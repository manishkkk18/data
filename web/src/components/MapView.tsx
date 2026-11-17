import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre v6 finds its worker relative to its own file, which bundlers move. Let Vite
// bundle the worker and hand MapLibre the URL instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);
import type { ExpressionSpecification, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { SAT, type Arrival, type BBox, type DistrictFC, type Fire, type SatLayer, type WindFile, type WindLevel } from "../data";
import { FIRE_NEW, FIRE_OLD, WIND_BLUE } from "./Legend";

// OpenFreeMap: free, no API key, no view limits. Attribution comes from the style.
export const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
export const STUDY: BBox = [68.1, 6.7, 97.4, 37.1]; // all of India (same frame as India Night Lights)
const DELHI: [number, number] = [77.2167, 28.6315];

export type FireHover = { fire: Fire; x: number; y: number };
export type FlyRequest = { bbox: BBox; n: number };

type Props = {
  districts: DistrictFC;
  outline: FeatureCollection;
  fires: Fire[]; // already filtered to the window
  at: number; // the moment the map is "at" (ms); fire age is measured from here
  windowHours: number;
  wind: WindFile | null;
  windFrame: number | null;
  windLevel: WindLevel;
  showWind: boolean;
  showDistricts: boolean;
  arrival: Arrival | null; // back-trajectories of the air reaching Delhi at the map's moment
  showTrajectory: boolean;
  sat: SatLayer; // NASA GIBS image under the data
  satDate: string; // its date (YYYY-MM-DD)
  selectedId: string | null;
  fly: FlyRequest | null;
  padding: { top: number; bottom: number; left: number; right: number };
  onFireHover: (h: FireHover | null) => void;
  onSelect: (districtId: string | null) => void;
  onLoaded?: () => void;
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Fire dots: colour = age in the window (0 newest → 1 oldest), size = fire radiative power (MW).
const AGE_COLOR: ExpressionSpecification = ["interpolate", ["linear"], ["get", "age"], 0, FIRE_NEW, 1, FIRE_OLD];
const FRP_RADIUS: ExpressionSpecification = ["interpolate", ["linear"], ["get", "frp"], 0, 1.6, 10, 2.4, 50, 4, 200, 7];
const zoomed = (base: ExpressionSpecification, k: number): ExpressionSpecification =>
  ["interpolate", ["linear"], ["zoom"], 4, ["*", base, 0.8], 7, base, 10, ["*", base, k]] as ExpressionSpecification;

export default function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const firstDraw = useRef<(() => void) | null>(null);
  const cb = useRef(props);
  cb.current = props; // latest callbacks without re-binding map events

  // Create the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE_URL,
      center: [77, 22],
      zoom: 1.8,
      maxPitch: 60,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio, 2), // keeps phones smooth
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map;

    // Delhi: an HTML marker, so it stays crisp and readable above every layer (added once loaded).
    const pin = document.createElement("div");
    pin.className = "delhi-pin";
    pin.innerHTML = '<span class="delhi-dot"></span><span class="delhi-name">Delhi</span>';
    pin.setAttribute("aria-hidden", "true");
    const pinMarker = new maplibregl.Marker({ element: pin, anchor: "left", offset: [-7, 0] }).setLngLat(DELHI);

    let flown = false;
    const flyIn = () => {
      if (flown || mapRef.current !== map) return;
      flown = true;
      // Opening: the globe, then a fly-in to north-west India (or the district a shared link asked for).
      const { padding: pad, fly } = cb.current;
      const duration = reducedMotion() ? 0 : 3800;
      map.fitBounds(fly ? fly.bbox : STUDY, { padding: pad, maxZoom: 9.5, essential: true, duration });
    };
    // Loaded = the first fires are drawn (as India Night Lights waits for its districts).
    let loaded = false;
    const onLoaded = () => {
      if (loaded || mapRef.current !== map) return;
      loaded = true;
      pinMarker.addTo(map);
      cb.current.onLoaded?.();
      setTimeout(flyIn, 250);
    };
    firstDraw.current = onLoaded;
    const fallback = setTimeout(onLoaded, 8000); // don't hold the opening forever on a slow device

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: [
          '<a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a>',
          '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>',
          '<a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a>',
        ],
      }),
      "bottom-right",
    );
    // Phones: keep the credits folded into the (i) button so they never sit under the map controls.
    if (window.matchMedia("(max-width: 639px)").matches) {
      const fold = () => container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      map.once("load", fold);
      map.once("idle", fold);
      setTimeout(fold, 1500);
    }

    map.once("style.load", () => {
      map.setProjection({ type: "globe" });
      tuneBasemap(map);
      addDataLayers(map, cb.current.districts, cb.current.outline);
      bindInteractions(map, cb);
      enableDetailOutline(map);
      setReady(true);
    });

    return () => {
      clearTimeout(fallback);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fires for the window, with age measured from the map's moment.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const span = props.windowHours * 3600000;
    (map.getSource("fires") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: props.fires.map((f, i) => ({
        type: "Feature",
        id: i,
        properties: { i, frp: f.frp, age: Math.min(Math.max((props.at - f.t) / span, 0), 1) },
        geometry: { type: "Point", coordinates: [f.lon, f.lat] },
      })),
    });
    // The first time, clear the loading screen once these fires are on screen.
    const done = firstDraw.current;
    if (done) {
      firstDraw.current = null;
      map.once("idle", done);
    }
  }, [props.fires, props.at, props.windowHours, ready]);

  // Wind arrows for the chosen frame and height (Delhi's own point is left out of the grid).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const w = props.wind;
    const frame = w && props.windFrame != null ? w.levels[props.windLevel]?.[props.windFrame] : null;
    const features = frame
      ? frame.slice(0, -1).flatMap((v, i) =>
          v ? [{ type: "Feature" as const, properties: { speed: v[0], to: (v[1] + 180) % 360 }, geometry: { type: "Point" as const, coordinates: w!.points[i] } }] : [],
        )
      : [];
    (map.getSource("wind") as GeoJSONSource).setData({ type: "FeatureCollection", features });
    map.setLayoutProperty("wind-arrows", "visibility", props.showWind && features.length ? "visible" : "none");
  }, [props.wind, props.windFrame, props.windLevel, props.showWind, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("district-line", "visibility", props.showDistricts ? "visible" : "none");
  }, [props.showDistricts, ready]);

  // NASA GIBS imagery, added the first time it's chosen and re-pointed when the day changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [key, s] of Object.entries(SAT)) {
      const id = `gibs-${key}`;
      const on = props.sat === key;
      const tiles = [s.url(props.satDate)];
      if (on && !map.getSource(id)) {
        // Only request tiles over South Asia: saves downloads, and NASA errors on some far-off empty tiles.
        map.addSource(id, { type: "raster", tiles, tileSize: 256, maxzoom: s.maxzoom, bounds: [60, 5, 100, 40], attribution: '<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>' });
        map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": s.opacity } }, "district-fill");
      } else if (on) {
        (map.getSource(id) as maplibregl.RasterTileSource).setTiles(tiles);
      }
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
    // Fires get a dark edge so they stay readable on top of the imagery.
    map.setPaintProperty("fire-dots", "circle-stroke-color", ["case", ["boolean", ["feature-state", "hover"], false], "#FFD2B8", "#0B0F1A"]);
    map.setPaintProperty("fire-dots", "circle-stroke-width", ["case", ["boolean", ["feature-state", "hover"], false], 1.5, props.sat === "none" ? 0 : 0.8]);
  }, [props.sat, props.satDate, ready]);

  // The air's path into Delhi: one line per height, dots every 6 hours back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const a = props.showTrajectory ? props.arrival : null;
    const features: GeoJSON.Feature[] = [];
    if (a) {
      for (const [level, path] of Object.entries(a.paths)) {
        if (path.length < 2) continue;
        features.push({ type: "Feature", properties: { level }, geometry: { type: "LineString", coordinates: path } });
        path.forEach((p, h) => {
          if (h > 0 && h % 6 === 0) features.push({ type: "Feature", properties: { level, h }, geometry: { type: "Point", coordinates: p } });
        });
      }
    }
    (map.getSource("traj") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [props.arrival, props.showTrajectory, ready]);

  // Blue outline on the selected district.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("district-selected", ["==", ["get", "id"], props.selectedId ?? ""]);
  }, [props.selectedId, ready]);

  // Fly to a requested district.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !props.fly) return;
    map.fitBounds(props.fly.bbox, { padding: props.padding, maxZoom: 9.5, duration: reducedMotion() ? 0 : 1800, essential: true });
  }, [props.fly, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} className="map" role="region" aria-label="Map of farm-fire detections and winds over north-west India" />;
}

