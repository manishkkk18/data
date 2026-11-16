"""Highway corridors: how the light along India's big roads has changed since 2015.

What this measures, and what it doesn't
---------------------------------------
The satellite passes over at about 1:30 am and each pixel is ~500 m across, so it
cannot see traffic. What it sees along a highway is *lit development*: street
lighting, toll plazas, fuel stations, dhabas, warehouses and the towns that grow
along the road. So this is a measure of how built-up and lit a corridor is, not how
busy the road is.

Method
------
1. Road lines come from OpenStreetMap (ODbL), fetched once with the Overpass API:
   ways tagged with the highway's number (Golden Quadrilateral arms) or name
   (expressways), kept only within 25 km of the route's waypoints.
2. For each year's NASA Black Marble annual composite (VNP46A4), we take every pixel
   whose centre is within 2 km of the road ("road strip"), and every pixel 10-20 km
   from it ("countryside nearby") as a comparison: if the strip brightens much more
   than the countryside around it, the road is pulling development towards it.
3. Pixels within CITY_RADIUS_KM of a big city on the route are left out, so a corridor
   is not just a ranking of the cities it happens to join.
4. Reported per corridor and year: median radiance of the strip, the share of the
   strip that is lit (>= LIT_THRESHOLD), the same for the countryside, and a profile
   along the route in PROFILE_BIN_KM steps for the strip chart.

  python -m nightlights.corridors              # fetch roads (cached) + measure all years cached

Writes data/corridors.json (stats) and data/corridors.geojson (simplified lines for the map).
"""

import argparse
import datetime as dt
import json
import logging
import time

import httpx
import numpy as np
import pyproj
import shapely
from rasterio import features
from rasterio.transform import Affine
from shapely.geometry import LineString, MultiLineString, Point, mapping
from shapely.ops import linemerge, transform, unary_union

from . import annual
from .config import DATA, LIT_THRESHOLD, RAW

OSM_CACHE = RAW / "osm"
OUT = DATA / "corridors.json"
OUT_GEO = DATA / "corridors.geojson"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
SEARCH_RADIUS_M = 25_000  # road pieces must be this close to the waypoint line
STRIP_KM = 2.0
COUNTRY_KM = (10.0, 20.0)
CITY_RADIUS_KM = 15.0
PROFILE_BIN_KM = 10
MIN_ROAD_SHARE = 0.5  # need road lines for at least half the route, or the corridor is left out.0
METRIC = pyproj.CRS("EPSG:7755")  # India NSF LCC, metres

log = logging.getLogger("nightlights")

