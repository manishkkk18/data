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
  sum?: (number | null)[][]; // older files only
  national_avg?: (number | null)[]; // newer files: total light / total observed area, per month
  est?: (number | null)[][]; // NASA's gap-filled estimate, only where `mean` is a gap
  lit: (number | null)[][];
  valid: (number | null)[][];
  /** Added on load: false for months in the timeline that have no processed data. */
  loaded?: boolean[];
};

export type DistrictProps = { id: string; name: string; state: string };
export type DistrictFC = FeatureCollection<Geometry, DistrictProps>;
export type BBox = [number, number, number, number];

export type District = DistrictProps & { bbox: BBox; search: string; aliases: string[] };

/** Our state trends next to ISRO Bhuvan's, built by pipeline/nightlights/crosscheck.py. */
export type CrossCheck = {
  generated: string;
  bhuvan_url: string;
  base_year: number;
  break_year: number;
  ours_source: Record<string, string>;
  agreement: { from: number; to: number; spearman: number | null; states: number } | null;
  excluded: string[];
  states: { state: string; ours: Record<string, number>; bhuvan: Record<string, number> }[];
};

/** Diwali-night brightness for major cities, from pipeline/nightlights/diwali.py. */
export type Diwali = {
  window: number;
  baseline_offsets: number[];
  cities: string[];
  years: {
    year: number;
    date: string;
    nights: Record<string, Record<string, number | null>>; // offset -> city -> radiance
    unavailable: number[];
    effect: Record<string, number | null>; // % vs median of normal nights
    clear_baseline_nights: Record<string, number>;
    // top districts that year (lit, >= 5 clear normal nights), from the pipeline
    district_top?: { id: string; effect: number; night: number; base: number; clear: number }[];
  }[];
};

/** Diwali effect for every district (pipeline/nightlights/diwali.py), loaded on demand. */
export type DiwaliDistricts = {
  window: number;
  baseline_offsets: number[];
  ids: string[];
  years: {
    year: number;
    date: string;
    unavailable: number[];
    effect: (number | null)[]; // per district, aligned with ids
    clear_baseline_nights: number[];
    nights: Record<string, (number | null)[]>; // offset -> per district
  }[];
};

/** NASA annual composites (VNP46A4), used for the long-term line on the trend chart. */
export type Yearly = { years: number[]; ids: string[]; mean: (number | null)[][]; valid: (number | null)[][] };

export type AppData = {
  districts: DistrictFC;
  outline: FeatureCollection;
  monthly: Monthly;
  yearly: Yearly | null; // optional: only once the annual run has been done
  crosscheck: CrossCheck | null; // optional
  diwali: Diwali | null; // optional
  optionalFiles: string[]; // optional data files present in this build (manifest.json)
  byId: Map<string, District>;
  index: Map<string, number>; // district id -> column in monthly arrays
};

export async function loadData(): Promise<AppData> {
  const get = (f: string) =>
    fetch(`${import.meta.env.BASE_URL}data/${f}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${f} (${r.status})`);
      return r.json();
    });
  // Optional files are listed in manifest.json by the build, so we only ask for files
  // that exist (no 404s in the console for, say, yearly data not produced yet).
  const manifest = get("manifest.json").catch(() => ({ files: [] as string[] })) as Promise<{ files: string[] }>;
  const optional = (f: string) => manifest.then((m) => (m.files.includes(f) ? get(f) : null));
  const [districts, outline, monthly, yearly, crosscheck, diwali] = (await Promise.all([
    get("districts.geojson"),
    get("india_outline.geojson"),
    get("monthly.json"),
    optional("yearly.json"),
    optional("crosscheck.json"),
    optional("diwali.json"),
  ])) as [DistrictFC, FeatureCollection, Monthly, Yearly | null, CrossCheck | null, Diwali | null];

  const byId = new Map<string, District>();
  for (const f of districts.features) {
    const p = f.properties;
    const aliases = ALIASES[p.id] ?? [];
    const shown = { ...p, ...DISPLAY_OVERRIDES[p.id] };
    if (DISPLAY_OVERRIDES[p.id]) f.properties = { ...f.properties, ...DISPLAY_OVERRIDES[p.id] };
    byId.set(p.id, { ...shown, aliases, bbox: bboxOf(f.geometry), search: fold(`${shown.name} ${shown.state} ${aliases.join(" ")}`) });
  }
  const index = new Map(monthly.ids.map((id, i) => [id, i]));
  return { districts, outline, monthly: fillMonthGaps(monthly), yearly, crosscheck, diwali, optionalFiles: (await manifest).files, byId, index };
}

