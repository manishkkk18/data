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

// Approximate area in km² (equirectangular per ring; plenty for weighting districts in a city).
function ringArea(ring: Position[]) {
  let s = 0;
  const lat0 = (ring.reduce((a, p) => a + p[1], 0) / ring.length) * (Math.PI / 180);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return Math.abs(s / 2) * 111.32 * 111.32 * Math.cos(lat0);
}
function polyArea(rings: Position[][]) {
  return ringArea(rings[0]) - rings.slice(1).reduce((a, h) => a + ringArea(h), 0);
}

/** Area (km²) of each district, by id. */
export function districtAreas(data: AppData): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of data.districts.features) {
    const g = f.geometry;
    const a = g.type === "Polygon" ? polyArea(g.coordinates) : g.type === "MultiPolygon" ? g.coordinates.reduce((s, p) => s + polyArea(p), 0) : 0;
    out.set(f.properties.id, a);
  }
  return out;
}

// The 8 major cities, as sets of districts (same as the pipeline's Diwali cities).
const DELHI = ["central", "east", "new-delhi", "north", "north-east", "north-west", "shahdara", "south", "south-east", "south-west", "west"].map((d) => `delhi--${d}`);
export const CITIES: { name: string; ids: string[]; pick: string }[] = [
  { name: "Delhi", ids: DELHI, pick: "delhi--new-delhi" },
  { name: "Mumbai", ids: ["maharashtra--mumbai", "maharashtra--mumbai-suburban"], pick: "maharashtra--mumbai" },
  { name: "Kolkata", ids: ["west-bengal--kolkata"], pick: "west-bengal--kolkata" },
  { name: "Ahmedabad", ids: ["gujarat--ahmadabad"], pick: "gujarat--ahmadabad" },
  { name: "Jaipur", ids: ["rajasthan--jaipur"], pick: "rajasthan--jaipur" },
  { name: "Lucknow", ids: ["uttar-pradesh--lucknow"], pick: "uttar-pradesh--lucknow" },
  { name: "Patna", ids: ["bihar--patna"], pick: "bihar--patna" },
  { name: "Hyderabad", ids: ["telangana--hyderabad"], pick: "telangana--hyderabad" },
];

/** Area-weighted city brightness in month `mi`; null unless every district in the city was observed. */
export function cityMean(data: AppData, areas: Map<string, number>, ids: string[], mi: number): number | null {
  let s = 0;
  let w = 0;
  for (const id of ids) {
    const col = data.index.get(id);
    const v = col == null ? null : data.monthly.mean[mi][col];
    if (v == null) return null;
    const a = areas.get(id) ?? 0;
    s += v * a;
    w += a;
  }
  return w > 0 ? s / w : null;
}