# (name, lat, lon, big city?) along each route, in order.
W = tuple[str, float, float, bool]
CORRIDORS: list[dict] = [
    {
        "id": "gq-delhi-mumbai", "name": "Delhi to Mumbai", "kind": "gq", "road": "NH48 (Golden Quadrilateral)",
        "ref": "48", "opened": None,
        "waypoints": [("Delhi", 28.61, 77.21, True), ("Gurugram", 28.46, 77.03, True), ("Jaipur", 26.91, 75.79, True),
                      ("Ajmer", 26.45, 74.64, False), ("Udaipur", 24.58, 73.71, False), ("Ahmedabad", 23.02, 72.57, True),
                      ("Vadodara", 22.31, 73.18, True), ("Surat", 21.17, 72.83, True), ("Mumbai", 19.08, 72.88, True)],
    },
    {
        "id": "gq-mumbai-chennai", "name": "Mumbai to Chennai", "kind": "gq", "road": "NH48 (Golden Quadrilateral)",
        "ref": "48", "opened": None,
        "waypoints": [("Mumbai", 19.08, 72.88, True), ("Pune", 18.52, 73.86, True), ("Satara", 17.69, 74.0, False),
                      ("Kolhapur", 16.70, 74.24, False), ("Belagavi", 15.85, 74.50, False), ("Hubballi", 15.36, 75.12, False),
                      ("Davangere", 14.46, 75.92, False), ("Tumakuru", 13.34, 77.10, False), ("Bengaluru", 12.97, 77.59, True),
                      ("Krishnagiri", 12.52, 78.21, False), ("Vellore", 12.92, 79.13, False), ("Chennai", 13.08, 80.27, True)],
    },
    {
        "id": "gq-chennai-kolkata", "name": "Chennai to Kolkata", "kind": "gq", "road": "NH16 (Golden Quadrilateral)",
        "ref": "16", "opened": None,
        "waypoints": [("Chennai", 13.08, 80.27, True), ("Nellore", 14.44, 79.99, False), ("Vijayawada", 16.51, 80.65, True),
                      ("Rajahmundry", 17.0, 81.8, False), ("Visakhapatnam", 17.69, 83.22, True), ("Srikakulam", 18.3, 83.9, False),
                      ("Berhampur", 19.31, 84.79, False), ("Bhubaneswar", 20.30, 85.82, True), ("Balasore", 21.49, 86.93, False),
                      ("Kharagpur", 22.35, 87.23, False), ("Kolkata", 22.57, 88.36, True)],
    },
    {
        "id": "gq-kolkata-delhi", "name": "Kolkata to Delhi", "kind": "gq", "road": "NH19 (Golden Quadrilateral)",
        "ref": "19", "opened": None,
        "waypoints": [("Kolkata", 22.57, 88.36, True), ("Durgapur", 23.52, 87.31, False), ("Asansol", 23.68, 86.98, False),
                      ("Dhanbad", 23.80, 86.43, False), ("Aurangabad (Bihar)", 24.75, 84.37, False), ("Varanasi", 25.32, 82.97, True),
                      ("Prayagraj", 25.44, 81.85, True), ("Kanpur", 26.45, 80.33, True), ("Etawah", 26.78, 79.02, False),
                      ("Agra", 27.18, 78.01, True), ("Mathura", 27.49, 77.67, False), ("Delhi", 28.61, 77.21, True)],
    },
    {
        "id": "mumbai-pune", "name": "Mumbai–Pune Expressway", "kind": "expressway", "road": "Mumbai–Pune Expressway",
        "name_re": "Mumbai.{0,3}Pune Expressway|Yashwantrao Chavan", "opened": 2002,
        "waypoints": [("Navi Mumbai", 19.03, 73.10, True), ("Khalapur", 18.83, 73.28, False), ("Lonavala", 18.75, 73.40, False),
                      ("Pune", 18.66, 73.74, True)],
    },
    {
        "id": "yamuna", "name": "Yamuna Expressway", "kind": "expressway", "road": "Yamuna Expressway",
        "name_re": "Yamuna Expressway", "opened": 2012,
        "waypoints": [("Greater Noida", 28.47, 77.51, True), ("Jewar", 28.13, 77.56, False), ("Mathura", 27.55, 77.70, False),
                      ("Agra", 27.23, 77.99, True)],
    },
    {
        "id": "eastern-peripheral", "name": "Eastern Peripheral Expressway", "kind": "expressway",
        "road": "Eastern Peripheral Expressway", "name_re": "Eastern Peripheral", "opened": 2018,
        "waypoints": [("Kundli", 28.88, 77.12, False), ("Baghpat", 28.85, 77.27, False), ("Ghaziabad", 28.72, 77.42, False),
                      ("Greater Noida", 28.50, 77.53, False), ("Palwal", 28.15, 77.33, False)],
    },
    {
        "id": "agra-lucknow", "name": "Agra–Lucknow Expressway", "kind": "expressway", "road": "Agra–Lucknow Expressway",
        "name_re": "Agra.{0,3}Lucknow", "opened": 2017,
        "waypoints": [("Agra", 27.15, 78.07, True), ("Firozabad", 27.10, 78.40, False), ("Etawah", 26.86, 79.05, False),
                      ("Kannauj", 26.95, 79.85, False), ("Unnao", 26.85, 80.45, False), ("Lucknow", 26.84, 80.88, True)],
    },
    {
        "id": "purvanchal", "name": "Purvanchal Expressway", "kind": "expressway", "road": "Purvanchal Expressway",
        "name_re": "Purvanchal", "opened": 2021,
        "waypoints": [("Lucknow", 26.78, 81.07, True), ("Barabanki", 26.65, 81.35, False), ("Sultanpur", 26.30, 82.05, False),
                      ("Azamgarh", 26.00, 82.95, False), ("Ghazipur", 25.62, 83.50, False)],
    },
    {
        "id": "bundelkhand", "name": "Bundelkhand Expressway", "kind": "expressway", "road": "Bundelkhand Expressway",
        "name_re": "Bundelkhand", "opened": 2022,
        "waypoints": [("Chitrakoot", 25.20, 81.00, False), ("Banda", 25.50, 80.40, False), ("Hamirpur", 25.80, 79.90, False),
                      ("Jalaun", 26.20, 79.40, False), ("Etawah", 26.75, 79.10, False)],
    },
    {
        "id": "samruddhi", "name": "Samruddhi Mahamarg (Mumbai–Nagpur)", "kind": "expressway",
        "road": "Samruddhi Mahamarg", "name_re": "Samruddhi", "opened": 2022,
        "waypoints": [("Nagpur", 21.10, 79.00, True), ("Wardha", 20.80, 78.60, False), ("Amravati", 20.75, 77.85, False),
                      ("Washim", 20.20, 77.10, False), ("Jalna", 19.90, 75.95, False), ("Chhatrapati Sambhajinagar", 19.90, 75.30, True),
                      ("Shirdi", 19.75, 74.45, False), ("Igatpuri", 19.70, 73.56, False), ("Thane", 19.30, 73.15, True)],
    },
    {
        "id": "delhi-mumbai-expressway", "name": "Delhi–Mumbai Expressway", "kind": "expressway",
        "road": "Delhi–Mumbai Expressway", "name_re": "Delhi.{0,3}Mumbai Expressway", "opened": 2023,
        "waypoints": [("Sohna", 28.25, 77.07, False), ("Alwar", 27.55, 76.75, False), ("Dausa", 26.88, 76.33, False),
                      ("Kota", 25.18, 75.83, True), ("Mandsaur", 24.05, 75.10, False), ("Ratlam", 23.33, 75.04, False),
                      ("Vadodara", 22.30, 73.20, True)],
    },
]