/**
 * Areas inside India's official outline that the boundary source has no district data
 * for. The source covers Gilgit-Baltistan, PoK, Shaksgam and Siachen with one placeholder
 * named "Data Not Available" (filed under Ladakh). We show it under a clear name, keep its
 * shading, and leave it out of ranks and insights since it isn't a district.
 */
export const NOT_A_DISTRICT = new Set(["ladakh--data-not-available"]);
const DISPLAY_OVERRIDES: Record<string, { name: string; state: string }> = {
  "ladakh--data-not-available": { name: "Gilgit-Baltistan & PoK (no district data)", state: "Ladakh / Jammu and Kashmir" },
};

/**
 * Other names people search for. Keys are district ids; the source uses older or
 * different spellings (Bangalore, Gurgaon, Ahmadabad) or names the district rather
 * than its main city (Ernakulam for Kochi).
 */
const ALIASES: Record<string, string[]> = {
  "karnataka--bangalore": ["Bengaluru", "Bengaluru Urban"],
  "karnataka--bangalore-rural": ["Bengaluru Rural"],
  "karnataka--mysore": ["Mysuru"],
  "karnataka--gulbarga": ["Kalaburagi"],
  "karnataka--belgaum": ["Belagavi"],
  "karnataka--shimoga": ["Shivamogga"],
  "karnataka--tumkur": ["Tumakuru"],
  "karnataka--chikmagalur": ["Chikkamagaluru"],
  "karnataka--dakshina-kannada": ["Mangaluru", "Mangalore"],
  "karnataka--dharwad": ["Hubli", "Hubballi"],
  "haryana--gurgaon": ["Gurugram"],
  "haryana--mewat": ["Nuh"],
  "gujarat--ahmadabad": ["Ahmedabad", "Amdavad"],
  "gujarat--vadodara": ["Baroda"],
  "uttar-pradesh--allahabad": ["Prayagraj"],
  "uttar-pradesh--faizabad": ["Ayodhya"],
  "uttar-pradesh--gautam-buddha-nagar": ["Noida", "Greater Noida"],
  "uttar-pradesh--kanpur-nagar": ["Kanpur"],
  "madhya-pradesh--hoshangabad": ["Narmadapuram"],
  "maharashtra--aurangabad": ["Chhatrapati Sambhajinagar"],
  "maharashtra--osmanabad": ["Dharashiv"],
  "maharashtra--ahmadnagar": ["Ahilyanagar", "Ahmednagar"],
  "maharashtra--mumbai": ["Bombay"],
  "maharashtra--pune": ["Poona"],
  "maharashtra--raigarh": ["Raigad"],
  "telangana--hyderabad": ["Secunderabad"],
  "kerala--ernakulam": ["Kochi", "Cochin"],
  "kerala--thiruvananthapuram": ["Trivandrum"],
  "kerala--kozhikode": ["Calicut"],
  "kerala--thrissur": ["Trichur"],
  "tamil-nadu--chennai": ["Madras"],
  "tamil-nadu--tiruchirappalli": ["Trichy"],
  "tamil-nadu--kancheepuram": ["Kanchipuram"],
  "west-bengal--kolkata": ["Calcutta"],
  "andhra-pradesh--visakhapatnam": ["Vizag"],
  "odisha--khordha": ["Bhubaneswar", "Khurda"],
  "assam--kamrup-metropolitan": ["Guwahati"],
  "meghalaya--east-khasi-hills": ["Shillong"],
  "tripura--west-tripura": ["Agartala"],
  "arunachal-pradesh--papum-pare": ["Itanagar"],
  "goa--north-goa": ["Panaji", "Panjim"],
  "punjab--sahibzada-ajit-singh-nagar": ["Mohali"],
};

