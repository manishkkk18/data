import { useMemo } from "react";
import type { FeatureCollection, Position } from "geojson";

/** While the map loads: India's outline drawing itself in glowing amber. */
export default function LoadingOutline({ outline, label = "Finding the fires" }: { outline: FeatureCollection; label?: string }) {
  const d = useMemo(() => {
    // Simple equirectangular projection, squeezed by cos(latitude) so India keeps its shape.
    const k = Math.cos((22 * Math.PI) / 180);
    const px = ([lon, lat]: Position) => `${((lon - 68) * k * 10).toFixed(1)} ${((37.5 - lat) * 10).toFixed(1)}`;
    const rings: Position[][] = [];
    for (const f of outline.features) {
      const g = f.geometry;
      if (g.type === "Polygon") rings.push(g.coordinates[0]);
      if (g.type === "MultiPolygon") g.coordinates.forEach((p) => rings.push(p[0]));
    }
    // Skip tiny islands: they read as noise at this size.
    return rings
      .filter((r) => r.length > 40)
      .map((r) => `M${r.filter((_, i) => i % 3 === 0).map(px).join("L")}Z`)
      .join("");
  }, [outline]);

  return (
    <div className="map-loading-outline" role="status" aria-label="Loading the map">
      <svg viewBox="0 0 280 320" aria-hidden="true">
        <path d={d} />
      </svg>
      <span className="loading-label">{label}<span className="dots" aria-hidden="true" /></span>
    </div>
  );
}
