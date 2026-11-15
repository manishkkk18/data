import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre v6 finds its worker relative to its own file, which bundlers move. Let Vite
// bundle the worker and hand MapLibre the URL instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);
import type { ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { RAD_STOPS, type BBox, type DistrictFC } from "../data";

// OpenFreeMap: free, no API key, no view limits. Attribution comes from the style.
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const INDIA: BBox = [68.1, 6.7, 97.4, 37.1];

export type DistrictValue = { mean: number | null; gap: boolean };
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

const isGap: ExpressionSpecification = ["boolean", ["feature-state", "gap"], false];

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
      zoom: 1.4,
      maxPitch: 70,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio, 2), // keeps phones smooth
    });
    mapRef.current = map;

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
      setReady(true);

      // Opening: a moment on the globe, then fly in to India.
      const pad = cb.current.padding;
      if (reducedMotion()) map.fitBounds(INDIA, { padding: pad, duration: 0 });
      else setTimeout(() => map.fitBounds(INDIA, { padding: pad, duration: 4200, essential: true }), 600);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Push this month's values into feature-state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [id, v] of props.values) {
      const lrad = v.mean != null ? Math.log10(Math.max(v.mean, 0.01)) : null;
      // Only genuinely bright districts (above ~8 nW) get a halo.
      const glow = lrad == null ? 0 : Math.min(Math.max((lrad - 0.9) / 1.0, 0), 1) * 0.5;
      map.setFeatureState({ source: "districts", id }, { lrad, gap: v.gap, glow });
    }
  }, [props.values, ready]);

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
    map.fitBounds(props.fly.bbox, {
      padding: props.padding,
      maxZoom: 9.5,
      duration: reducedMotion() ? 0 : 1800,
      essential: true,
    });
  }, [props.fly, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} className="map" role="region" aria-label="Map of Indian districts coloured by night-time brightness" />;
}

function tuneBasemap(map: maplibregl.Map) {
  const style = map.getStyle();
  for (const layer of style.layers ?? []) {
    // The basemap's borders come from OpenStreetMap and don't match India's official
    // map. We hide them all and draw India's outline from our own boundary data.
    if (layer.id.startsWith("boundary_")) map.setLayoutProperty(layer.id, "visibility", "none");
  }
  if (map.getLayer("background")) map.setPaintProperty("background", "background-color", "#0B0F1A");
  if (map.getLayer("water")) map.setPaintProperty("water", "fill-color", "#0D1424");
  try {
    map.setSky({ "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] });
  } catch {
    /* atmosphere is decorative */
  }
}

function addDataLayers(map: maplibregl.Map, districts: DistrictFC, outline: FeatureCollection) {
  map.addSource("districts", { type: "geojson", data: districts, promoteId: "id" });
  map.addSource("india-outline", { type: "geojson", data: outline });
  map.addImage("hatch", hatchPattern(), { pixelRatio: 2 });

  // Draw under the basemap's rivers, roads and labels so streets show through when
  // the shading fades out at city zoom.
  const before = map.getLayer("waterway") ? "waterway" : undefined;
  const fade = (near: number) => ["interpolate", ["linear"], ["zoom"], 3, near, 8, near, 10.5, near * 0.45, 12.5, 0] as ExpressionSpecification;

  map.addLayer(
    { id: "district-fill", type: "fill", source: "districts", paint: { "fill-color": RAD_COLOR, "fill-opacity": fade(0.9) } },
    before,
  );
  map.addLayer(
    {
      id: "district-gap",
      type: "fill",
      source: "districts",
      paint: {
        "fill-pattern": "hatch",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, ["case", isGap, 1, 0], 10.5, ["case", isGap, 0.5, 0], 12.5, 0],
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
  map.addLayer({
    id: "india-outline",
    type: "line",
    source: "india-outline",
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
    id: "district-selected",
    type: "line",
    source: "districts",
    filter: ["==", ["get", "id"], ""],
    paint: { "line-color": "#6EA8FF", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2, 10, 3.5] },
  });
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
  map.on("click", (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ["district-fill"] })[0];
    cb.current.onSelect((f?.properties?.id as string) ?? null);
  });
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
