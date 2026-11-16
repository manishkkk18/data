import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre v6 finds its worker relative to its own file, which bundlers move. Let Vite
// bundle the worker and hand MapLibre the URL instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);
import type { ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { GROWTH_STOPS, RAD_STOPS, type BBox, type DistrictFC } from "../data";
import type { BaseLayer } from "./LayerSwitcher";
import type { Highlight } from "./Legend";

// OpenFreeMap: free, no API key, no view limits. Attribution comes from the style.
export const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const INDIA: BBox = [68.1, 6.7, 97.4, 37.1];

// est = NASA's gap-filled estimate, shown (hatched) only where the observed value is a gap
export type DistrictValue = { mean: number | null; growth: number | null; gap: boolean; est?: number | null };
export type ColorMode = "radiance" | "growth";
export type HoverInfo = { id: string; x: number; y: number };
export type FlyRequest = { bbox: BBox; n: number };

type Props = {
  districts: DistrictFC;
  outline: FeatureCollection;
  values: Map<string, DistrictValue>;
  selectedId: string | null;
  fly: FlyRequest | null;
  padding: { top: number; bottom: number; left: number; right: number };
  onHover: (h: HoverInfo | null) => void;
  onSelect: (id: string | null) => void;
  onLoaded?: () => void; // districts are drawn
  mode: ColorMode;
  base: BaseLayer;
  threeD: boolean;
  compareId?: string | null; // second district in the compare view (dashed outline)
  highlight?: Highlight; // legend band being hovered: dim everything outside it
  orbit?: boolean; // slow auto-rotation of the 3D skyline
  onOrbitStop?: () => void; // the user grabbed the map, so the orbit stops
  corridor?: { id: string; bbox: BBox; n: number } | null; // highway corridor to draw and fly to
  onMap?: (map: maplibregl.Map) => void; // gives the swipe view the live map to follow
};

// NASA GIBS imagery (free, no key). Layer IDs from the GIBS WMTS GetCapabilities.
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const GIBS_CREDIT = '<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>';
const RASTERS: Record<Exclude<BaseLayer, "districts">, { url: string; maxzoom: number }> = {
  night: { url: `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, maxzoom: 8 },
  day: { url: `${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2026-02-21/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, maxzoom: 9 },
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Colour by log10(radiance), stored per district as feature-state so changing month
// only updates numbers, never re-uploads geometry.
const RAD_COLOR: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["feature-state", "lrad"], -3],
  ...RAD_STOPS.flatMap(([v, c]) => [Math.log10(v), c]),
] as ExpressionSpecification;

const GROWTH_COLOR: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["feature-state", "g"], 0],
  ...GROWTH_STOPS.flat(),
] as ExpressionSpecification;

const isGap: ExpressionSpecification = ["boolean", ["feature-state", "gap"], false];
const isEst: ExpressionSpecification = ["boolean", ["feature-state", "est"], false];

