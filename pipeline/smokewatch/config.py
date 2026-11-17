"""Shared settings. Secrets are read from the environment only (never hard-coded)."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RAW = DATA / "raw"
OUT = ROOT / "pipeline" / "out"

load_dotenv(ROOT / ".env")

# Study area: Punjab, Haryana, Delhi-NCR, West UP and the northern edges of
# Rajasthan / MP. (west, south, east, north) in degrees.
BBOX = (72.5, 25.5, 80.5, 32.6)

# States we report on. Fires elsewhere in the bbox are kept but grouped as "Other".
FOCUS_STATES = ["Punjab", "Haryana", "Delhi", "Uttar Pradesh", "Rajasthan", "Madhya Pradesh"]

# Delhi reference point (Connaught Place) for distances and trajectories.
DELHI = (77.2167, 28.6315)  # lon, lat

# Sensors. "consistent" is the set used for year-over-year comparison.
# Suomi NPP stopped delivering data in early Nov 2026 and NOAA-21 only starts in
# 2023/24, so NOAA-20 (data every season since 2018) is the only VIIRS sensor
# present in every season 2020-2026. S-NPP is still queried for past seasons.
NRT_SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"]
CONSISTENT_SENSORS = {"N20"}  # satellite codes as they appear in FIRMS CSVs


def secret(name: str) -> str | None:
    """Return a secret from the environment, or None. Never log the value."""
    v = os.environ.get(name, "").strip()
    return v or None
