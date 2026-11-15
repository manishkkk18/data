"""Cross-check our state-level trends against ISRO Bhuvan's night-light statistics.

Bhuvan (NRSC/ISRO) publishes one yearly value per state, 2012 onwards, at
  https://bhuvan-app1.nrsc.gov.in/bhuvanNTL/getIndiaStats.php   (public, no login)

Its "avg" is defined differently from our mean radiance (Chandigarh reads ~1,100 there,
~40 here), so absolute values are not comparable. We compare *trends* instead: both
series indexed to 2015 = 100, and how well the two agree on which states brightened
most. Bhuvan's 2012-2023 values come from NASA Collection 1 and 2024 onwards from
Collection 2, so we measure agreement only up to 2023 and flag the break.

Our state value for a year is total light / total observed area across the state's
districts (so big districts count in proportion to their size). Source per year:
NASA's annual product (VNP46A4) when it has been processed, otherwise the average of
that year's processed monthly values, labelled as such.

  python -m nightlights.crosscheck            # uses cached Bhuvan data if present
  python -m nightlights.crosscheck --refresh  # re-download Bhuvan data
"""

import argparse
import datetime as dt
import json
import unicodedata

import geopandas as gpd
import httpx
import numpy as np
import pandas as pd

from .config import DATA, DISTRICTS_FULL, RAW, STATS

BHUVAN_URL = "https://bhuvan-app1.nrsc.gov.in/bhuvanNTL/getIndiaStats.php"
BHUVAN_RAW = RAW / "bhuvan" / "getIndiaStats.json"
OUT = DATA / "crosscheck.json"
BASE_YEAR = 2015
BREAK_YEAR = 2024  # Bhuvan switches from NASA Collection 1 to Collection 2

# Bhuvan spellings -> our state names. Bhuvan lists Dadra & Nagar Haveli and Daman & Diu
# separately; our boundaries have the merged UT, and we can't combine two averages
# without their areas, so those two are left out.
BHUVAN_NAMES = {
    "ANDAMAN AND NICOBAR": "Andaman and Nicobar Islands",
    "JAMMU & KASHMIR": "Jammu and Kashmir",
    "ODISSA": "Odisha",
    "TAMILNADU": "Tamil Nadu",
    "UTTARANCHAL": "Uttarakhand",
}
SKIP = {"DADRA & NAGAR HAVELI", "DAMAN AND DIU"}


def fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower().strip()


def load_bhuvan(refresh: bool) -> list[dict]:
    if refresh or not BHUVAN_RAW.exists():
        BHUVAN_RAW.parent.mkdir(parents=True, exist_ok=True)
        r = httpx.get(BHUVAN_URL, timeout=60, headers={"User-Agent": "india-night-lights pipeline"})
        r.raise_for_status()
        BHUVAN_RAW.write_bytes(r.content)
    return json.loads(BHUVAN_RAW.read_text(encoding="utf-8"))


def bhuvan_table(rows: list[dict], our_states: set[str]) -> tuple[pd.DataFrame, list[str]]:
    by_fold = {fold(s): s for s in our_states}
    out, unmatched = {}, []
    for r in rows:
        name = r["state"].strip()
        if name in SKIP:
            continue
        ours = BHUVAN_NAMES.get(name) or by_fold.get(fold(name))
        if not ours:
            unmatched.append(name)
            continue
        out[ours] = {int(k[4:]): float(v) for k, v in r.items() if k.startswith("avg_") and v not in (None, "")}
    return pd.DataFrame(out).T.sort_index(axis=1), unmatched


def state_values(stats: pd.DataFrame, state_of: pd.Series) -> pd.Series:
    """Total light / total observed area per state (observed area = sum / mean)."""
    df = stats.dropna(subset=["mean_rad", "sum_rad"])
    df = df[df["mean_rad"] > 0].assign(state=lambda d: d["id"].map(state_of))
    df = df.assign(pixels=df["sum_rad"] / df["mean_rad"])
    g = df.groupby("state")[["sum_rad", "pixels"]].sum()
    return g["sum_rad"] / g["pixels"]


def ours_table(state_of: pd.Series) -> tuple[pd.DataFrame, dict[int, str]]:
    years: dict[int, pd.Series] = {}
    source: dict[int, str] = {}
    for f in sorted((STATS / "VNP46A4").glob("????.csv")):
        years[int(f.stem)] = state_values(pd.read_csv(f), state_of)
        source[int(f.stem)] = "annual"
    monthly = sorted((STATS / "VNP46A3").glob("????-??.csv"))
    by_year: dict[int, list] = {}
    for f in monthly:
        by_year.setdefault(int(f.stem[:4]), []).append(f)
    for y, files in by_year.items():
        if y in years:
            continue
        per_month = [state_values(pd.read_csv(f), state_of) for f in files]
        years[y] = pd.concat(per_month, axis=1).mean(axis=1)
        source[y] = f"monthly ({len(files)} month{'s' if len(files) > 1 else ''})"
    return pd.DataFrame(years).sort_index(axis=1), source


def spearman(a: pd.Series, b: pd.Series) -> float | None:
    both = pd.concat([a, b], axis=1).dropna()
    if len(both) < 5:
        return None
    return float(both.iloc[:, 0].rank().corr(both.iloc[:, 1].rank()))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--refresh", action="store_true", help="re-download Bhuvan data")
    args = p.parse_args()

    districts = gpd.read_file(DISTRICTS_FULL)
    state_of = districts.set_index("id")["state"]
    bhuvan, unmatched = bhuvan_table(load_bhuvan(args.refresh), set(state_of.unique()))
    ours, source = ours_table(state_of)

    # Agreement on growth from 2015 to the latest year both have, before Bhuvan's break.
    common = [y for y in ours.columns if y in bhuvan.columns and BASE_YEAR < y < BREAK_YEAR]
    end = max(common) if common else None
    agreement = None
    if end and BASE_YEAR in ours.columns and BASE_YEAR in bhuvan.columns:
        g_ours = ours[end] / ours[BASE_YEAR]
        g_bhuvan = bhuvan[end] / bhuvan[BASE_YEAR]
        agreement = {"from": BASE_YEAR, "to": end, "spearman": spearman(g_ours, g_bhuvan), "states": int(pd.concat([g_ours, g_bhuvan], axis=1).dropna().shape[0])}

    def series(row: pd.Series) -> dict:
        return {str(int(y)): round(float(v), 3) for y, v in row.items() if pd.notna(v)}

    states = sorted(set(ours.index) | set(bhuvan.index))
    out = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "bhuvan_url": BHUVAN_URL,
        "base_year": BASE_YEAR,
        "break_year": BREAK_YEAR,
        "ours_source": {str(y): s for y, s in source.items()},
        "agreement": agreement,
        "excluded": sorted(SKIP) + unmatched,
        "states": [
            {"state": s, "ours": series(ours.loc[s]) if s in ours.index else {}, "bhuvan": series(bhuvan.loc[s]) if s in bhuvan.index else {}}
            for s in states
        ],
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"{len(states)} states; our years {list(ours.columns)} ({source}); Bhuvan years {list(bhuvan.columns)[0]}-{list(bhuvan.columns)[-1]}")
    print(f"unmatched Bhuvan names: {unmatched or 'none'}; agreement: {agreement}")
    print(f"wrote {OUT.relative_to(DATA.parent)} ({OUT.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main()
