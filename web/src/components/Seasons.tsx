import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { addDays, dayLabel, fmtInt, fmtPct, pm25Band, SEASON_AREA, type AppData, type Season } from "../data";
import { track } from "../analytics";
import { COLOR_A, COLOR_B, MARKER } from "./chartColors";
import { FIRE_NEW } from "./Legend";

// Burning seasons below the map: fires vs Delhi PM2.5 (with a lag), and two seasons compared.
// Layout and chart style follow India Night Lights' Diwali and Compare sections.

type Props = {
  data: AppData;
  mapSeason: number | null; // season shown on the map, if any
  mapDay: string; // day shown on the map
  onShow: (year: number, day: string) => void; // show a season day on the map
};

const LAGS = [0, 1, 2, 3];
const AXIS = { fill: "#9AA3B8", fontSize: 11 };

/** Pearson correlation of PM2.5 on day i with fires on day i - lag (days with both values only). */
export function lagCorrelation(fires: number[], pm: (number | null)[], lag: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = lag; i < pm.length; i++) {
    const y = pm[i];
    const x = fires[i - lag];
    if (y == null || x == null) continue;
    xs.push(x);
    ys.push(y);
  }
  const n = xs.length;
  if (n < 10) return { r: null, n };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < n; k++) {
    sxy += (xs[k] - mx) * (ys[k] - my);
    sxx += (xs[k] - mx) ** 2;
    syy += (ys[k] - my) ** 2;
  }
  return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, n };
}

function stats(s: Season, upTo?: number) {
  const n = upTo ?? s.fires.india.length;
  const fires = s.fires.india.slice(0, n);
  const pm = s.pm25.slice(0, n);
  const pmOk = pm.filter((v): v is number => v != null);
  const peak = fires.reduce((best, v, i) => (v > fires[best] ? i : best), 0);
  const state = (name: string) => (s.fires.states[name] ?? []).slice(0, n).reduce((a, b) => a + b, 0);
  // A season average is only shown when most days have PM2.5; otherwise it would describe a few days, not the season.
  const enough = pmOk.length >= 0.8 * n;
  return {
    enough,
    fires: fires.reduce((a, b) => a + b, 0),
    peakDay: addDays(s.start, peak),
    peakN: fires[peak] ?? 0,
    pmMean: pmOk.length ? pmOk.reduce((a, b) => a + b, 0) / pmOk.length : null,
    pmDays: pmOk.length,
    veryPoor: pmOk.filter((v) => v > 120).length,
    punjab: state("Punjab"),
    haryana: state("Haryana"),
  };
}

