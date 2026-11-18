"""City PM2.5 / PM10 from OpenAQ v3, reference monitors only (CPCB/CAAQM, US missions).

Low-cost sensors (e.g. AirGradient) are left out: they read differently and their
number changes a lot, which would shift the Delhi average.

Aggregation rules (gaps are never filled):
- City hourly = mean of stations reporting that hour; needs at least MIN_SHARE of the
  usual number of stations, and MIN_STATIONS of them where the city usually has that
  many (small cities with 1-2 monitors keep their own count), else gap. A half-reported
  hour (e.g. the latest one, before most stations have uploaded) is a gap, not a value.
- Delhi daily  = mean of Delhi hourly values for the IST calendar day; needs
  >= MIN_HOURS hours, else gap (CPCB uses a similar ~16-hour rule for 24 h averages).
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

from .config import CITIES, secret

log = logging.getLogger(__name__)

BASE = "https://api.openaq.org/v3"
DELHI_BBOX = (76.84, 28.40, 77.35, 28.88)  # NCT of Delhi, roughly
PARAMS = {"pm25": "PM2.5", "pm10": "PM10"}
MIN_STATIONS = 3
MIN_SHARE = 0.5  # of the median station count over the window
MIN_HOURS = 18
REFERENCE_PROVIDERS = ("cpcb", "caaqm", "airnow", "stateair")
VALID_RANGE = (0, 1500)  # µg/m³; outside this is treated as an instrument error
IST = timezone(timedelta(hours=5, minutes=30))


def _get(path: str, key: str, **params) -> dict:
    for attempt in range(4):
        r = requests.get(f"{BASE}{path}", params=params, headers={"X-API-Key": key}, timeout=60)
        if r.status_code == 429:  # rate limited: back off
            time.sleep(5 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()
    return {}


def is_reference(loc: dict) -> bool:
    """Regulatory-grade monitor (CPCB/CAAQM, US Embassy), not a low-cost sensor.
    OpenAQ marks these with isMonitor; if the field is missing, fall back to known providers."""
    if "isMonitor" in loc and loc["isMonitor"] is not None:
        return bool(loc["isMonitor"])
    provider = ((loc.get("provider") or {}).get("name") or "").lower()
    return any(p in provider for p in REFERENCE_PROVIDERS)


def _area(city: dict) -> dict:
    """OpenAQ /locations query for a city: its bbox, or a radius around its centre."""
    if city.get("aq_bbox"):
        return {"bbox": ",".join(map(str, city["aq_bbox"]))}
    return {"coordinates": f"{city['lat']},{city['lon']}", "radius": int(min(city.get("aq_radius_km", 25), 25) * 1000)}


def list_sensors(key: str, city: dict | None = None, params: tuple[str, ...] = ("pm25", "pm10")) -> pd.DataFrame:
    """PM2.5/PM10 sensors at reference monitoring stations in a city (default Delhi)."""
    data = _get("/locations", key, limit=1000, **_area(city or CITIES["delhi"]))
    rows = []
    for loc in data.get("results", []):
        if not is_reference(loc):
            continue
        provider = (loc.get("provider") or {}).get("name", "")
        for s in loc.get("sensors", []):
            p = (s.get("parameter") or {}).get("name")
            if p in params:
                last = (loc.get("datetimeLast") or {}).get("utc")
                first = (loc.get("datetimeFirst") or {}).get("utc")
                rows.append({"sensor_id": s["id"], "location_id": loc["id"], "parameter": p, "location": loc.get("name"),
                             "provider": provider, "first_utc": first, "last_utc": last,
                             "lat": loc["coordinates"]["latitude"], "lon": loc["coordinates"]["longitude"]})
    return pd.DataFrame(rows)


def fetch_days(key: str, sensor_id: int, date_from: str, date_to: str) -> pd.DataFrame:
    """OpenAQ's daily averages for one sensor: date (local, i.e. IST for Delhi), value, percent of hours covered."""
    rows, page = [], 1
    while True:
        data = _get(f"/sensors/{sensor_id}/days", key, date_from=date_from, date_to=date_to, limit=1000, page=page)
        res = data.get("results", [])
        for d in res:
            cov = (d.get("coverage") or {}).get("percentComplete")
            rows.append({"date": d["period"]["datetimeFrom"]["local"][:10], "value": d["value"], "pct": cov})
        if len(res) < 1000:
            break
        page += 1
        time.sleep(1.1)
    return pd.DataFrame(rows, columns=["date", "value", "pct"])


