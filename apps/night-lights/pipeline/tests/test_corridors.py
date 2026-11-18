import numpy as np
from shapely.geometry import LineString
from shapely.ops import transform

from nightlights import corridors as K


def test_query_uses_posix_regex_and_route_radius():
    gq = next(c for c in K.CORRIDORS if c["kind"] == "gq")
    q = K.overpass_query(gq)
    assert "\\s" not in q  # Overpass regexes are POSIX
    assert f"NH *-?{gq['ref']}" in q
    assert "around" not in q and q.count(",") >= 3  # cheap bounding-box search
    ex = next(c for c in K.CORRIDORS if c["kind"] == "expressway")
    assert ',i]' in K.overpass_query(ex)  # name match is case-insensitive


def test_stats_needs_enough_pixels_and_ignores_gaps():
    assert K.stats(np.array([1.0] * 10))["median"] is None
    v = np.array([0.5] * 50 + [3.0] * 50 + [np.nan] * 20, dtype="float32")
    s = K.stats(v)
    assert s["n"] == 100
    assert s["lit"] == 50.0
    assert s["median"] == 1.75


def test_strip_and_ring_leave_out_big_cities():
    c = {"waypoints": [("A", 26.0, 75.0, True), ("B", 26.0, 77.0, False)]}
    road = transform(K.TO_M, LineString([(75.0, 26.0), (77.0, 26.0)]))
    g = K.corridor_geometry(c, road)
    a = transform(K.TO_M, LineString([(75.0, 26.0), (75.0001, 26.0)])).centroid
    b = transform(K.TO_M, LineString([(77.0, 26.0), (77.0001, 26.0)])).centroid
    assert not g["strip"].contains(a)  # inside the city radius around A
    assert g["strip"].contains(b)
    # the countryside ring sits 10-20 km off the road, never on it
    assert not g["ring"].contains(b)


def test_corridor_ids_unique():
    ids = [c["id"] for c in K.CORRIDORS]
    assert len(ids) == len(set(ids))


def test_road_segments_follow_the_10km_bins():
    from shapely.geometry import MultiLineString
    route = transform(K.TO_M, LineString([(75.0, 26.0), (75.5, 26.0)]))  # ~50 km
    road = MultiLineString([route])
    feats = K.road_segments({"c": {"id": "x"}, "route_m": route, "roads_m": road})
    bins = [f["properties"]["bin"] for f in feats]
    assert bins == list(range(len(bins))) and 4 <= len(bins) <= 6
    assert all(f["properties"]["id"] == "x" for f in feats)
