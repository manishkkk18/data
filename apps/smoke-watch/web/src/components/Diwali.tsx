import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtInt, loadDiwaliCity, loadDiwaliIndex, type CityInfo, type DiwaliCity, type DiwaliCityYear, type DiwaliIndex } from "../data";
import { chartColors } from "./chartColors";
import { theme } from "../theme";
import { track } from "../analytics";

// The Diwali effect: Delhi's (or another city's) hourly PM2.5 from 3 days before to 3 days
// after Diwali night, against its own normal nights, with the weather and crop-fire context.
// Ground monitors only: satellites can't see firecrackers.

const C = chartColors();
const T = theme();
const HOURS = 168; // 7 days shown, hourly
const NIGHT = [3 * 24 + 18, 4 * 24 + 6]; // Diwali night: 18:00 on Diwali to 06:00 next morning
const INDIA_24H = 60;
const WHO_24H = 15;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_FROM: Record<string, string> = { north: "N", "north-east": "NE", east: "E", "south-east": "SE", south: "S", "south-west": "SW", west: "W", "north-west": "NW" };

type Ready = Extract<DiwaliCityYear, { available: true }>;
/** A year with at least one reading in the week shown (older files may say available with none). */
const ready = (y: DiwaliCityYear | undefined): y is Ready => !!y && y.available && y.pm25.some((v) => v != null);
type View = number | "all";

// IST wall-clock times are stored without a zone: format them as UTC so the viewer's own zone never shifts them.
const at = (start: string, i: number) => new Date(Date.parse(`${start}:00Z`) + i * 3600_000);
const dayName = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
const hourName = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:00`;
const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

function readView(): View | null {
  const v = new URLSearchParams(window.location.search).get("diwali");
  if (v === "all") return "all";
  return v && /^20\d\d$/.test(v) ? Number(v) : null;
}
function writeView(v: View) {
  const q = new URLSearchParams(window.location.search);
  q.set("diwali", String(v));
  window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}#diwali`);
}

/** Chart rows: the line is split into government-station hours and US-Embassy-only hours
 * (dashed); neighbours are shared so the two parts join, and gaps stay gaps. */
function rowsFor(y: Ready) {
  return y.pm25.map((v, i) => {
    const s = y.src[i];
    const near = (k: string) => s === k || y.src[i - 1] === k || y.src[i + 1] === k;
    return { i, v, gov: v != null && near("c") ? v : null, emb: v != null && near("e") ? v : null, pm10: y.pm10[i], n: y.n[i], src: s };
  });
}

