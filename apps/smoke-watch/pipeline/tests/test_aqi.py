import pytest

from smokewatch.aqi import aqi, sub_index, PM10, PM25


def test_breakpoint_edges():
    assert sub_index(30, PM25) == 50 and sub_index(60, PM25) == 100 and sub_index(250, PM25) == 400
    assert sub_index(100, PM10) == 100 and sub_index(430, PM10) == 400
    assert sub_index(0, PM25) == 0 and sub_index(600, PM25) == 500


def test_delhi_example_is_poor_driven_by_pm25():
    # 17 Nov 2026: 24-hour PM2.5 98, PM10 172 µg/m³.
    a = aqi(97.9, 172)  # Delhi, 17 Nov 2026: 24-hour PM2.5 97.9, PM10 172 µg/m³
    assert a["value"] == 226 and a["band"] == "Poor" and a["driver"] == "PM2.5"


def test_pm10_can_drive_and_missing_pollutant_is_skipped():
    assert aqi(40, 300)["driver"] == "PM10"
    assert aqi(40, None)["pollutants"] == ["PM2.5"]
    assert aqi(None, None) is None


@pytest.mark.parametrize("pm25,band", [(20, "Good"), (45, "Satisfactory"), (75, "Moderate"), (110, "Poor"), (200, "Very poor"), (300, "Severe")])
def test_bands(pm25, band):
    assert aqi(pm25, None)["band"] == band
