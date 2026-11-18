"""India's National Air Quality Index (CPCB) from PM2.5 and PM10 24-hour averages.

Each pollutant's 24-hour average concentration (µg/m³) is turned into a sub-index by linear
interpolation within CPCB's breakpoints; the AQI is the highest sub-index. CPCB computes this
per station and averages the stations; we use the city-wide average concentrations, so values
can differ a little from CPCB's bulletin. Needs at least 18 of the 24 hours.
"""
from __future__ import annotations

# (concentration low, high, index low, high), µg/m³ -> AQI
PM25 = [(0, 30, 0, 50), (30, 60, 50, 100), (60, 90, 100, 200), (90, 120, 200, 300), (120, 250, 300, 400), (250, 380, 400, 500)]
PM10 = [(0, 50, 0, 50), (50, 100, 50, 100), (100, 250, 100, 200), (250, 350, 200, 300), (350, 430, 300, 400), (430, 510, 400, 500)]
BANDS = [(50, "Good"), (100, "Satisfactory"), (200, "Moderate"), (300, "Poor"), (400, "Very poor"), (500, "Severe")]


def sub_index(conc: float | None, breakpoints) -> float | None:
    if conc is None:
        return None
    for lo, hi, ilo, ihi in breakpoints:
        if conc <= hi:
            return ilo + (max(conc, lo) - lo) * (ihi - ilo) / (hi - lo)
    return 500.0


def aqi(pm25_24h: float | None, pm10_24h: float | None) -> dict | None:
    """{'value', 'band', 'driver'} or None if neither average is available."""
    subs = {"PM2.5": sub_index(pm25_24h, PM25), "PM10": sub_index(pm10_24h, PM10)}
    subs = {k: v for k, v in subs.items() if v is not None}
    if not subs:
        return None
    driver = max(subs, key=subs.get)
    value = round(subs[driver])
    band = next(name for top, name in BANDS if value <= top)
    return {"value": value, "band": band, "driver": driver, "pollutants": sorted(subs)}
