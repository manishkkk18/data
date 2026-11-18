"""Zonal stats on a tiny synthetic raster where every answer can be worked out by hand.

Raster: 10x10 pixels of 1°, covering lon 0-10, lat 0-10.
  columns 0-4 (lon 0-5)  -> radiance 0   (dark)
  columns 5-9 (lon 5-10) -> radiance 10  (lit)
  one missing pixel at row 0, col 9 (lon 9-10, lat 9-10)
"""

import geopandas as gpd
import numpy as np
import pytest
import rioxarray  # noqa: F401
import xarray as xr
from shapely.geometry import box

from nightlights.zonal import apply_coverage_rule, zonal_stats


@pytest.fixture
def raster():
    data = np.zeros((10, 10), dtype="float32")
    data[:, 5:] = 10.0
    data[0, 9] = np.nan
    da = xr.DataArray(
        data,
        dims=("y", "x"),
        coords={"y": np.arange(9.5, 0, -1.0), "x": np.arange(0.5, 10, 1.0)},
    )
    return da.rio.write_crs("EPSG:4326")


def districts(**boxes):
    return gpd.GeoDataFrame(
        {"id": list(boxes)}, geometry=list(boxes.values()), crs="EPSG:4326"
    )


def row(df, id_):
    return df.set_index("id").loc[id_]


def test_dark_and_lit_districts(raster):
    d = districts(dark=box(0, 0, 2, 2), lit=box(6, 0, 8, 2))
    df = zonal_stats(raster, d, lit_threshold=1.0)

    assert row(df, "dark").mean_rad == pytest.approx(0)
    assert row(df, "dark").lit_pct == pytest.approx(0)
    assert row(df, "lit").mean_rad == pytest.approx(10)
    assert row(df, "lit").sum_rad == pytest.approx(4 * 10)  # 4 pixels
    assert row(df, "lit").lit_pct == pytest.approx(100)
    assert row(df, "lit").valid_pct == pytest.approx(100)


def test_district_straddling_dark_and_lit(raster):
    d = districts(mixed=box(3, 0, 7, 1))  # 2 dark + 2 lit pixels
    r = row(zonal_stats(raster, d), "mixed")
    assert r.mean_rad == pytest.approx(5)
    assert r.lit_pct == pytest.approx(50)


def test_partial_pixels_are_area_weighted(raster):
    d = districts(half=box(5, 0, 5.5, 1))  # half of one lit pixel
    r = row(zonal_stats(raster, d), "half")
    assert r.sum_rad == pytest.approx(5)
    assert r.mean_rad == pytest.approx(10)


def test_missing_pixels_reduce_coverage_not_brightness(raster):
    d = districts(gappy=box(8, 9, 10, 10))  # one valid lit pixel, one missing
    r = row(zonal_stats(raster, d), "gappy")
    assert r.valid_pct == pytest.approx(50)
    assert r.mean_rad == pytest.approx(10)  # the gap isn't treated as darkness
    assert r.sum_rad == pytest.approx(10)


def test_coverage_rule_blanks_low_coverage(raster):
    d = districts(gappy=box(8, 9, 10, 10), ok=box(6, 0, 8, 2))
    df = apply_coverage_rule(zonal_stats(raster, d), min_valid_pct=60)
    assert np.isnan(row(df, "gappy").mean_rad)
    assert row(df, "gappy").valid_pct == pytest.approx(50)  # kept, to explain the gap
    assert row(df, "ok").mean_rad == pytest.approx(10)
