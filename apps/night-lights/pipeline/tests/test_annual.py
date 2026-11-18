"""Annual runner checks with a fake NASA client (no network, no token)."""

import json

import geopandas as gpd
import numpy as np
import pytest
import rioxarray  # noqa: F401
import xarray as xr
from shapely.geometry import box

from nightlights import annual


class FakeBM:
    def __init__(self, outdir):
        self.output_directory = outdir
        self.calls = 0

    def raster(self, gdf, product_id, date_range, variable):
        self.calls += 1
        assert product_id == annual.PRODUCT and date_range.month == 1 and date_range.day == 1
        data = np.zeros((1, 10, 10), dtype="float32")
        data[:, :, 5:] = 7.5
        da = xr.DataArray(
            data,
            dims=("time", "y", "x"),
            coords={"time": [np.datetime64(f"{date_range.year}-01-01")], "y": np.arange(9.5, 0, -1.0), "x": np.arange(0.5, 10, 1.0)},
        ).rio.write_crs("EPSG:4326")
        return da.to_dataset(name=variable)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(annual, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(annual, "STATS_DIR", tmp_path / "stats")
    monkeypatch.setattr(annual, "YEARLY_JSON", tmp_path / "yearly.json")
    (tmp_path / "stats").mkdir()
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "VNP46A4.A2020001.h25v06.002.x.h5").write_bytes(b"x")
    (raw / "VNP46A4.A2021001.h25v06.002.x.h5").write_bytes(b"x")
    districts = gpd.GeoDataFrame({"id": ["dark", "lit"]}, geometry=[box(0, 0, 2, 2), box(6, 0, 8, 2)], crs="EPSG:4326")
    return FakeBM(raw), districts


def test_year_cached_raw_deleted_and_json(env):
    bm, districts = env
    df = annual.process_year(bm, None, districts, 2020)
    assert df.set_index("id").loc["lit", "mean_rad"] == pytest.approx(7.5)
    assert [p.name for p in bm.output_directory.iterdir()] == ["VNP46A4.A2021001.h25v06.002.x.h5"]  # only 2020 removed

    annual.process_year(bm, None, districts, 2020)
    assert bm.calls == 1  # second run uses the cache

    annual.run.write_atomic(df, annual.STATS_DIR / "2020.csv")
    out = json.loads(annual.build_yearly_json(districts).read_text())
    assert out["years"] == [2020]
    assert out["mean"] == [[0.0, 7.5]]
    assert out["valid"] == [[100, 100]]
