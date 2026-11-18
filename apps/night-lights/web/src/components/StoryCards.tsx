import {
  baselineIndex,
  fmtPct,
  fmtRad,
  latestLoaded,
  latestWithBaseline,
  monthLabel,
  topBrightest,
  topGrowth,
  type AppData,
  type MonthSummary,
} from "../data";

type Props = { data: AppData; monthIndex: number; summary: MonthSummary; onPick: (id: string) => void };

/** The default side panel: three stories computed from the data, each flying the map there. */
export default function StoryCards({ data, monthIndex, summary, onPick }: Props) {
  const m = data.monthly;
  const bMonth = m.loaded?.[monthIndex] === false ? latestLoaded(m) : monthIndex;
  const gMonth = baselineIndex(m, monthIndex) != null && m.loaded?.[monthIndex] !== false ? monthIndex : latestWithBaseline(m);
  const bright = topBrightest(m, bMonth)[0];
  const grow = gMonth != null ? topGrowth(m, gMonth)[0] : undefined;
  const dYear = [...(data.diwali?.years ?? [])].reverse().find((y) => (y.district_top?.length ?? 0) > 0);
  const dTop = dYear?.district_top?.[0];
  const avg = summary.avg;

  const cards = [
    bright && {
      id: bright.id,
      kicker: "Brightest district",
      value: fmtRad(bright.value),
      unit: "nW/cm²/sr",
      line: `${avg ? `${(bright.value / avg).toFixed(0)}× the national average` : ""} · ${monthLabel(m.months[bMonth])}`,
      tone: "amber",
    },
    grow && {
      id: grow.id,
      kicker: "Fastest growing since 2015",
      value: fmtPct(grow.pct, true),
      unit: "",
      line: `${fmtRad(grow.then)} → ${fmtRad(grow.now)} nW/cm²/sr · ${monthLabel(m.months[gMonth!], true)} vs 2015`,
      tone: "blue",
    },
    dTop &&
      dYear && {
        id: dTop.id,
        kicker: `Diwali effect leader, ${dYear.year} (all districts)`,
        value: fmtPct(dTop.effect, true),
        unit: "",
        line: `on Diwali night vs a normal night (${fmtRad(dTop.night)} vs ${fmtRad(dTop.base)})`,
        tone: "amber",
      },
  ].filter(Boolean) as { id: string; kicker: string; value: string; unit: string; line: string; tone: string }[];

  return (
    <div className="stories">
      <p className="stories-intro muted">Three stories from the data. Tap one to fly there.</p>
      {cards.map((c) => {
        const d = data.byId.get(c.id);
        if (!d) return null;
        return (
          <button key={c.kicker} type="button" className="story" onClick={() => onPick(c.id)}>
            <span className="story-kicker">{c.kicker}</span>
            <span className="story-name">{d.name}</span>
            <span className="story-state muted">{d.state}</span>
            <span className={`story-value ${c.tone}`}>
              {c.value}
              {c.unit && <span className="story-unit"> {c.unit}</span>}
            </span>
            <span className="story-line muted">{c.line}</span>
            <span className="story-go" aria-hidden="true">
              Fly there →
            </span>
          </button>
        );
      })}
      <p className="stories-foot muted small">
        India · {monthLabel(m.months[bMonth])}: national average <b className="mono">{fmtRad(avg)}</b> nW/cm²/sr · {summary.withData} of{" "}
        {summary.withData + summary.gaps} districts observed
      </p>
    </div>
  );
}
