"""The Diwali effect: hourly air quality around Diwali night, 2020 onwards.

For each year and city: hourly PM2.5 and PM10 from 7 days before to 8 days after Diwali.
  - Each hour's city value is the MEDIAN across government (CPCB/DPCC) reference stations,
    kept only when enough stations reported (same rule as the live map), with the count.
  - Delhi only: hours that still have no value use the US Embassy monitor alone, labelled.
  - Anything else stays a gap. Nothing is interpolated.
Source: OpenAQ's public archive (S3, no key), which also covers 2022-24, when OpenAQ's API
has no Delhi government data; the API fills in recent days the archive doesn't have yet.

Statistics (all in IST):
  - Diwali night = 18:00 on Diwali to 06:00 the next morning (12 hours).
  - A night's mean needs at least 9 of its 12 hours.
  - Normal night = median of the night means 3-7 days before and 3-7 days after Diwali
    (the nights right around Diwali are left out); needs at least 4 such nights.
  - Peak = the highest hour of Diwali night. "Back to normal" = hours from that peak until
    the first hour at or below the normal-night level.

Delhi context for the 7 days shown (D-3 .. D+3):
  - Wind and ventilation from ERA5 (Open-Meteo archive, free): daily mean 10 m wind, and the
    ventilation index = boundary-layer height x wind speed, its daily maximum; below 6,000 m²/s
    smoke is trapped (the threshold used by IITM's air-quality forecasts).
  - Upwind fire load: the app's own back-trajectory method, run on ERA5 winds at 10 m and
    100 m (upper-air winds aren't available for every year) and the NOAA-20 fire detections
    in data/seasons. Indicative, not a source-apportionment study.

Usage (from pipeline/):  PYTHONPATH=. python -m smokewatch.diwali --years 2020-2026 [--city delhi]
Needs OPENAQ_API_KEY (to list each city's stations).
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests

from . import openaq, upwind, wind
from .config import CITIES, DATA, secret
from .trajectory import WindField

log = logging.getLogger("smokewatch.diwali")

IST = timezone(timedelta(hours=5, minutes=30))
OUT = DATA / "diwali"
FIRST_YEAR = 2020
EMBASSY_LOCATION = 8118
SHOW_BEFORE, SHOW_AFTER = 3, 3  # days shown either side of Diwali
FETCH_BEFORE, FETCH_AFTER = 7, 8  # days fetched (baseline nights reach D+7, which ends on D+8)
NIGHT_START_H, NIGHT_HOURS = 18, 12
MIN_NIGHT_HOURS = 9
BASELINE_OFFSETS = [-7, -6, -5, -4, -3, 3, 4, 5, 6, 7]
MIN_BASELINE_NIGHTS = 4
VI_TRAPPED = 6000  # m²/s
NON_CPCB = ("airnow", "stateair")  # US Embassy / consulate monitors: not part of the city median

# Lakshmi Puja (main Diwali night) as observed in Delhi. Source: Drik Panchang's New Delhi
# calendar, except 2024 (see note).
DIWALI: dict[int, dict] = {
    2020: {"date": "2020-11-14"},
    2021: {"date": "2021-11-04"},
    2022: {"date": "2022-10-24"},
    2023: {"date": "2023-11-12"},
    2024: {"date": "2024-10-31", "note": "Drik Panchang lists 1 Nov for New Delhi, but Delhi celebrated (and burst crackers) on the night of 31 Oct."},
    2025: {"date": "2025-10-20"},
    2026: {"date": "2026-11-08"},
}
for _y, _d in DIWALI.items():
    _d["source"] = f"https://www.drikpanchang.com/festivals/lakshmipuja/festivals-lakshmipuja-timings.html?year={_y}"

# Firecracker rules in Delhi that year (so year-to-year changes aren't read as behaviour alone).
RULES: dict[int, dict] = {
    2020: {"rule": "ban", "text": "Total ban on selling or bursting any firecrackers in Delhi-NCR (National Green Tribunal, 9–30 Nov).",
           "source": "https://www.tribuneindia.com/news/delhi/complete-ban-on-bursting-sale-of-firecrackers-up-to-january-1-in-delhi-317457"},
    2021: {"rule": "ban", "text": "Complete ban on selling and bursting firecrackers in Delhi until 1 Jan 2022 (DPCC).",
           "source": "https://www.tribuneindia.com/news/delhi/complete-ban-on-bursting-sale-of-firecrackers-up-to-january-1-in-delhi-317457"},
    2022: {"rule": "ban", "text": "Complete ban on making, selling and bursting firecrackers in Delhi until 1 Jan 2023 (DPCC).",
           "source": "https://www.outlookindia.com/national/delhi-pollution-control-body-issues-order-banning-firecrackers-till-january-1-news-223883"},
    2023: {"rule": "ban", "text": "Complete ban on all firecrackers in Delhi, green crackers included, until 1 Jan 2024 (DPCC).",
           "source": "https://lexplosion.in/delhi-pcc-bans-manufacturing-storing-selling-and-bursting-of-all-kinds-of-firecrackers-till-1-01-2024/"},
    2024: {"rule": "ban", "text": "Complete ban on firecrackers in Delhi until 1 Jan 2025 (Delhi government), widely flouted on Diwali night.",
           "source": "https://www.businesstoday.in/india/story/delhi-government-bans-firecrackers-until-january-2025-to-curb-winter-air-pollution-445092-2024-09-09"},
    2025: {"rule": "green", "text": "Supreme Court allowed certified green crackers in Delhi-NCR, 18–21 Oct, bursting only 6–7 am and 8–10 pm.",
           "source": "https://www.businesstoday.in/india/story/sc-allows-bursting-of-green-crackers-in-delhi-ncr-from-october-18-to-21-under-strict-rules-498250-2025-10-15"},
    2026: {"rule": "green", "text": "Supreme Court allowed certified green crackers in Delhi-NCR on 7–8 Nov, 6–7 am and 8–10 pm; full ban again from 9 Nov.",
           "source": "https://www.legalbites.in/constitutional-law/supreme-court-permits-limited-use-of-green-crackers-in-delhi-ncr-for-diwali-2026-1386780"},
}


# ---- Air quality: station-hours ----------------------------------------------------------

def archive_station_hours(csv_text: str) -> pd.DataFrame:
    """One archive file (one location, one day) -> hour (IST, hour start, naive), parameter,
    value (mean of the readings in that hour). Stamps mark the period end, so they're shifted
    back a minute first, as in openaq.archive_station_day."""
    df = pd.read_csv(io.StringIO(csv_text), usecols=["datetime", "parameter", "value"])
    df = df[df["parameter"].isin(["pm25", "pm10"])]
    lo, hi = openaq.VALID_RANGE
    df = df[df["value"].between(lo, hi, inclusive="neither")]
    if df.empty:
        return pd.DataFrame(columns=["hour", "parameter", "value"])
    t = pd.to_datetime(df["datetime"], utc=True).dt.tz_convert(IST) - pd.Timedelta(minutes=1)
    df = df.assign(hour=t.dt.floor("h").dt.tz_localize(None))
    return df.groupby(["hour", "parameter"], as_index=False)["value"].mean()


def fetch_archive_hours(location_ids: list[int], days: list[str]) -> pd.DataFrame:
    """Station-hours (location_id, hour, parameter, value) for these IST dates. A day's file
    can hold the first minutes of the next day, so files are read for each date given."""
    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=openaq.ARCHIVE_WORKERS, pool_maxsize=openaq.ARCHIVE_WORKERS)
    session.mount("https://", adapter)

    def one(job):
        loc, day = job
        y, m, d = day.split("-")
        url = openaq.ARCHIVE.format(loc=loc, y=y, m=int(m), ymd=f"{y}{m}{d}")
        for attempt in range(3):
            try:
                r = session.get(url, timeout=60)
                if r.status_code in (403, 404):
                    return None
                r.raise_for_status()
                return archive_station_hours(gzip.decompress(r.content).decode("utf-8")).assign(location_id=loc)
            except (requests.RequestException, OSError, ValueError) as e:
                if attempt == 2:
                    log.warning("archive %s %s failed: %s", loc, day, e)
                    return None
                time.sleep(3 * (attempt + 1))

    jobs = [(loc, day) for loc in location_ids for day in days]
    with ThreadPoolExecutor(openaq.ARCHIVE_WORKERS) as pool:
        frames = [f for f in pool.map(one, jobs) if f is not None and len(f)]
    if not frames:
        return pd.DataFrame(columns=["location_id", "hour", "parameter", "value"])
    df = pd.concat(frames, ignore_index=True)
    return df.groupby(["location_id", "hour", "parameter"], as_index=False)["value"].mean()


def fetch_api_hours(key: str, sensors: pd.DataFrame, start: date, end: date) -> pd.DataFrame:
    """Same shape as fetch_archive_hours, from the API (for recent days the archive lacks)."""
    t0 = datetime.combine(start, datetime.min.time(), IST)
    t1 = datetime.combine(end + timedelta(days=1), datetime.min.time(), IST)
    frames = []
    for row in sensors.itertuples():
        try:
            h = openaq.fetch_hours(key, int(row.sensor_id), t0, t1)
        except Exception as e:  # noqa: BLE001 - one sensor failing shouldn't stop the year
            log.warning("API sensor %s failed: %s", row.sensor_id, e)
            continue
        if len(h):
            hour = h["hour_utc"].dt.tz_convert(IST).dt.tz_localize(None)
            frames.append(pd.DataFrame({"location_id": row.location_id, "hour": hour, "parameter": row.parameter, "value": h["value"]}))
        time.sleep(1.1)
    if not frames:
        return pd.DataFrame(columns=["location_id", "hour", "parameter", "value"])
    df = pd.concat(frames, ignore_index=True)
    lo, hi = openaq.VALID_RANGE
    return df[df["value"].between(lo, hi, inclusive="neither")]


def city_median(station_hours: pd.DataFrame, hours: pd.DatetimeIndex, parameter: str) -> tuple[pd.Series, pd.Series]:
    """Hourly median across stations on the full `hours` index, and the station count.
    An hour needs at least 3 stations (or all of a city's usual 1-2) and at least half the
    usual count; otherwise it's NaN (a gap)."""
    d = station_hours[station_hours["parameter"] == parameter]
    g = d.groupby("hour")["value"].agg(["median", "count"]).reindex(hours)
    n = g["count"].fillna(0).astype(int)
    usual = float(n[n > 0].median()) if (n > 0).any() else 0.0
    need = min(openaq.MIN_STATIONS, usual)
    ok = (n >= max(need, 1)) & (n >= openaq.MIN_SHARE * usual)
    return g["median"].where(ok), n


# ---- Statistics --------------------------------------------------------------------------

def night_mean(series: pd.Series, night_of: date) -> float | None:
    """Mean of 18:00 on `night_of` to 06:00 next morning, if at least MIN_NIGHT_HOURS hours exist."""
    start = pd.Timestamp(datetime.combine(night_of, datetime.min.time())) + pd.Timedelta(hours=NIGHT_START_H)
    vals = series.reindex(pd.date_range(start, periods=NIGHT_HOURS, freq="h")).dropna()
    return float(vals.mean()) if len(vals) >= MIN_NIGHT_HOURS else None


def stats(series: pd.Series, diwali: date) -> dict:
    """Headline numbers for one year: normal-night level, Diwali night mean and % above it,
    peak hour, hours from the peak back to normal."""
    nights = [night_mean(series, diwali + timedelta(days=k)) for k in BASELINE_OFFSETS]
    usable = [v for v in nights if v is not None]
    baseline = float(np.median(usable)) if len(usable) >= MIN_BASELINE_NIGHTS else None
    dn = night_mean(series, diwali)
    start = pd.Timestamp(datetime.combine(diwali, datetime.min.time())) + pd.Timedelta(hours=NIGHT_START_H)
    night = series.reindex(pd.date_range(start, periods=NIGHT_HOURS, freq="h"))
    peak_t = night.idxmax() if night.notna().any() else None
    out = {
        "baseline": _r(baseline), "baseline_nights": len(usable),
        "night_mean": _r(dn), "night_hours": int(night.notna().sum()),
        "pct_above": _r((dn / baseline - 1) * 100) if dn is not None and baseline else None,
        "peak": {"value": _r(night[peak_t]), "hour": peak_t.strftime("%Y-%m-%dT%H:%M")} if peak_t is not None else None,
        "back_to_normal_h": None, "back_note": None,
    }
    if peak_t is not None and baseline:
        after = series[series.index > peak_t]
        below = after[after <= baseline]
        if len(below):
            out["back_to_normal_h"] = int((below.index[0] - peak_t) / pd.Timedelta(hours=1))
        else:
            last = series.dropna().index.max()
            out["back_note"] = f"not back to normal within the {int((last - peak_t) / pd.Timedelta(hours=1))} hours of data after the peak"
    return out


def _r(v, nd: int = 0):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    return int(round(v)) if nd == 0 else round(float(v), nd)


# ---- One city, one year -------------------------------------------------------------------

def city_year(key: str, city_id: str, year: int, sensors: pd.DataFrame, today: date) -> dict | None:
    d = date.fromisoformat(DIWALI[year]["date"])
    first, last = d - timedelta(days=FETCH_BEFORE), d + timedelta(days=FETCH_AFTER)
    if first > today:
        return None
    days = [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]
    hours = pd.date_range(f"{first}T00:00", f"{last}T23:00", freq="h")

    cpcb = sensors[~sensors["provider"].str.lower().str.contains("|".join(NON_CPCB), na=False)]
    locs = sorted({int(x) for x in cpcb["location_id"]})
    sh = fetch_archive_hours(locs, days) if locs else pd.DataFrame(columns=["location_id", "hour", "parameter", "value"])
    pm25, n25 = city_median(sh, hours, "pm25")
    # Recent days may not be in the archive yet: take them from the API instead.
    if (today - last).days < 30 and len(cpcb):
        missing_days = sorted({h.date() for h in pm25[pm25.isna()].index})
        if missing_days:
            api = fetch_api_hours(key, cpcb, missing_days[0], missing_days[-1])
            if len(api):
                sh = pd.concat([sh, api]).groupby(["location_id", "hour", "parameter"], as_index=False)["value"].mean()
                pm25, n25 = city_median(sh, hours, "pm25")
    pm10, _ = city_median(sh, hours, "pm10")

    src = pd.Series(np.where(pm25.notna(), "c", ""), index=hours)
    if city_id == "delhi":
        gaps = pm25[pm25.isna()].index
        if len(gaps):
            emb = fetch_archive_hours([EMBASSY_LOCATION], sorted({h.strftime("%Y-%m-%d") for h in gaps}))
            e = emb[emb["parameter"] == "pm25"].set_index("hour")["value"]
            e = e[~e.index.duplicated()].reindex(gaps).dropna()
            pm25.loc[e.index] = e
            src.loc[e.index] = "e"
            n25.loc[e.index] = 1

    if pm25.notna().sum() == 0:
        return {"date": d.isoformat(), "available": False}
    show = pd.date_range(f"{d - timedelta(days=SHOW_BEFORE)}T00:00", periods=24 * (SHOW_BEFORE + SHOW_AFTER + 1), freq="h")
    as_list = lambda s: [None if pd.isna(v) else int(round(v)) for v in s.reindex(show)]  # noqa: E731
    shown_src = src.reindex(show).fillna("")
    return {
        "date": d.isoformat(),
        "available": True,
        "start": show[0].strftime("%Y-%m-%dT%H:%M"),  # IST, hour start; one value per hour
        "pm25": as_list(pm25),
        "pm10": as_list(pm10),
        "n": [int(v) for v in n25.reindex(show).fillna(0)],
        "src": "".join(c if c else "-" for c in shown_src),  # c = CPCB median, e = US Embassy alone, - = gap
        "embassy_hours": int((shown_src == "e").sum()),
        "stations_usual": int(n25[n25 > 0].median()) if (n25 > 0).any() else 0,
        "stats": stats(pm25, d),
    }


# ---- Delhi context: ERA5 wind, ventilation, upwind fire load ------------------------------

ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive"
GRID_BBOX = (64.0, 18.0, 90.0, 38.0)  # covers 48 h of near-ground transport into Delhi
ERA5_LEVELS = ("10m", "100m")


def _era5(points: list[tuple[float, float]], start: date, end: date, variables: list[str]) -> list[dict]:
    out = []
    for c0 in range(0, len(points), wind.CHUNK):
        if c0:
            time.sleep(wind.PAUSE_S)
        chunk = points[c0:c0 + wind.CHUNK]
        params = {"latitude": ",".join(str(p[1]) for p in chunk), "longitude": ",".join(str(p[0]) for p in chunk),
                  "start_date": start.isoformat(), "end_date": end.isoformat(), "hourly": ",".join(variables),
                  "wind_speed_unit": "ms", "timezone": "UTC"}
        for attempt in range(wind.RETRIES):
            try:
                r = requests.get(ARCHIVE_API, params=params, timeout=120)
                r.raise_for_status()
                data = r.json()
                break
            except requests.RequestException as e:
                if attempt == wind.RETRIES - 1:
                    raise
                log.warning("ERA5 try %d failed (%s); retrying", attempt + 1, e)
                time.sleep(10 * (attempt + 1))
        out.extend(data if isinstance(data, list) else [data])
    return out


def delhi_weather(d: date) -> list[dict]:
    """Per shown day: mean 10 m wind (m/s), direction it blew from, max ventilation index."""
    first, last = d - timedelta(days=SHOW_BEFORE), d + timedelta(days=SHOW_AFTER)
    c = CITIES["delhi"]
    loc = _era5([(c["lon"], c["lat"])], first - timedelta(days=1), last + timedelta(days=1),
                ["wind_speed_10m", "wind_direction_10m", "boundary_layer_height"])[0]["hourly"]
    df = pd.DataFrame({"t": pd.to_datetime(loc["time"], utc=True).tz_convert(IST).tz_localize(None),
                       "ws": loc["wind_speed_10m"], "wd": loc["wind_direction_10m"], "blh": loc["boundary_layer_height"]})
    df["day"] = df["t"].dt.date
    out = []
    for i in range((last - first).days + 1):
        day = first + timedelta(days=i)
        g = df[df["day"] == day].dropna()
        if len(g) < 18:
            out.append({"date": day.isoformat(), "wind_ms": None, "wind_from": None, "vi_max": None, "ventilation": None})
            continue
        u, v = wind.to_uv(g["ws"], g["wd"])
        mean_from = (np.degrees(np.arctan2(-u.mean(), -v.mean())) + 360) % 360
        vi = float((g["ws"] * g["blh"]).max())
        out.append({"date": day.isoformat(), "wind_ms": round(float(g["ws"].mean()), 1), "wind_from": wind.compass(mean_from),
                    "vi_max": int(round(vi, -2)), "ventilation": "trapped" if vi < VI_TRAPPED else "dispersing"})
    return out


def season_fires(year: int) -> pd.DataFrame | None:
    """The NOAA-20 detections in data/seasons/fires_<year>.json, as the upwind code wants them."""
    p = DATA / "seasons" / f"fires_{year}.json"
    if not p.exists():
        return None
    f = json.loads(p.read_text(encoding="utf-8"))
    start = date.fromisoformat(f["start"])
    rows = []
    for lon, lat, day, hhmm, frp, di in f["rows"]:
        mins = (hhmm // 100) * 60 + hhmm % 100
        ist_day = start + timedelta(days=day)
        utc_day = ist_day - timedelta(days=1) if mins >= 18 * 60 + 30 else ist_day  # from 18:30 UTC it's already the next IST day
        t = datetime.combine(utc_day, datetime.min.time(), timezone.utc) + timedelta(minutes=mins)
        did = f["district_ids"][di] if di >= 0 else "outside"
        rows.append({"longitude": lon, "latitude": lat, "frp": frp, "hour": t.timestamp() / 3600,
                     "district": did, "state": did.split("--")[0]})
    return pd.DataFrame(rows)


def delhi_upwind(d: date, year: int) -> list[float | None] | None:
    """Mean upwind fire load per shown day (same units as the live map's), or None."""
    fires = season_fires(year)
    if fires is None or fires.empty:
        return None
    first, last = d - timedelta(days=SHOW_BEFORE), d + timedelta(days=SHOW_AFTER)
    points = wind.grid_points(GRID_BBOX, wind.STEP_DEG)
    variables = [f"wind_{q}_{lvl}" for lvl in ERA5_LEVELS for q in ("speed", "direction")]
    locs = _era5(points, first - timedelta(days=3), last + timedelta(days=1), variables)
    frames = []
    for k, loc in enumerate(locs):
        h = loc["hourly"]
        t = pd.to_datetime(h["time"], utc=True)
        for lvl in ERA5_LEVELS:
            frames.append(pd.DataFrame({"time": t, "point": k, "level": lvl, "speed": h[f"wind_speed_{lvl}"], "dir_from": h[f"wind_direction_{lvl}"]}))
    df = pd.concat(frames, ignore_index=True)
    fields: dict[str, WindField] = {lvl: wind.wind_field(df, points, lvl, bbox=GRID_BBOX) for lvl in ERA5_LEVELS}
    t0 = datetime.combine(first, datetime.min.time(), IST).timestamp() / 3600
    t1 = datetime.combine(last, datetime.min.time(), IST).timestamp() / 3600 + 21
    c = CITIES["delhi"]
    payload = upwind.compute_payload(fires, fields, (c["lon"], c["lat"]), t0, t1, fires_from_hour=float(fires["hour"].min()))
    by_day = {x["date"]: x["load"] for x in payload["days"]}
    return [by_day.get((first + timedelta(days=i)).isoformat()) for i in range((last - first).days + 1)]


# ---- Build -------------------------------------------------------------------------------

def build(years: list[int], cities: list[str], today: date) -> None:
    key = secret("OPENAQ_API_KEY")
    if not key:
        raise SystemExit("OPENAQ_API_KEY is not set: it's needed to list each city's monitoring stations.")
    OUT.mkdir(parents=True, exist_ok=True)
    idx_path = OUT / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {"years": {}, "cities": []}
    for city_id in cities:
        path = OUT / f"{city_id}.json"
        cur = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"city": city_id, "name": CITIES[city_id]["name"], "years": {}}
        sensors = openaq.list_sensors(key, CITIES[city_id])
        log.info("%s: %d PM sensors at reference stations", city_id, len(sensors))
        for y in years:
            res = city_year(key, city_id, y, sensors, today)
            if res is None:
                continue
            cur["years"][str(y)] = res
            s = res.get("stats") or {}
            log.info("%s %s: %s", city_id, y, {k: s.get(k) for k in ("baseline", "night_mean", "pct_above", "back_to_normal_h")} if res["available"] else "no data")
        path.write_text(json.dumps(cur, separators=(",", ":")), encoding="utf-8")
        if any(v.get("available") for v in cur["years"].values()) and city_id not in idx["cities"]:
            idx["cities"].append(city_id)

    for y in years:
        d = date.fromisoformat(DIWALI[y]["date"])
        if d - timedelta(days=FETCH_BEFORE) > today:
            continue
        entry = {**DIWALI[y], **RULES[y]}
        try:
            entry["weather"] = delhi_weather(d)
        except Exception as e:  # noqa: BLE001
            log.warning("ERA5 weather %s failed: %s", y, e)
            entry["weather"] = (idx["years"].get(str(y)) or {}).get("weather")
        try:
            entry["upwind"] = delhi_upwind(d, y)
        except Exception as e:  # noqa: BLE001
            log.warning("upwind %s failed: %s", y, e)
            entry["upwind"] = (idx["years"].get(str(y)) or {}).get("upwind")
        idx["years"][str(y)] = entry
    # Upwind levels relative to every Diwali week shown (terciles of all daily loads).
    loads = sorted(v for e in idx["years"].values() for v in (e.get("upwind") or []) if v is not None)
    idx["upwind_terciles"] = [loads[len(loads) // 3], loads[2 * len(loads) // 3]] if len(loads) >= 6 else None
    idx["generated_utc"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    idx["method"] = {
        "hourly": "Median across government (CPCB/DPCC) reference stations, hour by hour (IST, hour start); "
                  "needs 3+ stations and half the usual count. Delhi gaps use the US Embassy monitor alone (labelled).",
        "night": "18:00 to 06:00. Normal night: median of the night means 3-7 days either side of Diwali.",
        "ventilation": f"ERA5 boundary-layer height x 10 m wind, daily maximum; below {VI_TRAPPED:,} m²/s smoke is trapped.",
        "upwind": "Back-trajectories on ERA5 10 m and 100 m winds through NOAA-20 fire detections. Indicative, not source apportionment.",
    }
    idx["cities"] = [c for c in CITIES if c in idx["cities"]]
    idx_path.write_text(json.dumps(idx, indent=1), encoding="utf-8")


def _years(spec: str) -> list[int]:
    out: list[int] = []
    for part in spec.split(","):
        a, _, b = part.partition("-")
        out.extend(range(int(a), int(b or a) + 1))
    return [y for y in out if y in DIWALI]


def main(argv=None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default=f"{FIRST_YEAR}-{max(DIWALI)}")
    ap.add_argument("--city", action="append", help="city id (repeatable); default all")
    ap.add_argument("--if-recent", action="store_true", help="only if today is within Diwali-3 .. Diwali+14 of a listed year")
    a = ap.parse_args(argv)
    today = datetime.now(IST).date()
    years = _years(a.years)
    if a.if_recent:
        years = [y for y in years if -3 <= (today - date.fromisoformat(DIWALI[y]["date"])).days <= 14]
        if not years:
            log.info("No Diwali within the window today; nothing to do.")
            return
    build(years, a.city or list(CITIES), today)


if __name__ == "__main__":
    main()