export default function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef(props);
  cb.current = props; // latest callbacks without re-binding map events

  // Create the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE_URL,
      center: [80, 18],
      zoom: 1.8,
      maxPitch: 70,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio, 2), // keeps phones smooth
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map;

    // Timing marks for load-speed work (visible in DevTools > Performance, or
    // performance.getEntriesByType("mark")).
    performance.mark("map-created");
    map.once("style.load", () => performance.mark("style-loaded"));
    let flown = false;
    const flyIn = () => {
      if (flown || mapRef.current !== map) return; // map may have been removed meanwhile
      flown = true;
      // Opening: the globe, then a fly-in to India once there's something to see,
      // or straight to the district a shared link asked for (tilted if it asked for 3D).
      const { padding: pad, fly, base, threeD } = cb.current;
      const tilt = base === "districts" && threeD ? { pitch: 55, bearing: -15 } : {};
      const duration = reducedMotion() ? 0 : 3800;
      if (fly) {
        map.fitBounds(fly.bbox, { padding: pad, maxZoom: 9.5, essential: true, duration, ...tilt });
        return;
      }
      // All of India fits better flat; tilt into the skyline once it's framed.
      map.fitBounds(INDIA, { padding: pad, essential: true, duration, pitch: 0, bearing: 0 });
      if ("pitch" in tilt) map.once("moveend", () => map.easeTo({ ...tilt, duration: reducedMotion() ? 0 : 1400 }));
    };
    let loaded = false;
    const onLoaded = () => {
      if (loaded || mapRef.current !== map) return;
      loaded = true;
      performance.mark("districts-loaded");
      map.off("sourcedata", onData);
      cb.current.onLoaded?.();
      setTimeout(flyIn, 250);
    };
    function onData(e: maplibregl.MapSourceDataEvent) {
      if (e.sourceId === "districts" && e.isSourceLoaded) onLoaded();
    }
    map.on("sourcedata", onData);
    // With only the 3D layer showing, that event can be missed; the first idle frame is a safe backstop.
    map.once("idle", onLoaded);
    const fallback = setTimeout(flyIn, 4000); // don't hold the opening forever on a slow device
    map.once("idle", () => performance.mark("map-idle"));
    map.once("load", () => performance.mark("map-load"));

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: [
          '<a href="https://blackmarble.gsfc.nasa.gov/" target="_blank" rel="noopener">NASA Black Marble</a>',
          '<a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a>',
        ],
      }),
      "bottom-right",
    );

    // "style.load" fires as soon as the style is parsed; "load" would wait for every
    // visible tile, which on a globe view can take 10+ seconds on a slow connection.
    map.once("style.load", () => {
      map.setProjection({ type: "globe" });
      tuneBasemap(map);
      addDataLayers(map, cb.current.districts, cb.current.outline);
      bindInteractions(map, cb);
      enableDetailOutline(map);
      setReady(true);
      cb.current.onMap?.(map);
    });

    return () => {
      clearTimeout(fallback);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Push this month's values into feature-state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    pushValues(map, props.values);
  }, [props.values, ready]);

  // Legend hover: dim every district outside the hovered colour band.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const flat = props.base === "districts" && !props.threeD;
    if (!flat) return;
    if (!props.highlight) {
      map.setPaintProperty("district-fill", "fill-opacity", fadeOpacity(0.9));
      return;
    }
    const { key, lo, hi } = props.highlight;
    const v: ExpressionSpecification = ["coalesce", ["feature-state", key], -999];
    map.setPaintProperty("district-fill", "fill-opacity", ["case", ["all", [">=", v, lo], ["<", v, hi]], 0.95, 0.12]);
  }, [props.highlight, props.base, props.threeD, ready]);

  // Slow auto-orbit for the 3D skyline; any drag, zoom or rotate by the user stops it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !props.orbit || !props.threeD || reducedMotion()) return;
    let raf = 0;
    let last = performance.now();
    const spin = (t: number) => {
      map.setBearing(map.getBearing() + ((t - last) / 1000) * 3); // 3° per second
      last = t;
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
    const stop = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) cb.current.onOrbitStop?.();
    };
    map.on("dragstart", stop);
    map.on("zoomstart", stop);
    map.on("rotatestart", stop);
    map.on("pitchstart", stop);
    return () => {
      cancelAnimationFrame(raf);
      map.off("dragstart", stop);
      map.off("zoomstart", stop);
      map.off("rotatestart", stop);
      map.off("pitchstart", stop);
    };
  }, [props.orbit, props.threeD, ready]);

  // Which layers show: district colours (flat or 3D) or a NASA GIBS image.
  const prev3D = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyLayers(map, props.base, props.threeD, props.mode);
    const want3D = props.base === "districts" && props.threeD;
    if (want3D !== prev3D.current) {
      prev3D.current = want3D;
      map.easeTo({
        pitch: want3D ? 55 : 0,
        bearing: want3D ? -15 : 0,
        zoom: want3D ? Math.max(map.getZoom(), 4.2) : map.getZoom(),
        duration: reducedMotion() ? 0 : 1400,
      });
    }
  }, [props.base, props.threeD, props.mode, ready]);

  // Dashed outline on the district being compared.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("district-compare", ["==", ["get", "id"], props.compareId ?? ""]);
  }, [props.compareId, ready]);

  // Blue outline on the selected district.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("district-selected", ["==", ["get", "id"], props.selectedId ?? ""]);
  }, [props.selectedId, ready]);

  // Highway corridor: load the lines on first use, draw the chosen one, fly to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const c = props.corridor;
    const show = (id: string | null) => {
      for (const l of ["corridor-glow", "corridor-line"]) {
        if (!map.getLayer(l)) continue;
        map.setLayoutProperty(l, "visibility", id ? "visible" : "none");
        if (id) map.setFilter(l, ["==", ["get", "id"], id]);
      }
    };
    if (!c) return show(null);
    let cancelled = false;
    const draw = () => {
      if (cancelled || mapRef.current !== map) return;
      show(c.id);
      map.fitBounds(c.bbox, { padding: cb.current.padding, duration: reducedMotion() ? 0 : 1800, essential: true });
    };
    if (map.getSource("corridors")) return draw();
    fetch(`${import.meta.env.BASE_URL}data/corridors.geojson`)
      .then((r) => r.json())
      .then((geo) => {
        if (cancelled || mapRef.current !== map || map.getSource("corridors")) return draw();
        map.addSource("corridors", { type: "geojson", data: geo });
        map.addLayer({
          id: "corridor-glow", type: "line", source: "corridors",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#6EA8FF", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 6, 9, 14], "line-blur": 6, "line-opacity": 0.45 },
        });
        map.addLayer({
          id: "corridor-line", type: "line", source: "corridors",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#CFE0FF", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 9, 3] },
        });
        draw();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.corridor, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to a requested district.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !props.fly) return;
    map.fitBounds(props.fly.bbox, {
      padding: props.padding,
      maxZoom: 9.5,
      duration: reducedMotion() ? 0 : 1800,
      essential: true,
    });
  }, [props.fly, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} className="map" role="region" aria-label="Map of Indian districts coloured by night-time brightness" />;
}

