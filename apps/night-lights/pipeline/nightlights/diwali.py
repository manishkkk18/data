"""The Diwali effect: how much brighter each district (and 8 major cities) is on Diwali night.

Uses NASA's daily product (VNP46A2, moonlight- and angle-corrected radiance) for the
nights around Diwali each year. A district's or city's value for a night is its mean
radiance from pixels NASA rates as good quality (cloudy/poor pixels dropped).

  effect = Diwali night / median of normal nights - 1

"Normal nights" are 3-7 days either side. The two days right around Diwali are left
out of the baseline because lights go up early (Dhanteras, Choti Diwali) and stay up
(Bhai Dooj). If Diwali night was cloudy, or fewer than 3 baseline nights were clear,
the effect is reported as missing rather than guessed.

All of India needs 11 daily tiles (~35 MB each), so a year costs ~4.7 GB of downloads.
NASA is sometimes missing a tile on a night; tiles are fetched one by one so a missing
tile only blanks its own area. Each night is checkpointed (resumable) and raw files
are deleted after each night.

  python -m nightlights.diwali --years 2025
  python -m nightlights.diwali --years 2015-2026

Writes data/diwali.json (cities) and data/diwali_districts.json (every district).
"""

import argparse
import asyncio
import datetime as dt
import gc
import json
import logging
import traceback

import geopandas as gpd
import numpy as np
import pandas as pd
from blackmarble import TILES, BlackMarble, Product
from blackmarble.download import BlackMarbleDownloader
from pqdm.threads import pqdm
from rioxarray.merge import merge_arrays

from . import run  # applies the 4-way parallel download setting; shared helpers
from .config import COLLECTION, DATA, DISTRICTS_FULL, LIT_THRESHOLD, MIN_VALID_PCT, RAW, STATS, get_token
from .zonal import apply_coverage_rule, zonal_stats

PRODUCT = Product.VNP46A2
VARIABLE = "DNB_BRDF-Corrected_NTL"  # Collection 2 daily radiance, not gap-filled
# Daily quality flags: 0/1 high quality, 2 poor (outlier, likely cloud), 255 fill.
DAILY_DROP_FLAGS = [2, 255]
STATS_DIR = STATS / "VNP46A2_india"  # one CSV per night: every district + the cities
CITY_ONLY_DIR = STATS / PRODUCT.value  # older city-only checkpoints (used as a fallback)
OUT = DATA / "diwali.json"
OUT_DISTRICTS = DATA / "diwali_districts.json"

# Lakshmi Puja (main Diwali night). All fall on or next to a new moon.
DIWALI = {
    2015: "2015-11-11",
    2016: "2016-10-30",
    2017: "2017-10-19",
    2018: "2018-11-07",
    2019: "2019-10-27",
    2020: "2020-11-14",
    2021: "2021-11-04",
    2022: "2022-10-24",
    2023: "2023-11-12",
    2024: "2024-10-31",
    2025: "2025-10-20",
    2026: "2026-11-08",
}
WINDOW = 7  # nights either side
BASELINE = [o for o in range(-WINDOW, WINDOW + 1) if abs(o) >= 3]
MIN_BASELINE_NIGHTS = 3
LEADER_MIN_NIGHTS = 5  # clear normal nights behind a leaderboard entry
LEADER_MIN_BASE = 2.0  # nW/cm²/sr on a normal night: lit districts only
NOT_A_DISTRICT = {"ladakh--data-not-available"}  # source placeholder, not a district

# Cities as sets of districts (ids from data/districts.geojson).
CITIES = {
    "Delhi": "delhi--*",
    "Mumbai": ["maharashtra--mumbai", "maharashtra--mumbai-suburban"],
    "Kolkata": ["west-bengal--kolkata"],
    "Ahmedabad": ["gujarat--ahmadabad"],
    "Jaipur": ["rajasthan--jaipur"],
    "Lucknow": ["uttar-pradesh--lucknow"],
    "Patna": ["bihar--patna"],
    "Hyderabad": ["telangana--hyderabad"],
}

log = logging.getLogger("nightlights")