export default function Diwali({ cities, cityId }: { cities: CityInfo[]; cityId: string }) {
  const [index, setIndex] = useState<DiwaliIndex | null | undefined>(undefined);
  const [city, setCity] = useState("delhi");
  const [cache, setCache] = useState<Record<string, DiwaliCity | null>>({});
  const [view, setView] = useState<View | null>(readView);

  useEffect(() => {
    loadDiwaliIndex().then(setIndex);
  }, []);
  // Follow the city picked on the map, when this section has data for it.
  useEffect(() => {
    if (index?.cities.includes(cityId)) setCity(cityId);
  }, [cityId, index]);
  useEffect(() => {
    if (city in cache) return;
    loadDiwaliCity(city).then((d) => setCache((m) => ({ ...m, [city]: d })));
  }, [city]); // eslint-disable-line react-hooks/exhaustive-deps

  const years = useMemo(() => Object.keys(index?.years ?? {}).map(Number).sort(), [index]);
  const data = cache[city];
  const latest = years[years.length - 1];
  const current: View = view ?? latest;
  const name = cities.find((c) => c.id === city)?.name ?? data?.name ?? "Delhi";
  const pick = (v: View) => {
    setView(v);
    writeView(v);
    track(v === "all" ? "diwali-all" : `diwali-${v}`);
  };

  if (index === null) return null; // not built yet: leave the section out rather than show an empty box
  return (
    <section id="diwali" className="panel diwali dw" aria-labelledby="diwali-title">
      <div className="diwali-head">
        <div>
          <h2 id="diwali-title">The Diwali effect</h2>
          <p className="muted">
            How {name}'s air changes around Diwali night, hour by hour, from ground monitors. Firecracker smoke arrives in a few hours; crop-fire smoke builds over days,
            so the weather and the fires upwind are shown alongside.
          </p>
        </div>
        <div className="dw-controls">
          {index && index.cities.length > 1 && (
            <label className="select">
              <span className="kpi-label">City</span>
              <select
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  track(`diwali-city-${e.target.value}`);
                }}
              >
                {index.cities.map((id) => (
                  <option key={id} value={id}>
                    {cities.find((c) => c.id === id)?.name ?? id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="year-pills" role="radiogroup" aria-label="Diwali year">
            {years.map((y) => (
              <button key={y} type="button" role="radio" aria-checked={current === y} className={current === y ? "on" : ""} onClick={() => pick(y)}>
                {y}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={current === "all"} className={current === "all" ? "on" : ""} onClick={() => pick("all")}>
              All years
            </button>
          </div>
        </div>
      </div>

      {!index || data === undefined ? (
        <p className="muted">Loading Diwali air-quality data…</p>
      ) : !data ? (
        <p className="gap-note">There's no hourly monitor data for {name} around Diwali yet.</p>
      ) : current === "all" ? (
        <AllYears index={index} data={data} years={years} isDelhi={city === "delhi"} onPick={pick} />
      ) : (
        <YearView index={index} data={data} year={current} name={name} isDelhi={city === "delhi"} />
      )}

      <Notes index={index} />

      <a className="dw-link" href="/data/india/night-lights/#diwali">
        <span className="dw-link-title">See Diwali from space →</span>
        <span className="muted">India Night Lights' Diwali effect: how much brighter every district glows on Diwali night, from NASA's satellites.</span>
      </a>
    </section>
  );
}

function RuleLine({ info }: { info: DiwaliIndex["years"][string] }) {
  return (
    <p className="dw-rule">
      <span className={`dw-chip ${info.rule}`}>{info.rule === "ban" ? "Firecracker ban" : "Green crackers allowed"}</span> {info.rule_text}{" "}
      <a href={info.rule_source} target="_blank" rel="noopener">
        Source
      </a>
    </p>
  );
}

function YearView({ index, data, year, name, isDelhi }: { index: DiwaliIndex; data: DiwaliCity; year: number; name: string; isDelhi: boolean }) {
  const info = index.years[String(year)];
  const y = data.years[String(year)];
  const rows = useMemo(() => (ready(y) ? rowsFor(y) : []), [y]);
  if (!info) return <p className="gap-note">Diwali {year} hasn't been built yet.</p>;
  const head = (
    <p className="dw-date">
      Diwali (Lakshmi Puja): <b>{longDate(info.date)}</b>{" "}
      <a href={info.source} target="_blank" rel="noopener">
        Drik Panchang
      </a>
      {info.note ? <span className="muted"> · {info.note}</span> : null}
    </p>
  );
  if (!ready(y)) {
    return (
      <>
        {head}
        <RuleLine info={info} />
        <p className="gap-note">
          No hourly readings from government monitors in {name} around Diwali {year}
          {isDelhi ? ", and none from the US Embassy monitor either" : ""}. Nothing is filled in.
        </p>
      </>
    );
  }
  const s = y.stats;
  const gaps = y.pm25.filter((v) => v == null).length;
  const yMax = Math.max(INDIA_24H, ...y.pm25.filter((v): v is number => v != null)) * 1.08;
  // Phones: every other day, so the date labels don't run together.
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
  const ticks = Array.from({ length: 7 }, (_, k) => k * 24).filter((_, k) => !narrow || k % 2 === 0);
  const peakT = s.peak ? new Date(`${s.peak.hour}:00Z`) : null;

  return (
    <>
      {head}
      <RuleLine info={info} />

      <div className="tiles dw-tiles">
        <div className="tile">
          <span className="tile-label">Diwali night peak</span>
          <span className="tile-value accent">{s.peak ? fmtInt(s.peak.value) : "–"}</span>
          <span className="tile-hint">
            {s.peak && peakT ? `µg/m³ PM2.5 at ${hourName(peakT)} (${dayName(peakT)})` : "no readings that night"}
            {s.peak && s.night_hours < 12 ? `. Highest recorded hour: ${12 - s.night_hours} of the 12 night hours have no reading, so the real peak may be higher.` : ""}
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Night vs normal nights</span>
          <span className={`tile-value ${s.pct_above != null && s.pct_above > 0 ? "worse" : ""}`}>{s.pct_above != null ? `${s.pct_above > 0 ? "+" : ""}${s.pct_above}%` : "–"}</span>
          <span className="tile-hint">
            {s.night_mean != null && s.baseline != null
              ? `${fmtInt(s.night_mean)} vs ${fmtInt(s.baseline)} µg/m³, 6 pm–6 am average`
              : s.baseline == null
                ? `too few normal nights with data (${s.baseline_nights} of 10)`
                : `only ${s.night_hours} of 12 hours that night`}
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Back to normal</span>
          <span className="tile-value">{s.back_to_normal_h != null ? `${s.back_to_normal_h} h` : "–"}</span>
          <span className="tile-hint">
            {s.back_to_normal_h != null
              ? `from the peak until PM2.5 fell to a normal night's level${s.back_to_normal_h > 54 ? " (beyond the days on the chart)" : ""}`
              : (s.back_note ?? "no normal-night level to compare")}
          </span>
        </div>
      </div>

      <figure className="trend" aria-label={`Hourly PM2.5 in ${name}, 3 days either side of Diwali ${year}. Diwali night peak ${s.peak?.value ?? "unknown"} µg/m³.`}>
        <figcaption className="trend-head">
          <span className="trend-title">
            {name}: hourly PM2.5, {dayName(at(y.start, 0))} – {dayName(at(y.start, HOURS - 1))}
          </span>
          <span className="trend-legend">
            <span>
              <i style={{ background: C.A }} aria-hidden="true" /> PM2.5, median of {y.stations_usual} government monitors
            </span>
            {y.embassy_hours > 0 && (
              <span>
                <i className="dashed-a" aria-hidden="true" /> US Embassy monitor only
              </span>
            )}
            <span>
              <i className="dashed" aria-hidden="true" /> Normal night
            </span>
            <span>
              <i className="dw-night-key" aria-hidden="true" /> Diwali night, 6 pm–6 am
            </span>
          </span>
        </figcaption>
        <div className="trend-plot tall dw-plot">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={C.GRID} />
              <ReferenceArea x1={NIGHT[0]} x2={NIGHT[1]} fill={T.accent} fillOpacity={0.12} stroke="none" ifOverflow="hidden" />
              <XAxis dataKey="i" type="number" domain={[0, HOURS - 1]} ticks={ticks} tickFormatter={(i: number) => dayName(at(y.start, i))} tick={{ fill: C.AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.GRID }} />
              <YAxis domain={[0, Math.ceil(yMax / 50) * 50]} tick={{ fill: C.AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
              <ReferenceLine y={INDIA_24H} stroke={C.AXIS} strokeDasharray="1 3" label={{ value: "India 24-h standard 60", position: "insideTopRight", fill: C.AXIS, fontSize: 10 }} />
              <ReferenceLine y={WHO_24H} stroke={C.AXIS} strokeDasharray="1 3" label={{ value: "WHO 15", position: "insideBottomLeft", fill: C.AXIS, fontSize: 10 }} />
              {s.baseline != null && (
                <ReferenceLine y={s.baseline} stroke={T.text} strokeDasharray="5 4" strokeOpacity={0.8} label={{ value: `Normal night ${fmtInt(s.baseline)}`, position: "insideTopLeft", fill: T.text, fontSize: 11 }} />
              )}
              <Tooltip
                cursor={{ stroke: C.AXIS, strokeWidth: 1 }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const r = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
                  if (!r) return null;
                  const t = at(y.start, r.i);
                  return (
                    <div className="trend-tip">
                      <strong>
                        {WEEKDAYS[t.getUTCDay()]} {dayName(t)}, {hourName(t)}
                      </strong>
                      <span>PM2.5: {r.v != null ? <b>{fmtInt(r.v)}</b> : "no reading (gap)"}{r.v != null ? " µg/m³" : ""}</span>
                      {r.pm10 != null && <span>PM10: {fmtInt(r.pm10)} µg/m³</span>}
                      {r.v != null && <span className="muted">{r.src === "e" ? "US Embassy monitor only" : `median of ${r.n} monitors`}</span>}
                    </div>
                  );
                }}
              />
              <Line type="linear" dataKey="gov" stroke={C.A} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="linear" dataKey="emb" stroke={C.A} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="trend-note muted">
          Hourly PM2.5 in IST; the horizontal lines are daily (24-hour) limits, shown for scale.
          {gaps > 0 ? ` ${gaps} of ${HOURS} hours have too few readings and are left as breaks, not filled in.` : ""}
          {y.embassy_hours > 0
            ? ` ${y.embassy_hours} hours come from the US Embassy monitor alone (dashed), because OpenAQ has no government-monitor readings for them.`
            : ""}
        </p>
      </figure>

      {isDelhi ? <Context info={info} terciles={index.upwind_terciles} /> : <p className="muted small">Wind, ventilation and upwind fires are worked out for Delhi only.</p>}
    </>
  );
}

function Context({ info, terciles }: { info: DiwaliIndex["years"][string]; terciles: [number, number] | null }) {
  const weather = info.weather ?? [];
  const up = info.upwind ?? [];
  if (!weather.length && !up.length) return null;
  const maxUp = Math.max(1, ...up.filter((v): v is number => v != null));
  const level = (v: number | null) => (v == null || !terciles ? null : v < terciles[0] ? "low" : v < terciles[1] ? "medium" : "high");
  const days = weather.length ? weather.map((w) => w.date) : up.map((_, k) => k);
  return (
    <div className="dw-context-wrap">
      <p className="trend-title dw-context-title" id="dw-context-title">Delhi, same days: what the weather and the fires upwind were doing</p>
      <div className="dw-context-scroll">
      <table className="dw-context" aria-labelledby="dw-context-title">
        <thead>
          <tr>
            <th scope="col" />
            {days.map((d, k) => (
              <th key={k} scope="col" className={k === 3 ? "on" : ""}>
                {typeof d === "string" ? dayName(new Date(`${d}T00:00:00Z`)) : ""}
                {k === 3 && <span className="dw-diwali-tag">Diwali</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              Upwind fire load<span className="muted"> crop fires along the air's path</span>
            </th>
            {days.map((_, k) => {
              const v = up[k] ?? null;
              const l = level(v);
              return (
                <td key={k} className={k === 3 ? "on" : ""}>
                  {v == null ? (
                    <span className="muted">–</span>
                  ) : (
                    <>
                      <span className="dw-bar" aria-hidden="true">
                        <span className="fire-bg" style={{ height: `${Math.max(4, (v / maxUp) * 100)}%` }} />
                      </span>
                      <span className="dw-level">{l}</span>
                    </>
                  )}
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row">
              Wind<span className="muted"> daily average, 10 m</span>
            </th>
            {days.map((_, k) => {
              const w = weather[k];
              return (
                <td key={k} className={k === 3 ? "on" : ""}>
                  {w?.wind_ms != null ? (
                    <>
                      <b className="mono">{w.wind_ms}</b> <span className="muted">m/s</span>
                      <span className="dw-sub">from {SHORT_FROM[w.wind_from ?? ""] ?? "–"}</span>
                    </>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row">
              Ventilation<span className="muted"> mixing height × wind, best hour</span>
            </th>
            {days.map((_, k) => {
              const w = weather[k];
              return (
                <td key={k} className={k === 3 ? "on" : ""}>
                  {w?.ventilation ? (
                    <>
                      <span className={`dw-vent ${w.ventilation}`}>{w.ventilation === "trapped" ? "Trapped" : "Dispersing"}</span>
                      <span className="dw-sub mono">{fmtInt(w.vi_max)}</span>
                    </>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      </div>
      <p className="trend-note muted">
        Upwind fire load: NOAA-20 fire detections along 48-hour back-trajectories of the air reaching Delhi, using ERA5 winds near the ground (10 m and 100 m) so every
        year is treated the same; low / medium / high compare with all the Diwali weeks shown. Ventilation below 6,000 m²/s means smoke is trapped near the ground (the
        threshold IITM's forecasts use). Indicative, not a source-apportionment study.
      </p>
    </div>
  );
}

function AllYears({ index, data, years, isDelhi, onPick }: { index: DiwaliIndex; data: DiwaliCity; years: number[]; isDelhi: boolean; onPick: (y: number) => void }) {
  // One y scale for every year, so the panels compare at a glance.
  const top = Math.max(
    INDIA_24H,
    ...years.flatMap((yr) => {
      const y = data.years[String(yr)];
      return ready(y) ? y.pm25.filter((v): v is number => v != null) : [];
    }),
  );
  const yTop = Math.ceil((top * 1.05) / 100) * 100;
  return (
    <>
      <p className="muted small">Every Diwali on the same scale (0–{fmtInt(yTop)} µg/m³). Shaded: Diwali night. Dashed: that year's normal night. Pick a year for detail.</p>
      <div className="dw-grid">
        {years.map((yr) => {
          const info = index.years[String(yr)];
          const y = data.years[String(yr)];
          const s = ready(y) ? y.stats : null;
          const upD = isDelhi ? (info?.upwind?.[3] ?? null) : null;
          const t = index.upwind_terciles;
          const upLevel = upD == null || !t ? null : upD < t[0] ? "low" : upD < t[1] ? "medium" : "high";
          const vent = isDelhi ? info?.weather?.[3]?.ventilation : null;
          return (
            <button key={yr} type="button" className="dw-mini" onClick={() => onPick(yr)} aria-label={`Diwali ${yr}: show in detail`}>
              <span className="dw-mini-head">
                <b>{yr}</b>
                <span className="muted">{info ? longDate(info.date).slice(0, -5) : ""}</span>
                {info && <span className={`dw-chip ${info.rule}`}>{info.rule === "ban" ? "Ban" : "Green crackers"}</span>}
              </span>
              {ready(y) ? (
                <span className="dw-mini-plot" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rowsFor(y)} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                      <ReferenceArea x1={NIGHT[0]} x2={NIGHT[1]} fill={T.accent} fillOpacity={0.14} stroke="none" />
                      <XAxis dataKey="i" type="number" domain={[0, HOURS - 1]} hide />
                      <YAxis domain={[0, yTop]} hide />
                      {s?.baseline != null && <ReferenceLine y={s.baseline} stroke={T.text} strokeDasharray="4 3" strokeOpacity={0.7} />}
                      <ReferenceLine y={INDIA_24H} stroke={C.AXIS} strokeDasharray="1 3" />
                      <Line type="linear" dataKey="gov" stroke={C.A} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                      <Line type="linear" dataKey="emb" stroke={C.A} strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </span>
              ) : (
                <span className="dw-mini-plot empty">No monitor data</span>
              )}
              {s && (
                <span className="dw-mini-stats">
                  {s.pct_above != null ? (
                    <span>
                      Night <b className={s.pct_above > 0 ? "worse" : ""}>{`${s.pct_above > 0 ? "+" : ""}${s.pct_above}%`}</b> vs normal
                    </span>
                  ) : (
                    <span>{s.night_hours < 9 ? `Night: monitor gaps (${s.night_hours} of 12 h)` : "No normal-night comparison"}</span>
                  )}
                  <span>
                    Peak <b className="mono">{s.peak ? fmtInt(s.peak.value) : "–"}</b>
                  </span>
                  {upLevel && (
                    <span>
                      Upwind fires <b>{upLevel}</b>
                    </span>
                  )}
                  {vent && <span className={`dw-vent ${vent}`}>{vent === "trapped" ? "Trapped" : "Dispersing"}</span>}
                </span>
              )}
              {ready(y) && y.embassy_hours > 84 && <span className="dw-mini-note muted">Mostly the US Embassy monitor alone</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}

function Notes({ index }: { index: DiwaliIndex | null | undefined }) {
  const rules = index ? Object.entries(index.years).sort(([a], [b]) => Number(a) - Number(b)) : [];
  return (
    <div className="dw-notes">
      <h3 className="diwali-sub">Reading this honestly</h3>
      <ul>
        <li>
          <b>Satellites can't see firecrackers.</b> The fire map counts heat from burning fields. This section uses ground air-quality monitors, which measure all the
          smoke together.
        </li>
        <li>
          <b>Crackers and crop smoke behave differently.</b> A sharp jump within hours on Diwali night is mainly local, from firecrackers. Crop-fire smoke travels for a day
          or two on north-westerly winds and builds up more slowly. Calm, trapped air makes either worse, so a bad night can be as much the weather as the crackers. We don't
          split the smoke into exact shares.
        </li>
        <li>
          <b>The rules changed.</b> Delhi banned firecrackers outright from 2020 to 2024 (often flouted); in 2025 and 2026 the Supreme Court allowed certified green crackers in
          set hours. So differences between years aren't only about how people celebrated.{" "}
          {rules.map(([y, r], k) => (
            <span key={y}>
              <a href={r.rule_source} target="_blank" rel="noopener">
                {y}
              </a>
              {k < rules.length - 1 ? ", " : "."}
            </span>
          ))}
        </li>
        <li>
          <b>"Diwali night" follows Delhi's date.</b> It's the night of Lakshmi Puja (Drik Panchang, New Delhi). In much of South India, Deepavali crackers come on Naraka
          Chaturdashi, often that morning or the day before, so for those cities the peak can fall outside the shaded night.
        </li>
        <li>
          <b>Gaps stay gaps.</b> An hour needs at least 3 government monitors (half the usual number) to count. When OpenAQ has no government data for Delhi (most of
          2022–2024), the US Embassy monitor stands in on its own and is drawn dashed. Nothing is interpolated.
        </li>
      </ul>
    </div>
  );
}