TO_M = pyproj.Transformer.from_crs("EPSG:4326", METRIC, always_xy=True).transform
TO_LL = pyproj.Transformer.from_crs(METRIC, "EPSG:4326", always_xy=True).transform


def waypoint_line(c: dict) -> LineString:
    return LineString([(lon, lat) for _, lat, lon, _ in c["waypoints"]])


def overpass_query(c: dict) -> str:
    # A plain bounding box is far cheaper for Overpass than a route-shaped search;
    # pieces farther than SEARCH_RADIUS_M from the route are dropped in road_lines().
    lats = [lat for _, lat, _, _ in c["waypoints"]]
    lons = [lon for _, _, lon, _ in c["waypoints"]]
    m = 0.3
    around = f"({min(lats) - m:.2f},{min(lons) - m:.2f},{max(lats) + m:.2f},{max(lons) + m:.2f})"
    hw = '["highway"~"^(motorway|trunk|primary)$"]'
    if "ref" in c:
        # Overpass regexes are POSIX: no \s, so spell spaces out.
        sel = f'way{hw}["ref"~"(^|;) *NH *-?{c["ref"]} *(;|$)"]{around};'
    else:
        sel = f'way{hw}["name"~"{c["name_re"]}",i]{around};'
    return f"[out:json][timeout:240];({sel});out geom;"


def fetch_osm(c: dict, force: bool = False) -> dict:
    OSM_CACHE.mkdir(parents=True, exist_ok=True)
    path = OSM_CACHE / f"{c['id']}.json"
    if path.exists() and not force:
        return json.loads(path.read_text(encoding="utf-8"))
    q = overpass_query(c)
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            r = httpx.post(url, data={"data": q}, timeout=360,
                           headers={"User-Agent": "india-night-lights-pipeline (open data project)"})
            r.raise_for_status()
            out = r.json()
            if not out.get("elements"):
                raise RuntimeError(f"no roads matched for {c['id']}: {out.get('remark', 'empty result')}")
            path.write_text(r.text, encoding="utf-8")
            return out
        except (httpx.HTTPError, ValueError) as e:
            log.warning(f"  overpass attempt {attempt + 1} for {c['id']} failed: {type(e).__name__}")
            time.sleep(45 * (attempt + 1))  # Overpass asks clients to back off
    raise RuntimeError(f"Overpass failed for {c['id']}")


