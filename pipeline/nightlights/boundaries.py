"""Prepare district boundaries.

Source: geoBoundaries gbOpen IND ADM2/ADM1 (built from the government's Local
Government Directory via Pathways Data; 2021 vintage; ODbL). Its national outline
follows India's official map (all of J&K and Ladakh).

Outputs:
  data/raw/boundaries/districts_full.gpkg - full detail, used for zonal stats
  data/districts.geojson                  - simplified for the web (shared edges kept)
  data/india_outline.geojson              - national outline for the web map

Run:  python -m nightlights.boundaries
"""

import json
import re
import unicodedata

import geopandas as gpd
import httpx
import shapely

from .config import BOUNDARIES_RAW, DISTRICTS_FULL, DISTRICTS_WEB, OUTLINE_WEB

API = "https://www.geoboundaries.org/api/current/gbOpen/IND/{level}/"
WEB_TOLERANCE_DEG = 0.01  # ~1 km: 1.75 MB raw, ~0.4 MB gzipped
WEB_DECIMALS = 3  # ~110 m vertex snapping

# Spelling fixes for names as they appear in the source (after diacritics are removed).
NAME_FIXES = {"Hydrabad": "Hyderabad"}


def fold(s: str) -> str:
    """'Karnātaka' -> 'Karnataka' (geoBoundaries uses diacritics; most readers don't)."""
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(s).lower()).strip("-")


def download(level: str) -> gpd.GeoDataFrame:
    path = BOUNDARIES_RAW / f"IND_{level}.geojson"
    if not path.exists():
        BOUNDARIES_RAW.mkdir(parents=True, exist_ok=True)
        meta = httpx.get(API.format(level=level), timeout=60, follow_redirects=True).json()
        r = httpx.get(meta["gjDownloadURL"], timeout=300, follow_redirects=True)
        r.raise_for_status()
        path.write_bytes(r.content)
    return gpd.read_file(path)


def assign_states(districts: gpd.GeoDataFrame, states: gpd.GeoDataFrame) -> "pd.Series":
    """Each district gets the state containing most of its area."""
    d = districts[["geometry"]].reset_index(names="_i")
    s = states[["state", "geometry"]]
    eq = "EPSG:6933"  # equal-area, so overlap areas are comparable
    ov = gpd.overlay(d.to_crs(eq), s.to_crs(eq), how="intersection", keep_geom_type=True)
    ov["a"] = ov.area
    best = ov.sort_values("a").groupby("_i").tail(1).set_index("_i")["state"]
    return best.reindex(range(len(districts)))


def make_ids(df: gpd.GeoDataFrame) -> list[str]:
    ids, seen = [], {}
    for state, name in zip(df["state"], df["name"]):
        base = f"{slug(state)}--{slug(name)}"
        seen[base] = seen.get(base, 0) + 1
        ids.append(base if seen[base] == 1 else f"{base}-{seen[base]}")
    return ids


def round_coords(geom, decimals=WEB_DECIMALS):
    return shapely.set_precision(geom, 10**-decimals)


def build() -> gpd.GeoDataFrame:
    adm2 = download("ADM2")
    adm1 = download("ADM1").rename(columns={"shapeName": "state"})
    adm1["state"] = adm1["state"].map(fold)

    adm2["geometry"] = adm2.geometry.make_valid()
    adm1["geometry"] = adm1.geometry.make_valid()

    df = gpd.GeoDataFrame(
        {"name": adm2["shapeName"].map(fold).str.strip().replace(NAME_FIXES), "source_id": adm2["shapeID"]},
        geometry=adm2.geometry,
        crs=adm2.crs,
    )
    df["state"] = assign_states(df, adm1).fillna("Unknown").to_numpy()
    df = df.sort_values(["state", "name"]).reset_index(drop=True)
    df["id"] = make_ids(df)
    df = df[["id", "name", "state", "source_id", "geometry"]]

    DISTRICTS_FULL.parent.mkdir(parents=True, exist_ok=True)
    df.to_file(DISTRICTS_FULL, driver="GPKG")

    # Simplify all districts together so neighbours keep identical shared edges
    # (per-polygon simplification opens slivers between districts).
    simplified = shapely.coverage_simplify(df.geometry.to_numpy(), WEB_TOLERANCE_DEG)
    web = df[["id", "name", "state"]].copy()
    web = gpd.GeoDataFrame(web, geometry=[round_coords(g) for g in simplified], crs=df.crs)
    web.to_file(DISTRICTS_WEB, driver="GeoJSON", COORDINATE_PRECISION=WEB_DECIMALS)

    outline = shapely.coverage_union_all(simplified)
    outline = round_coords(outline.simplify(WEB_TOLERANCE_DEG))
    OUTLINE_WEB.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [{"type": "Feature", "properties": {}, "geometry": shapely.geometry.mapping(outline)}],
            }
        )
    )
    return df


if __name__ == "__main__":
    df = build()
    print(f"{len(df)} districts in {df['state'].nunique()} states/UTs")
    print(f"unassigned: {(df['state'] == 'Unknown').sum()}")
    for p in (DISTRICTS_FULL, DISTRICTS_WEB, OUTLINE_WEB):
        print(f"{p.name}: {p.stat().st_size / 1e6:.2f} MB")
