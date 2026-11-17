// Loads the pipeline's static JSON (never an API) and holds the small helpers the UI shares.
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";

export type BBox = [number, number, number, number];

// ---- Files written by pipeline/smokewatch/run.py -------------------------------------------
type FiresFile = {
  generated_utc: string;
  method: "api" | "public-7d";
  window_days: number;
  t0: string;
  latest_detection_utc: string | null;
  satellites: string[];
  district_ids: string[];
  rows: [lon: number, lat: number, tMin: number, frp: number, conf: string, sat: number, night: 0 | 1, district: number][];
};
type SummaryFile = {
  same_day_last_year: { available: boolean; reason?: string; date?: string; count?: number; last_year_date?: string; last_year_count?: number; sensor?: string } | null;
};
export type WindFile = {
  points: [number, number][]; // last point is Delhi
  times: string[];
  levels: Record<WindLevel, ([speed: number, dirFrom: number] | null)[][]>;
};
export type WindLevel = "10m" | "850hPa";
type AqRow = { parameter: "pm25" | "pm10"; value: number | null };
export type AqFile = {
  generated_utc: string;
  providers: string[];
  sensors_recent: number;
  hourly: (AqRow & { hour_utc: string; n_stations: number })[];
  daily: (AqRow & { date: string; n_hours: number })[];
};
/** Back-trajectories and upwind fire shares (pipeline/smokewatch/upwind.py). share is 0–1. */
export type Shares = [name: string, share: number][];
export type Arrival = { t: string; complete: boolean; paths: Record<WindLevel, [number, number][]>; load: number; states: Shares; districts: Shares };
export type UpwindDay = { date: string; arrivals: number; complete: boolean; load: number; states: Shares; districts: Shares };
export type UpwindFile = {
  generated_utc: string;
  note: string;
  method: { hours_back: number; arrival_every_h: number; corridor_km: number; corridor_growth_km_per_h: number; decay_h: number; time_slack_h: number };
  arrivals: Arrival[];
  days: UpwindDay[];
};
export type Meta = {
  generated_utc: string;
  fires?: { updated_utc: string; method: string; latest_detection_utc: string | null };
  wind?: { updated_utc?: string; latest_utc?: string | null; error?: string };
  aq?: { updated_utc?: string; error?: string };
  upwind?: { updated_utc?: string; error?: string };
};

// ---- What the app works with -----------------------------------------------------------------
export type Fire = { lon: number; lat: number; t: number; frp: number; conf: string; sat: string; night: boolean; district: string | null };
export type DistrictProps = { id: string; district: string; state: string };
export type DistrictFC = FeatureCollection<Polygon | MultiPolygon, DistrictProps>;
export type District = DistrictProps & { name: string; bbox: BBox; search: string; aliases: string[] };

export type AppData = {
  fires: Fire[]; // sorted by time
  firesMethod: FiresFile["method"];
  latestDetection: number | null;
  generated: number;
  days: string[]; // IST dates (YYYY-MM-DD) covered by the fire window, oldest first
  districts: DistrictFC;
  outline: FeatureCollection;
  byId: Map<string, District>;
  wind: WindFile | null;
  aq: AqFile | null;
  upwind: UpwindFile | null;
  seasons: SeasonIndex | null;
  lastYear: SummaryFile["same_day_last_year"];
  meta: Meta;
};

const BASE = import.meta.env.BASE_URL;
const getJson = async <T,>(f: string): Promise<T> => {
  const r = await fetch(`${BASE}data/${f}`);
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  return r.json() as Promise<T>;
};

export async function loadData(): Promise<AppData> {
  const manifest = await getJson<{ files: string[] }>("manifest.json").catch(() => ({ files: [] as string[] }));
  const opt = <T,>(f: string) => (manifest.files.includes(f) ? getJson<T>(f).catch(() => null) : Promise.resolve(null));
  const [firesFile, summary, districts, outline, meta, wind, aq, upwind, seasons] = await Promise.all([
    getJson<FiresFile>("fires_recent.json"),
    getJson<SummaryFile>("fires_summary_recent.json"),
    getJson<DistrictFC>("districts_web.geojson"),
    getJson<FeatureCollection>("india_outline.geojson"),
    getJson<Meta>("meta.json"),
    opt<WindFile>("wind_recent.json"),
    opt<AqFile>("aq_delhi_recent.json"),
    opt<UpwindFile>("upwind_recent.json"),
    opt<SeasonIndex>("seasons/index.json"),
  ]);

  const t0 = Date.parse(firesFile.t0);
  const fires: Fire[] = firesFile.rows.map(([lon, lat, tMin, frp, conf, sat, night, di]) => ({
    lon, lat, t: t0 + tMin * 60000, frp, conf, sat: firesFile.satellites[sat], night: night === 1,
    district: di >= 0 ? firesFile.district_ids[di] : null,
  }));
  fires.sort((a, b) => a.t - b.t);

  const byId = new Map<string, District>();
  for (const f of districts.features) {
    const p = f.properties;
    byId.set(p.id, { ...p, name: p.district, bbox: bboxOf(f.geometry), search: fold(`${p.district} ${p.state}`), aliases: [] });
  }

  const generated = Date.parse(firesFile.generated_utc);
  const latestDetection = firesFile.latest_detection_utc ? Date.parse(firesFile.latest_detection_utc) : null;
  // One slider step per IST day, from the oldest detection's day to today.
  const days: string[] = [];
  if (fires.length) {
    for (let d = istDate(fires[0].t); d <= istDate(generated); d = addDays(d, 1)) days.push(d);
  }

  return {
    fires, firesMethod: firesFile.method, latestDetection, generated, days,
    districts, outline, byId, wind, aq, upwind, seasons, lastYear: summary.same_day_last_year, meta,
  };
}