def road_lines(osm: dict, c: dict | None = None) -> MultiLineString:
    lines = [LineString([(p["lon"], p["lat"]) for p in el["geometry"]])
             for el in osm.get("elements", []) if el.get("type") == "way" and len(el.get("geometry", [])) >= 2]
    if c is not None:  # keep only pieces near this route (the same NH number can run elsewhere in the box)
        route = transform(TO_M, waypoint_line(c))
        lines = [ln for ln in lines if route.distance(transform(TO_M, ln.centroid)) <= SEARCH_RADIUS_M]
    if not lines:
        raise RuntimeError("no road pieces found")
    merged = linemerge(unary_union(lines))
    return merged if isinstance(merged, MultiLineString) else MultiLineString([merged])


def corridor_geometry(c: dict, roads_m) -> dict:
    """Strip, countryside ring and city exclusions, all in metres."""
    cities = unary_union([Point(TO_M(lon, lat)).buffer(CITY_RADIUS_KM * 1000)
                          for _, lat, lon, big in c["waypoints"] if big] or [Point(0, 0).buffer(1)])
    strip = roads_m.buffer(STRIP_KM * 1000).difference(cities)
    ring = roads_m.buffer(COUNTRY_KM[1] * 1000).difference(roads_m.buffer(COUNTRY_KM[0] * 1000)).difference(cities)
    return {"strip": strip, "ring": ring}


def pixel_mask(geom_m, transform_: Affine, shape) -> np.ndarray:
    geom_ll = transform(TO_LL, geom_m)
    return features.geometry_mask([mapping(geom_ll)], out_shape=shape, transform=transform_, invert=True, all_touched=False)


def stats(values: np.ndarray) -> dict:
    v = values[~np.isnan(values)]
    if v.size < 20:
        return {"median": None, "mean": None, "lit": None, "n": int(v.size)}
    return {"median": round(float(np.median(v)), 2), "mean": round(float(v.mean()), 2),
            "lit": round(float((v >= LIT_THRESHOLD).mean() * 100), 1), "n": int(v.size)}