def city_polygons(districts: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    rows = []
    for name, ids in CITIES.items():
        mask = districts["id"].str.startswith(ids[:-1]) if isinstance(ids, str) else districts["id"].isin(ids)
        part = districts[mask]
        if part.empty:
            raise SystemExit(f"No districts found for {name}: {ids}")
        rows.append({"id": name, "geometry": part.union_all()})
    return gpd.GeoDataFrame(rows, crs=districts.crs)


def zones(districts: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Every district plus the 8 cities, measured in one pass over each night's raster."""
    d = districts[["id", "geometry"]].copy()
    return gpd.GeoDataFrame(pd.concat([d, city_polygons(districts)], ignore_index=True), crs=districts.crs)


def nights(year: int) -> list[tuple[int, dt.date]]:
    d0 = dt.date.fromisoformat(DIWALI[year])
    return [(o, d0 + dt.timedelta(days=o)) for o in range(-WINDOW, WINDOW + 1)]


def tile_parts(aoi: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """India split along NASA's 10° tiles, each part shrunk a hair so it touches one tile only."""
    parts = gpd.overlay(aoi.to_crs("EPSG:4326"), TILES, how="intersection")
    parts["geometry"] = parts.buffer(-0.001)
    return parts[~parts.is_empty].reset_index(drop=True)


def delete_raw(bm: BlackMarble, day: dt.date):
    gc.collect()
    for f in bm.output_directory.glob(f"{PRODUCT.value}.A{day.year}{day.timetuple().tm_yday:03d}.*"):
        try:
            f.unlink(missing_ok=True)
        except PermissionError:
            log.warning(f"  could not delete {f.name} (in use)")


PREFETCH_JOBS = 6


def prefetch(bm, parts: gpd.GeoDataFrame, day: dt.date):
    """Download the night's available tiles in parallel before processing them one by one.

    Fetching tile by tile through the library would download them one at a time; NASA's
    server is slow per connection, so parallel downloads are several times faster.
    """
    dl = BlackMarbleDownloader(bm._token, bm.output_directory, collection=COLLECTION)
    manifest = asyncio.run(dl.get_manifest(parts[["TileID", "geometry"]], PRODUCT, [day]))
    links = manifest[manifest["TileID"].isin(parts["TileID"])]["downloadsLink"].tolist()
    if links:
        pqdm([(link, True) for link in links], dl._download_file, n_jobs=PREFETCH_JOBS, argument_type="args", disable=True)


def fetch_night(bm, parts: gpd.GeoDataFrame, day: dt.date):
    """Radiance for the night, tile by tile. Returns (raster, missing tile ids)."""
    try:
        prefetch(bm, parts, day)
    except Exception as e:  # fall back to the slower tile-by-tile downloads below
        log.debug(f"  prefetch failed: {type(e).__name__}: {e}")
    arrays, missing = [], []
    for _, part in parts.iterrows():
        g = gpd.GeoDataFrame(geometry=[part.geometry], crs="EPSG:4326")
        try:
            ds = bm.raster(gdf=g, product_id=PRODUCT, date_range=day, variable=VARIABLE)
            da = ds[VARIABLE].isel(time=0) if "time" in ds[VARIABLE].dims else ds[VARIABLE]
            arrays.append(da.load().copy().rio.write_crs(run.BLACK_MARBLE_CRS).rio.write_nodata(np.nan))
            ds.close()
        except KeyboardInterrupt:
            raise
        except Exception as e:  # usually that tile isn't in NASA's archive for the night
            missing.append(part["TileID"])
            log.debug(f"  tile {part['TileID']} unavailable: {type(e).__name__}: {e}")
    if not arrays:
        raise ValueError(f"no tiles available for {day}")
    merged = arrays[0] if len(arrays) == 1 else merge_arrays(arrays, nodata=np.nan)
    return merged.rio.write_crs(run.BLACK_MARBLE_CRS), missing


def process_night(bm, parts, zone_gdf, day: dt.date) -> pd.DataFrame:
    try:
        rast, missing = fetch_night(bm, parts, day)
        df = apply_coverage_rule(zonal_stats(rast, zone_gdf, lit_threshold=LIT_THRESHOLD))
        del rast
    finally:
        delete_raw(bm, day)
    df.insert(1, "date", day.isoformat())
    df["missing_tiles"] = ",".join(missing)
    return df[["id", "date", "mean_rad", "valid_pct", "missing_tiles"]]


def effect_for(values: dict[int, float | None]) -> tuple[float | None, int]:
    base = [values[o] for o in BASELINE if values.get(o) is not None]
    night = values.get(0)
    if night is None or len(base) < MIN_BASELINE_NIGHTS:
        return None, len(base)
    med = float(np.median(base))
    return (night / med - 1) * 100 if med > 0 else None, len(base)


def read_night(day: dt.date) -> pd.DataFrame | None:
    f = STATS_DIR / f"{day.isoformat()}.csv"
    if f.exists():
        return pd.read_csv(f).set_index("id")
    old = CITY_ONLY_DIR / f"{day.isoformat()}.csv"  # city-only checkpoint from the first version
    return pd.read_csv(old).set_index("id") if old.exists() else None


def val(df: pd.DataFrame, key: str) -> float | None:
    if key not in df.index or pd.isna(df.loc[key, "mean_rad"]):
        return None
    return round(float(df.loc[key, "mean_rad"]), 2)


def build_json(district_ids: list[str]) -> tuple[dict, dict]:
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    common = {"product": PRODUCT.value, "collection": COLLECTION, "variable": VARIABLE, "window": WINDOW,
              "baseline_offsets": BASELINE, "min_valid_pct": MIN_VALID_PCT, "generated": now}
    cities = {**common, "cities": list(CITIES), "years": []}
    dists = {**common, "ids": district_ids, "years": []}
    for year in sorted(DIWALI):
        per_night = {o: read_night(day) for o, day in nights(year)}
        have = {o: df for o, df in per_night.items() if df is not None}
        if not have:
            continue
        unavailable = [o for o, df in per_night.items() if df is None]
        # Cities
        c_nights = {str(o): {c: val(df, c) for c in CITIES} for o, df in sorted(have.items())}
        c_eff, c_clear = {}, {}
        for c in CITIES:
            e, n = effect_for({o: val(df, c) for o, df in have.items()})
            c_eff[c], c_clear[c] = (None if e is None else round(e, 1)), n
        cities["years"].append({"year": year, "date": DIWALI[year], "nights": c_nights, "unavailable": unavailable,
                                "effect": c_eff, "clear_baseline_nights": c_clear})
        # Districts: only from all-India checkpoints
        if not any(district_ids[0] in df.index for df in have.values()):
            continue
        d_nights = {str(o): [val(df, i) for i in district_ids] for o, df in sorted(have.items())}
        effects, clear, top = [], [], []
        for k, i in enumerate(district_ids):
            vals = {int(o): v[k] for o, v in d_nights.items()}
            e, n = effect_for(vals)
            effects.append(None if e is None else round(e, 1))
            clear.append(n)
            base = [vals[o] for o in BASELINE if vals.get(o) is not None]
            med = float(np.median(base)) if base else 0.0
            # Leaders need a solid comparison and a lit district, so dim places swinging
            # from 0.1 to 0.4 ("+300%") don't top the list.
            if e is not None and n >= LEADER_MIN_NIGHTS and med >= LEADER_MIN_BASE and i not in NOT_A_DISTRICT:
                top.append({"id": i, "effect": round(e, 1), "night": vals[0], "base": round(med, 2), "clear": n})
        top.sort(key=lambda r: -r["effect"])
        # A short leaderboard in the small cities file, so the site can show it without
        # loading the full per-district file.
        cities["years"][-1]["district_top"] = top[:5]
        dists["years"].append({"year": year, "date": DIWALI[year], "unavailable": unavailable, "effect": effects,
                               "clear_baseline_nights": clear, "nights": d_nights})
    return cities, dists


def parse_years(s: str) -> list[int]:
    if "-" in s:
        a, b = s.split("-")
        return list(range(int(a), int(b) + 1))
    return [int(y) for y in s.split(",")]


def write_outputs(district_ids: list[str]):
    cities, dists = build_json(district_ids)
    OUT.write_text(json.dumps(cities, separators=(",", ":"), ensure_ascii=False))
    if dists["years"]:
        OUT_DISTRICTS.write_text(json.dumps(dists, separators=(",", ":"), ensure_ascii=False))
    return cities, dists


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--years", required=True, help="e.g. 2025, 2015-2026 or 2019,2023")
    p.add_argument("--force", action="store_true")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    districts = gpd.read_file(DISTRICTS_FULL)
    zone_gdf = zones(districts)
    parts = tile_parts(run.area_of_interest(districts))
    bm = BlackMarble(
        token=get_token(),
        output_directory=RAW / "blackmarble" / PRODUCT.value,
        output_skip_if_exists=True,
        drop_values_by_quality_flag=DAILY_DROP_FLAGS,
        collection=COLLECTION,
    )
    for year in parse_years(args.years):
        if year not in DIWALI:
            log.warning(f"No Diwali date listed for {year}; skipping")
            continue
        log.info(f"Diwali {year} ({DIWALI[year]}), {len(parts)} tiles per night")
        for o, day in nights(year):
            out = STATS_DIR / f"{day.isoformat()}.csv"
            if out.exists() and not args.force:
                continue
            try:
                df = process_night(bm, parts, zone_gdf, day)
                run.write_atomic(df, out)
                d = df[~df["id"].isin(CITIES)]
                miss = df["missing_tiles"].iloc[0]
                log.info(f"  {day} ({o:+d}): {d['mean_rad'].notna().sum()}/{len(d)} districts clear" + (f", missing tiles {miss}" if miss else ""))
            except KeyboardInterrupt:
                raise
            except Exception as e:  # nothing at all for that night; retried next run
                log.warning(f"  {day} ({o:+d}): unavailable ({type(e).__name__}: {str(e).splitlines()[0][:120]})")
                log.debug(traceback.format_exc())

    cities, dists = write_outputs(districts["id"].tolist())
    for y in cities["years"]:
        log.info(f"{y['year']}: " + ", ".join(f"{c} {'n/a' if v is None else f'{v:+.0f}%'}" for c, v in y["effect"].items()))
    log.info(f"wrote {OUT.relative_to(DATA.parent)}" + (f" and {OUT_DISTRICTS.relative_to(DATA.parent)}" if dists["years"] else ""))


if __name__ == "__main__":
    main()
