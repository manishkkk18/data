"""Upwind fire load: how much fire was burning along the air's path into Delhi.

Indicative, based on wind and fire detections. Not a source-apportionment study: it
says nothing about how much of Delhi's PM2.5 came from these fires.

For one back-trajectory (air arriving at time T), each fire detection gets a weight:

    weight = FRP x corridor(distance) x decay(travel time)

- Corridor: the trajectory point closest in space AND time to the fire (the air must
  have passed within TIME_SLACK_H of the detection; satellites see fires only at overpass
  while burning lasts hours). Gaussian falloff with distance, width R0_KM growing by
  R_GROW_KMH per hour of travel, because the path gets less certain further back; cut
  off at CUTOFF_SIGMA widths.
- Decay: exp(-hours / DECAY_H). Older smoke has had longer to disperse and settle.

The "upwind fire load" for an arrival is the sum of weights; a district's or state's
share is its part of that sum. The two heights (10 m, 850 hPa) are averaged equally.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

R0_KM = 30.0
R_GROW_KMH = 3.0
DECAY_H = 24.0
TIME_SLACK_H = 12.0
CUTOFF_SIGMA = 2.5  # corridor edge, in corridor widths (75 km near Delhi, ~435 km at 48 h)
MIN_WEIGHT = 1e-3  # MW-equivalent; smaller contributions are treated as zero


def fire_weights(path: list[tuple[float, float, int]], arrival_hour: float, fires: pd.DataFrame) -> np.ndarray:
    """Weight of each fire (rows of `fires`: longitude, latitude, frp, hour) for one trajectory."""
    if fires.empty or len(path) < 2:
        return np.zeros(len(fires))
    p = np.asarray(path, dtype=float)  # (P, 3): lon, lat, tau
    plon, plat, tau = p[:, 0], p[:, 1], p[:, 2]
    # Fires further than the widest corridor edge from every path point can't count:
    # skip them before the (fires x path points) distance matrix.
    reach_km = CUTOFF_SIGMA * (R0_KM + R_GROW_KMH * tau.max())
    pad_lat = reach_km / 111.32
    pad_lon = reach_km / (111.32 * np.cos(np.deg2rad(min(abs(plat).max() + pad_lat, 80))))
    lon_all, lat_all = fires["longitude"].to_numpy(), fires["latitude"].to_numpy()
    near = ((lon_all >= plon.min() - pad_lon) & (lon_all <= plon.max() + pad_lon)
            & (lat_all >= plat.min() - pad_lat) & (lat_all <= plat.max() + pad_lat))
    out = np.zeros(len(fires))
    if not near.any():
        return out
    sub = fires[near]
    flon = sub["longitude"].to_numpy()[:, None]
    flat = sub["latitude"].to_numpy()[:, None]
    fhour = sub["hour"].to_numpy()[:, None]
    # Equirectangular distance in km (fine at these scales).
    kx = 111.32 * np.cos(np.deg2rad((flat + plat[None, :]) / 2))
    d = np.hypot((flon - plon[None, :]) * kx, (flat - plat[None, :]) * 111.32)  # (N, P)
    r = R0_KM + R_GROW_KMH * tau[None, :]
    passed_at = arrival_hour - tau[None, :]
    time_ok = np.abs(fhour - passed_at) <= TIME_SLACK_H
    inside = d <= CUTOFF_SIGMA * r  # the corridor has an edge: no long Gaussian tail
    k = np.exp(-0.5 * (d / r) ** 2) * np.exp(-tau[None, :] / DECAY_H) * time_ok * inside
    w = sub["frp"].to_numpy() * k.max(axis=1)
    w[w < MIN_WEIGHT] = 0.0
    out[near] = w
    return out


HOURS_BACK = 48
ARRIVAL_EVERY_H = 3
TOP_DISTRICTS = 10


def compute_payload(fires: pd.DataFrame, fields: dict, delhi: tuple[float, float], start_hour: float, end_hour: float,
                    fires_from_hour: float) -> dict:
    """Trajectories and upwind shares for air arriving in Delhi every ARRIVAL_EVERY_H hours
    from start_hour to end_hour (hours since epoch). `fires` needs longitude, latitude, frp,
    hour, district, state. An arrival is 'complete' only if fire data reaches back far enough."""
    from .trajectory import back_trajectory

    first = np.ceil(start_hour / ARRIVAL_EVERY_H) * ARRIVAL_EVERY_H
    arrivals = np.arange(first, end_hour + 1e-9, ARRIVAL_EVERY_H)
    f = fires.reset_index(drop=True)
    day_weights: dict[str, np.ndarray] = {}
    out_arrivals = []
    for T in arrivals:
        window = f[(f["hour"] >= T - HOURS_BACK - TIME_SLACK_H) & (f["hour"] <= T + TIME_SLACK_H)]
        paths, ws = {}, []
        for level, field in fields.items():
            path = back_trajectory(field, delhi[0], delhi[1], T, hours=HOURS_BACK)
            paths[level] = path
            ws.append(fire_weights(path, T, window))
        w = np.mean(ws, axis=0) if ws else np.zeros(len(window))
        full = np.zeros(len(f))
        full[window.index.to_numpy()] = w
        t = pd.Timestamp(T * 3600, unit="s", tz="UTC")
        day = t.tz_convert("Asia/Kolkata").date().isoformat()
        day_weights[day] = day_weights.get(day, np.zeros(len(f))) + full
        out_arrivals.append({
            "t": t.strftime("%Y-%m-%dT%H:%MZ"),
            "complete": bool(T - HOURS_BACK - TIME_SLACK_H >= fires_from_hour),
            "paths": {lvl: [[p[0], p[1]] for p in path] for lvl, path in paths.items()},
            "load": round(float(w.sum()), 1),
            "states": [[r["state"], r["share"]] for r in shares(window, w, "state")],
            "districts": [[r["district"], r["share"]] for r in shares(window, w, "district")[:TOP_DISTRICTS]],
        })
    days = []
    for day, w in sorted(day_weights.items()):
        mine = [a for a in out_arrivals if pd.Timestamp(a["t"]).tz_convert("Asia/Kolkata").date().isoformat() == day]
        n = len(mine)
        days.append({
            "date": day,
            "arrivals": n,
            # A full day has every 3-hourly arrival, each with its whole fire history.
            "complete": n == 24 // ARRIVAL_EVERY_H and all(a["complete"] for a in mine),
            "load": round(float(w.sum()) / max(n, 1), 1),  # mean per arrival, comparable across days
            "states": [[r["state"], r["share"]] for r in shares(f, w, "state")],
            "districts": [[r["district"], r["share"]] for r in shares(f, w, "district")[:TOP_DISTRICTS]],
        })
    return {
        "method": {"hours_back": HOURS_BACK, "arrival_every_h": ARRIVAL_EVERY_H, "corridor_km": R0_KM,
                   "corridor_growth_km_per_h": R_GROW_KMH, "corridor_cutoff_widths": CUTOFF_SIGMA,
                   "decay_h": DECAY_H, "time_slack_h": TIME_SLACK_H, "levels": list(fields)},
        "note": "Indicative, based on wind and fire detections. Not a source-apportionment study.",
        "arrivals": out_arrivals,
        "days": days,
    }


def shares(fires: pd.DataFrame, weights: np.ndarray, key: str) -> list[dict]:
    """[{key, load, share}] sorted by load; fires with no value for `key` are 'Outside India'."""
    total = float(weights.sum())
    if total <= 0:
        return []
    g = pd.Series(weights, index=fires[key].fillna("Outside India").to_numpy()).groupby(level=0).sum()
    g = g[g > 0].sort_values(ascending=False)
    return [{key: k, "load": round(float(v), 1), "share": round(float(v) / total, 4)} for k, v in g.items()]
