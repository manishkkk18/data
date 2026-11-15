import { baselineIndex, fmtPct, fmtRad, latestLoaded, latestWithBaseline, monthLabel, topBrightest, topGrowth, type AppData } from "../data";

type Props = { data: AppData; monthIndex: number; onPick: (id: string) => void };

export default function Insights({ data, monthIndex, onPick }: Props) {
  const m = data.monthly;
  // Use the month on the map when it has the data; otherwise fall back to the latest that does.
  const brightMonth = m.loaded?.[monthIndex] === false ? latestLoaded(m) : monthIndex;
  const growthMonth = baselineIndex(m, monthIndex) != null && m.loaded?.[monthIndex] !== false ? monthIndex : latestWithBaseline(m);
  const brightest = topBrightest(m, brightMonth);
  const growth = growthMonth != null ? topGrowth(m, growthMonth) : [];
  const maxBright = brightest[0]?.value ?? 1;
  const maxGrowth = Math.max(...growth.map((g) => g.pct), 1);

  return (
    <section id="insights" className="insights" aria-label="Insights">
      <article className="panel card">
        <h2>Fastest brightening since 2015</h2>
        <p className="card-sub muted">
          {growthMonth != null
            ? `${monthLabel(m.months[growthMonth])} vs ${monthLabel(m.months[baselineIndex(m, growthMonth)!])} · districts already lit in 2015`
            : "Needs a month processed for both 2015 and later"}
        </p>
        <ol className="bars">
          {growth.map((g, k) => {
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
      </article>

      <article className="panel card">
        <h2>Brightest districts</h2>
        <p className="card-sub muted">{monthLabel(m.months[brightMonth])} · mean radiance, nW/cm²/sr</p>
        <ol className="bars">
          {brightest.map((b, k) => {
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
      </article>

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
    </section>
  );
}
