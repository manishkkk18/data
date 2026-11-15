// Loading the static data files and deriving the numbers the UI shows.

import type { FeatureCollection, Geometry, Position } from "geojson";

export type Monthly = {
  product: string;
  collection: string;
  units: string;
  lit_threshold: number;
  min_valid_pct: number;
  generated: string;
  ids: string[];
  months: string[]; // "YYYY-MM"
  mean: (number | null)[][]; // [month][district], null = gap
  sum: (number | null)[][];
  lit: (number | null)[][];
  valid: (number | null)[][];
};

export type DistrictProps = { id: string; name: string; state: string };
export type DistrictFC = FeatureCollection<Geometry, DistrictProps>;
export type BBox = [number, number, number, number];

export type District = DistrictProps & { bbox: BBox; search: string };

export type AppData = {
  districts: DistrictFC;
  outline: FeatureCollection;
  monthly: Monthly;
  byId: Map<string, District>;
  index: Map<string, number>; // district id -> column in monthly arrays
};

export async function loadData(): Promise<AppData> {
  const get = (f: string) =>
    fetch(`${import.meta.env.BASE_URL}data/${f}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${f} (${r.status})`);
      return r.json();
    });
  const [districts, outline, monthly] = (await Promise.all([
    get("districts.geojson"),
    get("india_outline.geojson"),
    get("monthly.json"),
  ])) as [DistrictFC, FeatureCollection, Monthly];

  const byId = new Map<string, District>();
  for (const f of districts.features) {
    const p = f.properties;
    byId.set(p.id, { ...p, bbox: bboxOf(f.geometry), search: fold(`${p.name} ${p.state}`) });
  }
  const index = new Map(monthly.ids.map((id, i) => [id, i]));
  return { districts, outline, monthly, byId, index };
}

export function fold(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function bboxOf(g: Geometry): BBox {
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (c: unknown): void => {
    if (typeof (c as Position)[0] === "number") {
      const [x, y] = c as Position;
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    } else (c as unknown[]).forEach(visit);
  };
  if ("coordinates" in g) visit(g.coordinates);
  return b;
}

// ---- Derived numbers -------------------------------------------------------------

export type MonthSummary = {
  avg: number | null; // national average radiance over observed land
  withData: number;
  gaps: number;
  rank: Map<string, number>; // 1 = brightest
  brighterThan2015: number | null; // null when there's no 2015 baseline yet
};

export function summarise(m: Monthly, mi: number): MonthSummary {
  const mean = m.mean[mi];
  const sum = m.sum[mi];
  let totalSum = 0;
  let totalPixels = 0;
  const ranked: [string, number][] = [];
  m.ids.forEach((id, i) => {
    const v = mean[i];
    if (v == null) return;
    ranked.push([id, v]);
    const s = sum[i];
    // mean = sum / observed pixels, so pixels = sum / mean (skip fully dark districts)
    if (s != null && v > 0) {
      totalSum += s;
      totalPixels += s / v;
    }
  });
  ranked.sort((a, b) => b[1] - a[1]);
  const rank = new Map(ranked.map(([id], i) => [id, i + 1]));

  const base = baselineIndex(m, mi);
  let brighter: number | null = null;
  if (base != null) {
    brighter = 0;
    m.ids.forEach((_, i) => {
      const now = mean[i];
      const then = m.mean[base][i];
      if (now != null && then != null && now > then) brighter! += 1;
    });
  }

  return {
    avg: totalPixels > 0 ? totalSum / totalPixels : null,
    withData: ranked.length,
    gaps: m.ids.length - ranked.length,
    rank,
    brighterThan2015: brighter,
  };
}

/** Same calendar month in 2015, so seasonal swings (monsoon, festivals) cancel out. */
export function baselineIndex(m: Monthly, mi: number): number | null {
  const month = m.months[mi].slice(5);
  const i = m.months.indexOf(`2015-${month}`);
  return i >= 0 && i !== mi ? i : null;
}

/** % change vs the same month `years` earlier, or null if either side is missing. */
export function changePct(m: Monthly, col: number, mi: number, years: number): number | null {
  const [y, mo] = m.months[mi].split("-");
  const j = m.months.indexOf(`${Number(y) - years}-${mo}`);
  if (j < 0) return null;
  const now = m.mean[mi][col];
  const then = m.mean[j][col];
  if (now == null || then == null || then <= 0) return null;
  return ((now - then) / then) * 100;
}

// ---- Formatting ------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(ym: string, short = false) {
  const [y, m] = ym.split("-").map(Number);
  const name = MONTHS[m - 1];
  return `${short ? name.slice(0, 3) : name} ${y}`;
}

export function fmtRad(v: number | null | undefined) {
  if (v == null) return "–";
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function fmtPct(v: number | null | undefined, signed = false) {
  if (v == null) return "–";
  const s = `${Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
  return signed && v > 0 ? `+${s}` : s;
}

// ---- Colour scale (shared by map and legend) ---------------------------------------
// Log scale: dark navy -> amber -> near-white. Values in nW/cm²/sr.

export const RAD_STOPS: [number, string][] = [
  [0.05, "#131A2B"],
  [0.3, "#241F1A"],
  [1, "#4A3214"],
  [4, "#94601C"],
  [15, "#FFB547"],
  [40, "#FFE2A0"],
  [90, "#FFF9EE"],
];

export const LEGEND_TICKS = [0.1, 1, 10, 50];
