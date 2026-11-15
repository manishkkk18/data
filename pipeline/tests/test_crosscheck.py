import pandas as pd
import pytest

from nightlights.crosscheck import bhuvan_table, spearman, state_values


def test_state_value_weights_districts_by_observed_area():
    # big: 100 pixels at 2.0 ; small: 10 pixels at 20.0 -> (200 + 200) / 110
    stats = pd.DataFrame(
        {"id": ["big", "small", "gap"], "mean_rad": [2.0, 20.0, None], "sum_rad": [200.0, 200.0, None]}
    )
    out = state_values(stats, pd.Series({"big": "S", "small": "S", "gap": "S"}))
    assert out["S"] == pytest.approx(400 / 110)


def test_bhuvan_names_are_mapped_and_split_uts_skipped():
    rows = [
        {"state": "ODISSA", "avg_2015": "5", "avg_2016": "6"},
        {"state": "KERALA", "avg_2015": "9", "avg_2016": ""},
        {"state": "DAMAN AND DIU", "avg_2015": "50"},
        {"state": "NOWHERE", "avg_2015": "1"},
    ]
    table, unmatched = bhuvan_table(rows, {"Odisha", "Kerala"})
    assert set(table.index) == {"Odisha", "Kerala"}
    assert table.loc["Odisha", 2016] == 6
    assert pd.isna(table.loc["Kerala", 2016])
    assert unmatched == ["NOWHERE"]


def test_spearman_needs_enough_states():
    a = pd.Series([1, 2, 3, 4, 5], index=list("abcde"))
    assert spearman(a, a * 10) == pytest.approx(1.0)
    assert spearman(a.iloc[:3], a.iloc[:3]) is None
