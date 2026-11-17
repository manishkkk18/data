"""Recent-days pipeline: fires + wind + Delhi air quality -> data/*.json.

Usage (from pipeline/):  PYTHONPATH=. python -m smokewatch.run --days 7
"""
from __future__ import annotations

import argparse
import json
import logging
import math
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from . import firms, openaq, upwind, wind
from .attribute import attribute_fires
from .boundaries import load_districts
from .config import CONSISTENT_SENSORS, DATA, DELHI, secret

log = logging.getLogger("smokewatch")
IST = "Asia/Kolkata"
HISTORY_DAYS = 3  # extra days of fires and wind behind the window, for 48 h trajectories


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _clean(v):
    """JSON-safe: NaN -> None (gaps stay gaps)."""
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def write_json(name: str, obj) -> None:
    path = DATA / name
    path.write_text(json.dumps(obj, separators=(",", ":"), default=str), encoding="utf-8")
    log.info("wrote %s (%.1f KB)", path.relative_to(DATA.parent), path.stat().st_size / 1024)


LIVE = DATA / "live"


def write_live(fires: pd.DataFrame, districts, method: str, days: int) -> dict:
    """The live map's fires: one compact file per IST day (data/live/fires_YYYY-MM-DD.json) plus
    data/live/index.json, so the site loads only the days it shows. Rows: lon, lat, minutes after
    `t0`, FRP, confidence, satellite index, night flag, district index (-1 = outside India)."""
    ids = list(districts["id"])
    pos = {(s, d): i for i, (s, d) in enumerate(zip(districts["state"], districts["district"]))}
    t0 = fires["acq_utc"].min().floor("D") if len(fires) else pd.Timestamp.now(tz="UTC").floor("D")
    sat_codes = sorted(fires["satellite"].unique()) if len(fires) else []
    LIVE.mkdir(parents=True, exist_ok=True)
    for old in LIVE.glob("fires_*.json"):
        old.unlink()  # days that left the window
    by_day: dict[str, list] = {}
    if len(fires):
        ist_day = fires["acq_utc"].dt.tz_convert(IST).dt.date.astype(str)
        for r, day in zip(fires.itertuples(), ist_day):
            di = pos.get((r.state, r.district), -1) if r.district else -1
            by_day.setdefault(day, []).append([
                round(r.longitude, 3), round(r.latitude, 3), int((r.acq_utc - t0).total_seconds() // 60),
                round(float(r.frp), 1), (r.confidence or "?")[0], sat_codes.index(r.satellite), 1 if r.daynight == "N" else 0, di])
    files = []
    for day in sorted(by_day):
        name = f"fires_{day}.json"
        (LIVE / name).write_text(json.dumps({"date": day, "rows": by_day[day]}, separators=(",", ":")), encoding="utf-8")
        files.append({"date": day, "file": name, "n": len(by_day[day])})
    index = {
        "generated_utc": _now_iso(), "method": method, "window_days": days,
        "t0": t0.isoformat(), "latest_detection_utc": fires["acq_utc"].max().isoformat() if len(fires) else None,
        "satellites": sat_codes, "district_ids": ids,
        "columns": ["lon", "lat", "t_min", "frp", "conf", "sat", "night", "district"],
        "days": files,
    }
    (LIVE / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    log.info("wrote data/live: %d days, %d detections, %.1f MB", len(files), len(fires),
             sum((LIVE / f["file"]).stat().st_size for f in files) / 1e6)
    return index


def summary_payload(fires: pd.DataFrame, last_year: dict | None) -> dict:
    f = fires.copy()
    f["state"] = f["state"].fillna("Outside India")
    f["date"] = f["acq_utc"].dt.tz_convert(IST).dt.date.astype(str)
    f["consistent"] = f["satellite"].isin(CONSISTENT_SENSORS)

    by_state = (f.groupby("state").agg(detections=("frp", "size"), frp_sum=("frp", "sum"),
                                       detections_n20=("consistent", "sum"))
                .sort_values("detections", ascending=False).round(1).reset_index())
    by_district = (f.dropna(subset=["district"]).groupby(["state", "district"])
                   .agg(detections=("frp", "size"), frp_sum=("frp", "sum"))
                   .sort_values("detections", ascending=False).round(1).reset_index().head(30))
    f["india"] = f["state"] != "Outside India"
    by_day = (f.groupby("date").agg(detections=("frp", "size"), detections_india=("india", "sum"), detections_n20=("consistent", "sum"))
              .reset_index())
    return {
        "by_state": by_state.to_dict("records"),
        "top_districts": by_district.to_dict("records"),
        "by_day": by_day.to_dict("records"),
        "same_day_last_year": last_year,
        "note": "Counts are VIIRS satellite detections (375 m pixels), not individual fires or area burned.",
    }


def last_year_compare(fires: pd.DataFrame, today: date) -> dict | None:
    """NOAA-20 detections in India on the latest complete IST day vs the same date last year.
    Same single sensor both years, so the comparison is fair. Needs FIRMS_MAP_KEY."""
    key = secret("FIRMS_MAP_KEY")
    if not key:
        return {"available": False, "reason": "needs FIRMS_MAP_KEY"}
    day = today - timedelta(days=1)  # yesterday (IST) is the latest complete day
    try:
        ly_day = day.replace(year=day.year - 1)
    except ValueError:  # 29 Feb
        ly_day = day - timedelta(days=365)
    in_india = fires["state"].notna() & fires["satellite"].isin(CONSISTENT_SENSORS)
    now_n = int((in_india & (fires["acq_utc"].dt.tz_convert(IST).dt.date == day)).sum())
    # Archive (standard processing) first, NRT as fallback for very recent dates.
    prev = pd.DataFrame()
    for source in ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"):
        prev = firms.fetch_api(key, [source], ly_day - timedelta(days=1), ly_day + timedelta(days=1))
        if len(prev):
            break
    if prev.empty:
        return {"available": False, "reason": "no archive data returned", "date": str(day), "count": now_n}
    prev["acq_utc"] = pd.to_datetime(prev["acq_utc"], utc=True)
    prev = prev[prev["acq_utc"].dt.tz_convert(IST).dt.date == ly_day]
    prev = attribute_fires(prev, load_districts())
    then_n = int(prev["state"].notna().sum())
    return {"available": True, "sensor": "NOAA-20 VIIRS", "date": str(day), "count": now_n,
            "last_year_date": str(ly_day), "last_year_count": then_n}


def aq_payload(res: dict) -> dict:
    def table(df, tcol):
        return [{k: _clean(v) for k, v in r.items()} for r in
                df.assign(**{tcol: df[tcol].astype(str)}).to_dict("records")]
    return {
        "generated_utc": _now_iso(),
        "source": "OpenAQ v3",
        "providers": res["providers"],
        "sensors_total": res["sensors_total"],
        "sensors_recent": res["sensors_recent"],
        "rules": {"min_stations_per_hour": openaq.MIN_STATIONS, "min_hours_per_day": openaq.MIN_HOURS},
        "hourly": table(res["hourly"], "hour_utc"),
        "daily": table(res["daily"], "date"),
    }


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--skip-aq", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    meta = {"generated_utc": _now_iso()}
    # The last published meta (the workflow restores it before running): if a source fails now,
    # its previous file stays in data/ and its old timestamp is kept, marked stale.
    prev_path = DATA / "meta.json"
    prev = json.loads(prev_path.read_text(encoding="utf-8")) if prev_path.exists() else {}

    def failed(section: str, file: str, err: Exception) -> dict:
        old = prev.get(section) or {}
        if old.get("updated_utc") and (DATA / file).exists():
            log.warning("%s failed (%s): keeping the previous data from %s", section, err, old["updated_utc"])
            return {**old, "stale": True, "error": str(err)[:200]}
        return {"error": str(err)[:200]}

    districts = load_districts()
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()

    # Fires: HISTORY_DAYS extra so the earliest trajectories in the window have their 48 h of fires.
    all_fires, method = firms.fetch_recent(args.days + HISTORY_DAYS)
    all_fires = attribute_fires(all_fires, districts)
    window_start = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=args.days)
    fires = all_fires[all_fires["acq_utc"] > window_start].reset_index(drop=True)
    log.info("fires: %d detections in %d days (%s); outside India: %d", len(fires), args.days, method, fires["district"].isna().sum())
    write_live(fires, districts, method, args.days)
    write_json("fires_summary_recent.json", summary_payload(fires, last_year_compare(fires, today)))
    meta["fires"] = {"updated_utc": meta["generated_utc"], "method": method,
                     "latest_detection_utc": fires["acq_utc"].max().isoformat() if len(fires) else None}

    try:
        pts, keep = wind.all_points()
        w = wind.fetch(pts, past_days=args.days + HISTORY_DAYS)
        payload = wind.web_payload(w, pts, keep, since=window_start)
        write_json("wind_recent.json", payload)
        meta["wind"] = {"updated_utc": meta["generated_utc"], "latest_utc": payload["times"][-1] if payload["times"] else None}
    except Exception as e:  # noqa: BLE001 — wind is optional for the map
        log.warning("wind skipped: %s", e)
        meta["wind"] = failed("wind", "wind_recent.json", e)
        w = None

    if w is not None:
        try:
            fields = {lvl: wind.wind_field(w, pts, lvl) for lvl in wind.LEVELS}
            # District ids (as the map uses), not names: some names repeat across states.
            ids = {(s, d): i for i, s, d in zip(districts["id"], districts["state"], districts["district"])}
            f = all_fires.assign(
                hour=all_fires["acq_utc"].map(lambda t: t.timestamp() / 3600),
                district=[ids.get((s, d)) for s, d in zip(all_fires["state"], all_fires["district"])],
            )
            now_h = pd.Timestamp.now(tz="UTC").timestamp() / 3600
            latest_wind = min(fld.hours[-1] for fld in fields.values())
            up = upwind.compute_payload(
                f, fields, DELHI, start_hour=window_start.timestamp() / 3600, end_hour=min(now_h, latest_wind),
                fires_from_hour=f["hour"].min() if len(f) else now_h,
            )
            up["generated_utc"] = meta["generated_utc"]
            write_json("upwind_recent.json", up)
            meta["upwind"] = {"updated_utc": meta["generated_utc"], "arrivals": len(up["arrivals"])}
        except Exception as e:  # noqa: BLE001 — keep the rest of the run
            log.exception("upwind skipped: %s", e)
            meta["upwind"] = failed("upwind", "upwind_recent.json", e)
    else:
        meta["upwind"] = failed("upwind", "upwind_recent.json", RuntimeError("no wind data this run"))

    if not args.skip_aq:
        try:
            res = openaq.fetch_delhi(args.days)
            write_json("aq_delhi_recent.json", aq_payload(res))
            meta["aq"] = {"updated_utc": meta["generated_utc"], "sensors_recent": res["sensors_recent"]}
        except Exception as e:  # noqa: BLE001 — keep the previous air-quality file
            log.warning("air quality skipped: %s", e)
            meta["aq"] = failed("aq", "aq_delhi_recent.json", e)

    write_json("meta.json", meta)


if __name__ == "__main__":
    main()