/** Write each district's numbers for the month into feature-state (no geometry re-upload). */
export function pushValues(map: maplibregl.Map, values: Map<string, DistrictValue>) {
  for (const [id, v] of values) {
    const shown = v.mean ?? (v.gap ? v.est ?? null : null);
    const est = v.mean == null && v.est != null && v.gap;
    const lrad = shown != null ? Math.log10(Math.max(shown, 0.01)) : null;
    // Only genuinely bright districts (above ~8 nW) get a halo.
    const glow = lrad == null || est ? 0 : Math.min(Math.max((lrad - 0.9) / 1.0, 0), 1) * 0.5;
    // 3D height: log of brightness, cubed. Log keeps dark rural districts from vanishing;
    // cubing exaggerates the top so metros tower over everything else
    // (Delhi ~520 km, a 2 nW district ~75 km, a 0.1 nW district under 1 km at country zoom).
    const lr = v.gap || v.mean == null ? 0 : Math.max(0, Math.log10(v.mean / 0.05));
    const h = lr ** 3 * 18000;
    map.setFeatureState({ source: "districts", id }, { lrad, gap: v.gap, est, glow, g: v.growth, h });
  }
}

export function tuneBasemap(map: maplibregl.Map) {
  const style = map.getStyle();
  for (const layer of style.layers ?? []) {
    // The basemap's borders come from OpenStreetMap and don't match India's official
    // map. We hide them all and draw India's outline from our own boundary data.
    if (layer.id.startsWith("boundary_")) map.setLayoutProperty(layer.id, "visibility", "none");
  }
  // Basemap labels in English, falling back to the local name where there's no English one
  // (the style otherwise prints Latin + local script, e.g. "PAKISTAN / پاکستان").
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

/**
 * India's outline at ~170 m detail, fetched the first time the map is zoomed past
 * regional level, so the border stays accurate up close without slowing first load.
 */
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

export function addDataLayers(map: maplibregl.Map, districts: DistrictFC, outline: FeatureCollection) {
  // maxzoom 11: MapLibre pre-cuts the districts only down to city zoom (shading is gone
  // by 12.5) instead of its default 18, which roughly halves the first-load work.
  map.addSource("districts", { type: "geojson", data: districts, promoteId: "id", maxzoom: 11, buffer: 64, tolerance: 0.45 });
  map.addSource("india-outline", { type: "geojson", data: outline });
  map.addImage("hatch", hatchPattern(), { pixelRatio: 2 });
  map.addImage("hatch-est", estimatePattern(), { pixelRatio: 2 });

  // Draw under the basemap's rivers, roads and labels so streets show through when
  // the shading fades out at city zoom.
  const before = map.getLayer("waterway") ? "waterway" : undefined;

  map.addLayer(
    { id: "district-fill", type: "fill", source: "districts", paint: { "fill-color": RAD_COLOR, "fill-opacity": fadeOpacity(0.9) } },
    before,
  );
  map.addLayer(
    {
      id: "district-gap",
      type: "fill",
      source: "districts",
      paint: {
        "fill-pattern": "hatch",
        "fill-opacity": [
          "interpolate", ["linear"], ["zoom"],
          3, ["case", ["all", isGap, ["!", isEst]], 1, 0],
          10.5, ["case", ["all", isGap, ["!", isEst]], 0.5, 0],
          12.5, 0,
        ],
      },
    },
    before,
  );
  // Districts coloured from NASA's estimate get a light hatch on top, so they never pass
  // for observed values.
  map.addLayer(
    {
      id: "district-est",
      type: "fill",
      source: "districts",
      paint: {
        "fill-pattern": "hatch-est",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, ["case", isEst, 1, 0], 10.5, ["case", isEst, 0.5, 0], 12.5, 0],
      },
    },
    before,
  );
  // Soft glow: a blurred halo in each district's own colour, stronger for brighter ones.
  map.addLayer(
    {
      id: "district-glow",
      type: "line",
      source: "districts",
      paint: {
        "line-color": RAD_COLOR,
        "line-blur": ["interpolate", ["linear"], ["zoom"], 3, 4, 9, 10],
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 9, 14],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, ["coalesce", ["feature-state", "glow"], 0], 10, 0],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: "district-line",
      type: "line",
      source: "districts",
      paint: {
        "line-color": ["interpolate", ["linear"], ["zoom"], 5, "rgba(11,15,26,0.6)", 11, "rgba(110,130,170,0.45)"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.25, 8, 0.7, 12, 1.2],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: "district-3d",
      type: "fill-extrusion",
      source: "districts",
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": RAD_COLOR,
        // Shrink heights as you zoom in, so the skyline stays readable up close.
        "fill-extrusion-height": [
          "interpolate", ["linear"], ["zoom"],
          4, ["coalesce", ["feature-state", "h"], 0],
          6.5, ["*", ["coalesce", ["feature-state", "h"], 0], 0.25],
          9, ["*", ["coalesce", ["feature-state", "h"], 0], 0.025],
        ],
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.92, 9, 0.85, 11, 0],
        "fill-extrusion-vertical-gradient": true,
      },
    },
    before,
  );
  map.addLayer({
    id: "india-outline",
    type: "line",
    source: "india-outline",
    maxzoom: DETAIL_ZOOM, // closer in, the ~170 m outline takes over (enableDetailOutline)
    paint: {
      "line-color": "#9AA3B8",
      "line-opacity": 0.75,
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 1.4, 12, 2],
    },
  });
  map.addLayer({
    id: "district-hover",
    type: "line",
    source: "districts",
    paint: {
      "line-color": "#E8ECF5",
      "line-width": 1.5,
      "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
    },
  });
  map.addLayer({
    id: "district-compare",
    type: "line",
    source: "districts",
    filter: ["==", ["get", "id"], ""],
    paint: { "line-color": "#E8ECF5", "line-width": 2, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "district-selected",
    type: "line",
    source: "districts",
    filter: ["==", ["get", "id"], ""],
    paint: { "line-color": "#6EA8FF", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2, 10, 3.5] },
  });
}