export default function Seasons({ data, mapSeason, mapDay, onShow }: Props) {
  const seasons = data.seasons?.seasons ?? [];
  const latest = seasons[seasons.length - 1];
  const [yearA, setYearA] = useState<number | undefined>(mapSeason ?? latest?.year);
  const [yearB, setYearB] = useState<number | null>(null);
  const [lag, setLag] = useState(1);
  const A = seasons.find((s) => s.year === yearA) ?? latest;
  const B = yearB != null ? (seasons.find((s) => s.year === yearB) ?? null) : null;

  const rows = useMemo(() => {
    if (!A) return [];
    const len = Math.max(A.fires.india.length, B?.fires.india.length ?? 0, 92);
    return Array.from({ length: len }, (_, i) => ({
      i,
      day: addDays(`${A.year}-09-15`, i),
      firesLag: i - lag >= 0 ? (A.fires.india[i - lag] ?? null) : null,
      firesA: A.fires.india[i] ?? null,
      pmA: A.pm25[i] ?? null,
      cpcbA: A.pm25_source?.[i] === "cpcb",
      embA: A.pm25_source?.[i] === "embassy",
      firesB: B?.fires.india[i] ?? null,
      pmB: B?.pm25[i] ?? null,
    }));
  }, [A, B, lag]);
  const corr = useMemo(() => (A ? LAGS.map((l) => ({ lag: l, ...lagCorrelation(A.fires.india, A.pm25, l) })) : []), [A]);

  if (!A) {
    return (
      <section id="season" className="panel seasons" aria-labelledby="season-title">
        <h2 id="season-title">Burning seasons</h2>
        <p className="gap-note">Season data hasn't been built yet.</p>
      </section>
    );
  }
  const ticks = rows.filter((r) => r.i === 0 || r.day.endsWith("-01")).map((r) => r.i);
  const mapIdx = mapSeason === A.year ? rows.findIndex((r) => r.day === mapDay) : -1;
  // Compare on the same dates: a season in progress limits both to the days it has.
  const common = B ? Math.min(A.fires.india.length, B.fires.india.length) : undefined;
  const sa = stats(A, common);
  const sb = B ? stats(B, common) : null;
  const best = corr.reduce<(typeof corr)[number] | null>((b, c) => (c.r != null && (b?.r == null || c.r > b.r) ? c : b), null);
  const pickDay = (i: number) => {
    const r = rows[i];
    if (r && i < A.fires.india.length) {
      onShow(A.year, r.day);
      document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "start" });
      track("season-day");
    }
  };

  return (
    <section id="season" className="panel seasons" aria-labelledby="season-title">
      <div className="diwali-head">
        <div>
          <h2 id="season-title">Burning seasons, {seasons[0].year}–{latest.year}</h2>
          <p className="muted">
            Fire detections in {SEASON_AREA} each day from 15 Sep to 15 Dec, against Delhi's daily PM2.5. Same satellite (NOAA-20) every year, so seasons compare
            fairly.
          </p>
        </div>
        <div className="year-pills" role="radiogroup" aria-label="Season">
          {seasons.map((s) => (
            <button
              key={s.year}
              type="button"
              role="radio"
              aria-checked={s.year === A.year}
              className={s.year === A.year ? "on" : ""}
              onClick={() => {
                setYearA(s.year);
                if (yearB === s.year) setYearB(null);
                track("season-pick");
              }}
            >
              {s.year}
            </button>
          ))}
        </div>
      </div>

      <div className="season-controls">
        <div className="lag-pick" role="radiogroup" aria-label="Compare PM2.5 with fires this many days earlier">
          <span className="kpi-label">PM2.5 vs fires</span>
          <div className="toggle">
            {corr.map((c) => (
              <button
                key={c.lag}
                type="button"
                role="radio"
                aria-checked={lag === c.lag}
                className={lag === c.lag ? "on" : ""}
                onClick={() => {
                  setLag(c.lag);
                  track(`lag-${c.lag}`);
                }}
              >
                {c.lag === 0 ? "same day" : `${c.lag} d earlier`}
              </button>
            ))}
          </div>
        </div>
        <label className="select">
          <span className="kpi-label">Compare with</span>
          <select
            value={yearB ?? ""}
            onChange={(e) => {
              setYearB(e.target.value ? Number(e.target.value) : null);
              if (e.target.value) track("season-compare");
            }}
          >
            <option value="">No other season</option>
            {seasons
              .filter((s) => s.year !== A.year)
              .map((s) => (
                <option key={s.year} value={s.year}>
                  {s.year}
                </option>
              ))}
          </select>
        </label>
      </div>

      <figure className="trend" aria-label={`Daily fire detections in India and Delhi PM2.5, ${A.year} season. Click a day to show it on the map.`}>
        <figcaption className="trend-head">
          <span className="trend-title">{A.year}: fires and Delhi's air</span>
          <span className="trend-legend">
            <span>
              <i style={{ background: FIRE_NEW }} aria-hidden="true" /> Fire detections{lag ? `, ${lag} d earlier` : ""}
            </span>
            <span>
              <i style={{ background: COLOR_A }} aria-hidden="true" /> PM2.5 (µg/m³)
            </span>
          </span>
        </figcaption>
        <div className="trend-plot tall">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
              onClick={(st) => {
                const i = Number(st?.activeTooltipIndex);
                if (Number.isInteger(i)) pickDay(i);
              }}
              style={{ cursor: "pointer" }}
            >
              <CartesianGrid vertical={false} stroke="#232B40" />
              <XAxis dataKey="i" type="number" domain={[0, rows.length - 1]} ticks={ticks} tickFormatter={(i: number) => dayLabel(rows[i]?.day ?? "")} tick={AXIS} tickLine={false} axisLine={{ stroke: "#232B40" }} />
              <YAxis yAxisId="f" tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmtInt(v)} />
              <YAxis yAxisId="p" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                cursor={{ stroke: "#9AA3B8", strokeWidth: 1 }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const r = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
                  if (!r) return null;
                  const band = pm25Band(r.pmA);
                  return (
                    <div className="trend-tip">
                      <strong>{dayLabel(r.day, true)}</strong>
                      <span>
                        Fires that day: <b>{r.firesA != null ? fmtInt(r.firesA) : "–"}</b>
                      </span>
                      {lag > 0 && (
                        <span>
                          Fires {lag} d earlier: <b>{r.firesLag != null ? fmtInt(r.firesLag) : "–"}</b>
                        </span>
                      )}
                      <span>
                        PM2.5: {r.pmA != null ? <b>{fmtInt(r.pmA)}</b> : "gap"} {band ? `· ${band.name}` : ""}
                        {r.cpcbA ? " · CPCB" : ""}
                        {r.embA ? " · US Embassy only" : ""}
                      </span>
                    </div>
                  );
                }}
              />
              <Bar yAxisId="f" dataKey="firesLag" fill={FIRE_NEW} fillOpacity={0.75} isAnimationActive={false} />
              <Line yAxisId="p" type="linear" dataKey="pmA" stroke={COLOR_A} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              {mapIdx >= 0 && <ReferenceLine yAxisId="f" x={mapIdx} stroke={MARKER} strokeDasharray="4 3" strokeWidth={1.5} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="trend-note muted">
          Bars: NOAA-20 detections in India. Line: Delhi daily PM2.5 (OpenAQ{A.pm25_source?.includes("openaq-archive") ? ", some days rebuilt from its archive" : ""}{A.pm25_source?.includes("cpcb") ? "; some days from CPCB's own reports" : ""}
          {A.pm25_source?.includes("embassy") ? `; ${A.pm25_source.filter((x) => x === "embassy").length} days from the US Embassy monitor alone, as OpenAQ has no government-monitor data for them` : ""}); breaks are days with too
          few stations. Click a day to show it on the map.
        </p>
      </figure>

      {sa.pmDays < 0.8 * A.fires.india.length && (
        <p className="gap-note">
          Delhi PM2.5 is missing for {A.fires.india.length - A.pm25.filter((v) => v != null).length} of {A.fires.india.length} days this season: OpenAQ (including
          its archive) doesn't have enough Delhi stations reporting a full day for those days. The gaps are left empty, not filled.
        </p>
      )}
      <div className="lag-result">
        <p className="plain">
          {corr.map((c, k) => (
            <span key={c.lag}>
              {k > 0 && " · "}
              {c.lag === 0 ? "Same day" : `${c.lag} d earlier`} <b>{c.r != null ? `r = ${c.r.toFixed(2)}` : "–"}</b>
            </span>
          ))}
        </p>
        <p className="muted small">
          {best?.r != null
            ? `In ${A.year}, Delhi's PM2.5 moved most closely with fires ${best.lag === 0 ? "on the same day" : `${best.lag} day${best.lag > 1 ? "s" : ""} earlier`} (correlation ${best.r.toFixed(2)} over ${best.n} days). `
            : "Not enough days with PM2.5 to compare. "}
          Correlation is not cause: fires and PM2.5 both tend to rise through late October and November, and the weather (cold, still air) also
          drives Delhi's PM2.5, whatever its source.
        </p>
      </div>

      {B && sb && (
        <div className="compare-body seasons-compare">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Measure</span>
                </th>
                <th scope="col" style={{ color: COLOR_A }}>
                  {A.year}
                </th>
                <th scope="col" style={{ color: COLOR_B }}>
                  {B.year}
                </th>
                <th scope="col">
                  {Math.min(A.year, B.year)} → {Math.max(A.year, B.year)}
                </th>
              </tr>
            </thead>
            <tbody>
              <Row label="Fire detections, India" a={sa.fires} b={sb.fires} aLater={A.year > B.year} />
              <Row label="… in Punjab" a={sa.punjab} b={sb.punjab} aLater={A.year > B.year} />
              <Row label="… in Haryana" a={sa.haryana} b={sb.haryana} aLater={A.year > B.year} />
              <tr>
                <th scope="row">Peak day</th>
                <td>
                  {dayLabel(sa.peakDay)} ({fmtInt(sa.peakN)})
                </td>
                <td>
                  {dayLabel(sb.peakDay)} ({fmtInt(sb.peakN)})
                </td>
                <td />
              </tr>
              <Row label="Mean PM2.5 (µg/m³)" a={sa.enough ? sa.pmMean : null} b={sb.enough ? sb.pmMean : null} aLater={A.year > B.year} />
              <tr>
                <th scope="row">Days Very poor or worse</th>
                <td>{sa.enough ? `${sa.veryPoor} of ${sa.pmDays}` : "–"}</td>
                <td>{sb.enough ? `${sb.veryPoor} of ${sb.pmDays}` : "–"}</td>
                <td />
              </tr>
              <tr>
                <th scope="row">Days with PM2.5 data</th>
                <td>{sa.pmDays}</td>
                <td>{sb.pmDays}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <div className="seasons-mini">
            <MiniChart title="Fire detections per day" rows={rows} a="firesA" b="firesB" yearA={A.year} yearB={B.year} />
            <MiniChart title="Delhi PM2.5 (µg/m³)" rows={rows} a="pmA" b="pmB" yearA={A.year} yearB={B.year} />
          </div>
          <p className="trend-note muted compare-note">
            {common && common < 92 ? `Compared over the same ${common} days (15 Sep – ${dayLabel(addDays(`${A.year}-09-15`, common - 1))}), as one season is still in progress. ` : ""}
            Change is {Math.min(A.year, B.year)} → {Math.max(A.year, B.year)}.{" "}
            {[A, B]
              .filter((x) => x.pm25_source?.includes("embassy"))
              .map((x) => `${x.year} PM2.5 is mostly the US Embassy monitor alone, which reads about 8% below the city average. `)
              .join("")} PM2.5 averages are left out ("–") when fewer than 80% of days have data.
          </p>
        </div>
      )}
    </section>
  );
}