/**
 * Make the timeline continuous: every calendar month from the first to the last one
 * processed. Months with no data get all-null rows, so the map shows them as gaps
 * instead of silently skipping from, say, March to June.
 */
export function fillMonthGaps(m: Monthly): Monthly {
  if (m.months.length === 0) return { ...m, loaded: [] };
  const all: string[] = [];
  let [y, mo] = m.months[0].split("-").map(Number);
  const last = m.months[m.months.length - 1];
  for (;;) {
    const key = `${y}-${String(mo).padStart(2, "0")}`;
    all.push(key);
    if (key >= last) break;
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  const at = new Map(m.months.map((k, i) => [k, i]));
  const empty = m.ids.map(() => null);
  const pick = (rows: (number | null)[][]) => all.map((k) => (at.has(k) ? rows[at.get(k)!] : empty));
  return {
    ...m,
    months: all,
    mean: pick(m.mean),
    sum: m.sum ? pick(m.sum) : undefined,
    est: m.est ? pick(m.est) : undefined,
    national_avg: m.national_avg ? all.map((k) => (at.has(k) ? m.national_avg![at.get(k)!] : null)) : undefined,
    lit: pick(m.lit),
    valid: pick(m.valid),
    loaded: all.map((k) => at.has(k)),
  };
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
  stateRank: Map<string, [number, number]>; // [rank within state, districts with data in state]
  brighterThan2015: number | null; // null when there's no 2015 baseline yet
};

export function summarise(m: Monthly, mi: number, stateOf: (id: string) => string = () => ""): MonthSummary {
  const mean = m.mean[mi];
  const sum = m.sum?.[mi];
  let totalSum = 0;
  let totalPixels = 0;
  const ranked: [string, number][] = [];
  m.ids.forEach((id, i) => {
    const v = mean[i];
    if (v == null || NOT_A_DISTRICT.has(id)) return;
    ranked.push([id, v]);
    const s = sum?.[i];
    // older files: mean = sum / observed pixels, so pixels = sum / mean
    if (s != null && v > 0) {
      totalSum += s;
      totalPixels += s / v;
    }
  });
  ranked.sort((a, b) => b[1] - a[1]);
  const rank = new Map(ranked.map(([id], i) => [id, i + 1]));
  const stateCounts = new Map<string, number>();
  const stateRank = new Map<string, [number, number]>();
  for (const [id] of ranked) {
    const st = stateOf(id);
    const r = (stateCounts.get(st) ?? 0) + 1;
    stateCounts.set(st, r);
    stateRank.set(id, [r, 0]);
  }
  for (const [id, v] of stateRank) v[1] = stateCounts.get(stateOf(id)) ?? 0;

  const base = baselineIndex(m, mi);
  let brighter: number | null = null;
  if (base != null) {
    brighter = 0;
    m.ids.forEach((id, i) => {
      const now = mean[i];
      const then = m.mean[base][i];
      if (!NOT_A_DISTRICT.has(id) && now != null && then != null && now > then) brighter! += 1;
    });
  }

  return {
    avg: m.national_avg?.[mi] ?? (totalPixels > 0 ? totalSum / totalPixels : null),
    withData: ranked.length,
    gaps: m.ids.filter((id) => !NOT_A_DISTRICT.has(id)).length - ranked.length,
    rank,
    stateRank,
    brighterThan2015: brighter,
  };
}

/** Same calendar month in 2015, so seasonal swings (monsoon, festivals) cancel out. */
export function baselineIndex(m: Monthly, mi: number): number | null {
  const month = m.months[mi].slice(5);
  const i = m.months.indexOf(`2015-${month}`);
  return i >= 0 && i !== mi && m.loaded?.[i] !== false ? i : null;
}

/** Actual % change vs the same month in 2015. */
export function growthPct(m: Monthly, col: number, mi: number): number | null {
  const b = baselineIndex(m, mi);
  if (b == null) return null;
  const now = m.mean[mi][col];
  const then = m.mean[b][col];
  if (now == null || then == null || then <= 0) return null;
  return ((now - then) / then) * 100;
}

/**
 * Change for colouring the map, as log2 of the ratio (0 = no change, 1 = doubled).
 * A small offset keeps near-dark districts, where 0.02 -> 0.06 would read as "+200%",
 * from swamping the map with noise.
 */
export const GROWTH_OFFSET = 0.3;
export function growthLog2(m: Monthly, col: number, mi: number): number | null {
  const b = baselineIndex(m, mi);
  if (b == null) return null;
  const now = m.mean[mi][col];
  const then = m.mean[b][col];
  if (now == null || then == null) return null;
  return Math.log2((now + GROWTH_OFFSET) / (then + GROWTH_OFFSET));
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

// Growth since 2015, by log2 ratio: dimmer = red, unchanged = slate, brighter = blue.
export const GROWTH_STOPS: [number, string][] = [
  [-1, "#FF7A7A"],
  [-0.3, "#7A3F4A"],
  [0, "#262C40"],
  [0.4, "#2F4C85"],
  [1, "#6EA8FF"],
  [2, "#D6E6FF"],
];
export const GROWTH_TICKS: [number, string][] = [
  [-1, "−50%"],
  [0, "0"],
  [1, "+100%"],
  [2, "+300%"],
];

// ---- Insights ---------------------------------------------------------------------

/** The latest month that has data (the timeline may end in a month still to come). */
export function latestLoaded(m: Monthly): number {
  for (let i = m.months.length - 1; i >= 0; i--) if (m.loaded?.[i] !== false) return i;
  return m.months.length - 1;
}

/** The latest processed month that also has its 2015 counterpart processed. */
export function latestWithBaseline(m: Monthly): number | null {
  for (let i = m.months.length - 1; i >= 0; i--) {
    if (m.loaded?.[i] !== false && baselineIndex(m, i) != null) return i;
  }
  return null;
}

export function topBrightest(m: Monthly, mi: number, n = 5) {
  return m.ids
    .map((id, i) => ({ id, value: m.mean[mi][i] }))
    .filter((r): r is { id: string; value: number } => r.value != null && !NOT_A_DISTRICT.has(r.id))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/**
 * Biggest % rise vs the same month in 2015, among districts that were already lit
 * (>= minBase nW/cm²/sr) in 2015. Without that floor, near-dark districts going from
 * 0.05 to 0.3 would top the list at "+500%".
 */
export function topGrowth(m: Monthly, mi: number, n = 5, minBase = 1) {
  const b = baselineIndex(m, mi);
  if (b == null) return [];
  return m.ids
    .map((id, i) => {
      const now = m.mean[mi][i];
      const then = m.mean[b][i];
      return now == null || then == null || then < minBase || NOT_A_DISTRICT.has(id) ? null : { id, pct: ((now - then) / then) * 100, now, then };
    })
    .filter((r): r is { id: string; pct: number; now: number; then: number } => r != null)
    .sort((a, b2) => b2.pct - a.pct)
    .slice(0, n);
}

/** Months that actually have data, for month pickers. */
export function loadedMonths(m: Monthly): number[] {
  return m.months.map((_, i) => i).filter((i) => m.loaded?.[i] !== false);
}
