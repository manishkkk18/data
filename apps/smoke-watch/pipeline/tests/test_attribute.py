import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import box

from smokewatch.attribute import attribute_fires
from smokewatch.boundaries import DISTRICTS_OUT, load_districts


def fires(*lonlat):
    return pd.DataFrame({"longitude": [p[0] for p in lonlat], "latitude": [p[1] for p in lonlat], "frp": 1.0})


@pytest.fixture
def toy():
    # Two adjacent 0.1° squares near Ludhiana.
    return gpd.GeoDataFrame(
        {"district": ["A", "B"], "state": ["Punjab", "Haryana"]},
        geometry=[box(75.0, 30.0, 75.1, 30.1), box(75.1, 30.0, 75.2, 30.1)],
        crs="EPSG:4326",
    )


def test_inside_each_polygon(toy):
    out = attribute_fires(fires((75.05, 30.05), (75.15, 30.05)), toy)
    assert out["district"].tolist() == ["A", "B"]
    assert out["state"].tolist() == ["Punjab", "Haryana"]


def test_point_on_shared_edge_counted_once(toy):
    out = attribute_fires(fires((75.1, 30.05)), toy)
    assert len(out) == 1 and out["district"].iloc[0] in {"A", "B"}


def test_snaps_small_gap_but_not_far_points(toy):
    near = (75.21, 30.05)  # ~1 km east of B
    far = (75.30, 30.05)   # ~10 km east of B
    out = attribute_fires(fires(near, far), toy)
    assert out["district"].iloc[0] == "B"
    assert out["district"].iloc[1] is None and out["state"].iloc[1] is None


def test_empty_input(toy):
    out = attribute_fires(fires(), toy)
    assert out.empty and {"district", "state"} <= set(out.columns)


@pytest.mark.skipif(not DISTRICTS_OUT.exists(), reason="run the pipeline once to build boundaries")
def test_real_districts():
    d = load_districts()
    out = attribute_fires(fires((75.85, 30.90), (76.99, 29.69), (74.35, 31.55), (77.21, 28.63)), d)
    assert out[["district", "state"]].values.tolist()[:2] == [["Ludhiana", "Punjab"], ["Karnal", "Haryana"]]
    assert out["state"].iloc[2] is None  # Lahore, Pakistan
    assert out["state"].iloc[3] == "Delhi"