// ---- Copied from India Night Lights (basemap tuning and official outline) --------------------
export function tuneBasemap(map: maplibregl.Map) {
  const style = map.getStyle();
  for (const layer of style.layers ?? []) {
    // The basemap's borders come from OpenStreetMap and don't match India's official
    // map. We hide them all and draw India's outline from our own boundary data.
    if (layer.id.startsWith("boundary_")) map.setLayoutProperty(layer.id, "visibility", "none");
  }
  // Basemap labels in English, falling back to the local name where there's no English one.
  for (const layer of style.layers ?? []) {
    if (layer.type !== "symbol") continue;
    const field = map.getLayoutProperty(layer.id, "text-field");
    if (field && JSON.stringify(field).includes('"name')) {
      map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]]);
    }
  }
  if (map.getLayer("background")) map.setPaintProperty("background", "background-color", "#0B0F1A");
  if (map.getLayer("water")) map.setPaintProperty("water", "fill-color", "#0D1424");
  try {
    map.setSky({ "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] });
  } catch {
    /* atmosphere is decorative */
  }
}

const DETAIL_ZOOM = 6.5;
const OUTLINE_PAINT = {
  "line-color": "#9AA3B8",
  "line-opacity": 0.75,
  "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 1.4, 12, 2],
} as maplibregl.LineLayerSpecification["paint"];

/** India's outline at ~170 m detail, fetched the first time the map is zoomed past regional level. */
export function enableDetailOutline(map: maplibregl.Map) {
  let started = false;
  const check = () => {
    if (started || map.getZoom() < DETAIL_ZOOM - 0.5) return;
    started = true;
    map.off("zoomend", check);
    fetch(`${import.meta.env.BASE_URL}data/india_outline_detail.geojson`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!map.getStyle() || map.getSource("india-outline-detail")) return;
        map.addSource("india-outline-detail", { type: "geojson", data });
        map.addLayer({ id: "india-outline-detail", type: "line", source: "india-outline-detail", minzoom: DETAIL_ZOOM, paint: OUTLINE_PAINT }, "district-hover");
      })
      .catch(() => {
        started = false; // try again on the next zoom
        map.on("zoomend", check);
      });
  };
  map.on("zoomend", check);
  check();
}

