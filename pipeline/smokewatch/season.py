"""Burning seasons (15 Sep - 15 Dec), 2020 onward: NOAA-20 fire detections + Delhi daily PM2.5.

Why NOAA-20 only: it is the one VIIRS sensor with data for every season since 2018
(Suomi NPP stopped in Nov 2026, NOAA-21 started in 2023-24), so counts compare fairly
across years. Standard-processing (SP) archive data is used where it exists, near-real-time
(NRT) for recent weeks that SP hasn't reached yet.

Outputs (data/seasons/):
  index.json       every season's daily counts (total, India, per focus state) and Delhi PM2.5
  fires_YYYY.json  compact detections for the map, loaded only when that season is picked
Past seasons never change, so they are skipped if already built (use --force to redo).

Usage (from pipeline/, needs FIRMS_MAP_KEY and OPENAQ_API_KEY):
  PYTHONPATH=. python -m smokewatch.season --years 2020-2026
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from . import firms, openaq
from .attribute import attribute_fires
from .boundaries import load_districts
from .config import DATA, FOCUS_STATES, secret

log = logging.getLogger("smokewatch.season")
CPCB_DAILY = DATA / "cpcb" / "delhi_pm25_daily.json"
SEASON_DIR = DATA / "seasons"
START = (9, 15)
END = (12, 15)
FIRST_YEAR = 2020
SP, NRT = "VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"
NRT_DAYS = 150  # NRT is only kept for recent months; older chunks are SP-only
IST = timezone(timedelta(hours=5, minutes=30))
MIN_COVERAGE_PCT = 75  # a station-day needs >= 18 of 24 hours
MIN_STATIONS = 3
MIN_SHARE = 0.5  # of the season's median station count per day


def season_dates(year: int, today: date | None = None) -> tuple[date, date, bool]:
    """(first day, last day, complete). A season in progress ends yesterday (IST) and is not complete."""
    start, end = date(year, *START), date(year, *END)
    today = today or datetime.now(IST).date()
    if today <= end:
        return start, today - timedelta(days=1), False
    return start, end, True


def fetch_fires(key: str, start: date, end: date, today: date) -> tuple[pd.DataFrame, list[str]]:
    """NOAA-20 detections for [start, end], 5-day chunks: SP first, NRT where SP has nothing yet.
    Returns the detections and, per chunk, which product was used."""
    frames, used = [], []
    d = start
    while d <= end:
        days = min(firms.MAX_DAYS_PER_CALL, (end - d).days + 1)
        chunk = firms.fetch_api(key, [SP], d, d + timedelta(days=days - 1))
        src = "SP"
        if chunk.empty and (today - d).days <= NRT_DAYS:
            chunk = firms.fetch_api(key, [NRT], d, d + timedelta(days=days - 1))
            src = "NRT"
        frames.append(chunk)
        used.append(f"{d.isoformat()}:{src if len(chunk) else 'none'}")
        d += timedelta(days=days)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=firms.COLUMNS)
    if df.empty:
        return df, used
    df["acq_utc"] = pd.to_datetime(df["acq_utc"], utc=True)
    df[["latitude", "longitude", "frp"]] = df[["latitude", "longitude", "frp"]].apply(pd.to_numeric)
    df = firms.in_bbox(df).drop_duplicates(subset=["latitude", "longitude", "acq_utc"])
    # Keep detections whose IST date is inside the season.
    ist_day = df["acq_utc"].dt.tz_convert("Asia/Kolkata").dt.date
    return df[(ist_day >= start) & (ist_day <= end)].reset_index(drop=True), used


def daily_counts(fires: pd.DataFrame, start: date, end: date) -> dict:
    """Per IST day: all detections in the study area, those in India, and per focus state."""
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    idx = {d: i for i, d in enumerate(days)}
    out = {"total": [0] * len(days), "india": [0] * len(days), "states": {s: [0] * len(days) for s in FOCUS_STATES}}
    if fires.empty:
        return out
    ist_day = fires["acq_utc"].dt.tz_convert("Asia/Kolkata").dt.date
    for day, state in zip(ist_day, fires["state"]):
        i = idx.get(day)
        if i is None:
            continue
        out["total"][i] += 1
        if isinstance(state, str):
            out["india"][i] += 1
            if state in out["states"]:
                out["states"][state][i] += 1
    return out


def delhi_daily_pm25(sensor_days: pd.DataFrame) -> dict[str, float | None]:
    """sensor_days: sensor_id, date, value, pct. Delhi daily mean of station-days with enough
    hours; a day needs >= MIN_STATIONS and >= MIN_SHARE of the usual station count, else None."""
    if sensor_days.empty:
        return {}
    ok = sensor_days[(sensor_days["pct"].fillna(0) >= MIN_COVERAGE_PCT) & sensor_days["value"].between(0, 1500, inclusive="neither")]
    g = ok.groupby("date")["value"].agg(["mean", "count"])
    if g.empty:
        return {}
    usual = g["count"].median()
    good = (g["count"] >= MIN_STATIONS) & (g["count"] >= MIN_SHARE * usual)
    return {d: (round(float(r["mean"]), 1) if good[d] else None) for d, r in g.iterrows()}


def merge_cpcb(season: dict, cpcb: dict[str, float | None]) -> dict:
    """Fill a season's PM2.5 gaps from CPCB's own daily Delhi series (measurements, not
    estimates). OpenAQ values are never replaced. Adds pm25_source per day: 'openaq', 'cpcb' or None."""
    days = [(date.fromisoformat(season["start"]) + timedelta(days=i)).isoformat() for i in range(len(season["pm25"]))]
    old_src = season.get("pm25_source") or ["openaq" if v is not None else None for v in season["pm25"]]
    pm, src = [], []
    for d, v, s0 in zip(days, season["pm25"], old_src):
        if v is not None and s0 == "openaq":
            pm.append(v)
            src.append("openaq")
        elif cpcb.get(d) is not None:
            pm.append(cpcb[d])
            src.append("cpcb")
        else:
            pm.append(None)
            src.append(None)
    return {**season, "pm25": pm, "pm25_source": src}


def load_cpcb() -> dict[str, float | None]:
    return json.loads(CPCB_DAILY.read_text(encoding="utf-8"))["daily"] if CPCB_DAILY.exists() else {}


def fetch_pm25(key: str, start: date, end: date) -> tuple[dict, int]:
    sensors = openaq.list_sensors(key)
    if sensors.empty:
        return {}, 0
    s = sensors[sensors["parameter"] == "pm25"].copy()
    first = pd.to_datetime(s["first_utc"], utc=True, errors="coerce")
    last = pd.to_datetime(s["last_utc"], utc=True, errors="coerce")
    s = s[(first.dt.date <= end) & (last.dt.date >= start)]
    frames = []
    for sid in s["sensor_id"]:
        try:
            frames.append(openaq.fetch_days(key, int(sid), start.isoformat(), (end + timedelta(days=1)).isoformat()).assign(sensor_id=sid))
        except Exception as e:  # noqa: BLE001 — one sensor failing shouldn't stop the season
            log.warning("OpenAQ sensor %s days failed: %s", sid, e)
        time.sleep(1.1)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["sensor_id", "date", "value", "pct"])
    df = df[(df["date"] >= start.isoformat()) & (df["date"] <= end.isoformat())]
    return delhi_daily_pm25(df), len(s)


def fires_payload(fires: pd.DataFrame, districts, start: date) -> dict:
    """Compact rows: lon, lat, day index (IST, from season start), HHMM UTC, FRP, district index (-1 outside India)."""
    pos = {(s, d): i for i, (s, d) in enumerate(zip(districts["state"], districts["district"]))}
    rows = []
    if not fires.empty:
        ist_day = fires["acq_utc"].dt.tz_convert("Asia/Kolkata").dt.date
        for r, day in zip(fires.itertuples(), ist_day):
            di = pos.get((r.state, r.district), -1) if isinstance(r.district, str) else -1
            rows.append([round(r.longitude, 3), round(r.latitude, 3), (day - start).days,
                         int(r.acq_utc.strftime("%H%M")), round(float(r.frp), 1), di])
    return {"start": start.isoformat(), "sensor": "NOAA-20 VIIRS", "district_ids": list(districts["id"]),
            "columns": ["lon", "lat", "day", "hhmm_utc", "frp", "district"], "rows": rows}


def totals(fires: pd.DataFrame, districts) -> dict:
    """Season totals by state and the top districts (India only)."""
    if fires.empty:
        return {"by_state": [], "top_districts": []}
    f = fires.dropna(subset=["state"])
    ids = {(s, d): i for i, s, d in zip(districts["id"], districts["state"], districts["district"])}
    by_state = f.groupby("state").agg(n=("frp", "size"), frp=("frp", "sum")).sort_values("n", ascending=False)
    by_d = f.groupby(["state", "district"]).agg(n=("frp", "size"), frp=("frp", "sum")).sort_values("n", ascending=False).head(25)
    return {
        "by_state": [{"state": s, "n": int(r.n), "frp": round(float(r.frp))} for s, r in by_state.iterrows()],
        "top_districts": [{"id": ids.get(k), "n": int(r.n), "frp": round(float(r.frp))} for k, r in by_d.iterrows()],
    }


def build(year: int, firms_key: str, aq_key: str | None, today: date) -> dict:
    start, end, complete = season_dates(year, today)
    log.info("season %d: %s to %s (%s)", year, start, end, "complete" if complete else "in progress")
    districts = load_districts()
    fires, used = fetch_fires(firms_key, start, end, today)
    fires = attribute_fires(fires, districts)
    log.info("season %d: %d NOAA-20 detections (%d in India)", year, len(fires), fires["state"].notna().sum() if len(fires) else 0)
    (SEASON_DIR / f"fires_{year}.json").write_text(json.dumps(fires_payload(fires, districts, start), separators=(",", ":")), encoding="utf-8")

    pm, n_sensors = ({}, 0)
    if aq_key:
        pm, n_sensors = fetch_pm25(aq_key, start, end)
    days = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    out = {
        "year": year, "start": start.isoformat(), "end": end.isoformat(), "complete": complete,
        "built_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "fire_products": used, "pm25_sensors": n_sensors,
        "fires": daily_counts(fires, start, end),
        "pm25": [pm.get(d) for d in days],  # None = gap (not enough stations), never filled
        **totals(fires, districts),
    }
    return merge_cpcb(out, load_cpcb())


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default=f"{FIRST_YEAR}-{datetime.now(IST).year}")
    ap.add_argument("--force", action="store_true", help="rebuild seasons that are already complete")
    ap.add_argument("--apply-cpcb", action="store_true", help="only fill PM2.5 gaps in the existing index from CPCB data (no keys needed)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.apply_cpcb:
        index_path = SEASON_DIR / "index.json"
        index = json.loads(index_path.read_text(encoding="utf-8"))
        cpcb = load_cpcb()
        if not cpcb:
            raise SystemExit(f"No CPCB series at {CPCB_DAILY}: run python -m smokewatch.cpcb first")
        index["seasons"] = [merge_cpcb(s, cpcb) for s in index["seasons"]]
        index["note"] = ("NOAA-20 VIIRS detections only, for fair comparison across years. PM2.5: Delhi reference monitors via OpenAQ; "
                         "days OpenAQ is missing are filled from CPCB's own station reports where available (see pm25_source).")
        index_path.write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
        for s in index["seasons"]:
            src = s["pm25_source"]
            log.info("season %d: %d OpenAQ days, %d CPCB days, %d gaps", s["year"], src.count("openaq"), src.count("cpcb"), src.count(None))
        return
    a, _, b = args.years.partition("-")
    years = range(int(a), int(b or a) + 1)
    firms_key, aq_key = secret("FIRMS_MAP_KEY"), secret("OPENAQ_API_KEY")
    if not firms_key:
        raise SystemExit("FIRMS_MAP_KEY is required for season data")
    if not aq_key:
        log.warning("OPENAQ_API_KEY not set: seasons will have no PM2.5")

    SEASON_DIR.mkdir(parents=True, exist_ok=True)
    index_path = SEASON_DIR / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"seasons": []}
    have = {s["year"]: s for s in index["seasons"]}
    today = datetime.now(IST).date()
    for y in years:
        if y in have and have[y]["complete"] and not args.force and (SEASON_DIR / f"fires_{y}.json").exists():
            log.info("season %d already complete: skipped", y)
            continue
        have[y] = build(y, firms_key, aq_key, today)
        # Write after every season, so a later failure keeps the work done so far.
        index = {"generated_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                 "note": "NOAA-20 VIIRS detections only, for fair comparison across years. PM2.5: Delhi reference monitors via OpenAQ.",
                 "seasons": [have[k] for k in sorted(have)]}
        index_path.write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
