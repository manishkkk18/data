import type { ReactNode } from "react";
import {
  OUTSIDE,
  ago,
  arrivalAt,
  compass,
  upwindDay,
  dayLabel,
  delhiPm25,
  fmtInt,
  fmtPct,
  istDate,
  pm25Band,
  timeLabel,
  windFrame,
  WINDOW_LABEL,
  seasonDays,
  type AppData,
  type Fire,
  type Season,
  type Window,
  type WindLevel,
} from "../data";

type Props = {
  data: AppData;
  day: string; // selected IST day
  at: number; // the map's moment
  window: Window;
  fires: Fire[]; // in the window
  windLevel: WindLevel;
  selectedId: string | null;
  allFires: Fire[]; // every detection on the current timeline (live, or the season's NOAA-20)
  days: string[]; // the current timeline's days
  season: Season | null; // a burning season, or null for the live last 7 days
  expanded: boolean; // bottom-sheet state on phones; ignored on desktop
  onToggle: () => void;
  onClear: () => void;
  onPick: (id: string) => void;
  onShare: () => void;
  away?: boolean;
};

export default function SidePanel(p: Props) {
  const d = p.selectedId ? p.data.byId.get(p.selectedId) : undefined;
  const aq = delhiPm25(p.data.aq, p.at);
  const mine = d ? p.fires.filter((f) => f.district === d.id) : [];
  return (
    <aside className="side panel" aria-label={d ? "District details" : "Today in Delhi"} data-expanded={p.expanded} data-away={p.away || undefined} aria-hidden={p.away || undefined}>
      <button className="sheet-handle" type="button" aria-expanded={p.expanded} onClick={p.onToggle}>
        <span className="sheet-grip" aria-hidden="true" />
        <span className="sheet-peek">
          <span className="sheet-title">
            {d ? d.name : p.season ? `${dayLabel(p.day)} ${p.season.year}` : p.day === istDate(p.data.generated) ? "Today in Delhi" : `Delhi on ${dayLabel(p.day)}`}
          </span>
          <span className="sheet-value">
            {d ? (
              <span className="fire">{fmtInt(mine.length)}</span>
            ) : !p.season && aq ? (
              <span className={pm25Band(aq.now)?.cls}>{fmtInt(aq.now)}</span>
            ) : (
              <span className="fire">{fmtInt(p.fires.filter((f) => f.district).length)}</span>
            )}
          </span>
        </span>
        <span className="sr-only">{p.expanded ? "Collapse details" : "Expand details"}</span>
      </button>
      <div className="side-body">
        {d ? <DistrictCard {...p} fires={mine} all={p.fires} /> : p.season ? <SeasonDay {...p} season={p.season} /> : <Today {...p} aq={aq} />}
      </div>
    </aside>
  );
}

