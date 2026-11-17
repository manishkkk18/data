"""Assign each fire detection to a district and state."""
from __future__ import annotations

import geopandas as gpd
import pandas as pd

# A fire just outside every polygon (e.g. in a sliver gap left by simplification)
# is snapped to the nearest district if it is within this distance.
SNAP_METRES = 2000
_METRIC_CRS = "EPSG:32643"  # UTM 43N, covers NW India


def attribute_fires(fires: pd.DataFrame, districts: gpd.GeoDataFrame) -> pd.DataFrame:
    """Return `fires` with added `district` and `state` columns.

    Fires outside every district (beyond SNAP_METRES) get district/state = None,
    e.g. detections across the border in Pakistan.
    """
    if fires.empty:
        return fires.assign(district=pd.Series(dtype=object), state=pd.Series(dtype=object))

    pts = gpd.GeoDataFrame(
        fires.reset_index(drop=True),
        geometry=gpd.points_from_xy(fires["longitude"], fires["latitude"]),
        crs="EPSG:4326",
    )
    d = districts[["district", "state", "geometry"]].to_crs("EPSG:4326")

    hit = gpd.sjoin(pts, d, how="left", predicate="within")
    hit = hit[~hit.index.duplicated(keep="first")]  # a point on a shared edge: take one

    missing = hit["district"].isna()
    if missing.any():
        m = gpd.sjoin_nearest(
            pts[missing].to_crs(_METRIC_CRS),
            d.to_crs(_METRIC_CRS),
            how="left",
            max_distance=SNAP_METRES,
        )
        m = m[~m.index.duplicated(keep="first")]
        hit.loc[m.index, "district"] = m["district"]
        hit.loc[m.index, "state"] = m["state"]

    out = pd.DataFrame(hit.drop(columns=["geometry", "index_right"], errors="ignore"))
    out[["district", "state"]] = out[["district", "state"]].astype(object).where(out[["district", "state"]].notna(), None)
    return out
