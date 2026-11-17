import numpy as np
import pandas as pd
import pytest

from smokewatch.trajectory import WindField, back_trajectory
from smokewatch.upwind import fire_weights, shares

DELHI = (77.2, 28.6)
T0 = 500_000.0  # arbitrary hour since epoch


def uniform(u: float, v: float, hours: int = 72) -> WindField:
    lons = np.arange(64.5, 82.6, 1.0)
    lats = np.arange(23.5, 36.6, 1.0)
    shape = (hours + 1, len(lats), len(lons))
    return WindField(hours=T0 - hours + np.arange(hours + 1, dtype=float), lons=lons, lats=lats,
                     u=np.full(shape, float(u)), v=np.full(shape, float(v)))


def test_westerly_wind_traces_back_to_the_west():
    # 5 m/s from the west (u = +5): 24 h ago the air was ~432 km west of Delhi.
    path = back_trajectory(uniform(5, 0), *DELHI, arrival_hour=T0, hours=24)
    lon, lat, tau = path[-1]
    assert tau == 24 and len(path) == 25
    km_west = (DELHI[0] - lon) * 111.32 * np.cos(np.deg2rad(DELHI[1]))
    assert km_west == pytest.approx(432, rel=0.02)
    assert lat == pytest.approx(DELHI[1], abs=1e-6)


def test_northwesterly_wind_traces_back_to_punjab():
    # Wind from the north-west blows toward the south-east (u > 0, v < 0).
    path = back_trajectory(uniform(3, -3), *DELHI, arrival_hour=T0, hours=24)
    lon, lat, _ = path[-1]
    assert lon < DELHI[0] and lat > DELHI[1]


def test_path_stops_at_grid_edge_and_missing_data():
    # 20 m/s westerly leaves the 64.5°E edge in under 48 h.
    path = back_trajectory(uniform(20, 0), *DELHI, arrival_hour=T0, hours=48)
    assert len(path) < 49 and path[-1][0] >= 64.5
    f = uniform(5, 0)
    f.u[:, :, :] = np.nan
    assert back_trajectory(f, *DELHI, arrival_hour=T0) == [(DELHI[0], DELHI[1], 0)]


def fires(*rows):
    return pd.DataFrame(rows, columns=["longitude", "latitude", "frp", "hour", "district", "state"])


def test_upwind_fire_counts_downwind_and_far_fires_do_not():
    path = back_trajectory(uniform(5, 0), *DELHI, arrival_hour=T0, hours=48)
    lon12, lat12, _ = path[12]  # where the air was 12 h before arrival
    f = fires(
        (lon12, lat12, 10.0, T0 - 12, "punjab--x", "Punjab"),  # on the path, right time
        (DELHI[0] + 2.0, DELHI[1], 10.0, T0 - 12, "up--y", "Uttar Pradesh"),  # downwind (east)
        (lon12, lat12 + 3.0, 10.0, T0 - 12, "hp--z", "Himachal Pradesh"),  # ~330 km off the path
        (lon12, lat12, 10.0, T0 - 40, "punjab--x", "Punjab"),  # on the path, but burnt long before the air passed
    )
    w = fire_weights(path, T0, f)
    assert w[0] > 0
    assert w[1] == 0 and w[2] == 0 and w[3] == 0


def test_closer_and_more_recent_fires_weigh_more():
    path = back_trajectory(uniform(5, 0), *DELHI, arrival_hour=T0, hours=48)
    (a, b, _), (c, d, _) = path[6][:3], path[30][:3]
    f = fires((a, b, 10.0, T0 - 6, "p--a", "Punjab"), (c, d, 10.0, T0 - 30, "p--b", "Punjab"),
              (a, b + 0.3, 10.0, T0 - 6, "p--c", "Punjab"))
    w = fire_weights(path, T0, f)
    assert w[0] > w[1] > 0  # older air: decayed
    assert w[0] > w[2] > 0  # off the centre line: corridor falloff
    # FRP scales weight linearly.
    f2 = f.copy()
    f2.loc[0, "frp"] = 20.0
    assert fire_weights(path, T0, f2)[0] == pytest.approx(2 * w[0])


def test_shares_sum_to_one_and_keep_outside_india():
    f = fires((0, 0, 1, 0, "p--a", "Punjab"), (0, 0, 1, 0, None, None), (0, 0, 1, 0, "h--b", "Haryana"))
    s = shares(f, np.array([6.0, 3.0, 1.0]), "state")
    assert [r["state"] for r in s] == ["Punjab", "Outside India", "Haryana"]
    assert sum(r["share"] for r in s) == pytest.approx(1.0)
    assert shares(f, np.zeros(3), "state") == []
