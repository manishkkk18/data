"""Simple back-trajectories: where was the air arriving in Delhi 1, 2 ... 48 hours ago?

Method (deliberately simple, and indicative only):
- Winds are Open-Meteo hourly u/v on a 1° grid at a single height (10 m or 850 hPa),
  interpolated bilinearly in space and linearly in time.
- The air parcel is stepped backwards in time with Heun's method (a two-stage
  Runge-Kutta), 15-minute steps, and recorded every hour.
- No vertical motion, no turbulence, no terrain: real air rises, sinks and mixes. Treat
  the path as the centre of a widening corridor, not a precise line.
- If the parcel leaves the wind grid or hits missing wind, the path stops there.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

M_PER_DEG = 111_320.0


@dataclass
class WindField:
    hours: np.ndarray  # (T,) hours since the Unix epoch, ascending
    lons: np.ndarray  # (X,) ascending
    lats: np.ndarray  # (Y,) ascending
    u: np.ndarray  # (T, Y, X) m/s, eastward
    v: np.ndarray  # (T, Y, X) m/s, northward

    def at(self, hour: float, lon: float, lat: float) -> tuple[float, float] | None:
        """Wind (u, v) at a time and place, or None outside the grid / time range or where data is missing."""
        if not (self.hours[0] <= hour <= self.hours[-1]):
            return None
        if not (self.lons[0] <= lon <= self.lons[-1] and self.lats[0] <= lat <= self.lats[-1]):
            return None
        ti = min(int(np.searchsorted(self.hours, hour, side="right")) - 1, len(self.hours) - 2)
        ti = max(ti, 0)
        ft = (hour - self.hours[ti]) / (self.hours[ti + 1] - self.hours[ti]) if len(self.hours) > 1 else 0.0
        xi = min(int(np.searchsorted(self.lons, lon, side="right")) - 1, len(self.lons) - 2)
        yi = min(int(np.searchsorted(self.lats, lat, side="right")) - 1, len(self.lats) - 2)
        fx = (lon - self.lons[xi]) / (self.lons[xi + 1] - self.lons[xi])
        fy = (lat - self.lats[yi]) / (self.lats[yi + 1] - self.lats[yi])

        def bilinear(a: np.ndarray) -> float:
            c = a[yi:yi + 2, xi:xi + 2]
            return (c[0, 0] * (1 - fx) * (1 - fy) + c[0, 1] * fx * (1 - fy) + c[1, 0] * (1 - fx) * fy + c[1, 1] * fx * fy)

        out = []
        for comp in (self.u, self.v):
            a = bilinear(comp[ti])
            b = bilinear(comp[ti + 1]) if len(self.hours) > 1 else a
            out.append(a * (1 - ft) + b * ft)
        if any(np.isnan(x) for x in out):
            return None
        return float(out[0]), float(out[1])


def _step(lon: float, lat: float, u: float, v: float, seconds: float) -> tuple[float, float]:
    """Move a point by wind (u, v) for `seconds` (negative = backwards)."""
    dlat = v * seconds / M_PER_DEG
    dlon = u * seconds / (M_PER_DEG * np.cos(np.deg2rad(lat)))
    return lon + dlon, lat + dlat


def back_trajectory(field: WindField, lon: float, lat: float, arrival_hour: float, hours: int = 48, step_min: int = 15) -> list[tuple[float, float, int]]:
    """Path of the air arriving at (lon, lat) at `arrival_hour`, as [(lon, lat, hours_before_arrival)],
    one point per hour from 0 back to `hours` (fewer if it leaves the grid or hits missing data)."""
    dt = step_min * 60.0
    per_hour = 60 // step_min
    path = [(lon, lat, 0)]
    t = arrival_hour
    x, y = lon, lat
    for k in range(1, hours * per_hour + 1):
        w0 = field.at(t, x, y)
        if w0 is None:
            break
        # Heun: predict with the wind here, correct with the wind at the predicted point.
        px, py = _step(x, y, w0[0], w0[1], -dt)
        w1 = field.at(t - dt / 3600, px, py)
        if w1 is None:
            break
        x, y = _step(x, y, (w0[0] + w1[0]) / 2, (w0[1] + w1[1]) / 2, -dt)
        t -= dt / 3600
        if k % per_hour == 0:
            path.append((round(x, 4), round(y, 4), k // per_hour))
    return path
