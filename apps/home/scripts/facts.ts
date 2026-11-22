// Headline facts for the project cards, read at build time from the data files each app
// publishes (never typed in by hand). If a file is missing, that fact is left out rather
// than guessed, and the build logs a warning.
import { existsSync, readFileSync } from "node:fs";

export type Fact = { value: string; label: string };
export type Facts = { nl: Fact[]; nlAsOf: string | null; sw: Fact[]; swAsOf: string | null; mn: Fact[]; mnAsOf: string | null; mi: Fact[]; miAsOf: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const int = (n: number) => Math.round(n).toLocaleString("en-IN");
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const istDay = (iso: string) => {
  const d = new Date(Date.parse(iso) + 5.5 * 3600 * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

function read<T>(root: string, rel: string, warn: (m: string) => void): T | null {
  const p = `${root}/${rel}`;
  if (!existsSync(p)) {
    warn(`facts: ${rel} not found, leaving its facts out`);
    return null;
  }
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

type Monthly = { ids: string[]; months: string[]; national_avg?: (number | null)[] };
type Summary = { by_state: { state: string; detections: number }[]; by_day: { date: string; detections_india: number }[] };
type Cities = { generated_utc: string; cities: { name: string; pm25?: { aqi?: { value: number; band: string } | null } | null }[] };

/** `appsDir` is the repo's apps/ folder. */
export function readFacts(appsDir: string, warn: (m: string) => void = console.warn): Facts {
  const nl: Fact[] = [];
  let nlAsOf: string | null = null;
  const m = read<Monthly>(appsDir, "night-lights/data/monthly.json", warn);
  if (m) {
    nl.push({ value: int(m.ids.length), label: "districts, every month" });
    const first = m.months[0];
    const last = m.months[m.months.length - 1];
    nlAsOf = monthLabel(last);
    nl.push({ value: int(m.months.length), label: `monthly snapshots since ${monthLabel(first)}` });
    // Same definition as the app's "Growth since 2015": same calendar month, so seasons cancel out.
    const then = m.months.indexOf(`${first.slice(0, 4)}-${last.slice(5, 7)}`);
    const a = then >= 0 ? m.national_avg?.[then] : null;
    const b = m.national_avg?.[m.months.length - 1];
    if (a && b) {
      const pct = ((b - a) / a) * 100;
      nl.push({ value: `${pct >= 0 ? "+" : "−"}${Math.abs(Math.round(pct))}%`, label: `India's night brightness, ${monthLabel(last)} vs ${monthLabel(m.months[then])}` });
    }
  }

  const sw: Fact[] = [];
  let swAsOf: string | null = null;
  const s = read<Summary>(appsDir, "smoke-watch/data/fires_summary_recent.json", warn);
  if (s) {
    const week = s.by_day.slice(-7).reduce((t, d) => t + (d.detections_india ?? 0), 0);
    sw.push({ value: int(week), label: "fire detections in India, last 7 days" });
    const top = s.by_state.filter((x) => x.state !== "Outside India").sort((p, q) => q.detections - p.detections)[0];
    if (top) sw.push({ value: top.state, label: `most fires this week (${int(top.detections)})` });
  }
  const c = read<Cities>(appsDir, "smoke-watch/data/cities.json", warn);
  if (c) {
    swAsOf = istDay(c.generated_utc);
    const worst = c.cities
      .filter((x) => x.pm25?.aqi)
      .sort((p, q) => q.pm25!.aqi!.value - p.pm25!.aqi!.value)[0];
    if (worst) sw.push({ value: `AQI ${worst.pm25!.aqi!.value}`, label: `${worst.name}, worst air of ${c.cities.length} cities (${worst.pm25!.aqi!.band})` });
  }

  // The Monsoon: same numbers the app shows (IMD's official figure; its own district map; city arrivals).
  const mn: Fact[] = [];
  let mnAsOf: string | null = null;
  const meta = read<MonsoonMeta>(appsDir, "monsoon/data/meta.json", warn);
  const all = meta?.official.regions["All India"];
  if (all) {
    mn.push({ value: `${all.pct_of_lpa}%`, label: "of its normal monsoon rain fell on India (IMD)" });
    mnAsOf = "Season: 1 Jun – 30 Sep 2026";
  }
  const imd = read<MonsoonImd>(appsDir, "monsoon/data/imd_districts.json", warn);
  if (imd) {
    // IMD's own district table and categories (deficient, large deficient, no rain)
    const c = imd.imd_counts;
    const dry = (c.D ?? 0) + (c.LD ?? 0) + (c.NR ?? 0);
    const to = imd.period.slice(-10);
    mn.push({ value: `${int(dry)} of ${int(c.rows)}`, label: `districts had deficient or worse rain (IMD, to ${Number(to.slice(8))} ${MONTHS[Number(to.slice(5, 7)) - 1]})` });
  }
  const on = read<MonsoonOnset>(appsDir, "monsoon/data/onset_2026.json", warn);
  if (on) {
    const cities = on.cities.filter((x) => x.lonlat && x.arrived && x.days_late != null);
    const late = cities.filter((x) => x.days_late! > 2).length;
    mn.push({ value: `${int(late)} of ${int(cities.length)}`, label: "cities got the rains more than 2 days late" });
  }
  // Factory India: the app's own headline figures (MoSPI IIP and ASI), same definitions as its hero.
  const mi: Fact[] = [];
  let miAsOf: string | null = null;
  const iip = read<MfgIip>(appsDir, "manufacturing-insights/data/iip.json", warn);
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;
  if (iip) {
    const h = iip.headline;
    mi.push({ value: signed(h.mfg_change_pct), label: `factory output, ${h.from_fy} to ${h.to_fy} (IIP)` });
  }
  const asi = read<MfgAsi>(appsDir, "manufacturing-insights/data/asi.json", warn);
  if (asi) {
    const p = asi.india.series.persons;
    const a = p[asi.years.indexOf(asi.base)];
    const b = p[p.length - 1];
    if (a && b) mi.push({ value: signed(((b - a) / a) * 100), label: `people working in factories, ${asi.base} to ${asi.latest} (ASI)` });
    const g = asi.india.growth.gva_per_person;
    if (g != null) mi.push({ value: `${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(1)}%`, label: "a year: real value added per factory worker" });
  }
  if (iip && asi) miAsOf = `Latest: IIP ${monthLabel(iip.latest_month)}, ASI ${asi.latest}`;
  return { nl, nlAsOf, sw, swAsOf, mn, mnAsOf, mi, miAsOf };
}

type MfgIip = { latest_month: string; headline: { mfg_change_pct: number; from_fy: string; to_fy: string } };
type MfgAsi = { years: string[]; base: string; latest: string; india: { series: { persons: number[] }; growth: { gva_per_person: number | null } } };

type MonsoonMeta = { official: { regions: Record<string, { pct_of_lpa: number }> } };
type MonsoonImd = { period: string; imd_counts: Record<string, number> & { rows: number } };
type MonsoonOnset = { cities: { lonlat: number[] | null; arrived: string | null; days_late?: number }[] };
