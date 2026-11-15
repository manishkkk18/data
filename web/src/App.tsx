import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "./components/Header";
import MapView, { type ColorMode, type DistrictValue, type FlyRequest, type HoverInfo } from "./components/MapView";
import LayerSwitcher, { type BaseLayer } from "./components/LayerSwitcher";
import SidePanel from "./components/SidePanel";
import About from "./components/About";
import Insights from "./components/Insights";
import Compare from "./components/Compare";
import CrossCheck from "./components/CrossCheck";
import SwipeCompare from "./components/SwipeCompare";
import type { Map as MlMap } from "maplibre-gl";
import {
  GROWTH_STOPS,
  GROWTH_TICKS,
  LEGEND_TICKS,
  RAD_STOPS,
  baselineIndex,
  fmtPct,
  growthLog2,
  growthPct,
  latestLoaded,
  loadedMonths,
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
  const [mapLoading, setMapLoading] = useState(true);
  const [mode, setMode] = useState<ColorMode>("radiance");
  const [base, setBase] = useState<BaseLayer>("districts");
  const [threeD, setThreeD] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [swipe, setSwipe] = useState<{ before: number; after: number } | null>(null);
  const [mainMap, setMainMap] = useState<MlMap | null>(null);

  const summary = useMemo(() => summarise(m, monthIndex, (id) => data.byId.get(id)?.state ?? ""), [m, monthIndex, data]);
  const baseline = baselineIndex(m, monthIndex);
  const hasBaseline = baseline != null;
  const growthMode = mode === "growth" && hasBaseline && !swipe;
  const mapMonth = swipe ? swipe.before : monthIndex; // while swiping, the main map shows "before"
  const values = useMemo(() => {
    const out = new Map<string, DistrictValue>();
    m.ids.forEach((id, i) => {
      const mean = m.mean[mapMonth][i];
      const growth = growthMode ? growthLog2(m, i, mapMonth) : null;
      // In growth mode a district is a gap if either month is missing.
      out.set(id, { mean, growth, gap: growthMode ? growth == null : mean == null });
    });
    return out;
  }, [m, mapMonth, growthMode]);
  const afterValues = useMemo(() => {
    const out = new Map<string, DistrictValue>();
    if (!swipe) return out;
    m.ids.forEach((id, i) => {
      const mean = m.mean[swipe.after][i];
      out.set(id, { mean, growth: null, gap: mean == null });
    });
    return out;
  }, [m, swipe]);
  const months = useMemo(() => loadedMonths(m), [m]);
  const startSwipe = () => {
    // Default: January 2015 against the latest month (earliest processed month if Jan 2015 isn't in yet).
    const jan2015 = m.months.indexOf("2015-01");
    const before = jan2015 >= 0 && m.loaded?.[jan2015] !== false ? jan2015 : months[0];
    setThreeD(false);
    setBase("districts");
    setPlaying(false);
    setSwipe({ before, after: latestLoaded(m) });
  };
  const goToCompare = () => {
    document.getElementById("compare")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSheetOpen(false);
  };
  const monthMissing = m.loaded?.[monthIndex] === false;

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
              <span className="month">{swipe ? "Before / after" : monthLabel(m.months[monthIndex])}</span>
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
              <button
                type="button"
                role="radio"
                aria-checked={!growthMode}
                className={!growthMode ? "on" : ""}
                onClick={() => setMode("radiance")}
              >
                Radiance
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={growthMode}
                className={growthMode ? "on" : ""}
                disabled={!hasBaseline}
                title={hasBaseline ? undefined : "Needs the same month in 2015"}
                onClick={() => {
                  setMode("growth");
                  setBase("districts");
                }}
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
              onLoaded={() => setMapLoading(false)}
              mode={growthMode ? "growth" : "radiance"}
              base={swipe ? "districts" : base}
              threeD={swipe ? false : threeD}
              compareId={compareId}
              onMap={setMainMap}
              onSelect={(id) => {
                selectAndFly(id);
                if (id && isMobile) setSheetOpen(false);
              }}
            />
            {swipe && mainMap && (
              <SwipeCompare
                main={mainMap}
                districts={data.districts}
                outline={data.outline}
                after={afterValues}
                beforeLabel={monthLabel(m.months[swipe.before], true)}
                afterLabel={monthLabel(m.months[swipe.after], true)}
              />
            )}
            <LayerSwitcher
              base={base}
              threeD={threeD}
              onBase={setBase}
              onThreeD={setThreeD}
              disabled={!!swipe}
              extra={
                <button
                  type="button"
                  className={`layers-btn ${swipe ? "active" : ""}`}
                  aria-pressed={!!swipe}
                  disabled={months.length < 2 || mapLoading}
                  title={months.length < 2 ? "Needs at least two processed months" : undefined}
                  onClick={() => (swipe ? setSwipe(null) : startSwipe())}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <rect x="2" y="3" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M10 1v18" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  <span>Before / after</span>
                </button>
              }
            />
            {monthMissing && !mapLoading && !swipe && (
              <div className="map-notice" role="status">
                No data for {monthLabel(m.months[monthIndex])}: not processed yet, or unavailable from NASA.
              </div>
            )}
            {mapLoading && (
              <div className="map-loading" role="status">
                <span className="spinner" aria-hidden="true" /> Loading districts…
              </div>
            )}
            {hovered && hover && hoverCol != null && !isMobile && (
              <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="status">
                <strong>{hovered.name}</strong>
                <span className="muted">{hovered.state}</span>
                {m.mean[monthIndex][hoverCol] == null ? (
                  <span>{monthMissing ? "No data this month" : `No clear data (${fmtPct(m.valid[monthIndex][hoverCol])} observed)`}</span>
                ) : (
                  <span>
                    <b className="amber">{fmtRad(m.mean[monthIndex][hoverCol])}</b> nW/cm²/sr · rank #{summary.rank.get(hovered.id)}
                  </span>
                )}
                {growthMode && (
                  <span>
                    <b className="blue">{fmtPct(growthPct(m, hoverCol, monthIndex), true)}</b> since {monthLabel(m.months[baseline!], true)}
                  </span>
                )}
              </div>
            )}
          </div>

          {swipe ? (
            <div className="map-bottom swipe-bar">
              <label className="select">
                <span className="eyebrow">Before (left)</span>
                <select value={swipe.before} onChange={(e) => setSwipe({ ...swipe, before: Number(e.target.value) })}>
                  {months.map((i) => (
                    <option key={i} value={i}>{monthLabel(m.months[i], true)}</option>
                  ))}
                </select>
              </label>
              <label className="select">
                <span className="eyebrow">After (right)</span>
                <select value={swipe.after} onChange={(e) => setSwipe({ ...swipe, after: Number(e.target.value) })}>
                  {months.map((i) => (
                    <option key={i} value={i}>{monthLabel(m.months[i], true)}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" onClick={() => setSwipe(null)}>Done</button>
              <Legend growth={false} />
            </div>
          ) : (
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
            <TimeSlider months={m.months} value={monthIndex} compact={isMobile} onChange={(i) => { setPlaying(false); setMonthIndex(i); }} />
            {base === "districts" ? (
              <Legend growth={growthMode} />
            ) : (
              <p className="legend legend-note muted">
                {base === "night" ? "NASA Black Marble 2016 image" : "NASA true colour, 21 Feb 2026"}. District colours are hidden; outlines stay.
              </p>
            )}
          </div>
          )}
        </section>

        <SidePanel
          data={data}
          monthIndex={monthIndex}
          summary={summary}
          selectedId={selectedId}
          expanded={sheetOpen}
          onToggle={() => setSheetOpen((o) => !o)}
          onClear={() => setSelectedId(null)}
          onPickMonth={(i) => {
            setPlaying(false);
            setMonthIndex(i);
          }}
          onCompare={goToCompare}
        />
      </main>
      <Insights data={data} monthIndex={monthIndex} onPick={(id) => {
        selectAndFly(id);
        document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }} />
      <Compare
        data={data}
        monthIndex={monthIndex}
        summary={summary}
        aId={selectedId}
        bId={compareId}
        onPickA={(id) => selectAndFly(id)}
        onPickB={setCompareId}
        onSwap={() => {
          const a = selectedId;
          setSelectedId(compareId);
          setCompareId(a);
        }}
        onPickMonth={(i) => {
          setPlaying(false);
          setMonthIndex(i);
        }}
      />
      <CrossCheck data={data.crosscheck} preferredState={selectedId ? data.byId.get(selectedId)?.state : undefined} />
      <About monthly={m} />
    </>
  );
}

function TimeSlider({ months, value, compact, onChange }: { months: string[]; value: number; compact?: boolean; onChange: (i: number) => void }) {
  const firstYear = Number(months[0].slice(0, 4));
  const years = months
    .map((mo, i) => ({ year: mo.slice(0, 4), i }))
    .filter((y, k, arr) => k === 0 || y.year !== arr[k - 1].year)
    .filter((y, k, arr) => !(k === 0 && arr[1] && arr[1].i - y.i < 6))
    // On phones label every other year so the ticks don't collide.
    .filter((y) => !compact || (Number(y.year) - firstYear) % 2 === 1);
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

function Legend({ growth }: { growth: boolean }) {
  if (growth) {
    const lo = GROWTH_STOPS[0][0];
    const hi = GROWTH_STOPS[GROWTH_STOPS.length - 1][0];
    const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
    const gradient = `linear-gradient(90deg, ${GROWTH_STOPS.map(([v, c]) => `${c} ${pos(v).toFixed(1)}%`).join(", ")})`;
    return (
      <div className="legend" aria-label="Legend: change in brightness since the same month in 2015">
        <div className="legend-bar" style={{ background: gradient }} />
        <div className="legend-ticks" aria-hidden="true">
          {GROWTH_TICKS.map(([v, t]) => (
            <span
              key={t}
              style={{ left: `${pos(v)}%`, transform: pos(v) <= 0 ? "none" : pos(v) >= 100 ? "translateX(-100%)" : undefined }}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="legend-foot">
          <span className="muted">vs same month in 2015</span>
          <span className="legend-gap"><i aria-hidden="true" /> No data</span>
        </div>
      </div>
    );
  }
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
