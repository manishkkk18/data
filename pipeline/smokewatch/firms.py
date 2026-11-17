"""NASA FIRMS active-fire detections.

Primary path: the FIRMS area API with FIRMS_MAP_KEY.
Dev fallback (no key): FIRMS's public South Asia 7-day CSVs, which carry the
same columns. The fallback is only for local testing; the scheduled pipeline
requires the key.
"""
from __future__ import annotations

import io
import logging
from datetime import date, timedelta

import pandas as pd
import requests

from .config import BBOX, NRT_SOURCES, secret

log = logging.getLogger(__name__)

API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{area}/{days}/{start}"
PUBLIC = "https://firms.modaps.eosdis.nasa.gov/data/active_fire"
PUBLIC_7D = {
    "VIIRS_SNPP_NRT": f"{PUBLIC}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_Asia_7d.csv",
    "VIIRS_NOAA20_NRT": f"{PUBLIC}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_7d.csv",
    "VIIRS_NOAA21_NRT": f"{PUBLIC}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_Asia_7d.csv",
    "MODIS_NRT": f"{PUBLIC}/modis-c6.1/csv/MODIS_C6_1_South_Asia_7d.csv",
}
MAX_DAYS_PER_CALL = 5  # FIRMS area API accepts DAY_RANGE 1..5

COLUMNS = ["latitude", "longitude", "acq_utc", "satellite", "instrument", "confidence", "frp", "daynight", "source"]


def normalise(raw: pd.DataFrame, source: str) -> pd.DataFrame:
    """Map VIIRS and MODIS CSVs onto one schema.

    confidence -> 'low' | 'nominal' | 'high'. VIIRS reports l/n/h (or words);
    MODIS reports 0-100, mapped with FIRMS's own thresholds (<30 low, >=80 high).
    """
    if raw.empty:
        return pd.DataFrame(columns=COLUMNS)
    df = raw.copy()
    conf = df["confidence"]
    if source.startswith("MODIS"):
        c = pd.to_numeric(conf, errors="coerce")
        df["confidence"] = pd.cut(c, [-1, 29, 79, 100], labels=["low", "nominal", "high"]).astype(str)
        df["instrument"] = "MODIS"
    else:
        df["confidence"] = conf.astype(str).str.lower().str[0].map({"l": "low", "n": "nominal", "h": "high"})
        df["instrument"] = "VIIRS"
    hhmm = df["acq_time"].astype(str).str.zfill(4)
    df["acq_utc"] = pd.to_datetime(df["acq_date"] + " " + hhmm, format="%Y-%m-%d %H%M", utc=True)
    df["satellite"] = df["satellite"].astype(str)
    df["source"] = source
    return df[COLUMNS]


def in_bbox(df: pd.DataFrame, bbox=BBOX) -> pd.DataFrame:
    w, s, e, n = bbox
    m = df["longitude"].between(w, e) & df["latitude"].between(s, n)
    return df[m]


def _get_csv(url: str) -> pd.DataFrame:
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    text = r.text
    # FIRMS returns plain-text errors (e.g. "Invalid MAP_KEY.") with HTTP 200.
    if not text.startswith("latitude"):
        raise RuntimeError(f"FIRMS error: {text[:200]!r}")
    return pd.read_csv(io.StringIO(text))


def fetch_api(key: str, sources: list[str], start: date, end: date, bbox=BBOX) -> pd.DataFrame:
    area = ",".join(str(v) for v in bbox)
    frames = []
    for source in sources:
        d = start
        while d <= end:
            days = min(MAX_DAYS_PER_CALL, (end - d).days + 1)
            url = API.format(key=key, source=source, area=area, days=days, start=d.isoformat())
            try:
                frames.append(normalise(_get_csv(url), source))
            except Exception as e:  # noqa: BLE001 — one failed sensor shouldn't kill the run
                # Log with the key masked.
                log.warning("FIRMS %s %s failed: %s", source, d, str(e).replace(key, "***"))
            d += timedelta(days=days)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=COLUMNS)


def fetch_public_7d(sources: list[str], bbox=BBOX) -> pd.DataFrame:
    frames = []
    for source in sources:
        try:
            frames.append(normalise(_get_csv(PUBLIC_7D[source]), source))
        except Exception as e:  # noqa: BLE001
            log.warning("FIRMS public %s failed: %s", source, e)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=COLUMNS)
    return in_bbox(df, bbox)


def fetch_recent(days: int = 7, today: date | None = None) -> tuple[pd.DataFrame, str]:
    """Last `days` days of NRT detections. Returns (fires, method)."""
    today = today or date.today()
    key = secret("FIRMS_MAP_KEY")
    if key:
        df = fetch_api(key, NRT_SOURCES, today - timedelta(days=days - 1), today)
        method = "api"
    else:
        log.warning("FIRMS_MAP_KEY not set: using public 7-day files (dev only).")
        df = fetch_public_7d(NRT_SOURCES)
        method = "public-7d"
    # Empty per-sensor frames (e.g. S-NPP, now retired) make concat lose dtypes; restore them.
    df["acq_utc"] = pd.to_datetime(df["acq_utc"], utc=True)
    df[["latitude", "longitude", "frp"]] = df[["latitude", "longitude", "frp"]].apply(pd.to_numeric)
    df = df.drop_duplicates(subset=["latitude", "longitude", "acq_utc", "satellite"])
    return df.sort_values("acq_utc").reset_index(drop=True), method