function Today({ data, day, at, window: w, fires, windLevel, onPick, aq }: Props & { aq: ReturnType<typeof delhiPm25> }) {
  const india = fires.filter((f) => f.district);
  const abroad = fires.length - india.length;
  const band = pm25Band(aq?.now);
  const band24 = pm25Band(aq?.avg24);

  // Wind at Delhi: the last grid point is Delhi itself.
  const wi = windFrame(data.wind, at);
  const atDelhi = data.wind && wi != null ? data.wind.levels[windLevel][wi]?.[data.wind.points.length - 1] : null;

  const ly = data.lastYear;
  const lyChange = ly?.available && ly.last_year_count ? ((ly.count! - ly.last_year_count) / ly.last_year_count) * 100 : null;
  const isToday = day === istDate(data.generated);

  return (
    <>
      <div className="side-head">
        <div>
          <h2 className="side-name">{isToday ? "Today in Delhi" : `Delhi on ${dayLabel(day)}`}</h2>
          <p className="muted">{isToday ? `As of ${timeLabel(at)}` : `${dayLabel(day, true)}, end of day`}</p>
        </div>
      </div>

      {aq ? (
        <>
          <div className="big-number">
            <span className={`big-value aqi-value ${band?.cls ?? ""}`}>{fmtInt(aq.now)}</span>
            <span className="big-unit">
              µg/m³ PM2.5 · Delhi average of {aq.stations} stations, {timeLabel(aq.nowT)}
            </span>
          </div>
          <p className="plain">
            {band && <span className={`aqi-badge ${band.cls}`}>{band.name}</span>} 24-hour average{" "}
            {aq.avg24 != null ? (
              <>
                <b>{fmtInt(aq.avg24)}</b> µg/m³ {band24 && <span className={`aqi-badge ${band24.cls}`}>{band24.name}</span>}
              </>
            ) : (
              <span className="muted">not enough hours to average ({aq.hours24} of 18)</span>
            )}
          </p>
        </>
      ) : (
        <p className="gap-note">
          Delhi's air-quality readings aren't loaded yet. They come from CPCB stations via OpenAQ, which needs an API key in the pipeline. We show a gap rather than
          guess.
        </p>
      )}

      <div className="tiles">
        <Tile label={`Fires · ${WINDOW_LABEL[w]}`} value={fmtInt(india.length)} tone="fire" hint={abroad ? `+${fmtInt(abroad)} across the border` : "in India"} />
        <Tile
          label="vs a year ago"
          value={lyChange != null ? fmtPct(lyChange, true) : "–"}
          hint={ly?.available ? `${dayLabel(ly.date!)}: ${fmtInt(ly.count)} vs ${fmtInt(ly.last_year_count)}` : "needs the FIRMS key"}
          hint2={ly?.available ? "NOAA-20 only, so it's fair" : undefined}
        />
        <Tile
          label="Wind at Delhi"
          value={atDelhi ? `${atDelhi[0].toFixed(0)} m/s` : "–"}
          tone="blue"
          hint={atDelhi ? `from the ${compass(atDelhi[1])}` : "no wind data"}
          hint2={windLevel === "850hPa" ? "~1.5 km up" : "near the ground"}
        />
      </div>

      <WhoseSmoke data={data} day={day} at={at} onPick={onPick} />

      <TopDistricts data={data} fires={india} window={w} onPick={onPick}>
        <Freshness data={data} />
      </TopDistricts>
    </>
  );
}

/** Story cards for the districts with the most detections in the window (Night Lights' story style). */
function TopDistricts({ data, fires, window: w, onPick, children }: { data: AppData; fires: Fire[]; window: Window; onPick: (id: string) => void; children?: ReactNode }) {
  const byDistrict = new Map<string, { n: number; frp: number; last: number }>();
  for (const f of fires) {
    if (!f.district) continue;
    const e = byDistrict.get(f.district) ?? { n: 0, frp: 0, last: 0 };
    e.n++;
    e.frp += f.frp;
    e.last = Math.max(e.last, f.t);
    byDistrict.set(f.district, e);
  }
  const top = [...byDistrict.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3);
  return (
    <div className="stories">
      <p className="stories-intro muted">Most fire detections in the last {WINDOW_LABEL[w]}. Tap one to fly there.</p>
      {top.map(([id, e], k) => {
        const dist = data.byId.get(id);
        if (!dist) return null;
        return (
          <button key={id} type="button" className="story" onClick={() => onPick(id)}>
            <span className="story-kicker">
              #{k + 1} · {dist.state}
            </span>
            <span className="story-name">{dist.name}</span>
            <span className="story-value fire">
              {fmtInt(e.n)}
              <span className="story-unit"> detections</span>
            </span>
            <span className="story-line muted">
              {fmtInt(e.frp)} MW total fire power · latest {timeLabel(e.last)}
            </span>
            <span className="story-go" aria-hidden="true">
              Fly there →
            </span>
          </button>
        );
      })}
      {!top.length && <p className="gap-note">No fire detections in India in this window. Cloud cover can hide fires from the satellites.</p>}
      {children}
    </div>
  );
}

