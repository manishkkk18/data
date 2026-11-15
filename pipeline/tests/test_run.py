"""End-to-end runner checks with a fake NASA client (no network, no token)."""

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


class FakeBM:
    def __init__(self, outdir):
        self.output_directory = outdir
        self.calls = 0

    def raster(self, gdf, product_id, date_range, variable):
        self.calls += 1
        data = np.zeros((1, 10, 10), dtype="float32")
        data[:, :, 5:] = 12.3
        data[0, 0, 9] = np.nan
        da = xr.DataArray(
            data,
            dims=("time", "y", "x"),
            coords={"time": [np.datetime64("2025-10-01")], "y": np.arange(9.5, 0, -1.0), "x": np.arange(0.5, 10, 1.0)},
        ).rio.write_crs("EPSG:4326")
        return da.to_dataset(name=variable)


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
    df = run.process_month(bm, None, districts, MONTH)

    assert df.set_index("id").loc["lit", "mean_rad"] == pytest.approx(12.3)  # survives uint16 cache
    assert df.set_index("id").loc["dark", "mean_rad"] == pytest.approx(0)
    assert run.cache_path(MONTH).exists()
    assert sorted(p.name for p in bm.output_directory.iterdir()) == ["VNP46A3.A2025305.h25v06.002.x.h5"]

    run.process_month(bm, None, districts, MONTH)  # rerun reads the cache
    assert bm.calls == 1


def test_monthly_json_layout(env):
    bm, districts, tmp = env
    df = run.process_month(bm, None, districts, MONTH)
    df.loc[df.id == "dark", ["mean_rad", "sum_rad", "lit_pct"]] = np.nan  # pretend a gap
    run.write_atomic(df, run.STATS_DIR / "2025-10.csv")

    out = json.loads(run.build_monthly_json(districts).read_text())
    assert out["months"] == ["2025-10"]
    assert out["ids"] == ["dark", "lit"]
    assert out["mean"] == [[None, 12.3]]  # gap stays null, never filled in
    assert out["valid"][0][0] == 100