/** a, b: values for the two seasons; aLater: whether a is the later season. Change always runs earlier -> later. */
function Row({ label, a, b, aLater }: { label: string; a: number | null; b: number | null; aLater: boolean }) {
  const [from, to] = aLater ? [b, a] : [a, b];
  const ch = from && to != null ? ((to - from) / from) * 100 : null;
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{fmtInt(a)}</td>
      <td>{fmtInt(b)}</td>
      <td>{fmtPct(ch, true)}</td>
    </tr>
  );
}

type Rows = { i: number; day: string; firesA: number | null; firesB: number | null; pmA: number | null; pmB: number | null }[];

function MiniChart({ title, rows, a, b, yearA, yearB }: { title: string; rows: Rows; a: "firesA" | "pmA"; b: "firesB" | "pmB"; yearA: number; yearB: number }) {
  const ticks = rows.filter((r) => r.i === 0 || r.day.endsWith("-01")).map((r) => r.i);
  return (
    <figure className="trend">
      <figcaption className="trend-head">
        <span className="trend-title">{title}</span>
        <span className="trend-legend">
          <span>
            <i style={{ background: COLOR_A }} aria-hidden="true" /> {yearA}
          </span>
          <span>
            <i style={{ background: COLOR_B }} aria-hidden="true" /> {yearB}
          </span>
        </span>
      </figcaption>
      <div className="trend-plot">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#232B40" />
            <XAxis dataKey="i" type="number" domain={[0, rows.length - 1]} ticks={ticks} tickFormatter={(i: number) => dayLabel(rows[i]?.day ?? "")} tick={AXIS} tickLine={false} axisLine={{ stroke: "#232B40" }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmtInt(v)} />
            <Tooltip
              cursor={{ stroke: "#9AA3B8", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as Rows[number] | undefined) : undefined;
                if (!r) return null;
                return (
                  <div className="trend-tip">
                    <strong>{dayLabel(r.day)}</strong>
                    <span>
                      {yearA}: {r[a] != null ? <b>{fmtInt(r[a])}</b> : "gap"}
                    </span>
                    <span>
                      {yearB}: {r[b] != null ? <b>{fmtInt(r[b])}</b> : "gap"}
                    </span>
                  </div>
                );
              }}
            />
            <Line type="linear" dataKey={a} stroke={COLOR_A} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line type="linear" dataKey={b} stroke={COLOR_B} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
