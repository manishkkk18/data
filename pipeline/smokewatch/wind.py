"""Hourly wind over north-west India and its upwind approaches, from Open-Meteo (no key).

Two 1° grids, both aligned on .5° so one is a subset of the other:
- TRAJ_BBOX, wide enough for 48-hour back-trajectories (air can cover ~1,500 km in 2 days).
- BBOX (the study area), the only part drawn as arrows on the map.
Levels: 10 m and 850 hPa (~1.5 km). Directions are meteorological: where the wind blows FROM.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from .config import BBOX, DELHI, TRAJ_BBOX
from .trajectory import WindField

API = "https://api.open-meteo.com/v1/forecast"
LEVELS = ("10m", "850hPa")
STEP_DEG = 1.0
CHUNK = 40  # locations per request: small enough that Open-Meteo answers quickly
RETRIES = 4


def _get_with_retry(params: dict):
    """Open-Meteo is free and sometimes slow: retry timeouts and 429/5xx with a growing pause."""
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(API, params=params, timeout=90)
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
            r.raise_for_status()
            return r.json()
        except (requests.Timeout, requests.ConnectionError, requests.HTTPError) as e:
            if isinstance(e, requests.HTTPError) and e.response is not None and 400 <= e.response.status_code < 500 and e.response.status_code != 429:
                raise  # a real request error: retrying won't help
            last = e
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Open-Meteo failed after {RETRIES} tries: {last}")


def grid_points(bbox=BBOX, step=STEP_DEG) -> list[tuple[float, float]]:
    """Grid points (lon, lat), row by row from the south-west corner."""
    w, s, e, n = bbox
    lons = np.arange(w, e + 1e-9, step)
    lats = np.arange(s, n + 1e-9, step)
    return [(round(float(lo), 2), round(float(la), 2)) for la in lats for lo in lons]


def fetch(points: list[tuple[float, float]], past_days: int = 7) -> pd.DataFrame:
    """Long table: time (UTC), point (index into `points`), level, speed (m/s), dir_from (deg)."""
    variables = [f"wind_{q}_{lvl}" for lvl in LEVELS for q in ("speed", "direction")]
    frames = []
    for c0 in range(0, len(points), CHUNK):
        chunk = points[c0:c0 + CHUNK]
        params = {
            "latitude": ",".join(str(p[1]) for p in chunk),
            "longitude": ",".join(str(p[0]) for p in chunk),
            "hourly": ",".join(variables),
            "wind_speed_unit": "ms",
            "past_days": past_days,
            "forecast_days": 1,
            "timezone": "UTC",
        }
        data = _get_with_retry(params)
        if isinstance(data, dict):
            data = [data]
        for k, loc in enumerate(data):
            h = loc["hourly"]
            t = pd.to_datetime(h["time"], utc=True)
            for lvl in LEVELS:
                frames.append(pd.DataFrame({
                    "time": t, "point": c0 + k, "level": lvl,
                    "speed": h[f"wind_speed_{lvl}"], "dir_from": h[f"wind_direction_{lvl}"],
                }))
    return pd.concat(frames, ignore_index=True)


def to_uv(speed, dir_from):
    """Wind vector (u east, v north) in m/s from speed and meteorological 'from' direction."""
    rad = np.deg2rad(np.asarray(dir_from, dtype=float))
    s = np.asarray(speed, dtype=float)
    return -s * np.sin(rad), -s * np.cos(rad)


def compass(dir_from: float | None) -> str | None:
    """'north-west' style label for a 'from' direction in degrees."""
    if dir_from is None or (isinstance(dir_from, float) and np.isnan(dir_from)):
        return None
    names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
    return names[int(((dir_from % 360) + 22.5) // 45) % 8]


def wind_field(df: pd.DataFrame, points: list[tuple[float, float]], level: str, bbox=TRAJ_BBOX) -> WindField:
    """Gridded hourly u/v for one level, for the trajectory code. Missing values stay NaN."""
    w, s, e, n = bbox
    lons = np.arange(w, e + 1e-9, STEP_DEG)
    lats = np.arange(s, n + 1e-9, STEP_DEG)
    d = df[df["level"] == level]
    times = np.array(sorted(d["time"].unique()))
    t_index = {t: i for i, t in enumerate(times)}
    u = np.full((len(times), len(lats), len(lons)), np.nan)
    v = np.full_like(u, np.nan)
    pos = {}
    for i, (lo, la) in enumerate(points):
        xi = int(round((lo - w) / STEP_DEG))
        yi = int(round((la - s) / STEP_DEG))
        if 0 <= xi < len(lons) and 0 <= yi < len(lats) and abs(lons[xi] - lo) < 1e-6 and abs(lats[yi] - la) < 1e-6:
            pos[i] = (yi, xi)
    d = d[d["point"].isin(pos.keys())]
    uu, vv = to_uv(d["speed"].to_numpy(), d["dir_from"].to_numpy())
    for ti, pi, a, b in zip(d["time"].map(t_index), d["point"], uu, vv):
        yi, xi = pos[pi]
        u[ti, yi, xi] = a
        v[ti, yi, xi] = b
    hours = np.array([pd.Timestamp(t).timestamp() / 3600 for t in times])
    return WindField(hours=hours, lons=lons, lats=lats, u=u, v=v)


def web_payload(df: pd.DataFrame, points, keep: list[int], every_hours: int = 3, now: datetime | None = None, since=None) -> dict:
    """Compact JSON for the map: 3-hourly frames up to now for the `keep` points (Delhi last),
    speed (0.1 m/s) and direction (deg)."""
    now = now or datetime.now(timezone.utc)
    d = df[(df["time"] <= now) & (df["time"].dt.hour % every_hours == 0) & df["point"].isin(keep)]
    if since is not None:
        d = d[d["time"] >= since]
    d = d.dropna(subset=["speed", "dir_from"])
    times = sorted(d["time"].unique())
    out = {"points": [[points[i][0], points[i][1]] for i in keep],
           "times": [pd.Timestamp(t).strftime("%Y-%m-%dT%H:%MZ") for t in times], "levels": {}}
    for lvl in LEVELS:
        sub = d[d["level"] == lvl].set_index(["time", "point"])
        frames = []
        for t in times:
            row = []
            for i in keep:
                try:
                    s, a = sub.loc[(t, i), ["speed", "dir_from"]]
                    row.append([round(float(s), 1), int(a)])
                except KeyError:
                    row.append(None)  # gap stays a gap
            frames.append(row)
        out["levels"][lvl] = frames
    return out


def all_points() -> tuple[list[tuple[float, float]], list[int]]:
    """Trajectory grid + Delhi, and the indices the map draws (study grid, Delhi last)."""
    pts = grid_points(TRAJ_BBOX) + [DELHI]
    w, s, e, n = BBOX
    keep = [i for i, (lo, la) in enumerate(pts[:-1]) if w - 1e-6 <= lo <= e + 1e-6 and s - 1e-6 <= la <= n + 1e-6]
    return pts, keep + [len(pts) - 1]