def fetch_hours(key: str, sensor_id: int, start: datetime, end: datetime) -> pd.DataFrame:
    rows, page = [], 1
    while True:
        data = _get(f"/sensors/{sensor_id}/hours", key, datetime_from=start.isoformat(),
                    datetime_to=end.isoformat(), limit=1000, page=page)
        res = data.get("results", [])
        for h in res:
            rows.append({"hour_utc": h["period"]["datetimeFrom"]["utc"], "value": h["value"]})
        if len(res) < 1000:
            break
        page += 1
        time.sleep(1.1)
    df = pd.DataFrame(rows, columns=["hour_utc", "value"])
    df["hour_utc"] = pd.to_datetime(df["hour_utc"], utc=True)
    return df


def city_hourly(station_hours: pd.DataFrame) -> pd.DataFrame:
    """station_hours: columns sensor_id, parameter, hour_utc, value.
    Returns hour_utc, parameter, value (mean, or NaN if too few stations), n_stations."""
    lo, hi = VALID_RANGE
    ok = station_hours[station_hours["value"].between(lo, hi, inclusive="neither")]
    g = ok.groupby(["parameter", "hour_utc"])["value"].agg(["mean", "count"]).reset_index()
    g = g.rename(columns={"mean": "value", "count": "n_stations"})
    usual = g.groupby("parameter")["n_stations"].transform("median")
    need = usual.clip(upper=MIN_STATIONS)  # 3, or fewer for a city that only has 1-2 monitors
    too_few = (g["n_stations"] < need) | (g["n_stations"] < MIN_SHARE * usual)
    g.loc[too_few, "value"] = float("nan")
    return g


def city_daily(hourly: pd.DataFrame) -> pd.DataFrame:
    """Daily means per IST day. Returns date, parameter, value (NaN if < MIN_HOURS), n_hours."""
    h = hourly.dropna(subset=["value"]).copy()
    h["date"] = h["hour_utc"].dt.tz_convert(IST).dt.date
    g = h.groupby(["parameter", "date"])["value"].agg(["mean", "count"]).reset_index()
    g = g.rename(columns={"mean": "value", "count": "n_hours"})
    g.loc[g["n_hours"] < MIN_HOURS, "value"] = float("nan")
    return g


def fetch_city(city: dict, days: int = 7, now: datetime | None = None, params: tuple[str, ...] = ("pm25", "pm10")) -> dict:
    """Fetch, aggregate and return a coverage report plus hourly/daily tables for one city."""
    key = secret("OPENAQ_API_KEY")
    if not key:
        raise RuntimeError("OPENAQ_API_KEY not set in .env")
    now = now or datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    sensors = list_sensors(key, city, params)
    recent = sensors[pd.to_datetime(sensors["last_utc"], utc=True, errors="coerce") > start] if not sensors.empty else sensors

    frames = []
    for s in recent.itertuples():
        try:
            df = fetch_hours(key, s.sensor_id, start, now)
            frames.append(df.assign(sensor_id=s.sensor_id, parameter=s.parameter))
        except requests.HTTPError as e:
            log.warning("OpenAQ sensor %s failed: %s", s.sensor_id, e.response.status_code)
        time.sleep(1.1)  # stay under 60 requests/minute
    station_hours = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(
        columns=["sensor_id", "parameter", "hour_utc", "value"])
    hourly = city_hourly(station_hours)
    daily = city_daily(hourly)
    return {
        "sensors_total": len(sensors),
        "sensors_recent": len(recent),
        "providers": sorted(set(sensors["provider"])) if not sensors.empty else [],
        "station_hours": station_hours,
        "hourly": hourly,
        "daily": daily,
    }


