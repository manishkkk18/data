"""Hourly wind over north-west India from Open-Meteo (no key).

A 1° grid over the study bbox plus Delhi itself, at 10 m and 850 hPa (~1.5 km).
Directions follow the meteorological convention: the direction the wind blows FROM.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from .config import BBOX, DELHI

API = "https://api.open-meteo.com/v1/forecast"
LEVELS = {"10m": "10m", "850hPa": "850hPa"}
STEP_DEG = 1.0


def grid_points(bbox=BBOX, step=STEP_DEG) -> list[tuple[float, float]]:
    w, s, e, n = bbox
    lons = np.arange(w, e + 1e-9, step)
    lats = np.arange(s, n + 1e-9, step)
    pts = [(round(float(lo), 2), round(float(la), 2)) for la in lats for lo in lons]
    return pts + [DELHI]  # Delhi last, so the UI can read "wind at Delhi" directly


def fetch(points: list[tuple[float, float]], past_days: int = 7) -> pd.DataFrame:
    """Long table: time (UTC), point index, level, speed (m/s), dir_from (deg)."""
    variables = [f"wind_{q}_{lvl}" for lvl in LEVELS for q in ("speed", "direction")]
    params = {
        "latitude": ",".join(str(p[1]) for p in points),
        "longitude": ",".join(str(p[0]) for p in points),
        "hourly": ",".join(variables),
        "wind_speed_unit": "ms",
        "past_days": past_days,
        "forecast_days": 1,
        "timezone": "UTC",
    }
    r = requests.get(API, params=params, timeout=120)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict):
        data = [data]
    frames = []
    for i, loc in enumerate(data):
        h = loc["hourly"]
        t = pd.to_datetime(h["time"], utc=True)
        for lvl in LEVELS:
            frames.append(pd.DataFrame({
                "time": t, "point": i, "level": lvl,
                "speed": h[f"wind_speed_{lvl}"], "dir_from": h[f"wind_direction_{lvl}"],
            }))
    return pd.concat(frames, ignore_index=True)


def to_uv(speed, dir_from):
    """Wind vector (u east, v north) in m/s from speed and meteorological 'from' direction."""
    rad = np.deg2rad(np.asarray(dir_from, dtype=float))
    s = np.asarray(speed, dtype=float)
    return -s * np.sin(rad), -s * np.cos(rad)


def compass(dir_from: float | None) -> str | None:
    """'From the north-west' style label for a 'from' direction in degrees."""
    if dir_from is None or (isinstance(dir_from, float) and np.isnan(dir_from)):
        return None
    names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
    return names[int(((dir_from % 360) + 22.5) // 45) % 8]


def web_payload(df: pd.DataFrame, points, every_hours: int = 3, now: datetime | None = None) -> dict:
    """Compact JSON for the map: 3-hourly frames up to now, speed (0.1 m/s) and direction (deg)."""
    now = now or datetime.now(timezone.utc)
    d = df[(df["time"] <= now) & (df["time"].dt.hour % every_hours == 0)].dropna(subset=["speed", "dir_from"])
    times = sorted(d["time"].unique())
    out = {"points": [[p[0], p[1]] for p in points], "times": [pd.Timestamp(t).strftime("%Y-%m-%dT%H:%MZ") for t in times],
           "levels": {}}
    for lvl in LEVELS:
        sub = d[d["level"] == lvl].set_index(["time", "point"])
        frames = []
        for t in times:
            row = []
            for i in range(len(points)):
                try:
                    s, a = sub.loc[(t, i), ["speed", "dir_from"]]
                    row.append([round(float(s), 1), int(a)])
                except KeyError:
                    row.append(None)  # gap stays a gap
            frames.append(row)
        out["levels"][lvl] = frames
    return out
