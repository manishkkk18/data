"""Compute monthly district stats from NASA Black Marble VNP46A3.

Resumable: each finished month is written to data/stats/VNP46A3/YYYY-MM.csv and
skipped on the next run. Raw HDF5 tiles are cached in data/raw/blackmarble/, so
re-running a month after a crash doesn't re-download anything already fetched.

  python -m nightlights.run --start 2025-10 --end 2025-10 --qa
  python -m nightlights.run --start 2015-01 --end 2025-10        # backfill
"""

import argparse
import datetime as dt
import json
import logging
import traceback

import geopandas as gpd
import numpy as np
import pandas as pd
import rioxarray
import xarray as xr
from blackmarble import BlackMarble, Product

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


def fetch_raster(bm: BlackMarble, aoi: gpd.GeoDataFrame, month: dt.date):
    ds = bm.raster(gdf=aoi, product_id=PRODUCT, date_range=month, variable=VARIABLE)
    return ds[VARIABLE].isel(time=0) if "time" in ds[VARIABLE].dims else ds[VARIABLE]


# --- Raster cache --------------------------------------------------------------------
# NASA's raw files are ~1 GB per month for India (11 tiles with dozens of layers).
# We keep only the one layer we use, clipped to India and stored compactly:
# radiance x10 as uint16 (the source is already in 0.1 steps, so nothing is lost).
NODATA_U16 = 65535


def cache_path(month: dt.date):
    return CACHE / f"{PRODUCT.value}_{month:%Y-%m}.tif"


def save_cache(rast: xr.DataArray, month: dt.date):
    CACHE.mkdir(parents=True, exist_ok=True)
    enc = np.clip(np.round(rast.values * 10), 0, NODATA_U16 - 1)
    enc = np.where(np.isnan(rast.values), NODATA_U16, enc).astype("uint16")
    out = rast.copy(data=enc).rio.write_nodata(NODATA_U16)
    tmp = cache_path(month).with_suffix(".tmp.tif")
    out.rio.to_raster(tmp, compress="DEFLATE", predictor=2, tiled=True)
    tmp.replace(cache_path(month))


def load_cache(month: dt.date) -> xr.DataArray:
    da = rioxarray.open_rasterio(cache_path(month)).squeeze(drop=True)
    vals = np.where(da.values == NODATA_U16, np.nan, da.values / 10).astype("float32")
    return da.copy(data=vals).rio.write_nodata(np.nan)


def delete_raw(bm: BlackMarble, month: dt.date):
    """Remove this month's NASA tiles (and the library's per-tile GeoTIFFs)."""
    stamp = f".A{month.year}{month.timetuple().tm_yday:03d}."
    for f in bm.output_directory.glob(f"{PRODUCT.value}{stamp}*"):
        f.unlink(missing_ok=True)


def get_raster(bm, aoi, month: dt.date, keep_raw: bool) -> xr.DataArray:
    if cache_path(month).exists():
        return load_cache(month)
    rast = fetch_raster(bm, aoi, month)
    save_cache(rast, month)
    if not keep_raw:
        delete_raw(bm, month)
    return load_cache(month)  # use exactly what's cached, so reruns are identical


def process_month(bm, aoi, districts, month: dt.date, keep_raw: bool = False) -> pd.DataFrame:
    rast = get_raster(bm, aoi, month, keep_raw)
    df = apply_coverage_rule(zonal_stats(rast, districts, lit_threshold=LIT_THRESHOLD))
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
        "mean": [],
        "sum": [],
        "lit": [],
        "valid": [],
    }

    def col(df, name, nd):
        s = df.set_index("id")[name].reindex(ids)
        return [None if pd.isna(v) else round(float(v), nd) for v in s]

    for f in files:
        df = pd.read_csv(f)
        out["months"].append(f.stem)
        out["mean"].append(col(df, "mean_rad", 2))
        out["sum"].append(col(df, "sum_rad", 0))
        out["lit"].append(col(df, "lit_pct", 1))
        out["valid"].append(col(df, "valid_pct", 0))

    MONTHLY_JSON.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    return MONTHLY_JSON


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", required=True, help="YYYY-MM")
    p.add_argument("--end", required=True, help="YYYY-MM")
    p.add_argument("--force", action="store_true", help="recompute months that already have a CSV")
    p.add_argument("--qa", action="store_true", help="write a sanity-check PNG per month")
    p.add_argument("--keep-raw", action="store_true", help="keep NASA HDF5 tiles (~1 GB/month)")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    districts = load_districts()
    aoi = area_of_interest(districts)

    bm = BlackMarble(
        token=get_token(),
        output_directory=RAW / "blackmarble" / PRODUCT.value,
        output_skip_if_exists=True,
        drop_values_by_quality_flag=DROP_QUALITY_FLAGS,
        collection=COLLECTION,
    )

    todo = months(args.start, args.end)
    done = failed = 0
    for i, m in enumerate(todo, 1):
        key = m.strftime("%Y-%m")
        out = STATS_DIR / f"{key}.csv"
        if out.exists() and not args.force:
            log.info(f"[{i}/{len(todo)}] {key}: already done, skipping")
            continue
        log.info(f"[{i}/{len(todo)}] {key}: processing")
        try:
            df = process_month(bm, aoi, districts, m, keep_raw=args.keep_raw)
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
