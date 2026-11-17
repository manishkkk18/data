import math

import pandas as pd

from smokewatch.cpcb import delhi_daily, read_station
from smokewatch.season import merge_cpcb

CCR_LIKE = [
    ["Central Control Room for Air Quality Management - All India", None, None],
    ["Station - Anand Vihar, Delhi - DPCC", None, None],
    ["Parameters - PM2.5", None, None],
    [None, None, None],
    ["From Date", "To Date", "PM2.5"],
    ["15-10-2023 00:00", "16-10-2023 00:00", "180.5"],
    ["16-10-2023 00:00", "17-10-2023 00:00", "None"],
    ["17-10-2023 00:00", "18-10-2023 00:00", "9999"],
    ["18-10-2023 00:00", "19-10-2023 00:00", 210],
    ["Min", None, 180.5],
    ["Avg", None, 195],
]


def test_reads_ccr_like_excel(tmp_path):
    p = tmp_path / "site_123_2023.xlsx"
    pd.DataFrame(CCR_LIKE).to_excel(p, header=False, index=False)
    name, df = read_station(p)
    assert name == "Anand Vihar, Delhi - DPCC"
    assert df["date"].tolist() == ["2023-10-15", "2023-10-16", "2023-10-17", "2023-10-18"]  # footer rows dropped
    v = df["value"].tolist()
    assert v[0] == 180.5 and math.isnan(v[1]) and math.isnan(v[2]) and v[3] == 210  # "None" and 9999 are missing


def test_reads_csv_and_falls_back_to_file_name(tmp_path):
    p = tmp_path / "ITO.csv"
    pd.DataFrame([["Date", "PM2.5 (ug/m3)"], ["2023-11-01", "300"], ["2023-11-02", ""]]).to_csv(p, header=False, index=False)
    name, df = read_station(p)
    assert name == "ITO"
    assert df["value"].iloc[0] == 300 and math.isnan(df["value"].iloc[1])


def test_delhi_daily_station_rule():
    def st(vals):
        return pd.DataFrame({"date": ["2023-11-01", "2023-11-02"], "value": vals})
    stations = {f"s{i}": st([100.0 + i, 200.0 if i < 2 else float("nan")]) for i in range(6)}
    d = delhi_daily(stations)
    assert d["2023-11-01"] == round(sum(100.0 + i for i in range(6)) / 6, 1)
    assert d["2023-11-02"] is None  # only 2 of the usual 6 stations


def test_merge_fills_gaps_only():
    season = {"start": "2023-09-15", "pm25": [50.0, None, None]}
    out = merge_cpcb(season, {"2023-09-15": 999.0, "2023-09-16": 60.0})
    assert out["pm25"] == [50.0, 60.0, None]  # OpenAQ value kept; gap filled; no data stays a gap
    assert out["pm25_source"] == ["openaq", "cpcb", None]
    # Re-applying with newer CPCB data updates CPCB days but still never touches OpenAQ days.
    again = merge_cpcb(out, {"2023-09-15": 1.0, "2023-09-16": 61.0, "2023-09-17": 70.0})
    assert again["pm25"] == [50.0, 61.0, 70.0]


def test_merge_keeps_embassy_unless_cpcb_city_average():
    season = {"start": "2023-11-01", "pm25": [300.0, 280.0], "pm25_source": ["embassy", "embassy"]}
    out = merge_cpcb(season, {"2023-11-01": 310.0})
    assert out["pm25"] == [310.0, 280.0]
    assert out["pm25_source"] == ["cpcb", "embassy"]
