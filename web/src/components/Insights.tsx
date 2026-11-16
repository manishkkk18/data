import { useMemo, useState } from "react";
import { CITIES, cityMean, districtAreas } from "../geo";
import { baselineIndex, fmtPct, fmtRad, latestLoaded, latestWithBaseline, monthLabel, topBrightest, topGrowth, type AppData } from "../data";

type Props = { data: AppData; monthIndex: number; onPick: (id: string) => void; phone?: boolean };

type Tab = "growth" | "bright" | "cities";
const TABS: [Tab, string][] = [
  ["growth", "Fastest brightening"],
  ["bright", "Brightest"],
  ["cities", "Major cities"],
];
const PHONE_TOP = 5;

export default function Insights({ data, monthIndex, onPick, phone }: Props) {
  const m = data.monthly;
  const [tab, setTab] = useState<Tab>("growth");
  const [more, setMore] = useState(false);
  // Use the month on the map when it has the data; otherwise fall back to the latest that does.
  const brightMonth = m.loaded?.[monthIndex] === false ? latestLoaded(m) : monthIndex;
  const growthMonth = baselineIndex(m, monthIndex) != null && m.loaded?.[monthIndex] !== false ? monthIndex : latestWithBaseline(m);
  const n = phone ? 10 : 5; // phones show the top 5, with "Show more" for the rest
  const brightest = topBrightest(m, brightMonth, n);
  const growth = growthMonth != null ? topGrowth(m, growthMonth, n) : [];
  const maxBright = brightest[0]?.value ?? 1;
  const maxGrowth = Math.max(...growth.map((g) => g.pct), 1);
  const areas = useMemo(() => districtAreas(data), [data]);
  const base = growthMonth != null ? baselineIndex(m, growthMonth) : null;
  const cities = CITIES.map((c) => {
    const now = growthMonth != null ? cityMean(data, areas, c.ids, growthMonth) : null;
    const then = base != null ? cityMean(data, areas, c.ids, base) : null;
    return { ...c, now, then, pct: now != null && then != null && then > 0 ? ((now - then) / then) * 100 : null };
  }).sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity));

  const growthSub =
    growthMonth != null
      ? `${monthLabel(m.months[growthMonth])} vs ${monthLabel(m.months[baselineIndex(m, growthMonth)!])} · districts already lit in 2015`
      : "Needs a month processed for both 2015 and later";
  const brightSub = `${monthLabel(m.months[brightMonth])} · mean radiance, nW/cm²/sr`;
  const cut = <T,>(xs: T[]) => (phone && !more ? xs.slice(0, PHONE_TOP) : xs);

  const growthList = (
    <ol className="bars">
      {cut(growth).map((g, k) => {
        const d = data.byId.get(g.id)!;
        return (
          <li key={g.id}>
            <button type="button" className="bar-row" onClick={() => onPick(g.id)}>
              <span className="bar-rank">{k + 1}</span>
              <span className="bar-name">
                {d.name}
                <span className="muted"> · {d.state}</span>
              </span>
              <span className="bar-value">{fmtPct(g.pct, true)}</span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-fill blue-fill" style={{ width: `${(g.pct / maxGrowth) * 100}%` }} />
              </span>
              <span className="sr-only">
                , from {fmtRad(g.then)} to {fmtRad(g.now)} nW/cm²/sr
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );

  const brightList = (
    <ol className="bars">
      {cut(brightest).map((b, k) => {
        const d = data.byId.get(b.id)!;
        return (
          <li key={b.id}>
            <button type="button" className="bar-row" onClick={() => onPick(b.id)}>
              <span className="bar-rank">{k + 1}</span>
              <span className="bar-name">
                {d.name}
                <span className="muted"> · {d.state}</span>
              </span>
              <span className="bar-value">{fmtRad(b.value)}</span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-fill amber-fill" style={{ width: `${(b.value / maxBright) * 100}%` }} />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );

  const cityTable = (
    <>
      <table className="compare-table city-table">
        <caption className="sr-only">
          Brightness change of 8 major cities, {growthMonth != null && base != null ? `${monthLabel(m.months[base])} to ${monthLabel(m.months[growthMonth])}` : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col">City</th>
            <th scope="col">{base != null ? m.months[base].slice(0, 4) : "2015"}</th>
            <th scope="col">{growthMonth != null ? m.months[growthMonth].slice(0, 4) : "Now"}</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {cut(cities).map((c) => (
            <tr key={c.name}>
              <th scope="row">
                <button type="button" className="link-btn city-btn" onClick={() => onPick(c.pick)}>
                  {c.name}
                </button>
              </th>
              <td>{fmtRad(c.then)}</td>
              <td>{fmtRad(c.now)}</td>
              <td className={c.pct == null ? "muted" : c.pct >= 0 ? "blue" : "red"}>{c.pct == null ? "cloudy" : fmtPct(c.pct, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Mean radiance, nW/cm²/sr, same month both years. Delhi (11 districts) and Mumbai (2) are area-weighted.</p>
    </>
  );

  const aboutCard = (
    <article className="panel card">
      <h2>About the data</h2>
      <ul className="about-points">
        <li>
          <b>Source:</b> NASA Black Marble monthly night lights (VNP46A3), ~500 m pixels, averaged per district.
        </li>
        <li>
          <b>Honest gaps:</b> cloudy months and months not yet processed are shown hatched, never filled in.
        </li>
        <li>
          <b>A proxy, not GDP:</b> lights track electrification and urban activity, but also gas flares and festivals.
        </li>
        <li>
          <b>Checked against ISRO:</b> state trends compared with Bhuvan's figures below.
        </li>
      </ul>
      <p className="card-links">
        <a href="#crosscheck">Bhuvan cross-check</a> · <a href="#about">Method, sources and credits</a>
      </p>
    </article>
  );

  if (phone) {
    const total = tab === "growth" ? growth.length : tab === "bright" ? brightest.length : cities.length;
    return (
      <section id="insights" className="insights" aria-label="Insights">
        <article className="panel card insights-tabs">
          <h2>Insights</h2>
          <div className="tabs" role="tablist" aria-label="Insight lists">
            {TABS.map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`ins-tab-${t}`}
                aria-selected={tab === t}
                aria-controls="ins-panel"
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
          <div id="ins-panel" role="tabpanel" aria-labelledby={`ins-tab-${tab}`} className="tab-panel">
            <p className="card-sub muted">
              {tab === "growth" ? growthSub : tab === "bright" ? brightSub : "Brightness change since 2015, biggest rise first"}
            </p>
            {tab === "growth" ? growthList : tab === "bright" ? brightList : cityTable}
            {total > PHONE_TOP && (
              <button type="button" className="btn show-more" aria-expanded={more} onClick={() => setMore((v) => !v)}>
                {more ? "Show fewer" : `Show all ${total}`}
              </button>
            )}
          </div>
        </article>
        {aboutCard}
      </section>
    );
  }

  return (
    <section id="insights" className="insights" aria-label="Insights">
      <article className="panel card">
        <h2>Fastest brightening since 2015</h2>
        <p className="card-sub muted">{growthSub}</p>
        {growthList}
        <h3 className="insights-sub">8 major cities</h3>
        {cityTable}
      </article>

      <article className="panel card">
        <h2>Brightest districts</h2>
        <p className="card-sub muted">{brightSub}</p>
        {brightList}
      </article>

      {aboutCard}
    </section>
  );
}
