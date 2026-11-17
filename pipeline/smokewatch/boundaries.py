"""District (ADM2) and state (ADM1) boundaries from geoBoundaries.

Decision: districts come from geoBoundaries gbOpen IND ADM2 (2021, based on the
Local Government Directory, 735 districts). That file has no state column, so
each district is assigned the state (ADM1) that contains its interior point.
Neither layer is an official Survey of India product; see README.
"""
from __future__ import annotations

import unicodedata
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import box

from .config import BBOX, DATA, RAW

# Pinned release commit so results are reproducible.
GB = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND"
SOURCES = {
    "adm1": f"{GB}/ADM1/geoBoundaries-IND-ADM1.geojson",
    "adm2": f"{GB}/ADM2/geoBoundaries-IND-ADM2.geojson",
}
DISTRICTS_OUT = DATA / "boundaries" / "districts.geojson"
DISTRICTS_WEB = DATA / "boundaries" / "districts_web.geojson"


def ascii_name(s: str) -> str:
    """'Haryāna' -> 'Haryana'."""
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().strip()


def _download(name: str) -> Path:
    path = RAW / f"ind_{name}.geojson"
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        r = requests.get(SOURCES[name], timeout=120)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def build_districts(bbox=BBOX) -> gpd.GeoDataFrame:
    """Districts intersecting the study bbox, with columns: district, state, geometry."""
    adm1 = gpd.read_file(_download("adm1"))[["shapeName", "geometry"]]
    adm2 = gpd.read_file(_download("adm2"))[["shapeName", "geometry"]]
    area = box(*bbox)
    adm2 = adm2[adm2.intersects(area)].copy()

    pts = adm2.copy()
    pts["geometry"] = adm2.representative_point()
    joined = gpd.sjoin(pts, adm1.rename(columns={"shapeName": "state"}), how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")]

    out = gpd.GeoDataFrame(
        {
            "district": adm2["shapeName"].map(ascii_name),
            "state": joined["state"].fillna("Unknown").map(ascii_name),
        },
        geometry=adm2.geometry.make_valid(),
        crs=adm2.crs,
    ).reset_index(drop=True)
    out.insert(0, "id", [district_id(s, d) for s, d in zip(out["state"], out["district"])])
    return out


def district_id(state: str, district: str) -> str:
    """Stable URL-safe id, e.g. 'punjab--ludhiana' (same style as India Night Lights)."""
    slug = lambda s: "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-")  # noqa: E731
    return f"{slug(state)}--{slug(district)}"


def load_districts() -> gpd.GeoDataFrame:
    """Load cached study-area districts, building them on first use."""
    if not DISTRICTS_OUT.exists():
        d = build_districts()
        DISTRICTS_OUT.parent.mkdir(parents=True, exist_ok=True)
        # Simplify to ~100 m: far finer than a 375 m VIIRS pixel, and keeps the file
        # small enough for the web map. Pipeline and web use this same file.
        d["geometry"] = d.geometry.simplify(0.001, preserve_topology=True)
        d.to_file(DISTRICTS_OUT, driver="GeoJSON", COORDINATE_PRECISION=4)
        # Lighter copy for the web map only (~500 m; outlines, not attribution).
        web = d.copy()
        web["geometry"] = web.geometry.simplify(0.005, preserve_topology=True)
        web.to_file(DISTRICTS_WEB, driver="GeoJSON", COORDINATE_PRECISION=3)
    return gpd.read_file(DISTRICTS_OUT)