// ---- This app's layers -----------------------------------------------------------------------
function addDataLayers(map: maplibregl.Map, districts: DistrictFC, outline: FeatureCollection) {
  const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
  map.addSource("districts", { type: "geojson", data: districts, promoteId: "id", maxzoom: 11 });
  map.addSource("india-outline", { type: "geojson", data: outline });
  map.addSource("fires", { type: "geojson", data: empty });
  map.addSource("wind", { type: "geojson", data: empty });
  map.addImage("wind-arrow", arrowImage(), { pixelRatio: 2 });

  const before = map.getLayer("waterway") ? "waterway" : undefined;
  // Invisible fill: lets a tap anywhere in a district select it.
  map.addLayer({ id: "district-fill", type: "fill", source: "districts", paint: { "fill-color": "#000", "fill-opacity": 0 } }, before);
  map.addLayer(
    {
      id: "district-line",
      type: "line",
      source: "districts",
      paint: {
        "line-color": ["interpolate", ["linear"], ["zoom"], 5, "rgba(110,130,170,0.28)", 11, "rgba(110,130,170,0.5)"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 8, 0.8, 12, 1.2],
      },
    },
    before,
  );
  map.addLayer({ id: "india-outline", type: "line", source: "india-outline", maxzoom: DETAIL_ZOOM, paint: OUTLINE_PAINT });
  map.addLayer({
    id: "district-hover",
    type: "line",
    source: "districts",
    paint: { "line-color": "#E8ECF5", "line-width": 1.5, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0] },
  });
  map.addLayer({
    id: "district-selected",
    type: "line",
    source: "districts",
    filter: ["==", ["get", "id"], ""],
    paint: { "line-color": WIND_BLUE, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2, 10, 3.5] },
  });
  // Fires: a soft glow under each dot, newest drawn on top.
  map.addLayer({
    id: "fire-glow",
    type: "circle",
    source: "fires",
    layout: { "circle-sort-key": ["-", 1, ["get", "age"]] },
    paint: {
      "circle-color": AGE_COLOR,
      // A halo about 2.4× the dot, not a second dot.
      "circle-radius": zoomed(["*", FRP_RADIUS, 2.4] as ExpressionSpecification, 1.8) as unknown as number,
      "circle-blur": 1,
      "circle-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 0.55, 1, 0.12],
    },
  });
  map.addLayer({
    id: "fire-dots",
    type: "circle",
    source: "fires",
    layout: { "circle-sort-key": ["-", 1, ["get", "age"]] },
    paint: {
      "circle-color": AGE_COLOR,
      "circle-radius": zoomed(FRP_RADIUS, 1.8) as unknown as number,
      "circle-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 0.95, 1, 0.45],
      "circle-stroke-color": "#FFD2B8",
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 1.5, 0],
    },
  });
  map.addLayer({
    id: "wind-arrows",
    type: "symbol",
    source: "wind",
    layout: {
      "icon-image": "wind-arrow",
      "icon-rotate": ["get", "to"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": ["interpolate", ["linear"], ["get", "speed"], 0, 0.45, 4, 0.8, 10, 1.25, 20, 1.6],
    },
    paint: { "icon-opacity": 0.9 },
  });
  // Back-trajectories on top of everything: a soft glow, then the line (solid aloft, dashed near the ground).
  map.addSource("traj", { type: "geojson", data: empty });
  const isLine: ExpressionSpecification = ["==", ["geometry-type"], "LineString"];
  const aloft: ExpressionSpecification = ["==", ["get", "level"], "850hPa"];
  map.addLayer({
    id: "traj-glow",
    type: "line",
    source: "traj",
    filter: isLine,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": WIND_BLUE, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 16], "line-blur": 8, "line-opacity": ["case", aloft, 0.45, 0.3] },
  });
  map.addLayer({
    id: "traj-line-aloft",
    type: "line",
    source: "traj",
    filter: ["all", isLine, aloft],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#CFE0FF", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3.5] },
  });
  map.addLayer({
    id: "traj-line-ground",
    type: "line",
    source: "traj",
    filter: ["all", isLine, ["!", aloft]],
    layout: { "line-join": "round" },
    paint: { "line-color": WIND_BLUE, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 3], "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "traj-ticks",
    type: "circle",
    source: "traj",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 8, 4.5],
      "circle-color": "#0B0F1A",
      "circle-stroke-color": ["case", aloft, "#CFE0FF", WIND_BLUE],
      "circle-stroke-width": 2,
    },
  });
}

