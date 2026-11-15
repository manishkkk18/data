import datetime as dt

import geopandas as gpd
import pytest
from shapely.geometry import box

from nightlights.diwali import BASELINE, DIWALI, WINDOW, city_polygons, effect_for, nights


def test_effect_uses_median_of_normal_nights():
    values = {o: 10.0 for o in BASELINE}
    values[BASELINE[0]] = 100.0  # one odd night doesn't move a median
    values[0] = 15.0
    values[-1] = 50.0  # pre-Diwali lights are not part of the baseline
    effect, n = effect_for(values)
    assert effect == pytest.approx(50.0)
    assert n == len(BASELINE)


def test_cloudy_diwali_night_or_thin_baseline_is_missing_not_guessed():
    base = {o: 10.0 for o in BASELINE}
    assert effect_for({**base, 0: None})[0] is None
    thin = {BASELINE[0]: 10.0, BASELINE[1]: 10.0, 0: 20.0}
    assert effect_for(thin) == (None, 2)


def test_window_and_dates():
    ns = nights(2025)
    assert len(ns) == 2 * WINDOW + 1
    assert dict(ns)[0] == dt.date.fromisoformat(DIWALI[2025])
    assert 0 not in BASELINE and -2 not in BASELINE and 3 in BASELINE


def test_city_polygons_merge_districts():
    ids = ["delhi--east", "delhi--west", "maharashtra--mumbai", "maharashtra--mumbai-suburban", "west-bengal--kolkata",
           "gujarat--ahmadabad", "rajasthan--jaipur", "uttar-pradesh--lucknow", "bihar--patna", "telangana--hyderabad"]
    d = gpd.GeoDataFrame({"id": ids}, geometry=[box(i, 0, i + 1, 1) for i in range(len(ids))], crs="EPSG:4326")
    c = city_polygons(d).set_index("id")
    assert c.loc["Delhi"].geometry.area == pytest.approx(2.0)
    assert c.loc["Mumbai"].geometry.area == pytest.approx(2.0)
