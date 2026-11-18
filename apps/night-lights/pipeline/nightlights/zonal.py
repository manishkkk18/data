"""Per-district statistics from a night-lights raster.

Uses exactextract (the same engine blackmarblepy's own `extract` uses), which weights
each pixel by the fraction of it inside the polygon. That matters for small districts
such as those in Delhi, which cover only a handful of ~500 m pixels.

We call exactextract directly rather than `BlackMarble.extract` because we need two
things it doesn't give: the share of lit pixels, and how much of each district was
actually observed (so cloudy months show as gaps instead of misleading lows).
"""

import geopandas as gpd
import numpy as np
import pandas as pd
import rioxarray  # noqa: F401  (registers the .rio accessor)
import xarray as xr
from exactextract import exact_extract

from .config import LIT_THRESHOLD, MIN_VALID_PCT


def _extract(rast: xr.DataArray, districts: gpd.GeoDataFrame, ops: list[str]) -> pd.DataFrame:
    df = exact_extract(rast, districts, ops, output="pandas")
    return df.reset_index(drop=True)


def zonal_stats(
    raster: xr.DataArray,
    districts: gpd.GeoDataFrame,
    id_col: str = "id",
    lit_threshold: float = LIT_THRESHOLD,
) -> pd.DataFrame:
    """Compute per-district night-light stats.

    raster: 2-D radiance in nW/cm²/sr with a CRS; NaN means "no observation".
    Returns one row per district with:
      mean_rad  - average radiance over observed pixels
      sum_rad   - total radiance over observed pixels ("sum of lights")
      lit_pct   - % of observed pixels at or above `lit_threshold`
      valid_pct - % of the district's area that was observed at all
    """
    rad = raster.squeeze(drop=True).astype("float32").rio.write_nodata(np.nan)
    districts = districts.to_crs(rad.rio.crs)

    lit = xr.where(rad.isnull(), np.nan, (rad >= lit_threshold).astype("float32"))
    lit = lit.astype("float32").rio.write_crs(rad.rio.crs).rio.write_nodata(np.nan)
    ones = xr.ones_like(rad, dtype="float32").rio.write_crs(rad.rio.crs)

    a = _extract(rad, districts, ["mean", "sum", "count"])
    b = _extract(lit, districts, ["mean"])
    c = _extract(ones, districts, ["sum"])

    total = c["sum"].to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        valid_pct = np.where(total > 0, a["count"].to_numpy() / total * 100, 0.0)

    return pd.DataFrame(
        {
            id_col: districts[id_col].to_numpy(),
            "mean_rad": a["mean"].to_numpy(),
            "sum_rad": a["sum"].to_numpy(),
            "lit_pct": b["mean"].to_numpy() * 100,
            "valid_pct": valid_pct,
        }
    )


def apply_coverage_rule(df: pd.DataFrame, min_valid_pct: float = MIN_VALID_PCT) -> pd.DataFrame:
    """Blank out values for district-months where too little was observed.

    We keep valid_pct so the UI can say *why* a value is missing.
    """
    out = df.copy()
    gap = out["valid_pct"] < min_valid_pct
    out.loc[gap, ["mean_rad", "sum_rad", "lit_pct"]] = np.nan
    return out
