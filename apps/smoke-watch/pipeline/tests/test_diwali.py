from datetime import date

import numpy as np
import pandas as pd

from smokewatch import diwali

D = date(2026, 11, 8)


def hourly(base=100.0, first=date(2026, 11, 1), days=16):
    idx = pd.date_range(f"{first}T00:00", periods=24 * days, freq="h")
    return pd.Series(base, index=idx, dtype=float)


def test_dates_and_rules_cover_every_year_with_sources():
    assert sorted(diwali.DIWALI) == sorted(diwali.RULES) == list(range(2020, 2027))
    assert diwali.DIWALI[2026]["date"] == "2026-11-08" and diwali.DIWALI[2024]["date"] == "2024-10-31"
    assert all(r["source"].startswith("https://") for r in diwali.RULES.values())


def test_night_mean_needs_nine_of_twelve_hours():
    s = hourly()
    assert diwali.night_mean(s, D) == 100
    s[pd.date_range("2026-11-08T18:00", periods=4, freq="h")] = np.nan  # 8 of 12 left
    assert diwali.night_mean(s, D) is None


def test_stats_peak_percent_and_back_to_normal():
    s = hourly(100.0)
    night = pd.date_range("2026-11-08T18:00", periods=12, freq="h")
    s[night] = 200.0
    s[pd.Timestamp("2026-11-08T23:00")] = 600.0  # the peak
    # after the night it stays high until 09:00 on the 9th, then back to 100
    s[pd.date_range("2026-11-09T06:00", "2026-11-09T08:00", freq="h")] = 150.0
    out = diwali.stats(s, D)
    assert out["baseline"] == 100 and out["baseline_nights"] == 10
    assert out["peak"] == {"value": 600, "hour": "2026-11-08T23:00"}
    assert out["night_mean"] == round((200 * 11 + 600) / 12)
    assert out["pct_above"] == round(((200 * 11 + 600) / 12 / 100 - 1) * 100)
    assert out["back_to_normal_h"] == 10  # 23:00 -> 09:00


def test_stats_says_so_when_it_never_comes_back():
    s = hourly(100.0)
    s[s.index >= pd.Timestamp("2026-11-08T18:00")] = 300.0
    s[pd.date_range("2026-11-11T18:00", "2026-11-15T06:00", freq="h")] = 100.0  # later baseline nights stay normal...
    s[s.index >= pd.Timestamp("2026-11-11T18:00")] = 120.0  # ...but never at or below the baseline
    out = diwali.stats(s, D)
    assert out["back_to_normal_h"] is None and "not back to normal" in out["back_note"]


def test_too_few_baseline_nights_means_no_comparison():
    s = hourly(100.0)
    s[(s.index < pd.Timestamp("2026-11-07")) | (s.index > pd.Timestamp("2026-11-10"))] = np.nan
    out = diwali.stats(s, D)
    assert out["baseline"] is None and out["pct_above"] is None


def test_city_median_and_station_rule():
    hours = pd.date_range("2026-11-08T00:00", periods=3, freq="h")
    rows = []
    for loc, vals in {1: [10, 10, 10], 2: [20, 20, 20], 3: [30, 30, None], 4: [100, None, None]}.items():
        rows += [{"location_id": loc, "hour": h, "parameter": "pm25", "value": v} for h, v in zip(hours, vals) if v is not None]
    med, n = diwali.city_median(pd.DataFrame(rows), hours, "pm25")
    assert list(n) == [4, 3, 2]
    assert med.iloc[0] == 25 and med.iloc[1] == 20  # medians, not means
    assert np.isnan(med.iloc[2])  # only 2 stations: a gap


def test_archive_file_is_read_as_hour_start_ist():
    csv = "location_id,sensors_id,location,datetime,lat,lon,parameter,units,value\n" \
          "1,1,x,2026-11-08T19:00:00+05:30,0,0,pm25,ug,200\n" \
          "1,1,x,2026-11-08T19:00:00+05:30,0,0,pm10,ug,300\n" \
          "1,1,x,2026-11-08T19:15:00+05:30,0,0,pm25,ug,220\n" \
          "1,1,x,2026-11-08T19:15:00+05:30,0,0,no2,ug,40\n"
    df = diwali.archive_station_hours(csv)
    pm25 = df[df["parameter"] == "pm25"].set_index("hour")["value"]
    # 19:00 closes the 18:00 hour; 19:15 is in the 19:00 hour
    assert pm25[pd.Timestamp("2026-11-08T18:00")] == 200 and pm25[pd.Timestamp("2026-11-08T19:00")] == 220
    assert set(df["parameter"]) == {"pm25", "pm10"}


def test_years_spec():
    assert diwali._years("2020-2022,2026") == [2020, 2021, 2022, 2026]
    assert diwali._years("2019-2020") == [2020]


def test_partial_hours_and_spread():
    hours = pd.date_range("2026-11-08T00:00", periods=4, freq="h")
    rows = []
    # 12 monitors usually; hour 3 has only 7 of them (more than half, less than three-quarters)
    for loc in range(12):
        for k, h in enumerate(hours):
            if k == 3 and loc >= 7:
                continue
            rows.append({"location_id": loc, "hour": h, "parameter": "pm25", "value": 100 + loc * 10})
    g = diwali.city_hours(pd.DataFrame(rows), hours, "pm25")
    assert list(g["n"]) == [12, 12, 12, 7]
    assert list(g["partial"]) == [False, False, False, True]
    assert g["max"].iloc[0] == 210 and g["median"].iloc[0] == 155
    assert abs(g["p90"].iloc[0] - 199) < 1e-9  # 90th percentile of 100..210
    assert np.isnan(g["p90"].iloc[3])  # fewer than 10 monitors: no percentile


def test_night_extras_flags_a_partial_peak():
    hours = pd.date_range("2026-11-08T00:00", periods=36, freq="h")
    g = pd.DataFrame({"median": 100.0, "p90": 150.0, "max": 200.0, "n": 40, "partial": False}, index=hours)
    peak = pd.Timestamp("2026-11-09T00:00")
    g.loc[peak, ["median", "max", "n", "partial"]] = [500.0, 980.0, 20, True]
    src = pd.Series(np.where(g["partial"], "p", "c"), index=hours)
    out = diwali.night_extras(g, src, D)
    assert out["worst_monitor"] == {"value": 980, "hour": "2026-11-09T00:00"}
    assert out["partial_night_hours"] == 1 and out["peak_partial"] and out["peak_monitors"] == 20