/** An arrow pointing north (rotated per point to where the wind blows). */
function arrowImage(): ImageData {
  const w = 24;
  const h = 48;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = WIND_BLUE;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(110,168,255,0.6)";
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(w / 2, h - 6);
  ctx.lineTo(w / 2, 6);
  ctx.moveTo(w / 2 - 7, 14);
  ctx.lineTo(w / 2, 6);
  ctx.lineTo(w / 2 + 7, 14);
  ctx.stroke();
  return ctx.getImageData(0, 0, w, h);
}

function bindInteractions(map: maplibregl.Map, cb: React.RefObject<Props>) {
  let hoverDistrict: string | null = null;
  let hoverFire: number | null = null;
  const setDistrictHover = (id: string | null) => {
    if (hoverDistrict) map.setFeatureState({ source: "districts", id: hoverDistrict }, { hover: false });
    hoverDistrict = id;
    if (id) map.setFeatureState({ source: "districts", id }, { hover: true });
  };
  const setFireHover = (id: number | null) => {
    if (hoverFire != null) map.setFeatureState({ source: "fires", id: hoverFire }, { hover: false });
    hoverFire = id;
    if (id != null) map.setFeatureState({ source: "fires", id }, { hover: true });
  };

  map.on("mousemove", (e) => {
    const fire = map.queryRenderedFeatures(e.point, { layers: ["fire-dots"] })[0];
    if (fire) {
      const i = fire.properties.i as number;
      setFireHover(fire.id as number);
      map.getCanvas().style.cursor = "pointer";
      const f = cb.current.fires[i];
      cb.current.onFireHover(f ? { fire: f, x: e.point.x, y: e.point.y } : null);
    } else {
      setFireHover(null);
      cb.current.onFireHover(null);
    }
    const d = map.queryRenderedFeatures(e.point, { layers: ["district-fill"] })[0];
    const id = (d?.properties?.id as string) ?? null;
    if (id !== hoverDistrict) setDistrictHover(id);
    if (!fire) map.getCanvas().style.cursor = id ? "pointer" : "";
  });
  map.on("mouseout", () => {
    setDistrictHover(null);
    setFireHover(null);
    cb.current.onFireHover(null);
  });
  // A double-click zooms the map, so a click only selects once 250 ms pass without a second one.
  let pending: ReturnType<typeof setTimeout> | undefined;
  map.on("click", (e) => {
    clearTimeout(pending);
    const fire = map.queryRenderedFeatures(e.point, { layers: ["fire-dots"] })[0];
    const f = fire ? cb.current.fires[fire.properties.i as number] : undefined;
    const d = map.queryRenderedFeatures(e.point, { layers: ["district-fill"] })[0];
    const id = f ? f.district : ((d?.properties?.id as string) ?? null);
    pending = setTimeout(() => cb.current.onSelect(id), 250);
  });
  map.on("dblclick", () => clearTimeout(pending));
}
