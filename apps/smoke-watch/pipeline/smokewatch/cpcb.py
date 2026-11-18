"""Delhi PM2.5 from CPCB's own downloads, to fill days OpenAQ is missing (mid-Oct 2022 - 2024).

Input: station reports downloaded by hand from CPCB's CCR portal
(airquality.cpcb.gov.in/ccr, which needs a captcha), saved in data/cpcb/stations/.
Each file is one station's "24 Hours" (daily) PM2.5 report, Excel or CSV. The layout isn't
documented, so the reader looks for the header row itself: a row with a date column
("From Date", "Date", ...) and a PM2.5 column.

Rules (same spirit as the OpenAQ series, and gaps are never filled):
- A station-day is CPCB's own 24-hour value; blanks, "None", "NA" and values outside
  (0, 1500) are treated as missing.
- Delhi's daily value = mean of stations with a value that day; it needs >= MIN_STATIONS
  and >= MIN_SHARE of the usual number of stations, else it is a gap.

Output: data/cpcb/delhi_pm25_daily.json  {"YYYY-MM-DD": value or null, ...} plus metadata.

Usage (from pipeline/, no keys needed):  PYTHONPATH=. python -m smokewatch.cpcb
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import pandas as pd

from .config import DATA

log = logging.getLogger("smokewatch.cpcb")
FOLDER = DATA / "cpcb" / "stations"
OUT = DATA / "cpcb" / "delhi_pm25_daily.json"
MIN_STATIONS = 3
MIN_SHARE = 0.5
VALID = (0, 1500)

_DATE_HEAD = re.compile(r"^(from\s*date|date|from|start\s*date|timestamp|from\s*date\s*&?\s*time)$", re.I)
_PM25_HEAD = re.compile(r"pm\s*2[.\s_]*5", re.I)
_STATION = re.compile(r"station\s*(name)?\s*[:\-–]\s*(.+)", re.I)


def _cells(df: pd.DataFrame) -> list[list[str]]:
    return [["" if pd.isna(v) else str(v).strip() for v in row] for row in df.itertuples(index=False)]


def read_station(path: Path) -> tuple[str, pd.DataFrame]:
    """(station name, DataFrame[date, value]) from one CPCB report."""
    raw = pd.read_excel(path, header=None, dtype=object) if path.suffix.lower() in (".xlsx", ".xls") else pd.read_csv(path, header=None, dtype=object)
    rows = _cells(raw)
    station = path.stem
    head_i = date_c = pm_c = None
    for i, row in enumerate(rows):
        for cell in row:
            m = _STATION.search(cell)
            if m and station == path.stem:
                station = m.group(2).strip()
        dc = next((j for j, c in enumerate(row) if _DATE_HEAD.match(c)), None)
        pc = next((j for j, c in enumerate(row) if _PM25_HEAD.search(c)), None)
        if dc is not None and pc is not None:
            head_i, date_c, pm_c = i, dc, pc
            break
    if head_i is None:
        raise ValueError(f"{path.name}: no header row with a date column and a PM2.5 column")

    out = []
    for row in rows[head_i + 1:]:
        if len(row) <= max(date_c, pm_c) or not row[date_c]:
            continue
        d = pd.to_datetime(row[date_c], dayfirst=True, errors="coerce")
        if pd.isna(d):
            continue  # footer rows such as "Min", "Max", "Avg"
        v = pd.to_numeric(row[pm_c], errors="coerce")
        out.append({"date": d.date().isoformat(), "value": v})
    df = pd.DataFrame(out, columns=["date", "value"])
    lo, hi = VALID
    df.loc[~df["value"].between(lo, hi, inclusive="neither"), "value"] = float("nan")
    return station, df.drop_duplicates("date", keep="first")


def delhi_daily(stations: dict[str, pd.DataFrame]) -> dict[str, float | None]:
    """Delhi daily mean across stations, with the station-count rule; None = gap."""
    frames = [df.dropna(subset=["value"]).assign(station=name) for name, df in stations.items()]
    if not frames:
        return {}
    all_days = sorted({d for df in stations.values() for d in df["date"]})
    g = pd.concat(frames).groupby("date")["value"].agg(["mean", "count"]).reindex(all_days)
    g["count"] = g["count"].fillna(0)
    usual = g.loc[g["count"] > 0, "count"].median() if (g["count"] > 0).any() else 0
    ok = (g["count"] >= MIN_STATIONS) & (g["count"] >= MIN_SHARE * usual)
    return {d: (round(float(r["mean"]), 1) if ok[d] else None) for d, r in g.iterrows()}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    files = sorted(p for p in FOLDER.glob("*") if p.suffix.lower() in (".xlsx", ".xls", ".csv"))
    if not files:
        raise SystemExit(f"No CPCB files in {FOLDER}")
    stations: dict[str, pd.DataFrame] = {}
    for p in files:
        name, df = read_station(p)
        # Several files for one station (e.g. one per year) are joined.
        stations[name] = pd.concat([stations[name], df]).drop_duplicates("date") if name in stations else df
        log.info("%s: %s, %d days (%d with PM2.5)", p.name, name, len(df), df["value"].notna().sum())
    daily = delhi_daily(stations)
    OUT.write_text(json.dumps({
        "source": "CPCB CCR portal, station 24-hour PM2.5 reports downloaded by hand",
        "stations": sorted(stations),
        "rules": {"min_stations": MIN_STATIONS, "min_share_of_usual": MIN_SHARE},
        "daily": daily,
    }, indent=1), encoding="utf-8")
    good = sum(v is not None for v in daily.values())
    log.info("wrote %s: %d stations, %d days (%d with a Delhi value)", OUT.relative_to(DATA.parent), len(stations), len(daily), good)


if __name__ == "__main__":
    main()
