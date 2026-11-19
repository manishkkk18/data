// Loads the pipeline's static JSON (never an API) and holds the small helpers the UI shares.
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";

export type BBox = [number, number, number, number];

// ---- Files written by pipeline/smokewatch/run.py -------------------------------------------
type LiveRow = [lon: number, lat: number, tMin: number, frp: number, conf: string, sat: number, night: 0 | 1, district: number];
/** data/live/index.json: the live window's days; each day's detections are in its own file. */
export type LiveIndex = {
  generated_utc: string;
  method: "api" | "public-7d";
  window_days: number;
  t0: string;
  latest_detection_utc: string | null;
  satellites: string[];
  district_ids: string[];
  days: { date: string; file: string; n: number }[];
};
type SummaryFile = {
  by_day?: { date: string; detections: number; detections_india?: number }[];
  same_day_last_year: { available: boolean; reason?: string; date?: string; count?: number; last_year_date?: string; last_year_count?: number; sensor?: string } | null;
};
export type WindFile = {
  points: [number, number][]; // the grid, then one point per city (in `cities` order)
  cities?: string[];
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
  wind?: { updated_utc?: string; latest_utc?: string | null; error?: string; stale?: boolean };
  aq?: Record<string, { updated_utc?: string; error?: string; stale?: boolean }>; // per city
  upwind?: Record<string, { updated_utc?: string; error?: string; stale?: boolean }>; // per city
};

// ---- What the app works with -----------------------------------------------------------------
export type Fire = { lon: number; lat: number; t: number; frp: number; conf: string; sat: string; night: boolean; district: string | null };
export type DistrictProps = { id: string; district: string; state: string };
export type DistrictFC = FeatureCollection<Polygon | MultiPolygon, DistrictProps>;
export type District = DistrictProps & { name: string; bbox: BBox; search: string; aliases: string[] };

export type AppData = {
  fires: Fire[]; // the live days loaded so far (the latest two at start), sorted by time
  live: LiveIndex;
  dayCounts: Map<string, number>; // detections in India per IST day, for the timeline
  firesMethod: LiveIndex["method"];
  latestDetection: number | null;
  generated: number;
  days: string[]; // IST dates (YYYY-MM-DD) covered by the fire window, oldest first
  districts: DistrictFC;
  outline: FeatureCollection;
  byId: Map<string, District>;
  wind: WindFile | null;
  cities: CityInfo[]; // the city picker's list, with PM2.5 now when available
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
  const [live, summary, districts, outline, meta, wind, citiesFile, seasons] = await Promise.all([
    getJson<LiveIndex>("live/index.json"),
    getJson<SummaryFile>("fires_summary_recent.json"),
    getJson<DistrictFC>("districts_web.geojson"),
    getJson<FeatureCollection>("india_outline.geojson"),
    getJson<Meta>("meta.json"),
    opt<WindFile>("wind_recent.json"),
    opt<{ cities: CityInfo[] }>("cities.json"),
    opt<SeasonIndex>("seasons/index.json"),
  ]);

  // Start with the latest two days (all a 24-hour window needs); the rest load in the background.
  const fires = await loadLiveDays(live, live.days.slice(-2).map((d) => d.date));

  const byId = new Map<string, District>();
  for (const f of districts.features) {
    const p = f.properties;
    byId.set(p.id, { ...p, name: p.district, bbox: bboxOf(f.geometry), search: fold(`${p.district} ${p.state}`), aliases: [] });
  }

  const generated = Date.parse(live.generated_utc);
  const latestDetection = live.latest_detection_utc ? Date.parse(live.latest_detection_utc) : null;
  // One slider step per IST day, from the oldest day with detections to today.
  const days: string[] = [];
  if (live.days.length) {
    for (let d = live.days[0].date; d <= istDate(generated); d = addDays(d, 1)) days.push(d);
  }
  const dayCounts = new Map((summary.by_day ?? []).map((r) => [r.date, r.detections_india ?? r.detections] as [string, number]));

  return {
    fires, live, dayCounts, firesMethod: live.method, latestDetection, generated, days,
    districts, outline, byId, wind, cities: citiesFile?.cities ?? CITY_LIST, seasons, lastYear: summary.same_day_last_year, meta,
  };
}

