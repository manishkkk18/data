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

# Live map: all of India (and the edges of neighbouring countries in the frame).
# (west, south, east, north) in degrees.
BBOX = (68.0, 6.5, 97.5, 37.5)
# Burning-season history (season.py) still covers north-west India until it is rebuilt
# for the whole country; keeping it separate stops the daily season update mixing areas.
SEASON_BBOX = (72.5, 25.5, 80.5, 32.6)
# Wind grid for 48-hour back-trajectories: India plus its upwind approaches (Pakistan,
# Afghanistan, the Arabian Sea, Bay of Bengal). 2° steps keep it within Open-Meteo's free
# daily limit (~460 points x 8 runs). Aligned with BBOX so the map's arrows are a subset.
TRAJ_BBOX = (58.0, 0.5, 100.0, 40.5)

# States we report on. Fires elsewhere in the bbox are kept but grouped as "Other".
FOCUS_STATES = ["Punjab", "Haryana", "Delhi", "Uttar Pradesh", "Rajasthan", "Madhya Pradesh"]

# Delhi reference point (Connaught Place) for distances and trajectories.
DELHI = (77.2167, 28.6315)  # lon, lat

# Cities with their own air quality, wind, air's path and upwind share. lon/lat is the
# city centre (where trajectories arrive). Air quality uses reference monitors inside
# `aq_bbox` (Delhi: all of NCT) or within `aq_radius_km` of the centre (OpenAQ allows <= 25 km).
CITIES: dict[str, dict] = {
    "delhi": {"name": "Delhi", "lon": 77.2167, "lat": 28.6315, "aq_bbox": (76.84, 28.40, 77.35, 28.88)},
    "mumbai": {"name": "Mumbai", "lon": 72.8777, "lat": 19.0760, "aq_radius_km": 25},
    "kolkata": {"name": "Kolkata", "lon": 88.3639, "lat": 22.5726, "aq_radius_km": 25},
    "chennai": {"name": "Chennai", "lon": 80.2707, "lat": 13.0827, "aq_radius_km": 25},
    "bengaluru": {"name": "Bengaluru", "lon": 77.5946, "lat": 12.9716, "aq_radius_km": 25},
    "hyderabad": {"name": "Hyderabad", "lon": 78.4867, "lat": 17.3850, "aq_radius_km": 25},
    "ahmedabad": {"name": "Ahmedabad", "lon": 72.5714, "lat": 23.0225, "aq_radius_km": 25},
    "lucknow": {"name": "Lucknow", "lon": 80.9462, "lat": 26.8467, "aq_radius_km": 25},
    "patna": {"name": "Patna", "lon": 85.1376, "lat": 25.5941, "aq_radius_km": 25},
    "jaipur": {"name": "Jaipur", "lon": 75.7873, "lat": 26.9124, "aq_radius_km": 25},
    "guwahati": {"name": "Guwahati", "lon": 91.7362, "lat": 26.1445, "aq_radius_km": 25},
    "bhopal": {"name": "Bhopal", "lon": 77.4126, "lat": 23.2599, "aq_radius_km": 25},
}

# Sensors. "consistent" is the set used for year-over-year comparison.
# Suomi NPP stopped delivering data in early Nov 2026 and NOAA-21 only starts in
# 2023/24, so NOAA-20 (data every season since 2018) is the only VIIRS sensor
# present in every season 2020-2026. S-NPP is still queried for past seasons.
# The live map uses VIIRS only: across India MODIS (1 km) mostly duplicates it and would
# add volume without detail.
NRT_SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"]
CONSISTENT_SENSORS = {"N20"}  # satellite codes as they appear in FIRMS CSVs


def secret(name: str) -> str | None:
    """Return a secret from the environment, or None. Never log the value."""
    v = os.environ.get(name, "").strip()
    return v or None
