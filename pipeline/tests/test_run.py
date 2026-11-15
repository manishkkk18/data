"""End-to-end runner checks with a fake NASA client (no network, no token).

Fake month on a 10x10 grid of 1° pixels:
  columns 0-4 radiance 0, columns 5-9 radiance 12.3
  pixel (row 0, col 9) has no data at all (quality 255)
  columns 0-1 of rows 8-9 (the "dark" district) are NASA gap-filled (quality 2) with 4.0
"""

import datetime as dt
import json

import geopandas as gpd
import numpy as np
import pytest
import rioxarray  # noqa: F401
import xarray as xr
from shapely.geometry import box

from nightlights import run

MONTH = dt.date(2025, 10, 1)


def grid(values):
    return xr.DataArray(
        values[None],
        dims=("time", "y", "x"),
        coords={"time": [np.datetime64("2025-10-01")], "y": np.arange(9.5, 0, -1.0), "x": np.arange(0.5, 10, 1.0)},
    ).rio.write_crs("EPSG:4326")


class FakeBM:
    def __init__(self, outdir):
        self.output_directory = outdir
        self.calls = []

    def raster(self, gdf, product_id, date_range, variable):
        self.calls.append(variable)
        if variable == run.QUALITY:
            q = np.zeros((10, 10), dtype="float32")
            q[8:10, 0:2] = 2  # gap-filled from history
            q[0, 9] = np.nan  # 255 -> NaN, as the library returns it
            return grid(q).to_dataset(name=variable)
        rad = np.zeros((10, 10), dtype="float32")
        rad[:, 5:] = 12.3
        rad[0, 9] = np.nan
        rad[8:10, 0:2] = 4.0
        return grid(rad).to_dataset(name=variable)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(run, "STATS_DIR", tmp_path / "stats")
    monkeypatch.setattr(run, "MONTHLY_JSON", tmp_path / "monthly.json")
    (tmp_path / "stats").mkdir()
    raw = tmp_path / "raw"
    raw.mkdir()
    # files the library would leave behind for Oct 2025 (day-of-year 274) and another month
    (raw / "VNP46A3.A2025274.h25v06.002.x.h5").write_bytes(b"x")
    (raw / "VNP46A3.A2025274.h25v06.002.x.tif").write_bytes(b"x")
    (raw / "VNP46A3.A2025305.h25v06.002.x.h5").write_bytes(b"x")
    districts = gpd.GeoDataFrame({"id": ["dark", "lit"]}, geometry=[box(0, 0, 2, 2), box(6, 0, 8, 2)], crs="EPSG:4326")
    return FakeBM(raw), districts, tmp_path


def test_month_is_cached_and_raw_deleted(env):
    bm, districts, tmp = env
    df = run.process_month(bm, None, districts, MONTH).set_index("id")

    assert df.loc["lit", "mean_rad"] == pytest.approx(12.3)  # survives the uint16 cache
    assert run.cache_path(MONTH).exists() and run.quality_path(MONTH).exists()
    assert sorted(p.name for p in bm.output_directory.iterdir()) == ["VNP46A3.A2025305.h25v06.002.x.h5"]
    assert bm.calls == [run.VARIABLE, run.QUALITY]

    run.process_month(bm, None, districts, MONTH)  # rerun reads the cache
    assert len(bm.calls) == 2


def test_gap_filled_pixels_are_an_estimate_not_an_observation(env):
    bm, districts, tmp = env
    df = run.process_month(bm, None, districts, MONTH).set_index("id")
    # The dark district is entirely NASA-filled: no observation, so a gap...
    assert df.loc["dark", "valid_pct"] == pytest.approx(0)
    assert np.isnan(df.loc["dark", "mean_rad"])
    # ...but NASA's estimate is kept separately.
    assert df.loc["dark", "est_mean_rad"] == pytest.approx(4.0)
    assert df.loc["dark", "est_valid_pct"] == pytest.approx(100)
    # A fully observed district's estimate equals its observed value.
    assert df.loc["lit", "est_mean_rad"] == pytest.approx(df.loc["lit", "mean_rad"])


def test_old_cache_without_quality_has_no_estimate(env):
    bm, districts, tmp = env
    run.process_month(bm, None, districts, MONTH)
    run.quality_path(MONTH).unlink()  # simulate a month cached before quality flags were kept
    df = run.process_month(bm, None, districts, MONTH).set_index("id")
    assert np.isnan(df.loc["lit", "est_mean_rad"])
    assert len(bm.calls) == 2  # no re-download without --force
    run.process_month(bm, None, districts, MONTH, refetch_old=True)
    assert len(bm.calls) == 4 and run.quality_path(MONTH).exists()


def test_monthly_json_layout(env):
    bm, districts, tmp = env
    df = run.process_month(bm, None, districts, MONTH)
    run.write_atomic(df, run.STATS_DIR / "2025-10.csv")

    out = json.loads(run.build_monthly_json(districts).read_text())
    assert out["months"] == ["2025-10"]
    assert out["ids"] == ["dark", "lit"]
    assert out["mean"] == [[None, 12.3]]  # gap stays null in the observed series
    assert out["est"] == [[4.0, None]]  # estimate only where observed is a gap
    assert out["valid"][0] == [0, 100]
    assert "sum" not in out
    assert out["national_avg"] == [pytest.approx(12.3)]  # only the observed district counts
