from datetime import date

import geopandas as gpd
import pandas as pd
from shapely.geometry import box

from smokewatch.season import daily_counts, delhi_daily_pm25, fires_payload, season_dates


def test_season_dates_past_and_in_progress():
    assert season_dates(2024, today=date(2026, 11, 17)) == (date(2024, 9, 15), date(2024, 12, 15), True)
    # In progress: ends yesterday, not complete.
    assert season_dates(2026, today=date(2026, 11, 17)) == (date(2026, 9, 15), date(2026, 11, 16), False)
    assert season_dates(2026, today=date(2026, 12, 16))[2] is True


def fires(*rows):
    df = pd.DataFrame(rows, columns=["acq_utc", "state", "district", "longitude", "latitude", "frp"])
    df["acq_utc"] = pd.to_datetime(df["acq_utc"], utc=True)
    return df


def test_daily_counts_use_ist_days_and_split_india():
    f = fires(
        ("2025-09-15T08:00Z", "Punjab", "Sangrur", 75.8, 30.2, 5.0),
        ("2025-09-15T20:00Z", "Haryana", "Karnal", 77.0, 29.7, 2.0),  # 01:30 IST on 16 Sep
        ("2025-09-16T08:00Z", None, None, 74.3, 31.5, 9.0),  # across the border
    )
    c = daily_counts(f, date(2025, 9, 15), date(2025, 9, 17))
    assert c["total"] == [1, 2, 0]
    assert c["india"] == [1, 1, 0]
    assert c["states"]["Punjab"] == [1, 0, 0] and c["states"]["Haryana"] == [0, 1, 0]


def test_delhi_daily_pm25_needs_coverage_and_stations():
    rows = []
    for day in ("2025-11-01", "2025-11-02", "2025-11-03"):
        for s in range(10):
            rows.append({"sensor_id": s, "date": day, "value": 200.0, "pct": 100})
    # 2 Nov: most stations have too few hours -> only 2 count -> gap.
    for r in rows:
        if r["date"] == "2025-11-02" and r["sensor_id"] >= 2:
            r["pct"] = 50
    rows.append({"sensor_id": 99, "date": "2025-11-03", "value": 9999.0, "pct": 100})  # instrument error ignored
    pm = delhi_daily_pm25(pd.DataFrame(rows))
    assert pm["2025-11-01"] == 200.0
    assert pm["2025-11-02"] is None
    assert pm["2025-11-03"] == 200.0
    assert delhi_daily_pm25(pd.DataFrame(columns=["sensor_id", "date", "value", "pct"])) == {}


def test_fires_payload_rows_and_district_index():
    districts = gpd.GeoDataFrame({"id": ["punjab--sangrur"], "district": ["Sangrur"], "state": ["Punjab"]}, geometry=[box(0, 0, 1, 1)])
    f = fires(("2025-09-16T20:30Z", "Punjab", "Sangrur", 75.81234, 30.2, 5.04), ("2025-09-15T08:00Z", None, None, 74.3, 31.5, 9.0))
    p = fires_payload(f, districts, date(2025, 9, 15))
    assert p["district_ids"] == ["punjab--sangrur"]
    # 20:30 UTC on 16 Sep is 02:00 IST on 17 Sep -> day index 2.
    assert p["rows"][0] == [75.812, 30.2, 2, 2030, 5.0, 0]
    assert p["rows"][1][-1] == -1
