import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { addDataLayers, applyLayers, enableDetailOutline, pushValues, STYLE_URL, tuneBasemap, type DistrictValue } from "./MapView";
import type { DistrictFC } from "../data";

type Props = {
  main: maplibregl.Map; // the main map shows the "before" month underneath
  districts: DistrictFC;
  outline: FeatureCollection;
  after: Map<string, DistrictValue>;
  beforeLabel: string;
  afterLabel: string;
};

/**
 * Before/after swipe: a second map showing the "after" month sits on top of the main
 * map, clipped to the right of a draggable handle, and follows the main map's camera.
 * The overlay ignores the mouse, so panning and zooming still work on the map below.
 */
export default function SwipeCompare({ main, districts, outline, after, beforeLabel, afterLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const overlay = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState(50); // handle position, % from the left

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE_URL,
      interactive: false,
      attributionControl: false,
      center: main.getCenter(),
      zoom: main.getZoom(),
      bearing: main.getBearing(),
      pitch: main.getPitch(),
      // A second map doubles the GPU work, so draw it at a slightly lower resolution.
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
    });
    overlay.current = map;
    map.once("style.load", () => {
      map.setProjection({ type: "globe" });
      tuneBasemap(map);
      addDataLayers(map, districts, outline);
      applyLayers(map, "districts", false, "radiance");
      enableDetailOutline(map);
      setReady(true);
    });
    const follow = () => map.jumpTo({ center: main.getCenter(), zoom: main.getZoom(), bearing: main.getBearing(), pitch: main.getPitch() });
    main.on("move", follow);
    return () => {
      main.off("move", follow);
      map.remove();
      overlay.current = null;
    };
  }, [main, districts, outline]);

  useEffect(() => {
    if (ready && overlay.current) pushValues(overlay.current, after);
  }, [after, ready]);

  const moveTo = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    setPos(Math.min(Math.max(((clientX - r.left) / r.width) * 100, 2), 98));
  };

  return (
    <div className="swipe" ref={wrap}>
      {/* Inline position: MapLibre's stylesheet sets .maplibregl-map { position: relative },
          which in the production CSS order would collapse this container to zero height. */}
      <div
        className="swipe-map"
        ref={container}
        style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${pos}%)` }}
        aria-hidden="true"
      />
      <span className="swipe-label left">{beforeLabel}</span>
      <span className="swipe-label right">{afterLabel}</span>
      <div className="swipe-line" style={{ left: `${pos}%` }} aria-hidden="true" />
      <button
        type="button"
        className="swipe-handle"
        style={{ left: `${pos}%` }}
        role="slider"
        aria-label={`Swipe between ${beforeLabel} (left) and ${afterLabel} (right)`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${Math.round(pos)}% showing ${beforeLabel}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 3;
          if (e.key === "ArrowLeft") setPos((p) => Math.max(p - step, 2));
          else if (e.key === "ArrowRight") setPos((p) => Math.min(p + step, 98));
          else if (e.key === "Home") setPos(2);
          else if (e.key === "End") setPos(98);
          else return;
          e.preventDefault();
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M7 5l-4 5 4 5M13 5l4 5-4 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