/** Side panel for a day in a burning season: Delhi's daily PM2.5, the day's fires and the season so far. */
function SeasonDay({ data, day, at, window: w, fires, onPick, season }: Props & { season: Season }) {
  const i = Math.max(0, seasonDays(season).indexOf(day));
  const pm = season.pm25[i];
  const band = pm25Band(pm);
  const india = season.fires.india;
  const toDate = india.slice(0, i + 1).reduce((a, b) => a + b, 0);
  // The same dates in the previous season, for a fair season-to-date comparison (same sensor).
  const prev = data.seasons?.seasons.find((x) => x.year === season.year - 1);
  const prevToDate = prev ? prev.fires.india.slice(0, i + 1).reduce((a, b) => a + b, 0) : null;
  const change = prevToDate ? ((toDate - prevToDate) / prevToDate) * 100 : null;
  const hasUpwind = !!upwindDay(data.upwind, day);
  return (
    <>
      <div className="side-head">
        <div>
          <h2 className="side-name">
            Delhi on {dayLabel(day)} {season.year}
          </h2>
          <p className="muted">{season.year} burning season · NOAA-20 detections only</p>
        </div>
      </div>
      {pm != null ? (
        <>
          <div className="big-number">
            <span className={`big-value aqi-value ${band?.cls ?? ""}`}>{fmtInt(pm)}</span>
            <span className="big-unit">µg/m³ PM2.5 · Delhi daily mean of reference monitors</span>
          </div>
          {band && (
            <p className="plain">
              <span className={`aqi-badge ${band.cls}`}>{band.name}</span>
            </p>
          )}
        </>
      ) : (
        <p className="gap-note">
          {season.pm25_sensors
            ? "No PM2.5 for this day: too few stations reported a full day. We show a gap rather than guess."
            : "No Delhi air-quality data for this season."}
        </p>
      )}
      <div className="tiles">
        <Tile label="Fires that day" value={fmtInt(india[i])} tone="fire" hint="in India" />
        <Tile label="Season to date" value={fmtInt(toDate)} tone="fire" hint={`since 15 Sep ${season.year}`} />
        <Tile
          label={`vs ${season.year - 1}`}
          value={change != null ? fmtPct(change, true) : "–"}
          hint={prevToDate != null ? `${fmtInt(prevToDate)} by ${dayLabel(day)}` : "no earlier season"}
        />
      </div>
      {hasUpwind ? (
        <WhoseSmoke data={data} day={day} at={at} onPick={onPick} />
      ) : (
        <p className="muted small">The air's path and upwind shares are worked out for the last 7 days only.</p>
      )}
      <TopDistricts data={data} fires={fires} window={w} onPick={onPick}>
        <p className="stories-foot muted small freshness">
          Season data built <b className="mono">{ago(Date.parse(season.built_utc))}</b>
          {!season.complete && " · season in progress"}
        </p>
      </TopDistricts>
    </>
  );
}

