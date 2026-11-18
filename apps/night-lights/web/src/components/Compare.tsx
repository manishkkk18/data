import { lazy, Suspense, useMemo } from "react";
import { Search } from "./Header";
import { changePct, fmtPct, fmtRad, growthPct, latestLoaded, monthLabel, type AppData, type MonthSummary } from "../data";

import { COLOR_A, COLOR_B } from "./chartColors";

const CompareChart = lazy(() => import("./CompareChart"));

type Props = {
  data: AppData;
  monthIndex: number;
  summary: MonthSummary;
  aId: string | null;
  bId: string | null;
  onPickA: (id: string) => void;
  onPickB: (id: string | null) => void;
  onSwap: () => void;
  onPickMonth: (i: number) => void;
};

export default function Compare({ data, monthIndex, summary, aId, bId, onPickA, onPickB, onSwap, onPickMonth }: Props) {
  const m = data.monthly;
  const districts = useMemo(() => [...data.byId.values()].sort((x, y) => x.name.localeCompare(y.name)), [data]);
  const a = aId ? data.byId.get(aId) : undefined;
  const b = bId ? data.byId.get(bId) : undefined;
  const mi = m.loaded?.[monthIndex] === false ? latestLoaded(m) : monthIndex;

  const rows = (id: string) => {
    const col = data.index.get(id)!;
    const sr = summary.stateRank.get(id);
    return {
      radiance: fmtRad(m.mean[mi][col]),
      lit: fmtPct(m.lit[mi][col]),
      observed: fmtPct(m.valid[mi][col]),
      y1: fmtPct(changePct(m, col, mi, 1), true),
      y5: fmtPct(changePct(m, col, mi, 5), true),
      since2015: fmtPct(growthPct(m, col, mi), true),
      rank: summary.rank.get(id) ? `#${summary.rank.get(id)} of ${summary.withData}` : "–",
      stateRank: sr ? `#${sr[0]} of ${sr[1]}` : "–",
    };
  };
  const ra = a ? rows(a.id) : null;
  const rb = b ? rows(b.id) : null;
  const metrics: [keyof NonNullable<typeof ra>, string][] = [
    ["radiance", "Radiance (nW/cm²/sr)"],
    ["lit", "Lit area"],
    ["observed", "Observed (clear sky)"],
    ["y1", "1-year change"],
    ["y5", "5-year change"],
    ["since2015", "Since 2015"],
    ["rank", "National rank"],
    ["stateRank", "Rank in state"],
  ];

  return (
    <section id="compare" className="panel compare" aria-labelledby="compare-title">
      <div className="compare-head">
        <h2 id="compare-title">Compare districts</h2>
        <p className="muted small">{monthLabel(m.months[mi])}</p>
      </div>

      <div className="compare-pickers">
        <div className="picker">
          <span className="picker-label">
            <i style={{ background: COLOR_A }} aria-hidden="true" /> First district
          </span>
          {a ? (
            <p className="picked">
              {a.name} <span className="muted">· {a.state}</span>
            </p>
          ) : (
            <p className="muted small">Select one on the map, or search:</p>
          )}
          <Search districts={districts} onPick={onPickA} placeholder={a ? "Change first district" : "Search first district"} label="Choose first district" />
        </div>
        <button type="button" className="icon-btn swap" onClick={onSwap} disabled={!a || !b} aria-label="Swap the two districts">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 7h11l-3-3M16 13H5l3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="picker">
          <span className="picker-label">
            <i style={{ background: COLOR_B }} aria-hidden="true" /> Compare with
          </span>
          {b ? (
            <p className="picked">
              {b.name} <span className="muted">· {b.state}</span>{" "}
              <button type="button" className="link-btn" onClick={() => onPickB(null)}>
                Clear
              </button>
            </p>
          ) : (
            <p className="muted small">Pick a second district:</p>
          )}
          <Search districts={districts} onPick={(id) => onPickB(id)} placeholder="Search second district" label="Choose district to compare with" />
        </div>
      </div>

      {a && b && ra && rb ? (
        <div className="compare-body">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Measure</span>
                </th>
                <th scope="col">{a.name}</th>
                <th scope="col">{b.name}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(([k, label]) => (
                <tr key={k}>
                  <th scope="row">{label}</th>
                  <td>{ra[k]}</td>
                  <td>{rb[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Suspense fallback={<div className="chart-placeholder"><p className="muted small">Loading chart…</p></div>}>
            <CompareChart data={data} aId={a.id} bId={b.id} monthIndex={monthIndex} onPickMonth={onPickMonth} />
          </Suspense>
        </div>
      ) : (
        <p className="muted compare-empty">Choose two districts to see their numbers and trends side by side. The second one is outlined with a dashed line on the map.</p>
      )}
    </section>
  );
}
