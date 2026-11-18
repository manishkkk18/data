"""Compute monthly district stats from NASA Black Marble VNP46A3.

Resumable: each finished month is written to data/stats/VNP46A3/YYYY-MM.csv and
skipped on the next run. Raw HDF5 tiles are cached in data/raw/blackmarble/, so
re-running a month after a crash doesn't re-download anything already fetched.

  python -m nightlights.run --start 2025-10 --end 2025-10 --qa
  python -m nightlights.run --start 2015-01 --end 2025-10        # backfill
"""

import argparse
import datetime as dt
import gc
import json
import logging
import traceback

import geopandas as gpd
import numpy as np
import pandas as pd
import rioxarray
import xarray as xr
from blackmarble import BlackMarble, Product
from blackmarble.download import BlackMarbleDownloader

from .config import (
    COLLECTION,
    DATA,
    DISTRICTS_FULL,
    DROP_QUALITY_FLAGS,
    LIT_THRESHOLD,
    MIN_VALID_PCT,
    RAW,
    STATS,
    VARIABLE,
    get_token,
)
from .zonal import apply_coverage_rule, zonal_stats

PRODUCT = Product.VNP46A3

# NASA's server is slow per connection (~0.3 MB/s) rather than overall, so download 4
# tiles at once instead of the library's fixed 2. Kept modest to be fair to the server.
PARALLEL_DOWNLOADS = 4
_library_download = BlackMarbleDownloader.download


def _download_in_parallel(self, *args, n_jobs: int = PARALLEL_DOWNLOADS, **kwargs):
    return _library_download(self, *args, n_jobs=n_jobs, **kwargs)


BlackMarbleDownloader.download = _download_in_parallel

STATS_DIR = STATS / PRODUCT.value
FAILURES = STATS_DIR / "failures.json"
MONTHLY_JSON = DATA / "monthly.json"
CACHE = RAW / "india_monthly"

log = logging.getLogger("nightlights")


def months(start: str, end: str) -> list[dt.date]:
    return [d.date() for d in pd.date_range(f"{start}-01", f"{end}-01", freq="MS")]


def load_districts() -> gpd.GeoDataFrame:
    if not DISTRICTS_FULL.exists():
        raise SystemExit("Boundaries missing. Run: python -m nightlights.boundaries")
    return gpd.read_file(DISTRICTS_FULL)


