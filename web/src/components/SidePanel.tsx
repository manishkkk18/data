import { changePct, fmtPct, fmtRad, monthLabel, type AppData, type MonthSummary } from "../data";

type Props = {
  data: AppData;
  monthIndex: number;
  summary: MonthSummary;
  selectedId: string | null;
  expanded: boolean; // bottom-sheet state on phones; ignored on desktop
  onToggle: () => void;
  onClear: () => void;
};

export default function SidePanel({ data, monthIndex, summary, selectedId, expanded, onToggle, onClear }: Props) {
  const m = data.monthly;
  const d = selectedId ? data.byId.get(selectedId) : undefined;
  const col = d ? data.index.get(d.id) : undefined;
  const month = m.months[monthIndex];

  const mean = col != null ? m.mean[monthIndex][col] : null;
  const lit = col != null ? m.lit[monthIndex][col] : null;
  const valid = col != null ? m.valid[monthIndex][col] : null;
  const rank = d ? summary.rank.get(d.id) : undefined;
  const ch1 = col != null ? changePct(m, col, monthIndex, 1) : null;
  const ch5 = col != null ? changePct(m, col, monthIndex, 5) : null;
  const needsHistory = m.months.length < 13;

  return (
    <aside className="side panel" aria-label="District details" data-expanded={expanded}>
      <button className="sheet-handle" type="button" aria-expanded={expanded} onClick={onToggle}>
        <span className="sheet-grip" aria-hidden="true" />
        <span className="sheet-peek">
          <span className="sheet-title">{d ? d.name : "India"}</span>
          <span className="sheet-value">{d ? fmtRad(mean) : fmtRad(summary.avg)}</span>
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
              <span className="big-value">{fmtRad(mean)}</span>
              <span className="big-unit">nW/cm²/sr · {monthLabel(month)}</span>
            </div>
            {mean == null && m.loaded?.[monthIndex] === false ? (
              <p className="gap-note">No data for this month: not processed yet, or unavailable from NASA.</p>
            ) : mean == null ? (
              <p className="gap-note">
                No clear view this month: only {fmtPct(valid)} of the district was observed (clouds). We show a gap rather than guess.
              </p>
            ) : (
              <p className="muted small">
                {fmtPct(lit)} of the district is lit · {fmtPct(valid)} observed
              </p>
            )}

            <div className="tiles">
              <Tile label="1-year change" value={fmtPct(ch1, true)} tone={ch1} hint={ch1 == null && needsHistory ? "after backfill" : undefined} />
              <Tile label="5-year change" value={fmtPct(ch5, true)} tone={ch5} hint={ch5 == null && needsHistory ? "after backfill" : undefined} />
              <Tile label="National rank" value={rank ? `#${rank}` : "–"} hint={rank ? `of ${summary.withData}` : undefined} />
            </div>

            <div className="chart-placeholder">
              <p className="muted small">The month-by-month trend since 2015 appears here once the history is loaded.</p>
            </div>

            <div className="side-actions">
              <button type="button" className="btn" disabled title="Coming in a later phase">Compare with…</button>
              <button type="button" className="btn" onClick={() => downloadCsv(data, d.id)}>Download CSV</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="side-name">India</h2>
            <p className="muted">{monthLabel(month)}</p>
            <div className="big-number">
              <span className="big-value">{fmtRad(summary.avg)}</span>
              <span className="big-unit">nW/cm²/sr national average</span>
            </div>
            <div className="tiles two">
              <Tile label="Districts with data" value={`${summary.withData}`} hint={`of ${m.ids.length}`} />
              {m.loaded?.[monthIndex] === false ? (
                <Tile label="Month status" value="No data" hint="not processed yet" />
              ) : (
                <Tile label="Cloud gaps" value={`${summary.gaps}`} hint="shown hatched" />
              )}
            </div>
            <p className="muted small hint">Tap or click a district on the map, or search for one above, to see its numbers.</p>
          </>
        )}
      </div>
    </aside>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: number | null }) {
  const cls = tone == null ? "" : tone >= 0 ? "up" : "down";
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className={`tile-value ${cls}`}>{value}</span>
      {hint && <span className="tile-hint">{hint}</span>}
    </div>
  );
}

function downloadCsv(data: AppData, id: string) {
  const m = data.monthly;
  const d = data.byId.get(id)!;
  const col = data.index.get(id)!;
  const cell = (v: number | null) => (v == null ? "" : String(v));
  const rows = [
    "district,state,month,mean_radiance_nW_cm2_sr,sum_of_lights,lit_pct,observed_pct",
    ...m.months.map((mo, i) =>
      [`"${d.name}"`, `"${d.state}"`, mo, cell(m.mean[i][col]), cell(m.sum[i][col]), cell(m.lit[i][col]), cell(m.valid[i][col])].join(","),
    ),
  ];
  const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `night-lights-${id}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}