// ---- Burning seasons (NOAA-20 only, 15 Sep – 15 Dec) -----------------------------------------
export type Season = {
  year: number;
  start: string;
  end: string;
  complete: boolean;
  built_utc: string;
  pm25_sensors: number;
  fires: { total: number[]; india: number[]; states: Record<string, number[]> };
  pm25: (number | null)[]; // Delhi daily mean, null = gap
  pm25_source?: ("openaq" | "openaq-archive" | "cpcb" | "embassy" | null)[]; // where each day's value came from
  by_state: { state: string; n: number; frp: number }[];
  top_districts: { id: string; n: number; frp: number }[];
};
export type SeasonIndex = { generated_utc: string; note: string; seasons: Season[] };
type SeasonFiresFile = { start: string; district_ids: string[]; rows: [lon: number, lat: number, day: number, hhmm: number, frp: number, district: number][] };

export function seasonDays(s: Season) {
  const out: string[] = [];
  for (let d = s.start; d <= s.end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** A season's NOAA-20 detections as the same Fire objects the live map uses. */
export async function loadSeasonFires(year: number): Promise<Fire[]> {
  const f = await getJson<SeasonFiresFile>(`seasons/fires_${year}.json`);
  const fires = f.rows.map(([lon, lat, day, hhmm, frp, di]) => {
    const istDay = addDays(f.start, day);
    const mins = Math.floor(hhmm / 100) * 60 + (hhmm % 100);
    // The stored time is UTC; from 18:30 UTC it is already the next IST day.
    const utcDay = mins >= 18 * 60 + 30 ? addDays(istDay, -1) : istDay;
    const hh = Math.floor(hhmm / 100);
    return {
      lon, lat, frp, t: Date.parse(`${utcDay}T00:00:00Z`) + mins * 60000,
      conf: "", sat: "N20", night: !(hh >= 4 && hh < 12), // VIIRS passes ~08 UTC (day) and ~20 UTC (night)
      district: di >= 0 ? f.district_ids[di] : null,
    } satisfies Fire;
  });
  return fires.sort((a, b) => a.t - b.t);
}

// ---- Upwind (indicative) ---------------------------------------------------------------------
/** The latest air arrival in Delhi at or before `ref`. */
export function arrivalAt(u: UpwindFile | null, ref: number): Arrival | null {
  if (!u) return null;
  let best: Arrival | null = null;
  for (const a of u.arrivals) if (Date.parse(a.t) <= ref) best = a;
  return best;
}
export function upwindDay(u: UpwindFile | null, day: string): UpwindDay | null {
  return u?.days.find((d) => d.date === day) ?? null;
}
export const OUTSIDE = "Outside India";

// ---- Time (all labels in IST) ----------------------------------------------------------------
const IST_MS = 5.5 * 3600 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function istDate(t: number) {
  return new Date(t + IST_MS).toISOString().slice(0, 10);
}
export function addDays(d: string, n: number) {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
/** End of an IST day as a UTC timestamp. */
export function endOfIstDay(d: string) {
  return Date.parse(`${d}T00:00:00Z`) + 86400000 - IST_MS;
}
export function dayLabel(d: string, withYear = false) {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}
export function timeLabel(t: number) {
  const d = new Date(t + IST_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} IST`;
}
/** "2 h ago", "3 days ago". */
export function ago(t: number | null | undefined, now = Date.now()) {
  if (t == null || Number.isNaN(t)) return "–";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// ---- Fire window -----------------------------------------------------------------------------
export type Window = "24h" | "3d" | "7d";
export const WINDOW_HOURS: Record<Window, number> = { "24h": 24, "3d": 72, "7d": 168 };
export const WINDOW_LABEL: Record<Window, string> = { "24h": "24 h", "3d": "3 days", "7d": "7 days" };

/** The moment the map is "at": end of the chosen IST day, or now for today. */
export function refTime(data: AppData, day: string) {
  return Math.min(endOfIstDay(day), data.generated);
}

/** Fires in (ref - window, ref] from a time-sorted list. */
export function windowFires(fires: Fire[], ref: number, w: Window) {
  const from = ref - WINDOW_HOURS[w] * 3600000;
  const out: Fire[] = [];
  for (const f of fires) {
    if (f.t > ref) break;
    if (f.t > from) out.push(f);
  }
  return out;
}

export const SATELLITE: Record<string, string> = {
  N: "Suomi NPP (VIIRS)", N20: "NOAA-20 (VIIRS)", N21: "NOAA-21 (VIIRS)", A: "Aqua (MODIS)", T: "Terra (MODIS)", Aqua: "Aqua (MODIS)", Terra: "Terra (MODIS)",
};
export const CONFIDENCE: Record<string, string> = { l: "low", n: "nominal", h: "high" };

// ---- Air quality (India NAQI, PM2.5 24-hour breakpoints, µg/m³) -------------------------------
export type Band = { name: string; max: number; cls: string };
export const NAQI_PM25: Band[] = [
  { name: "Good", max: 30, cls: "aqi-good" },
  { name: "Satisfactory", max: 60, cls: "aqi-sat" },
  { name: "Moderate", max: 90, cls: "aqi-mod" },
  { name: "Poor", max: 120, cls: "aqi-poor" },
  { name: "Very poor", max: 250, cls: "aqi-vpoor" },
  { name: "Severe", max: Infinity, cls: "aqi-severe" },
];
export function pm25Band(v: number | null | undefined) {
  if (v == null) return null;
  return NAQI_PM25.find((b) => v <= b.max) ?? null;
}

/** Latest Delhi hourly PM2.5 at or before `ref`, and the mean of the 24 hours before it. */
export function delhiPm25(aq: AqFile | null, ref: number) {
  if (!aq) return null;
  const rows = aq.hourly.filter((r) => r.parameter === "pm25" && Date.parse(r.hour_utc) <= ref).sort((a, b) => Date.parse(a.hour_utc) - Date.parse(b.hour_utc));
  const last = [...rows].reverse().find((r) => r.value != null);
  if (!last) return null;
  const t = Date.parse(last.hour_utc);
  const day = rows.filter((r) => r.value != null && Date.parse(r.hour_utc) > ref - 86400000);
  const avg24 = day.length >= 18 ? day.reduce((s, r) => s + r.value!, 0) / day.length : null; // same 18-hour rule as the pipeline
  return { now: last.value!, nowT: t, stations: last.n_stations, avg24, hours24: day.length };
}

// ---- Wind ------------------------------------------------------------------------------------
/** Index of the latest wind frame at or before `ref` (null if none). */
export function windFrame(w: WindFile | null, ref: number) {
  if (!w) return null;
  let best: number | null = null;
  w.times.forEach((t, i) => {
    if (Date.parse(t) <= ref) best = i;
  });
  return best;
}
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export function compass(dirFrom: number) {
  return COMPASS[Math.floor((((dirFrom % 360) + 360) % 360 + 22.5) / 45) % 8];
}

// ---- Formatting & geometry -------------------------------------------------------------------
export const fmtInt = (v: number | null | undefined) => (v == null ? "–" : Math.round(v).toLocaleString("en-IN"));
export const fmtPct = (v: number | null | undefined, signed = false) =>
  v == null ? "–" : `${signed && v > 0 ? "+" : ""}${Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;

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
  visit((g as Polygon | MultiPolygon).coordinates);
  return b;
}

export type { Feature };

// ---- NASA GIBS satellite imagery (no key) -----------------------------------------------------
// Layer IDs from the GIBS WMTS GetCapabilities (EPSG:3857 "best").
export type SatLayer = "none" | "true" | "aod";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
export const SAT: Record<Exclude<SatLayer, "none">, { label: string; note: string; url: (date: string) => string; maxzoom: number; opacity: number }> = {
  true: {
    label: "True colour (NOAA-20)",
    note: "See the haze as the satellite saw it, ~13:30 IST",
    url: (d) => `${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    maxzoom: 9,
    opacity: 0.95,
  },
  aod: {
    label: "Haze: aerosol optical depth",
    note: "How much light the particles block (NOAA-20 Deep Blue)",
    url: (d) => `${GIBS}/VIIRS_NOAA20_AOD_Deep_Blue_Land_Ocean/default/${d}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    maxzoom: 6,
    opacity: 0.6, // fires must stay readable on top of NASA's yellow-to-red scale
  },
};
// NASA's MODIS_VIIRS_AOD colour map (from GIBS), value -> colour.
export const AOD_STOPS: [number, string][] = [
  [0, "#FFF7BC"], [0.09, "#FFE87E"], [0.18, "#FFCD50"], [0.28, "#FFA12E"], [0.37, "#FF731E"], [0.47, "#FC3A12"], [0.56, "#E3110B"], [0.66, "#B8000E"], [0.75, "#7D000E"],
];
/** Image date for a map day: the IST date, except today, whose image NASA may not have published yet. */
export function satDate(day: string, generated: number) {
  return day >= istDate(generated) ? addDays(istDate(generated), -1) : day;
}