def measure(years: list[int], force_osm: bool = False):
    prepared = []
    for c in CORRIDORS:
        try:
            osm = fetch_osm(c, force=force_osm)
            roads = road_lines(osm, c)
        except RuntimeError as e:  # one missing road shouldn't sink the rest
            log.warning(f"{c['id']}: skipped ({e})")
            continue
        roads_m = transform(TO_M, roads)
        geo = corridor_geometry(c, roads_m)
        route_m = transform(TO_M, waypoint_line(c))
        if roads_m.length < MIN_ROAD_SHARE * route_m.length:  # OpenStreetMap only gave us bits of the road
            log.warning(f"{c['id']}: skipped, only {roads_m.length / 1000:.0f} of ~{route_m.length / 1000:.0f} km of road found")
            continue
        log.info(f"{c['id']}: {len(osm.get('elements', []))} OSM ways, {roads_m.length / 1000:.0f} km of carriageway")
        prepared.append({"c": c, "roads": roads, "roads_m": roads_m, "route_m": route_m, **geo})

    results = {p["c"]["id"]: {"years": [], "strip": [], "country": [], "profile": []} for p in prepared}
    masks: dict[str, dict] = {}
    for year in years:
        if not annual.cache_path(year).exists():
            log.warning(f"{year}: no annual raster cached, skipping")
            continue
        rast = annual.load_cache(year)
        arr = rast.values.astype("float32")
        tr = rast.rio.transform()
        for p in prepared:
            cid = p["c"]["id"]
            if cid not in masks:  # the grid is the same every year, so compute masks once
                strip = pixel_mask(p["strip"], tr, arr.shape)
                ring = pixel_mask(p["ring"], tr, arr.shape)
                rows, cols = np.nonzero(strip)
                xs, ys = rasterio_xy(tr, rows, cols)
                pm = shapely.points(*TO_M(xs, ys))
                along = shapely.line_locate_point(p["route_m"], pm) / 1000
                nbins = int(np.ceil(p["route_m"].length / 1000 / PROFILE_BIN_KM))
                bins = np.clip((along // PROFILE_BIN_KM).astype(int), 0, nbins - 1)
                masks[cid] = {"strip": strip, "ring": ring, "rows": rows, "cols": cols, "bins": bins, "nbins": nbins}
            m = masks[cid]
            r = results[cid]
            r["years"].append(year)
            r["strip"].append(stats(arr[m["strip"]]))
            r["country"].append(stats(arr[m["ring"]]))
            vals = arr[m["rows"], m["cols"]]
            prof = []
            for b in range(m["nbins"]):
                v = vals[(m["bins"] == b) & ~np.isnan(vals)]
                prof.append(round(float(v.mean()), 2) if v.size >= 3 else None)
            r["profile"].append(prof)
        log.info(f"{year}: measured {len(prepared)} corridors")
        del rast, arr
    return prepared, results


def rasterio_xy(tr: Affine, rows, cols):
    xs = tr.c + (cols + 0.5) * tr.a + (rows + 0.5) * tr.b
    ys = tr.f + (cols + 0.5) * tr.d + (rows + 0.5) * tr.e
    return xs, ys


def write_outputs(prepared, results):
    corridors = []
    feats = []
    for p in prepared:
        c = p["c"]
        route = p["route_m"]
        labels = [{"name": n, "km": round(route.project(Point(TO_M(lon, lat))) / 1000), "city": big}
                  for n, lat, lon, big in c["waypoints"]]
        corridors.append({
            "id": c["id"], "name": c["name"], "kind": c["kind"], "road": c["road"], "opened": c["opened"],
            "route_km": round(route.length / 1000), "bin_km": PROFILE_BIN_KM, "labels": labels,
            "bbox": [round(v, 3) for v in p["roads"].bounds],
            **results[c["id"]],
        })
        simple = p["roads"].simplify(0.003, preserve_topology=False)
        feats.append({"type": "Feature", "properties": {"id": c["id"], "kind": c["kind"]},
                      "geometry": json.loads(shapely.to_geojson(shapely.set_precision(simple, 0.0001)))})
    meta = {
        "product": annual.PRODUCT.value, "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "strip_km": STRIP_KM, "country_km": list(COUNTRY_KM), "city_radius_km": CITY_RADIUS_KM,
        "lit_threshold": LIT_THRESHOLD, "source_roads": "OpenStreetMap contributors (ODbL), via Overpass API",
        "corridors": corridors,
    }
    OUT.write_text(json.dumps(meta, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    OUT_GEO.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")
    return OUT, OUT_GEO


def download_rasters(years: list[int]):
    """Fill the annual-raster cache without touching the committed stats."""
    from blackmarble import BlackMarble

    from . import run
    from .config import COLLECTION, DROP_QUALITY_FLAGS, get_token

    districts = run.load_districts()
    aoi = run.area_of_interest(districts)
    bm = BlackMarble(token=get_token(), output_directory=RAW / "blackmarble" / annual.PRODUCT.value,
                     output_skip_if_exists=True, drop_values_by_quality_flag=DROP_QUALITY_FLAGS,
                     collection=COLLECTION)
    for year in years:
        if annual.cache_path(year).exists():
            log.info(f"{year}: cached")
            continue
        annual.get_raster(bm, aoi, year, keep_raw=False)
        log.info(f"{year}: downloaded")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", type=int, default=2015)
    p.add_argument("--end", type=int, default=dt.date.today().year - 1)
    p.add_argument("--refetch-roads", action="store_true", help="download road lines from OpenStreetMap again")
    p.add_argument("--download-rasters", action="store_true",
                   help="only download NASA's annual composites for the years into the local cache")
    p.add_argument("--fetch-roads", action="store_true", help="only download the road lines")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    years = list(range(args.start, args.end + 1))
    if args.download_rasters:
        download_rasters(years)
        return
    if args.fetch_roads:
        failed = []
        for c in CORRIDORS:
            try:
                fetch_osm(c, force=args.refetch_roads)
                log.info(f"{c['id']}: roads ok")
            except RuntimeError as e:
                failed.append(c["id"])
                log.warning(f"{c['id']}: {e}")
        log.info(f"roads: {len(CORRIDORS) - len(failed)} ok, failed: {failed or 'none'}")
        return
    prepared, results = measure(list(range(args.start, args.end + 1)), force_osm=args.refetch_roads)
    for path in write_outputs(prepared, results):
        log.info(f"wrote {path.relative_to(DATA.parent)} ({path.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
