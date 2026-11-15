"""The Diwali effect: how much brighter major cities are on Diwali night.

Uses NASA's daily product (VNP46A2, moonlight- and angle-corrected radiance) for the
nights around Diwali each year. A city's value for a night is its mean radiance over
its districts, from pixels NASA rates as good quality (cloudy/poor pixels dropped).

  effect = Diwali night / median of normal nights - 1

"Normal nights" are 3-7 days either side. The two days right around Diwali are left
out of the baseline because lights go up early (Dhanteras, Choti Diwali) and stay up
(Bhai Dooj). If Diwali night was cloudy, or fewer than 3 baseline nights were clear,
the effect is reported as missing rather than guessed.

Daily files are ~35 MB per tile and the 8 cities need 3 tiles, so a year costs ~1 GB
of downloads. Each night is checkpointed, so runs are resumable; raw files are deleted
after each night.

  python -m nightlights.diwali --years 2025
  python -m nightlights.diwali --years 2015-2026
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
from blackmarble import BlackMarble, Product

from . import run  # noqa: F401  (applies the 4-way parallel download setting)
from .config import COLLECTION, DATA, DISTRICTS_FULL, LIT_THRESHOLD, MIN_VALID_PCT, RAW, STATS, get_token
from .zonal import apply_coverage_rule, zonal_stats

PRODUCT = Product.VNP46A2
VARIABLE = "DNB_BRDF-Corrected_NTL"  # Collection 2 daily radiance, not gap-filled
# Daily quality flags: 0/1 high quality, 2 poor (outlier, likely cloud), 255 fill.
DAILY_DROP_FLAGS = [2, 255]
STATS_DIR = STATS / PRODUCT.value
OUT = DATA / "diwali.json"

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


def nights(year: int) -> list[tuple[int, dt.date]]:
    d0 = dt.date.fromisoformat(DIWALI[year])
    return [(o, d0 + dt.timedelta(days=o)) for o in range(-WINDOW, WINDOW + 1)]


def delete_raw(bm: BlackMarble, day: dt.date):
    gc.collect()
    for f in bm.output_directory.glob(f"{PRODUCT.value}.A{day.year}{day.timetuple().tm_yday:03d}.*"):
        try:
            f.unlink(missing_ok=True)
        except PermissionError:
            log.warning(f"  could not delete {f.name} (in use)")


def process_night(bm, cities: gpd.GeoDataFrame, day: dt.date) -> pd.DataFrame:
    try:
        ds = bm.raster(gdf=cities, product_id=PRODUCT, date_range=day, variable=VARIABLE)
        rast = ds[VARIABLE].isel(time=0) if "time" in ds[VARIABLE].dims else ds[VARIABLE]
        rast = rast.rio.write_crs(run.BLACK_MARBLE_CRS)
        df = apply_coverage_rule(zonal_stats(rast, cities, lit_threshold=LIT_THRESHOLD))
        rast.close()
        del rast, ds
    finally:
        delete_raw(bm, day)
    df.insert(1, "date", day.isoformat())
    return df


def effect_for(values: dict[int, float | None]) -> tuple[float | None, int]:
    base = [values[o] for o in BASELINE if values.get(o) is not None]
    night = values.get(0)
    if night is None or len(base) < MIN_BASELINE_NIGHTS:
        return None, len(base)
    med = float(np.median(base))
    return (night / med - 1) * 100 if med > 0 else None, len(base)


def build_json() -> dict:
    out = {
        "product": PRODUCT.value,
        "collection": COLLECTION,
        "variable": VARIABLE,
        "window": WINDOW,
        "baseline_offsets": BASELINE,
        "min_valid_pct": MIN_VALID_PCT,
        "cities": list(CITIES),
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "years": [],
    }
    for year in sorted(DIWALI):
        per_night: dict[int, dict[str, float | None]] = {}
        unavailable = []
        for o, day in nights(year):
            f = STATS_DIR / f"{day.isoformat()}.csv"
            if not f.exists():
                unavailable.append(o)
                continue
            df = pd.read_csv(f).set_index("id")
            per_night[o] = {c: (None if pd.isna(df.loc[c, "mean_rad"]) else round(float(df.loc[c, "mean_rad"]), 2)) for c in CITIES if c in df.index}
        if not per_night:
            continue
        effects, clear = {}, {}
        for c in CITIES:
            e, n = effect_for({o: v.get(c) for o, v in per_night.items()})
            effects[c] = None if e is None else round(e, 1)
            clear[c] = n
        out["years"].append(
            {
                "year": year,
                "date": DIWALI[year],
                "nights": {str(o): v for o, v in sorted(per_night.items())},
                "unavailable": unavailable,
                "effect": effects,
                "clear_baseline_nights": clear,
            }
        )
    return out


def parse_years(s: str) -> list[int]:
    if "-" in s:
        a, b = s.split("-")
        return list(range(int(a), int(b) + 1))
    return [int(y) for y in s.split(",")]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--years", required=True, help="e.g. 2025, 2015-2026 or 2019,2023")
    p.add_argument("--force", action="store_true")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    cities = city_polygons(gpd.read_file(DISTRICTS_FULL))
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
        log.info(f"Diwali {year} ({DIWALI[year]})")
        for o, day in nights(year):
            out = STATS_DIR / f"{day.isoformat()}.csv"
            if out.exists() and not args.force:
                continue
            try:
                df = process_night(bm, cities, day)
                run.write_atomic(df, out)
                ok = df["mean_rad"].notna().sum()
                log.info(f"  {day} ({o:+d}): {ok}/{len(df)} cities clear")
            except KeyboardInterrupt:
                raise
            except Exception as e:  # usually a missing NASA tile for that night; retried next run
                log.warning(f"  {day} ({o:+d}): unavailable ({type(e).__name__}: {str(e).splitlines()[0][:120]})")
                log.debug(traceback.format_exc())

    data = build_json()
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    for y in data["years"]:
        log.info(f"{y['year']}: " + ", ".join(f"{c} {'n/a' if v is None else f'{v:+.0f}%'}" for c, v in y["effect"].items()))
    log.info(f"wrote {OUT.relative_to(DATA.parent)}")


if __name__ == "__main__":
    main()