function setVisible(map: maplibregl.Map, id: string, on: boolean) {
  if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

export function applyLayers(map: maplibregl.Map, base: BaseLayer, threeD: boolean, mode: ColorMode) {
  const districts = base === "districts";
  const flat = districts && !threeD;
  const color = mode === "growth" ? GROWTH_COLOR : RAD_COLOR;

  // The flat fill stays "visible" (just transparent) so hover and click keep working.
  map.setPaintProperty("district-fill", "fill-color", color);
  map.setPaintProperty("district-fill", "fill-opacity", flat ? fadeOpacity(0.9) : 0);
  setVisible(map, "district-gap", flat);
  setVisible(map, "district-est", flat && mode === "radiance");
  setVisible(map, "district-glow", flat && mode === "radiance");
  setVisible(map, "district-3d", districts && threeD);
  map.setPaintProperty("district-3d", "fill-extrusion-color", color);

  // NASA GIBS rasters are added the first time they're chosen, so nobody downloads
  // satellite tiles they never look at.
  for (const [key, r] of Object.entries(RASTERS)) {
    const id = `gibs-${key}`;
    const on = base === key;
    if (on && !map.getSource(id)) {
      map.addSource(id, { type: "raster", tiles: [r.url], tileSize: 256, maxzoom: r.maxzoom, attribution: GIBS_CREDIT });
      map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.95 } }, map.getLayer("waterway") ? "waterway" : undefined);
    }
    setVisible(map, id, on);
  }
}

