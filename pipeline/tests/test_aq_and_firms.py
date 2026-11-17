import math

import pandas as pd

from smokewatch import openaq
from smokewatch.firms import normalise


def _hours(n_stations, hours, value=100.0, start="2026-11-10T18:30Z"):
    t0 = pd.Timestamp(start)
    return pd.DataFrame([
        {"sensor_id": s, "parameter": "pm25", "hour_utc": t0 + pd.Timedelta(hours=h), "value": value}
        for s in range(n_stations) for h in range(hours)
    ])


def test_hour_with_too_few_stations_is_a_gap():
    h = openaq.delhi_hourly(_hours(openaq.MIN_STATIONS - 1, 1))
    assert math.isnan(h["value"].iloc[0])


def test_invalid_values_ignored():
    df = _hours(3, 1)
    df = pd.concat([df, df.iloc[[0]].assign(sensor_id=99, value=9999.0)])
    h = openaq.delhi_hourly(df)
    assert h["value"].iloc[0] == 100.0 and h["n_stations"].iloc[0] == 3


def test_daily_uses_ist_day_and_min_hours():
    # 18:30 UTC = 00:00 IST, so 24 hours from there are one IST day.
    full = openaq.delhi_daily(openaq.delhi_hourly(_hours(3, 24)))
    assert len(full) == 1 and full["value"].iloc[0] == 100.0 and str(full["date"].iloc[0]) == "2026-11-11"
    short = openaq.delhi_daily(openaq.delhi_hourly(_hours(3, openaq.MIN_HOURS - 1)))
    assert math.isnan(short["value"].iloc[0])


def test_firms_normalise_viirs_and_modis():
    base = {"latitude": 30.0, "longitude": 75.0, "acq_date": "2026-11-10", "acq_time": 805,
            "satellite": "N20", "frp": 5.0, "daynight": "D"}
    v = normalise(pd.DataFrame([{**base, "confidence": "h"}, {**base, "confidence": "nominal"}]), "VIIRS_NOAA20_NRT")
    assert v["confidence"].tolist() == ["high", "nominal"]
    assert v["acq_utc"].iloc[0] == pd.Timestamp("2026-11-10T08:05Z")
    m = normalise(pd.DataFrame([{**base, "confidence": c} for c in (10, 50, 90)]), "MODIS_NRT")
    assert m["confidence"].tolist() == ["low", "nominal", "high"]