# ---- OpenAQ's public S3 archive (no key) -----------------------------------------------------
# The API's daily averages are missing for Delhi from mid-Oct 2022 through 2024, but the raw
# measurements are in OpenAQ's public archive: one gzipped CSV per location per local day,
# readings stamped at the END of their period (e.g. 00:30 ... next day 00:00, IST).
ARCHIVE = ("https://openaq-data-archive.s3.amazonaws.com/records/csv.gz/"
           "locationid={loc}/year={y}/month={m:02d}/location-{loc}-{ymd}.csv.gz")
ARCHIVE_WORKERS = 16
MIN_HOURS_PER_STATION_DAY = 18


def archive_station_day(csv_text: str, day: str) -> tuple[float | None, int]:
    """PM2.5 daily mean for one station-day from an archive file: readings -> hourly means ->
    mean of hours. Returns (value or None if fewer than MIN_HOURS_PER_STATION_DAY hours, hours)."""
    import io

    df = pd.read_csv(io.StringIO(csv_text), usecols=["datetime", "parameter", "value"])
    df = df[(df["parameter"] == "pm25")]
    if df.empty:
        return None, 0
    lo, hi = VALID_RANGE
    df = df[df["value"].between(lo, hi, inclusive="neither")]
    # Stamps mark the period end: shift back a minute so 00:00 next day belongs to 23:xx today.
    t = pd.to_datetime(df["datetime"], utc=True).dt.tz_convert(IST) - pd.Timedelta(minutes=1)
    df = df.assign(date=t.dt.date.astype(str), hour=t.dt.hour)
    df = df[df["date"] == day]
    hourly = df.groupby("hour")["value"].mean()
    if len(hourly) < MIN_HOURS_PER_STATION_DAY:
        return None, len(hourly)
    return round(float(hourly.mean()), 1), len(hourly)


def fetch_archive_days(location_ids: list[int], days: list[str]) -> pd.DataFrame:
    """Station-days for the given IST dates from the archive. Columns as fetch_days plus
    sensor_id (= location id here): date, value, pct (hours/24), sensor_id. Missing files are skipped."""
    import gzip
    from concurrent.futures import ThreadPoolExecutor

    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=ARCHIVE_WORKERS, pool_maxsize=ARCHIVE_WORKERS)
    session.mount("https://", adapter)

    def one(job):
        loc, day = job
        y, m, d = day.split("-")
        url = ARCHIVE.format(loc=loc, y=y, m=int(m), ymd=f"{y}{m}{d}")
        for attempt in range(3):
            try:
                r = session.get(url, timeout=60)
                if r.status_code in (403, 404):
                    return None  # no file for that day
                r.raise_for_status()
                v, hours = archive_station_day(gzip.decompress(r.content).decode("utf-8"), day)
                return {"sensor_id": loc, "date": day, "value": v, "pct": hours / 24 * 100}
            except (requests.RequestException, OSError, ValueError) as e:
                if attempt == 2:
                    log.warning("archive %s %s failed: %s", loc, day, e)
                    return None
                time.sleep(3 * (attempt + 1))

    jobs = [(loc, day) for loc in location_ids for day in days]
    with ThreadPoolExecutor(ARCHIVE_WORKERS) as pool:
        rows = [r for r in pool.map(one, jobs) if r]
    return pd.DataFrame(rows, columns=["sensor_id", "date", "value", "pct"])


# Older names, kept for callers and tests written for Delhi only.
delhi_hourly = city_hourly
delhi_daily = city_daily


def fetch_delhi(days: int = 7, now: datetime | None = None) -> dict:
    return fetch_city(CITIES["delhi"], days, now)
