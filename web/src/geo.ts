// Which district contains a point (for "Find my district"). Runs on the simplified
// boundaries already loaded for the map, so it needs no extra download.
import type { Position } from "geojson";
import type { AppData } from "./data";

function inRing(x: number, y: number, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x: number, y: number, rings: Position[][]) {
  // first ring is the outline, the rest are holes
  return inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h));
}

export function districtAt(data: AppData, lon: number, lat: number): string | null {
  for (const f of data.districts.features) {
    const d = data.byId.get(f.properties.id);
    if (!d) continue;
    const [x0, y0, x1, y1] = d.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    const g = f.geometry;
    if (g.type === "Polygon" && inPolygon(lon, lat, g.coordinates)) return d.id;
    if (g.type === "MultiPolygon" && g.coordinates.some((p) => inPolygon(lon, lat, p))) return d.id;
  }
  return null;
}
