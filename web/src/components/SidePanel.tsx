import { changePct, fmtPct, fmtRad, monthLabel, type AppData, type MonthSummary } from "../data";
import { lazy, Suspense } from "react";
import StoryCards from "./StoryCards";

// The chart library is ~110 KB gzipped; load it only once someone opens a district,
// so the first map view isn't slowed down.
const TrendChart = lazy(() => import("./TrendChart"));

type Props = {
  data: AppData;
  monthIndex: number;
  summary: MonthSummary;
  selectedId: string | null;
  expanded: boolean; // bottom-sheet state on phones; ignored on desktop
  onToggle: () => void;
  onClear: () => void;
  onPickMonth: (i: number) => void;
  onCompare: () => void;
  onPickStory: (id: string) => void; // a story card was tapped: select + fly
  onShare: () => void;
};

export default function SidePanel({ data, monthIndex, summary, selectedId, expanded, onToggle, onClear, onPickMonth, onCompare, onPickStory, onShare }: Props) {
  const m = data.monthly;
  const d = selectedId ? data.byId.get(selectedId) : undefined;
  const col = d ? data.index.get(d.id) : undefined;
  const month = m.months[monthIndex];

  const mean = col != null ? m.mean[monthIndex][col] : null;
  const est = col != null && mean == null ? (m.est?.[monthIndex][col] ?? null) : null;
  const lit = col != null ? m.lit[monthIndex][col] : null;
  const valid = col != null ? m.valid[monthIndex][col] : null;
  const rank = d ? summary.rank.get(d.id) : undefined;
  const stateRank = d ? summary.stateRank.get(d.id) : undefined;
  const ch1 = col != null ? changePct(m, col, monthIndex, 1) : null;
  const ch5 = col != null ? changePct(m, col, monthIndex, 5) : null;
  const needsHistory = m.months.length < 13;
  // Plain-language context for the number: where it sits among districts, and against India.
  const brighterThan = rank && summary.withData > 1 ? Math.round(((summary.withData - rank) / (summary.withData - 1)) * 100) : null;
  const multiple = mean != null && summary.avg ? mean / summary.avg : null;

  return (
    <aside className="side panel" aria-label="District details" data-expanded={expanded}>
      <button className="sheet-handle" type="button" aria-expanded={expanded} onClick={onToggle}>
        <span className="sheet-grip" aria-hidden="true" />
        <span className="sheet-peek">
          <span className="sheet-title">{d ? d.name : "Stories from the data"}</span>
          <span className="sheet-value">{d ? fmtRad(mean ?? est) : ""}</span>
        </span>
        <span className="sr-only">{expanded ? "Collapse details" : "Expand details"}</span>
      </button>

      <div className="side-body">
        {d ? (
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
              <span className={`big-value ${est != null ? "estimate" : ""}`}>{fmtRad(mean ?? est)}</span>
              <span className="big-unit">
                nW/cm²/sr · {monthLabel(month)}
                {est != null && <span className="est-badge">NASA estimate</span>}
              </span>
            </div>
            {est != null ? (
              <p className="gap-note">
                Cloudy month: only {fmtPct(valid)} of the district was observed. This is NASA's estimate, filled in from earlier months, so it isn't used in
                ranks, changes or insights.
              </p>
            ) : mean == null && m.loaded?.[monthIndex] === false ? (
              <p className="gap-note">No data for this month: not processed yet, or unavailable from NASA.</p>
            ) : mean == null ? (
              <p className="gap-note">
                No clear view this month: only {fmtPct(valid)} of the district was observed (clouds). We show a gap rather than guess.
              </p>
            ) : (
              <>
                <p className="plain">
                  {brighterThan != null && (
                    <>
                      Brighter than <b>{brighterThan}%</b> of districts
                    </>
                  )}
                  {multiple != null && (
                    <>
                      {" · "}
                      <b>{multiple >= 10 ? multiple.toFixed(0) : multiple.toFixed(1)}×</b> the national average
                    </>
                  )}
                </p>
                <p className="muted small">
                  {fmtPct(lit)} of the district is lit · {fmtPct(valid)} observed
                </p>
              </>
            )}

            <div className="tiles">
              <Tile label="1-year change" value={fmtPct(ch1, true)} tone={ch1} hint={ch1 == null && needsHistory ? "after backfill" : undefined} />
              <Tile label="5-year change" value={fmtPct(ch5, true)} tone={ch5} hint={ch5 == null && needsHistory ? "after backfill" : undefined} />
              <Tile
                label="National rank"
                value={rank ? `#${rank}` : "–"}
                hint={rank ? `of ${summary.withData}` : undefined}
                hint2={stateRank ? `#${stateRank[0]} of ${stateRank[1]} in ${d.state}` : undefined}
              />
            </div>

            <Suspense fallback={<div className="chart-placeholder"><p className="muted small">Loading chart…</p></div>}>
              <TrendChart data={data} districtId={d.id} monthIndex={monthIndex} onPickMonth={onPickMonth} />
            </Suspense>

            <div className="side-actions three">
              <button type="button" className="btn" onClick={onCompare}>Compare with…</button>
              <button type="button" className="btn" onClick={() => downloadCsv(data, d.id)}>Download CSV</button>
              <button type="button" className="btn" onClick={onShare}>
                Share
              </button>
            </div>
          </>
        ) : (
          <StoryCards data={data} monthIndex={monthIndex} summary={summary} onPick={onPickStory} />
        )}
      </div>
    </aside>
  );
}

function Tile({ label, value, hint, hint2, tone }: { label: string; value: string; hint?: string; hint2?: string; tone?: number | null }) {
  const cls = tone == null ? "" : tone >= 0 ? "up" : "down";
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className={`tile-value ${cls}`}>{value}</span>
      {hint && <span className="tile-hint">{hint}</span>}
      {hint2 && <span className="tile-hint">{hint2}</span>}
    </div>
  );
}

function downloadCsv(data: AppData, id: string) {
  const m = data.monthly;
  const d = data.byId.get(id)!;
  const col = data.index.get(id)!;
  const cell = (v: number | null) => (v == null ? "" : String(v));
  const rows = [
    "district,state,month,mean_radiance_nW_cm2_sr,lit_pct,observed_pct,nasa_estimate_when_cloudy",
    ...m.months.map((mo, i) =>
      [`"${d.name}"`, `"${d.state}"`, mo, cell(m.mean[i][col]), cell(m.lit[i][col]), cell(m.valid[i][col]), cell(m.est?.[i][col] ?? null)].join(","),
    ),
  ];
  const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `night-lights-${id}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}