/** Detections for the given IST days of the live window, as Fire objects sorted by time. */
export async function loadLiveDays(live: LiveIndex, dates: string[]): Promise<Fire[]> {
  const t0 = Date.parse(live.t0);
  const files = live.days.filter((d) => dates.includes(d.date));
  const parts = await Promise.all(files.map((d) => getJson<{ rows: LiveRow[] }>(`live/${d.file}`)));
  const fires: Fire[] = parts.flatMap((p) =>
    p.rows.map(([lon, lat, tMin, frp, conf, sat, night, di]) => ({
      lon, lat, t: t0 + tMin * 60000, frp, conf, sat: live.satellites[sat], night: night === 1,
      district: di >= 0 ? live.district_ids[di] : null,
    })),
  );
  return fires.sort((a, b) => a.t - b.t);
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
/** Fires in (from, to] from a time-sorted list (binary search, cheap enough for every animation frame). */
export function firesBetween(fires: Fire[], from: number, to: number) {
  const first = (x: number) => {
    let lo = 0;
    let hi = fires.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fires[mid].t <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return fires.slice(first(from), first(to));
}

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

// India's National AQI (CPCB): each pollutant's 24-hour average -> sub-index by linear
// interpolation between breakpoints; the AQI is the worse (higher) sub-index.
const PM25_BP: [number, number, number, number][] = [[0, 30, 0, 50], [30, 60, 50, 100], [60, 90, 100, 200], [90, 120, 200, 300], [120, 250, 300, 400], [250, 380, 400, 500]];
const PM10_BP: [number, number, number, number][] = [[0, 50, 0, 50], [50, 100, 50, 100], [100, 250, 100, 200], [250, 350, 200, 300], [350, 430, 300, 400], [430, 510, 400, 500]];
const subIndex = (c: number | null, bp: [number, number, number, number][]) => {
  if (c == null) return null;
  for (const [lo, hi, ilo, ihi] of bp) if (c <= hi) return ilo + ((Math.max(c, lo) - lo) * (ihi - ilo)) / (hi - lo);
  return 500;
};
export type Aqi = { value: number; band: Band; driver: "PM2.5" | "PM10"; pollutants: string[] };
const AQI_TOPS = [50, 100, 200, 300, 400, Infinity];
export function aqiFrom(pm25: number | null, pm10: number | null): Aqi | null {
  const a = subIndex(pm25, PM25_BP);
  const b = subIndex(pm10, PM10_BP);
  if (a == null && b == null) return null;
  const driver = b != null && (a == null || b > a) ? "PM10" : "PM2.5";
  const value = Math.round(driver === "PM10" ? b! : a!);
  const band = NAQI_PM25[AQI_TOPS.findIndex((t) => value <= t)];
  return { value, band, driver, pollutants: [a != null ? "PM2.5" : "", b != null ? "PM10" : ""].filter(Boolean) };
}

/** Air in a city at `ref`: the latest hourly PM2.5, 24-hour PM2.5 and PM10 means (>= 18 hours
 * each), and the AQI from those 24-hour means, the way CPCB defines it. */
export function cityPm25(aq: AqFile | null, ref: number) {
  if (!aq) return null;
  const rows = (p: string) =>
    aq.hourly.filter((r) => r.parameter === p && r.value != null && Date.parse(r.hour_utc) <= ref).sort((x, y) => Date.parse(x.hour_utc) - Date.parse(y.hour_utc));
  const pm25 = rows("pm25");
  const last = pm25[pm25.length - 1];
  if (!last) return null;
  const t = Date.parse(last.hour_utc);
  const mean24 = (rs: typeof pm25) => {
    const d = rs.filter((r) => Date.parse(r.hour_utc) > t - 86400000);
    return { v: d.length >= 18 ? d.reduce((s2, r) => s2 + r.value!, 0) / d.length : null, n: d.length };
  };
  const p25 = mean24(pm25);
  const p10 = mean24(rows("pm10"));
  return {
    now: last.value!, nowT: t, stations: last.n_stations,
    avg24: p25.v, hours24: p25.n, pm10avg24: p10.v,
    aqi: aqiFrom(p25.v, p10.v),
  };
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

/** The data is overdue if the scheduled refresh (every 3 h in season, daily otherwise) has missed
 * two or more runs. Returns how old it is, or null if it's on time. */
export function overdue(generated: number, now = Date.now()) {
  const md = istDate(now).slice(5).replace("-", "");
  const inSeason = md >= "0915" && md <= "1215";
  const limit = (inSeason ? 7 : 30) * 3600000;
  return now - generated > limit ? ago(generated, now) : null;
}

/** Area the season history covers until it is rebuilt for the whole country. */
export const SEASON_AREA = "north-west India (Punjab, Haryana, Delhi, west UP, edges of Rajasthan and MP)";

// ---- Cities -------------------------------------------------------------------------------------
export type CityInfo = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  pm25?: {
    value: number; hour_utc: string; stations: number; avg24: number | null; pm10_avg24?: number | null;
    aqi?: { value: number; band: string; driver: string; pollutants: string[] } | null;
  } | null;
  wind_850?: { speed: number; dir_from: number } | null;
  upwind_today?: { date: string; load: number; state: [string, number] | null } | null;
};
/** Used if cities.json is missing; same order as pipeline/smokewatch/config.py CITIES. */
export const CITY_LIST: CityInfo[] = [
  { id: "delhi", name: "Delhi", lon: 77.2167, lat: 28.6315 },
  { id: "mumbai", name: "Mumbai", lon: 72.8777, lat: 19.076 },
  { id: "kolkata", name: "Kolkata", lon: 88.3639, lat: 22.5726 },
  { id: "chennai", name: "Chennai", lon: 80.2707, lat: 13.0827 },
  { id: "bengaluru", name: "Bengaluru", lon: 77.5946, lat: 12.9716 },
  { id: "hyderabad", name: "Hyderabad", lon: 78.4867, lat: 17.385 },
  { id: "ahmedabad", name: "Ahmedabad", lon: 72.5714, lat: 23.0225 },
  { id: "lucknow", name: "Lucknow", lon: 80.9462, lat: 26.8467 },
  { id: "patna", name: "Patna", lon: 85.1376, lat: 25.5941 },
  { id: "jaipur", name: "Jaipur", lon: 75.7873, lat: 26.9124 },
  { id: "guwahati", name: "Guwahati", lon: 91.7362, lat: 26.1445 },
  { id: "bhopal", name: "Bhopal", lon: 77.4126, lat: 23.2599 },
];
/** One city's air quality and air's path, loaded when the city is picked. */
export type CityData = { aq: AqFile | null; upwind: UpwindFile | null };
export async function loadCityData(id: string): Promise<CityData> {
  const [aq, upwind] = await Promise.all([
    getJson<AqFile>(`aq/${id}.json`).catch(() => null),
    getJson<UpwindFile>(`upwind/${id}.json`).catch(() => null),
  ]);
  return { aq, upwind };
}
/** Index of a city's own point in the wind file, or null. */
export function windIndex(w: WindFile | null, cityId: string) {
  if (!w?.cities) return w ? w.points.length - 1 : null; // older files: Delhi was the last point
  const i = w.cities.indexOf(cityId);
  return i < 0 ? null : w.points.length - w.cities.length + i;
}
export const delhiPm25 = cityPm25;

// ---- The Diwali effect (data/diwali, built by pipeline/smokewatch/diwali.py) ----------------
export type DiwaliWeatherDay = { date: string; wind_ms: number | null; wind_from: string | null; vi_max: number | null; ventilation: "trapped" | "dispersing" | null };
export type DiwaliYearInfo = {
  date: string; source: string; note?: string; // Lakshmi Puja date used, with its source
  rule: "ban" | "green"; rule_text: string; rule_source: string; // firecracker rules in Delhi that year
  weather?: DiwaliWeatherDay[] | null; // Delhi, the 7 days shown
  upwind?: (number | null)[] | null; // Delhi, mean upwind fire load per shown day
};
export type DiwaliIndex = {
  generated_utc: string;
  years: Record<string, DiwaliYearInfo>;
  cities: string[]; // cities with any data
  upwind_terciles: [number, number] | null;
  method: Record<string, string>;
};
export type DiwaliStats = {
  baseline: number | null; baseline_nights: number;
  night_mean: number | null; night_hours: number; pct_above: number | null;
  peak: { value: number; hour: string } | null;
  back_to_normal_h: number | null; back_note: string | null;
  // What the median can hide (newer files): the highest single monitor on Diwali night, night
  // hours with fewer than 3/4 of the usual monitors, and how many reported at the peak hour.
  worst_monitor?: { value: number; hour: string } | null;
  partial_night_hours?: number; peak_monitors?: number | null; peak_partial?: boolean;
};
export type DiwaliCityYear =
  | { date: string; available: false }
  | {
      date: string; available: true;
      start: string; // IST, hour start of the first value
      pm25: (number | null)[]; pm10: (number | null)[]; n: number[];
      src: string; // per hour: c = government-monitor median, p = same but partial (< 3/4 of usual monitors), e = US Embassy alone, - = gap
      p90?: (number | null)[]; max?: (number | null)[]; // worst-hit tenth of monitors (10+ only), single highest monitor
      partial_hours?: number;
      embassy_hours: number; stations_usual: number;
      stats: DiwaliStats;
    };
export type DiwaliCity = { city: string; name: string; years: Record<string, DiwaliCityYear> };

export async function loadDiwaliIndex(): Promise<DiwaliIndex | null> {
  return getJson<DiwaliIndex>("diwali/index.json").catch(() => null);
}
export async function loadDiwaliCity(id: string): Promise<DiwaliCity | null> {
  return getJson<DiwaliCity>(`diwali/${id}.json`).catch(() => null);
}
