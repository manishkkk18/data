import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "./components/Header";
import MapView, { type DistrictValue, type FlyRequest, type HoverInfo } from "./components/MapView";
import SidePanel from "./components/SidePanel";
import About from "./components/About";
import {
  LEGEND_TICKS,
  RAD_STOPS,
  fmtPct,
  fmtRad,
  loadData,
  monthLabel,
  summarise,
  type AppData,
} from "./data";

const MOBILE = "(max-width: 899px)";

function useMedia(q: string) {
  const [match, setMatch] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return match;
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData().then(setData, (e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="load-msg">Couldn't load the data: {error}</p>;
  if (!data) return <p className="load-msg">Loading night lights…</p>;
  return <Main data={data} />;
}

function Main({ data }: { data: AppData }) {
  const m = data.monthly;
  const isMobile = useMedia(MOBILE);
  const [monthIndex, setMonthIndex] = useState(m.months.length - 1);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [fly, setFly] = useState<FlyRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const summary = useMemo(() => summarise(m, monthIndex), [m, monthIndex]);
  const values = useMemo(() => {
    const out = new Map<string, DistrictValue>();
    m.ids.forEach((id, i) => {
      const mean = m.mean[monthIndex][i];
      out.set(id, { mean, gap: mean == null });
    });
    return out;
  }, [m, monthIndex]);

  const districtList = useMemo(() => [...data.byId.values()].sort((a, b) => a.name.localeCompare(b.name)), [data]);

  // Fit padding: on phones the bottom sheet covers the lower part of the map.
  // Values clear the overlays drawn on top of the map (stats bar, slider, legend).
  const padding = isMobile ? { top: 190, bottom: 170, left: 28, right: 56 } : { top: 120, bottom: 130, left: 60, right: 70 };

  const selectAndFly = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const d = id ? data.byId.get(id) : undefined;
      if (d) setFly({ bbox: d.bbox, n: Date.now() });
    },
    [data],
  );

  // Play: step through months, stopping at the latest.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setMonthIndex((i) => {
        if (i >= m.months.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 700);
    return () => clearInterval(t);
  }, [playing, m.months.length]);

  const canPlay = m.months.length > 1;
  const hasBaseline = summary.brighterThan2015 != null;
  const hovered = hover ? data.byId.get(hover.id) : undefined;
  const hoverCol = hover ? data.index.get(hover.id) : undefined;

  return (
    <>
      <Header districts={districtList} onPick={(id) => selectAndFly(id)} compact={isMobile} />
      <main className="main">
        <section id="map" className="map-panel panel" aria-label="Night lights map">
          <div className="map-top">
            <div className="stat-month">
              <span className="eyebrow">Month</span>
              <span className="month">{monthLabel(m.months[monthIndex])}</span>
            </div>
            <div className="stat">
              <span className="eyebrow">Avg radiance</span>
              <span className="stat-value amber">{fmtRad(summary.avg)}</span>
            </div>
            <div className="stat">
              <span className="eyebrow">Brighter than 2015</span>
              <span className="stat-value blue">{hasBaseline ? summary.brighterThan2015 : "–"}</span>
            </div>
            <div className="toggle" role="radiogroup" aria-label="Colour districts by">
              <button type="button" role="radio" aria-checked="true" className="on">Radiance</button>
              <button
                type="button"
                role="radio"
                aria-checked="false"
                disabled={!hasBaseline}
                title={hasBaseline ? undefined : "Available once 2015 data is loaded"}
              >
                Growth since 2015
              </button>
            </div>
          </div>

          <div className="map-wrap">
            <MapView
              districts={data.districts}
              outline={data.outline}
              values={values}
              selectedId={selectedId}
              fly={fly}
              padding={padding}
              onHover={setHover}
              onSelect={(id) => {
                selectAndFly(id);
                if (id && isMobile) setSheetOpen(false);
              }}
            />
            {hovered && hover && hoverCol != null && !isMobile && (
              <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="status">
                <strong>{hovered.name}</strong>
                <span className="muted">{hovered.state}</span>
                {m.mean[monthIndex][hoverCol] == null ? (
                  <span>No clear data ({fmtPct(m.valid[monthIndex][hoverCol])} observed)</span>
                ) : (
                  <span>
                    <b className="amber">{fmtRad(m.mean[monthIndex][hoverCol])}</b> nW/cm²/sr · rank #{summary.rank.get(hovered.id)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="map-bottom">
            <button
              type="button"
              className="play"
              onClick={() => {
                if (!playing && monthIndex >= m.months.length - 1) setMonthIndex(0);
                setPlaying((p) => !p);
              }}
              disabled={!canPlay}
              aria-label={playing ? "Pause" : "Play through the months"}
              title={canPlay ? undefined : "More months arrive with the backfill"}
            >
              {playing ? (
                <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="4" width="3.5" height="12" rx="1" /><rect x="11.5" y="4" width="3.5" height="12" rx="1" /></svg>
              ) : (
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l10 6-10 6z" /></svg>
              )}
            </button>
            <TimeSlider months={m.months} value={monthIndex} onChange={(i) => { setPlaying(false); setMonthIndex(i); }} />
            <Legend />
          </div>
        </section>

        <SidePanel
          data={data}
          monthIndex={monthIndex}
          summary={summary}
          selectedId={selectedId}
          expanded={sheetOpen}
          onToggle={() => setSheetOpen((o) => !o)}
          onClear={() => setSelectedId(null)}
        />
      </main>
      <About monthly={m} />
    </>
  );
}

function TimeSlider({ months, value, onChange }: { months: string[]; value: number; onChange: (i: number) => void }) {
  const years = months
    .map((mo, i) => ({ year: mo.slice(0, 4), i }))
    .filter((y, k, arr) => k === 0 || y.year !== arr[k - 1].year);
  const single = months.length < 2;
  return (
    <div className="slider">
      <label htmlFor="month-slider" className="sr-only">Month</label>
      <input
        id="month-slider"
        type="range"
        min={0}
        max={Math.max(months.length - 1, 1)}
        step={1}
        value={single ? 1 : value}
        disabled={single}
        aria-valuetext={monthLabel(months[value])}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="ticks" aria-hidden="true">
        {single ? (
          <span style={{ left: "100%" }}>{months[0].slice(0, 4)}</span>
        ) : (
          years.map((y) => (
            <span key={y.year} style={{ left: `${(y.i / (months.length - 1)) * 100}%` }}>
              {y.year}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Legend() {
  const lo = Math.log10(RAD_STOPS[0][0]);
  const hi = Math.log10(RAD_STOPS[RAD_STOPS.length - 1][0]);
  const pos = (v: number) => ((Math.log10(v) - lo) / (hi - lo)) * 100;
  const gradient = `linear-gradient(90deg, ${RAD_STOPS.map(([v, c]) => `${c} ${pos(v).toFixed(1)}%`).join(", ")})`;
  return (
    <div className="legend" aria-label="Legend: radiance in nanowatts per square centimetre per steradian, log scale">
      <div className="legend-bar" style={{ background: gradient }} />
      <div className="legend-ticks" aria-hidden="true">
        {LEGEND_TICKS.map((t) => (
          <span key={t} style={{ left: `${pos(t)}%` }}>{t}</span>
        ))}
      </div>
      <div className="legend-foot">
        <span className="muted">nW/cm²/sr, log scale</span>
        <span className="legend-gap"><i aria-hidden="true" /> No clear data</span>
      </div>
    </div>
  );
}
