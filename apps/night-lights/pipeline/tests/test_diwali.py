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


def test_zones_are_districts_plus_cities():
    from nightlights.diwali import CITIES, zones
    ids = ["delhi--east", "maharashtra--mumbai", "maharashtra--mumbai-suburban", "west-bengal--kolkata", "gujarat--ahmadabad",
           "rajasthan--jaipur", "uttar-pradesh--lucknow", "bihar--patna", "telangana--hyderabad", "kerala--idukki"]
    d = gpd.GeoDataFrame({"id": ids}, geometry=[box(i, 0, i + 1, 1) for i in range(len(ids))], crs="EPSG:4326")
    z = zones(d)
    assert len(z) == len(ids) + len(CITIES)
    assert "kerala--idukki" in set(z.id) and "Delhi" in set(z.id)


def test_build_json_gives_each_district_its_own_effect(tmp_path, monkeypatch):
    import pandas as pd
    from nightlights import diwali
    monkeypatch.setattr(diwali, "STATS_DIR", tmp_path / "india")
    monkeypatch.setattr(diwali, "CITY_ONLY_DIR", tmp_path / "old")
    (tmp_path / "india").mkdir()
    ids = ["a--x", "b--y"]
    for o, day in diwali.nights(2025):
        a = 20.0 if o == 0 else 10.0          # a: doubles on Diwali night
        b = None if o == 0 else 5.0           # b: cloudy on Diwali night
        rows = [{"id": "a--x", "mean_rad": a}, {"id": "b--y", "mean_rad": b}] + [{"id": c, "mean_rad": 1.0} for c in diwali.CITIES]
        pd.DataFrame(rows).assign(date=day.isoformat(), valid_pct=100, missing_tiles="").to_csv(tmp_path / "india" / f"{day}.csv", index=False)
    cities, dists = diwali.build_json(ids)
    y = next(v for v in dists["years"] if v["year"] == 2025)
    assert y["effect"] == [pytest.approx(100.0), None]
    assert y["clear_baseline_nights"][0] == len(BASELINE)
    assert len(y["nights"]) == 2 * WINDOW + 1 and y["nights"]["0"] == [20.0, None]
    assert next(v for v in cities["years"] if v["year"] == 2025)["effect"]["Delhi"] == pytest.approx(0.0)


def test_leaderboard_skips_dim_and_thin_comparisons(tmp_path, monkeypatch):
    import pandas as pd
    from nightlights import diwali
    monkeypatch.setattr(diwali, "STATS_DIR", tmp_path / "india")
    monkeypatch.setattr(diwali, "CITY_ONLY_DIR", tmp_path / "old")
    (tmp_path / "india").mkdir()
    ids = ["lit--city", "dim--village", "lit--town"]
    for o, day in diwali.nights(2025):
        rows = [
            {"id": "lit--city", "mean_rad": 30.0 if o == 0 else 20.0},  # +50%, lit
            {"id": "dim--village", "mean_rad": 0.4 if o == 0 else 0.1},  # +300%, but dim
            {"id": "lit--town", "mean_rad": 8.0 if o == 0 else 5.0},  # +60%, lit
        ] + [{"id": c, "mean_rad": 1.0} for c in diwali.CITIES]
        pd.DataFrame(rows).assign(date=day.isoformat(), valid_pct=100, missing_tiles="").to_csv(tmp_path / "india" / f"{day}.csv", index=False)
    cities, _ = diwali.build_json(ids)
    top = next(v for v in cities["years"] if v["year"] == 2025)["district_top"]
    assert [t["id"] for t in top] == ["lit--town", "lit--city"]
    assert top[0]["effect"] == pytest.approx(60.0)
