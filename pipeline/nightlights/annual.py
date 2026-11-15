"""Yearly district stats from NASA Black Marble VNP46A4 (annual composites).

Annual composites combine a whole year of clear nights, so they have far fewer
cloud gaps than monthly ones. That makes them the better source for the long-term
trend line. Same method as the monthly run (nightlights.run): zonal stats per
district, gap-filled pixels dropped, results checkpointed one CSV per year.

  python -m nightlights.annual --start 2015 --end 2025

Writes data/stats/VNP46A4/YYYY.csv and data/yearly.json.
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

from . import run  # reuses its 4-way parallel download setting and helpers
from .config import COLLECTION, DATA, DROP_QUALITY_FLAGS, LIT_THRESHOLD, MIN_VALID_PCT, RAW, STATS, VARIABLE, get_token
from .zonal import apply_coverage_rule, zonal_stats

PRODUCT = Product.VNP46A4
STATS_DIR = STATS / PRODUCT.value
FAILURES = STATS_DIR / "failures.json"
YEARLY_JSON = DATA / "yearly.json"
CACHE = RAW / "india_yearly"
NODATA_U16 = run.NODATA_U16

log = logging.getLogger("nightlights")


def cache_path(year: int):
    return CACHE / f"{PRODUCT.value}_{year}.tif"


def save_cache(rast: xr.DataArray, year: int):
    CACHE.mkdir(parents=True, exist_ok=True)
    enc = np.clip(np.round(rast.values * 10), 0, NODATA_U16 - 1)
    enc = np.where(np.isnan(rast.values), NODATA_U16, enc).astype("uint16")
    out = rast.copy(data=enc).rio.write_crs(run.BLACK_MARBLE_CRS).rio.write_nodata(NODATA_U16)
    tmp = cache_path(year).with_suffix(".tmp.tif")
    out.rio.to_raster(tmp, compress="DEFLATE", predictor=2, tiled=True)
    tmp.replace(cache_path(year))


def load_cache(year: int) -> xr.DataArray:
    da = rioxarray.open_rasterio(cache_path(year)).squeeze(drop=True)
    vals = np.where(da.values == NODATA_U16, np.nan, da.values / 10).astype("float32")
    return da.copy(data=vals).rio.write_crs(run.BLACK_MARBLE_CRS).rio.write_nodata(np.nan)


def delete_raw(bm: BlackMarble, year: int):
    gc.collect()
    for f in bm.output_directory.glob(f"{PRODUCT.value}.A{year}001.*"):
        try:
            f.unlink(missing_ok=True)
        except PermissionError:
            log.warning(f"  could not delete {f.name} (in use); will retry next run")


def get_raster(bm, aoi, year: int, keep_raw: bool) -> xr.DataArray:
    if not cache_path(year).exists():
        ds = bm.raster(gdf=aoi, product_id=PRODUCT, date_range=dt.date(year, 1, 1), variable=VARIABLE)
        rast = ds[VARIABLE].isel(time=0) if "time" in ds[VARIABLE].dims else ds[VARIABLE]
        save_cache(rast, year)
        rast.close()
        del rast, ds
    if not keep_raw:
        delete_raw(bm, year)
    return load_cache(year)


def process_year(bm, aoi, districts, year: int, keep_raw: bool = False) -> pd.DataFrame:
    rast = get_raster(bm, aoi, year, keep_raw)
    df = apply_coverage_rule(zonal_stats(rast, districts, lit_threshold=LIT_THRESHOLD))
    df.insert(1, "year", year)
    return df


def build_yearly_json(districts: gpd.GeoDataFrame):
    """Compact file for the web: only what the trend chart needs (mean and coverage)."""
    ids = districts["id"].tolist()
    out = {
        "product": PRODUCT.value,
        "collection": COLLECTION,
        "variable": VARIABLE,
        "units": "nW/cm²/sr",
        "min_valid_pct": MIN_VALID_PCT,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "ids": ids,
        "years": [],
        "mean": [],
        "valid": [],
    }
    for f in sorted(STATS_DIR.glob("????.csv")):
        df = pd.read_csv(f).set_index("id").reindex(ids)
        out["years"].append(int(f.stem))
        out["mean"].append([None if pd.isna(v) else round(float(v), 2) for v in df["mean_rad"]])
        out["valid"].append([None if pd.isna(v) else round(float(v)) for v in df["valid_pct"]])
    YEARLY_JSON.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    return YEARLY_JSON


def record(year: int, err: Exception | None):
    failures = json.loads(FAILURES.read_text()) if FAILURES.exists() else {}
    if err is None:
        failures.pop(str(year), None)
    else:
        failures[str(year)] = f"{type(err).__name__}: {str(err).splitlines()[0][:300]}"
    FAILURES.write_text(json.dumps(failures, indent=2, sort_keys=True))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", type=int, required=True, help="first year, e.g. 2015")
    p.add_argument("--end", type=int, required=True, help="last year, e.g. 2025")
    p.add_argument("--force", action="store_true")
    p.add_argument("--keep-raw", action="store_true")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    districts = run.load_districts()
    aoi = run.area_of_interest(districts)
    bm = BlackMarble(
        token=get_token(),
        output_directory=RAW / "blackmarble" / PRODUCT.value,
        output_skip_if_exists=True,
        drop_values_by_quality_flag=DROP_QUALITY_FLAGS,
        collection=COLLECTION,
    )

    for year in range(args.start, args.end + 1):
        out = STATS_DIR / f"{year}.csv"
        if out.exists() and not args.force:
            log.info(f"{year}: already done, skipping")
            continue
        log.info(f"{year}: processing")
        try:
            df = process_year(bm, aoi, districts, year, keep_raw=args.keep_raw)
            run.write_atomic(df, out)
            record(year, None)
            log.info(f"  ok: {len(df)} districts, {df['mean_rad'].isna().sum()} gaps (<{MIN_VALID_PCT:.0f}% observed)")
        except KeyboardInterrupt:
            raise
        except Exception as e:
            record(year, e)
            log.warning(f"  FAILED: {type(e).__name__}: {str(e).splitlines()[0][:200]}")
            log.debug(traceback.format_exc())

    path = build_yearly_json(districts)
    log.info(f"wrote {path.relative_to(DATA.parent)} ({path.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