function DistrictCard({ data, selectedId, fires, all, allFires, days, window: w, at, onClear, onShare }: Props & { all: Fire[] }) {
  const d = selectedId ? data.byId.get(selectedId) : undefined;
  if (!d) return null;
  const frp = fires.reduce((s, f) => s + f.frp, 0);
  const indiaTotal = all.filter((f) => f.district).length;
  const share = indiaTotal ? (fires.length / indiaTotal) * 100 : null;
  // Rank among districts with detections in the window.
  const counts = new Map<string, number>();
  for (const f of allFires) if (f.district && f.t <= at && f.t > at - 7 * 86400000) counts.set(f.district, (counts.get(f.district) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const rank = ranked.findIndex(([k]) => k === d.id) + 1;
  const n24 = allFires.filter((f) => f.district === d.id && f.t <= at && f.t > at - 86400000).length;
  const n7 = counts.get(d.id) ?? 0;
  // Detections per IST day, for the small chart (empty days are real zeros: the satellites passed).
  // Detections per IST day (empty days are real zeros: the satellites passed); up to 14 days ending at the map's day.
  const mineAll = allFires.filter((f) => f.district === d.id);
  const end = Math.max(days.indexOf(istDate(at)), 0);
  const perDay = days.slice(Math.max(0, end - 13), end + 1).map((day) => ({ day, n: mineAll.filter((f) => istDate(f.t) === day).length }));

  return (
    <>
      <div className="side-head">
        <div>
          <h2 className="side-name">{d.name}</h2>
          <p className="muted">{d.state}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClear} aria-label="Clear selection">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="big-number">
        <span className="big-value fire">{fmtInt(fires.length)}</span>
        <span className="big-unit">fire detections · last {WINDOW_LABEL[w]} to {timeLabel(at)}</span>
      </div>
      {fires.length ? (
        <p className="plain">
          <b>{fmtPct(share)}</b> of detections in north-west India · <b>{fmtInt(frp)}</b> MW total fire power
        </p>
      ) : (
        <p className="gap-note">No detections in this window. That can mean no burning, or fires the satellites missed (cloud, or burning between passes).</p>
      )}
      <div className="tiles">
        <Tile label="Last 24 h" value={fmtInt(n24)} tone="fire" />
        <Tile label="Last 7 days" value={fmtInt(n7)} tone="fire" />
        <Tile label="Rank, 7 days" value={rank ? `#${rank}` : "–"} hint={rank ? `of ${ranked.length} districts` : "no detections"} />
      </div>
      <DayBars rows={perDay} />
      <div className="side-actions">
        <button type="button" className="btn" onClick={onClear}>
          Back to today
        </button>
        <button type="button" className="btn" onClick={onShare}>
          Share
        </button>
      </div>
      <Freshness data={data} />
    </>
  );
}

/** Detections per day as small bars (same look as India Night Lights' hw-chart). */
function DayBars({ rows }: { rows: { day: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const W = 320;
  const H = 96;
  const bw = W / rows.length;
  return (
    <figure className="hw-chart day-bars">
      <figcaption className="trend-title">Detections per day</figcaption>
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={rows.map((r) => `${dayLabel(r.day)}: ${r.n}`).join(", ")}>
        <line className="grid" x1="0" x2={W} y1={H} y2={H} />
        {rows.map((r, i) => {
          const h = (r.n / max) * (H - 14);
          return (
            <g key={r.day}>
              <rect x={i * bw + bw * 0.18} width={bw * 0.64} y={H - h} height={h} rx="2" className="fire-fill" />
              {r.n > 0 && (
                <text className="axis" x={i * bw + bw / 2} y={H - h - 3} textAnchor="middle">
                  {r.n}
                </text>
              )}
              <text className="axis" x={i * bw + bw / 2} y={H + 12} textAnchor="middle">
                {dayLabel(r.day).split(" ")[0]}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Indicative upwind fire share: where the air reaching Delhi passed, and what was burning there. */
function WhoseSmoke({ data, day, at, onPick }: { data: AppData; day: string; at: number; onPick: (id: string) => void }) {
  const u = data.upwind;
  if (!u) return <p className="gap-note">The air's path into Delhi isn't available for this run, so upwind shares can't be shown.</p>;
  const d = upwindDay(u, day);
  const a = arrivalAt(u, at);
  const total = u.days.filter((x) => x.complete).map((x) => x.load);
  const typical = total.length ? [...total].sort((p, q) => p - q)[Math.floor(total.length / 2)] : null;
  const from = a?.paths["850hPa"] ?? a?.paths["10m"];
  const start = from && from.length > 12 ? from[12] : null;
  const dirFrom = start ? bearingFrom(start, from![0]) : null;
  const states = (d?.states ?? []).slice(0, 5);
  const districts = (d?.districts ?? []).filter(([id]) => id !== OUTSIDE).slice(0, 5);
  const maxS = states[0]?.[1] ?? 1;
  const maxD = districts[0]?.[1] ?? 1;
  const name = (s: string) => (s === OUTSIDE ? "Across the border" : s);

  return (
    <section className="whose" aria-labelledby="whose-title">
      <div className="whose-head">
        <h3 id="whose-title" className="trend-title">
          Whose smoke is reaching Delhi?
        </h3>
        <p className="whose-note">Indicative, based on wind and fire detections. Not a source-apportionment study.</p>
      </div>
      {a && dirFrom && (
        <p className="plain">
          Air arriving at {timeLabel(Date.parse(a.t)).split(", ")[1]} came from the <b className="blue-b">{dirFrom}</b>
          {d && d.load > 0 && typical ? (
            <>
              {" "}
              · upwind fire load {d.load >= typical * 1.3 ? "above" : d.load <= typical * 0.7 ? "below" : "near"} this week's typical day
            </>
          ) : null}
        </p>
      )}
      {!d || !states.length ? (
        <p className="gap-note">No fires were detected along the air's path {d ? "on this day" : "yet"}. Clouds can hide fires from the satellites.</p>
      ) : (
        <>
          {!d.complete &&
            (day === istDate(data.generated) && d.arrivals < 8 ? (
              <p className="muted small">So far today: {d.arrivals} of 8 three-hourly arrivals.</p>
            ) : (
              <p className="gap-note">Partial day: {d.arrivals} of 8 three-hourly arrivals, or fire records don't reach back 48 hours.</p>
            ))}
          <p className="insights-sub">Share of upwind fire load · {dayLabel(day)}</p>
          <ol className="bars">
            {states.map(([s, v], k) => (
              <li key={s}>
                <div className="bar-row static">
                  <span className="bar-rank">{k + 1}</span>
                  <span className="bar-name">{name(s)}</span>
                  <span className="bar-value">{fmtPct(v * 100)}</span>
                  <span className="bar-track" aria-hidden="true">
                    <span className="bar-fill fire-bg" style={{ width: `${(v / maxS) * 100}%` }} />
                  </span>
                </div>
              </li>
            ))}
          </ol>
          {districts.length > 0 && (
            <>
              <p className="insights-sub">Top upwind districts</p>
              <ol className="bars">
                {districts.map(([id, v], k) => {
                  const dist = data.byId.get(id);
                  if (!dist) return null;
                  return (
                    <li key={id}>
                      <button type="button" className="bar-row" onClick={() => onPick(id)}>
                        <span className="bar-rank">{k + 1}</span>
                        <span className="bar-name">
                          {dist.name}
                          <span className="muted"> · {dist.state}</span>
                        </span>
                        <span className="bar-value">{fmtPct(v * 100)}</span>
                        <span className="bar-track" aria-hidden="true">
                          <span className="bar-fill fire-bg" style={{ width: `${(v / maxD) * 100}%` }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          <p className="trend-note muted">
            Fires along the air's 48-hour path, weighted by fire power, closeness to the path and how recently the air passed. It shows where upwind
            burning was, not how much of Delhi's PM2.5 it caused.
          </p>
        </>
      )}
    </section>
  );
}

/** Compass direction the air came FROM: from Delhi (end) back to an earlier point (start). */
function bearingFrom(start: [number, number], end: [number, number]) {
  const dx = (start[0] - end[0]) * Math.cos((end[1] * Math.PI) / 180);
  const dy = start[1] - end[1];
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return compass((deg + 360) % 360);
}

function Freshness({ data }: { data: AppData }) {
  const m = data.meta;
  return (
    <p className="stories-foot muted small freshness">
      Fires updated <b className="mono">{ago(Date.parse(m.fires?.updated_utc ?? ""))}</b>
      {data.latestDetection && <> · latest satellite pass {timeLabel(data.latestDetection)}</>}
      {data.firesMethod === "public-7d" && <> · preview data (public 7-day file)</>}
      <br />
      Wind {m.wind?.updated_utc ? <b className="mono">{ago(Date.parse(m.wind.updated_utc))}</b> : "unavailable"} · Air quality{" "}
      {m.aq?.updated_utc ? <b className="mono">{ago(Date.parse(m.aq.updated_utc))}</b> : "not loaded"}
    </p>
  );
}

function Tile({ label, value, hint, hint2, tone }: { label: string; value: string; hint?: string; hint2?: string; tone?: "fire" | "blue" }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className={`tile-value ${tone ?? ""}`}>{value}</span>
      {hint && <span className="tile-hint">{hint}</span>}
      {hint2 && <span className="tile-hint">{hint2}</span>}
    </div>
  );
}
