import { useEffect, useMemo, useState } from "react";
import { addDays, dayLabel, fmtInt, fmtPct, istDate, loadSeasonFires, SEASON_AREA, type AppData, type Fire, type Season } from "../data";
import { track } from "../analytics";

// Fires by state and district: a season so far vs the same dates a year earlier (NOAA-20 only).
// Same card layout as India Night Lights' Insights (three cards; tabs on phones).

type Props = { data: AppData; onPick: (id: string) => void; phone?: boolean };
type Tab = "states" | "districts" | "change";
const TABS: [Tab, string][] = [
  ["states", "States"],
  ["districts", "Top districts"],
  ["change", "Biggest changes"],
];
const STATES = ["Punjab", "Haryana", "Uttar Pradesh", "Madhya Pradesh", "Rajasthan"];
const PHONE_TOP = 5;

/** Detections per district on IST days from the season start up to `last` (inclusive). */
function countByDistrict(fires: Fire[], last: string) {
  const out = new Map<string, number>();
  for (const f of fires) if (f.district && istDate(f.t) <= last) out.set(f.district, (out.get(f.district) ?? 0) + 1);
  return out;
}

export default function Leaderboards({ data, onPick, phone }: Props) {
  const seasons = data.seasons?.seasons ?? [];
  const pairs = seasons.filter((s) => seasons.some((p) => p.year === s.year - 1)).map((s) => s.year).reverse();
  const [year, setYear] = useState<number | undefined>(pairs[0]);
  const [tab, setTab] = useState<Tab>("states");
  const [more, setMore] = useState(false);
  const A = seasons.find((s) => s.year === year);
  const B = A ? seasons.find((s) => s.year === A.year - 1) : undefined;
  const [fires, setFires] = useState<Record<number, Fire[]>>({});

  // District counts need the detections themselves: fetch the two seasons once.
  useEffect(() => {
    if (!A || !B) return;
    for (const y of [A.year, B.year]) {
      if (fires[y]) continue;
      loadSeasonFires(y)
        .then((f) => setFires((m) => ({ ...m, [y]: f })))
        .catch(() => {});
    }
  }, [A, B]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same dates in both seasons: a season in progress limits both to the days it has.
  const n = A && B ? Math.min(A.fires.india.length, B.fires.india.length) : 0;
  const states = useMemo(() => {
    if (!A || !B) return [];
    const sum = (s: Season, name: string) => (s.fires.states[name] ?? []).slice(0, n).reduce((a, b) => a + b, 0);
    return STATES.map((name) => ({ name, now: sum(A, name), then: sum(B, name) })).sort((a, b) => b.now - a.now);
  }, [A, B, n]);
  const districts = useMemo(() => {
    if (!A || !B || !fires[A.year] || !fires[B.year]) return null;
    const now = countByDistrict(fires[A.year], addDays(A.start, n - 1));
    const then = countByDistrict(fires[B.year], addDays(B.start, n - 1));
    const ids = new Set([...now.keys(), ...then.keys()]);
    return [...ids].map((id) => ({ id, now: now.get(id) ?? 0, then: then.get(id) ?? 0 })).filter((d) => data.byId.has(d.id));
  }, [A, B, n, fires, data]);

  if (!A || !B) return null;
  const top = districts ? [...districts].sort((a, b) => b.now - a.now).slice(0, 10) : [];
  const falls = districts ? [...districts].sort((a, b) => a.now - a.then - (b.now - b.then)).slice(0, 5) : [];
  const rises = districts ? [...districts].filter((d) => d.now > d.then).sort((a, b) => b.now - b.then - (a.now - a.then)).slice(0, 5) : [];
  const maxState = Math.max(1, ...states.map((s) => Math.max(s.now, s.then)));
  const maxTop = Math.max(1, ...top.map((d) => d.now));
  const cut = <T,>(xs: T[]) => (phone && !more ? xs.slice(0, PHONE_TOP) : xs);
  const range = `15 Sep – ${dayLabel(addDays(A.start, n - 1))}`;
  const sub = `${range}, ${A.year} vs ${B.year} · NOAA-20 detections in ${SEASON_AREA.split(" (")[0]}`;
  const pct = (now: number, then: number) => (then ? ((now - then) / then) * 100 : null);
  // More fire is fire-coloured; fewer is plain text (blue is kept for selection and wind).
  const tone = (now: number, then: number) => (now > then ? "fire" : "");

  const picker = (
    <label className="select leader-year">
      <span className="kpi-label">Season</span>
      <select
        value={A.year}
        onChange={(e) => {
          setYear(Number(e.target.value));
          track("leaders-year");
        }}
      >
        {pairs.map((y) => (
          <option key={y} value={y}>
            {y} vs {y - 1}
          </option>
        ))}
      </select>
    </label>
  );

  const stateList = (
    <ol className="bars">
      {states.map((s, k) => (
        <li key={s.name}>
          <div className="bar-row static">
            <span className="bar-rank">{k + 1}</span>
            <span className="bar-name">
              {s.name}
              <span className="sr-only">, {fmtInt(s.then)} in {B.year}</span>
            </span>
            <span className="bar-value">
              {fmtInt(s.now)} <small className={tone(s.now, s.then)}>{fmtPct(pct(s.now, s.then), true)}</small>
            </span>
            <span className="bar-track pair" aria-hidden="true">
              <span className="bar-fill fire-bg" style={{ width: `${(s.now / maxState) * 100}%` }} />
              <span className="bar-ghost" style={{ left: `${(s.then / maxState) * 100}%` }} />
            </span>
          </div>
        </li>
      ))}
    </ol>
  );

  const districtRow = (d: { id: string; now: number; then: number }, k: number, value: React.ReactNode, width: number | null, detail?: string) => {
    const dist = data.byId.get(d.id)!;
    return (
      <li key={d.id}>
        <button type="button" className="bar-row" onClick={() => onPick(d.id)} title={`${dist.name}, ${dist.state}`}>
          <span className="bar-rank">{k + 1}</span>
          <span className="bar-name">
            {dist.name}
            <span className="muted"> · {detail ?? dist.state}</span>
          </span>
          <span className="bar-value">{value}</span>
          {width != null && (
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill fire-bg" style={{ width: `${width}%` }} />
            </span>
          )}
          <span className="sr-only">
            , {fmtInt(d.then)} in {B.year}
          </span>
        </button>
      </li>
    );
  };
  const loading = <p className="muted small">Loading district counts…</p>;
  const topList = districts ? (
    <ol className="bars">
      {cut(top).map((d, k) =>
        districtRow(
          d,
          k,
          <>
            {fmtInt(d.now)} <small className={tone(d.now, d.then)}>{fmtPct(pct(d.now, d.then), true)}</small>
          </>,
          (d.now / maxTop) * 100,
        ),
      )}
    </ol>
  ) : (
    loading
  );
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtInt(Math.abs(v))}`;
  const changeLists = districts ? (
    <>
      <h3 className="insights-sub">Fewer detections</h3>
      <ol className="bars">
        {falls.map((d, k) =>
          districtRow(
            d,
            k,
            <span>{signed(d.now - d.then)}</span>,
            null,
            `${fmtInt(d.then)} → ${fmtInt(d.now)}`,
          ),
        )}
      </ol>
      <h3 className="insights-sub">More detections</h3>
      {rises.length ? (
        <ol className="bars">
          {rises.map((d, k) =>
            districtRow(
              d,
              k,
              <span className="fire">{signed(d.now - d.then)}</span>,
              null,
              `${fmtInt(d.then)} → ${fmtInt(d.now)}`,
            ),
          )}
        </ol>
      ) : (
        <p className="muted small">No district has more detections than last season over these dates.</p>
      )}
    </>
  ) : (
    loading
  );
  const note = (
    <p className="trend-note muted">
      Detections, not fires or area burned. Some change may be burning moving to after the satellite's afternoon pass (<a href="#limits">Limits</a>).
    </p>
  );

  if (phone) {
    const total = tab === "districts" ? top.length : 0;
    return (
      <section id="leaders" className="insights" aria-label="Fire leaderboards">
        <article className="panel card insights-tabs">
          <div className="leader-head">
            <h2>Fire leaderboards</h2>
            {picker}
          </div>
          <div className="tabs" role="tablist" aria-label="Leaderboards">
            {TABS.map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`ld-tab-${t}`}
                aria-selected={tab === t}
                aria-controls="ld-panel"
                className={tab === t ? "on" : ""}
                onClick={() => {
                  setTab(t);
                  setMore(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div id="ld-panel" role="tabpanel" aria-labelledby={`ld-tab-${tab}`} className="tab-panel">
            <p className="card-sub muted">{sub}</p>
            {tab === "states" ? stateList : tab === "districts" ? topList : changeLists}
            {total > PHONE_TOP && (
              <button type="button" className="btn show-more" aria-expanded={more} onClick={() => setMore((v) => !v)}>
                {more ? "Show fewer" : `Show all ${total}`}
              </button>
            )}
            {note}
          </div>
        </article>
      </section>
    );
  }

  return (
    <section id="leaders" className="insights" aria-label="Fire leaderboards">
      <article className="panel card">
        <div className="leader-head">
          <h2>Fires by state</h2>
          {picker}
        </div>
        <p className="card-sub muted">{sub}</p>
        {stateList}
        <p className="trend-note muted">
          Bar: {A.year}. Tick: {B.year} over the same dates.
        </p>
      </article>
      <article className="panel card">
        <h2>Top districts</h2>
        <p className="card-sub muted">{sub}</p>
        {topList}
      </article>
      <article className="panel card">
        <h2>Biggest changes</h2>
        <p className="card-sub muted">{sub}</p>
        {changeLists}
        {note}
      </article>
    </section>
  );
}