function fadeOpacity(near: number): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 3, near, 8, near, 10.5, near * 0.45, 12.5, 0];
}

function bindInteractions(map: maplibregl.Map, cb: React.RefObject<Props>) {
  let hovered: string | null = null;
  const setHover = (id: string | null) => {
    if (hovered) map.setFeatureState({ source: "districts", id: hovered }, { hover: false });
    hovered = id;
    if (id) map.setFeatureState({ source: "districts", id }, { hover: true });
  };

  map.on("mousemove", "district-fill", (e) => {
    const id = e.features?.[0]?.properties?.id as string | undefined;
    if (!id) return;
    if (id !== hovered) setHover(id);
    map.getCanvas().style.cursor = "pointer";
    cb.current.onHover({ id, x: e.point.x, y: e.point.y });
  });
  map.on("mouseleave", "district-fill", () => {
    setHover(null);
    map.getCanvas().style.cursor = "";
    cb.current.onHover(null);
  });
  // A double-click zooms the map. MapLibre reports its two clicks first, so a click only
  // selects once 250 ms pass without a second one.
  let pending: ReturnType<typeof setTimeout> | undefined;
  map.on("click", (e) => {
    clearTimeout(pending);
    const f = map.queryRenderedFeatures(e.point, { layers: ["district-fill"] })[0];
    const id = (f?.properties?.id as string) ?? null;
    pending = setTimeout(() => cb.current.onSelect(id), 250);
  });
  map.on("dblclick", () => clearTimeout(pending));
}

/** Light diagonal lines over a transparent background: "this colour is NASA's estimate". */
function estimatePattern(): ImageData {
  const size = 16;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "rgba(232,236,245,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const o of [-size, 0, size]) {
    ctx.moveTo(o, size);
    ctx.lineTo(o + size, 0);
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** Diagonal hatching for "no clear data" districts. */
function hatchPattern(): ImageData {
  const size = 16;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(29,34,53,0.85)";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(154,163,184,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const o of [-size, 0, size]) {
    ctx.moveTo(o, size);
    ctx.lineTo(o + size, 0);
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}