def area_of_interest(districts: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """A light-weight India outline for clipping the raster (faster than 735 polygons)."""
    outline = districts.dissolve().to_crs("EPSG:6933").simplify(1000).buffer(2000).to_crs(districts.crs)
    return gpd.GeoDataFrame(geometry=outline, crs=districts.crs)


QUALITY = "NearNadir_Composite_Snow_Free_Quality"
GAP_FILLED = 2  # NASA quality flag: "gap filled based on historical data"
# We fetch with only "no data" (255) removed, keep each pixel's quality flag, and split
# the two ourselves: observed stats drop gap-filled pixels exactly as before, and the
# gap-filled values become a separately labelled "NASA estimate" for cloudy months.
FETCH_DROP_FLAGS = [255]


def fetch_layer(bm: BlackMarble, aoi: gpd.GeoDataFrame, month: dt.date, variable: str) -> xr.DataArray:
    ds = bm.raster(gdf=aoi, product_id=PRODUCT, date_range=month, variable=variable)
    da = ds[variable].isel(time=0) if "time" in ds[variable].dims else ds[variable]
    # Pull it into memory: the library writes every variable to the same GeoTIFF name,
    # so the next layer would overwrite a file this array still reads lazily.
    out = da.load().copy()
    da.close()
    ds.close()
    del da, ds
    gc.collect()
    return out


def fetch_raster(bm: BlackMarble, aoi: gpd.GeoDataFrame, month: dt.date):
    return fetch_layer(bm, aoi, month, VARIABLE)


# --- Raster cache --------------------------------------------------------------------
# NASA's raw files are ~1 GB per month for India (11 tiles with dozens of layers).
# We keep only the one layer we use, clipped to India and stored compactly:
# radiance x10 as uint16 (the source is already in 0.1 steps, so nothing is lost).
NODATA_U16 = 65535
BLACK_MARBLE_CRS = "EPSG:4326"  # the library drops it from its output; tiles are always lat/lon


def cache_path(month: dt.date):
    return CACHE / f"{PRODUCT.value}_{month:%Y-%m}.tif"


def save_cache(rast: xr.DataArray, month: dt.date):
    CACHE.mkdir(parents=True, exist_ok=True)
    enc = np.clip(np.round(rast.values * 10), 0, NODATA_U16 - 1)
    enc = np.where(np.isnan(rast.values), NODATA_U16, enc).astype("uint16")
    out = rast.copy(data=enc).rio.write_crs(BLACK_MARBLE_CRS).rio.write_nodata(NODATA_U16)
    tmp = cache_path(month).with_suffix(".tmp.tif")
    out.rio.to_raster(tmp, compress="DEFLATE", predictor=2, tiled=True)
    tmp.replace(cache_path(month))


def load_cache(month: dt.date) -> xr.DataArray:
    # Read fully and close: on Windows an open file can't be replaced or deleted later.
    with rioxarray.open_rasterio(cache_path(month)) as src:
        da = src.squeeze(drop=True).load()
    vals = np.where(da.values == NODATA_U16, np.nan, da.values / 10).astype("float32")
    return da.copy(data=vals).rio.write_crs(BLACK_MARBLE_CRS).rio.write_nodata(np.nan)


def delete_raw(bm: BlackMarble, month: dt.date):
    """Remove this month's NASA tiles (and the library's per-tile GeoTIFFs)."""
    gc.collect()  # on Windows, files still referenced by xarray can't be deleted
    stamp = f".A{month.year}{month.timetuple().tm_yday:03d}."
    for f in bm.output_directory.glob(f"{PRODUCT.value}{stamp}*"):
        try:
            f.unlink(missing_ok=True)
        except PermissionError:  # cleanup must never fail a month; retried next run
            log.warning(f"  could not delete {f.name} (in use); will retry next run")


def quality_path(month: dt.date):
    return CACHE / f"{PRODUCT.value}_{month:%Y-%m}_quality.tif"


def save_quality(q: xr.DataArray, month: dt.date):
    CACHE.mkdir(parents=True, exist_ok=True)
    enc = np.where(np.isnan(q.values), 255, q.values).astype("uint8")
    out = q.copy(data=enc).rio.write_crs(BLACK_MARBLE_CRS).rio.write_nodata(255)
    tmp = quality_path(month).with_suffix(".tmp.tif")
    out.rio.to_raster(tmp, compress="DEFLATE", tiled=True)
    tmp.replace(quality_path(month))


def get_rasters(bm, aoi, month: dt.date, keep_raw: bool, refetch_old: bool = False):
    """Return (observed, estimate) radiance for the month.

    observed: gap-filled pixels removed (what all stats use).
    estimate: observed plus NASA's gap-filled pixels; None for months cached before
    quality flags were kept (re-fetch them with --force to get estimates).
    """
    old_format = cache_path(month).exists() and not quality_path(month).exists()
    if not cache_path(month).exists() or (old_format and refetch_old):
        rad = fetch_layer(bm, aoi, month, VARIABLE)
        save_cache(rad, month)
        del rad
        q = fetch_layer(bm, aoi, month, QUALITY)
        save_quality(q, month)
        del q
        gc.collect()
    if not keep_raw:
        delete_raw(bm, month)  # also tidies leftovers from an earlier interrupted run
    full = load_cache(month)  # use exactly what's cached, so reruns are identical
    if not quality_path(month).exists():
        return full, None  # old cache: gap-filled pixels were already removed
    with rioxarray.open_rasterio(quality_path(month)) as src:
        q = src.squeeze(drop=True).values.copy()
    observed = full.copy(data=np.where(q == GAP_FILLED, np.nan, full.values).astype("float32"))
    return observed, full


def get_raster(bm, aoi, month: dt.date, keep_raw: bool) -> xr.DataArray:
    return get_rasters(bm, aoi, month, keep_raw)[0]


def process_month(bm, aoi, districts, month: dt.date, keep_raw: bool = False, refetch_old: bool = False) -> pd.DataFrame:
    observed, estimate = get_rasters(bm, aoi, month, keep_raw, refetch_old)
    df = apply_coverage_rule(zonal_stats(observed, districts, lit_threshold=LIT_THRESHOLD))
    if estimate is not None:
        est = zonal_stats(estimate, districts, lit_threshold=LIT_THRESHOLD)
        df["est_mean_rad"] = est["mean_rad"].to_numpy()
        df["est_valid_pct"] = est["valid_pct"].to_numpy()
    else:
        df["est_mean_rad"] = np.nan
        df["est_valid_pct"] = np.nan
    df.insert(1, "month", month.strftime("%Y-%m"))
    return df


def write_atomic(df: pd.DataFrame, path):
    tmp = path.with_suffix(".tmp")
    df.to_csv(tmp, index=False, float_format="%.4f")
    tmp.replace(path)  # a crash mid-write never leaves a half-written checkpoint


def record_failure(month: str, err: Exception):
    failures = json.loads(FAILURES.read_text()) if FAILURES.exists() else {}
    failures[month] = f"{type(err).__name__}: {str(err).splitlines()[0][:300]}"
    FAILURES.write_text(json.dumps(failures, indent=2, sort_keys=True))


def clear_failure(month: str):
    if FAILURES.exists():
        failures = json.loads(FAILURES.read_text())
        if failures.pop(month, None) is not None:
            FAILURES.write_text(json.dumps(failures, indent=2, sort_keys=True))


def build_monthly_json(districts: gpd.GeoDataFrame):
    """Combine all month CSVs into one compact, column-oriented file for the web.

    Layout: arrays indexed [month][district], with null for gaps. Much smaller than
    one object per district-month.
    """
    files = sorted(STATS_DIR.glob("????-??.csv"))
    ids = districts["id"].tolist()
    out = {
        "product": PRODUCT.value,
        "collection": COLLECTION,
        "variable": VARIABLE,
        "units": "nW/cm²/sr",
        "lit_threshold": LIT_THRESHOLD,
        "min_valid_pct": MIN_VALID_PCT,
        "dropped_quality_flags": DROP_QUALITY_FLAGS,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "ids": ids,
        "months": [],
        # National average radiance per month: total light / total observed area. Shipped
        # instead of each district's "sum of lights", which was the largest array.
        "national_avg": [],
        "mean": [],
        "lit": [],
        "valid": [],
        # NASA's gap-filled estimate, only where our observed value is a gap (else null)
        "est": [],
    }

    def col(df, name, nd):
        s = df.set_index("id")[name].reindex(ids)
        return [None if pd.isna(v) else round(float(v), nd) for v in s]

    for f in files:
        df = pd.read_csv(f)
        out["months"].append(f.stem)
        out["mean"].append(col(df, "mean_rad", 2))
        ok = df[(df["mean_rad"] > 0) & df["sum_rad"].notna()]
        pixels = (ok["sum_rad"] / ok["mean_rad"]).sum()
        out["national_avg"].append(round(float(ok["sum_rad"].sum() / pixels), 3) if pixels > 0 else None)
        out["lit"].append(col(df, "lit_pct", 1))
        out["valid"].append(col(df, "valid_pct", 0))
        if "est_mean_rad" in df:
            e = df.set_index("id").reindex(ids)
            usable = e["mean_rad"].isna() & e["est_mean_rad"].notna() & (e["est_valid_pct"] >= MIN_VALID_PCT)
            out["est"].append([round(float(v), 2) if ok else None for v, ok in zip(e["est_mean_rad"], usable)])
        else:
            out["est"].append([None] * len(ids))  # month cached before estimates existed

    MONTHLY_JSON.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    return MONTHLY_JSON


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", required=True, help="YYYY-MM")
    p.add_argument("--end", required=True, help="YYYY-MM")
    p.add_argument("--force", action="store_true", help="recompute months that already have a CSV (re-downloads months cached before quality flags were kept)")
    p.add_argument("--qa", action="store_true", help="write a sanity-check PNG per month")
    p.add_argument("--keep-raw", action="store_true", help="keep NASA HDF5 tiles (~1 GB/month)")
    p.add_argument(
        "--fill-estimates",
        action="store_true",
        help="also redo months processed before NASA estimates were kept (their CSV lacks est_mean_rad)",
    )
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    districts = load_districts()
    aoi = area_of_interest(districts)

    bm = BlackMarble(
        token=get_token(),
        output_directory=RAW / "blackmarble" / PRODUCT.value,
        output_skip_if_exists=True,
        drop_values_by_quality_flag=FETCH_DROP_FLAGS,  # gap-filled split out in get_rasters
        collection=COLLECTION,
    )

    todo = months(args.start, args.end)
    done = failed = 0
    for i, m in enumerate(todo, 1):
        key = m.strftime("%Y-%m")
        out = STATS_DIR / f"{key}.csv"
        needs_estimates = args.fill_estimates and out.exists() and "est_mean_rad" not in out.read_text(encoding="utf-8").splitlines()[0]
        if out.exists() and not args.force and not needs_estimates:
            log.info(f"[{i}/{len(todo)}] {key}: already done, skipping")
            continue
        log.info(f"[{i}/{len(todo)}] {key}: processing")
        try:
            df = process_month(bm, aoi, districts, m, keep_raw=args.keep_raw, refetch_old=args.force or needs_estimates)
            write_atomic(df, out)
            clear_failure(key)
            done += 1
            gaps = df["mean_rad"].isna().sum()
            log.info(f"  ok: {len(df)} districts, {gaps} gaps (<{MIN_VALID_PCT:.0f}% observed)")
            if args.qa:
                from .qa import report

                report(key)
        except KeyboardInterrupt:
            raise
        except Exception as e:  # keep going; the month is retried next run
            failed += 1
            record_failure(key, e)
            log.warning(f"  FAILED: {type(e).__name__}: {str(e).splitlines()[0][:200]}")
            log.debug(traceback.format_exc())

    path = build_monthly_json(districts)
    log.info(f"done={done} failed={failed}; wrote {path.relative_to(DATA.parent)} ({path.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
