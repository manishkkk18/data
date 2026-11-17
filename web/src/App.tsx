import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Header from "./components/Header";
import MapView, { type FireHover, type FlyRequest } from "./components/MapView";
import LayerSwitcher, { type Layers } from "./components/LayerSwitcher";
import SidePanel from "./components/SidePanel";
import TimeBar from "./components/TimeBar";
import Legend from "./components/Legend";
import LoadingOutline from "./components/LoadingOutline";
import About from "./components/About";
import WhyItMatters from "./components/WhyItMatters";
import Leaderboards from "./components/Leaderboards";
// The chart library is ~110 KB gzipped: load it with the Seasons section, not with the map.
const Seasons = lazy(() => import("./components/Seasons"));
import { readUrl, writeUrl } from "./url";
import { track } from "./analytics";
import {
  arrivalAt,
  overdue,
  satDate,
  CONFIDENCE,
  loadSeasonFires,
  seasonDays,
  type Fire,
  SATELLITE,
  WINDOW_HOURS,
  WINDOW_LABEL,
  dayLabel,
  delhiPm25,
  fmtInt,
  istDate,
  loadData,
  pm25Band,
  refTime,
  timeLabel,
  windFrame,
  windowFires,
  type AppData,
  type Window,
} from "./data";

const MOBILE = "(max-width: 899px)";
const PHONE = "(max-width: 639px)";
const TAGLINE = "Whose smoke is Delhi breathing? Farm fires seen from space, and the wind that carries their smoke.";

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
  if (!data) return <p className="load-msg">Loading fires…</p>;
  return <Main data={data} />;
}

function Main({ data }: { data: AppData }) {
  const isMobile = useMedia(MOBILE);
  const isPhone = useMedia(PHONE);
  const initial = useMemo(() => readUrl(), []);
  const today = data.days.length ? data.days[data.days.length - 1] : istDate(data.generated);

  // Timeline: the live last-7-days view (null) or a burning season by year (NOAA-20 only).
  const [seasonYear, setSeasonYear] = useState<number | null>(() =>
    initial.season && data.seasons?.seasons.some((x) => x.year === initial.season) ? initial.season : null,
  );
  const season = seasonYear != null ? (data.seasons?.seasons.find((x) => x.year === seasonYear) ?? null) : null;
  const days = useMemo(() => (season ? seasonDays(season) : data.days), [season, data.days]);
  const [dayIndex, setDayIndex] = useState(() => {
    const i = initial.day ? days.indexOf(initial.day) : -1;
    return i >= 0 ? i : Math.max(days.length - 1, 0);
  });
  const [seasonFires, setSeasonFires] = useState<Record<number, Fire[]>>({});
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [win, setWin] = useState<Window>(initial.w ?? "24h");
  const [layers, setLayers] = useState<Layers>({
    wind: initial.wind !== "off",
    windLevel: initial.wind === "10m" ? "10m" : "850hPa",
    districts: true,
    trajectory: initial.path !== "off",
    sat: initial.sat ?? "none",
  });
  const [selectedId, setSelectedId] = useState<string | null>(() => (initial.d && data.byId.has(initial.d) ? initial.d : null));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [hover, setHover] = useState<FireHover | null>(null);
  const [fly, setFly] = useState<FlyRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [intro, setIntro] = useState(true);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapInView, setMapInView] = useState(true);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const say = useCallback((text: string) => setToast({ text, n: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setIntro(false), 12000);
    return () => clearTimeout(t);
  }, [intro]);
  // The bottom sheet belongs to the map: it slides away once the map scrolls out of view.
  useEffect(() => {
    const el = document.getElementById("map");
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setMapInView(e.intersectionRatio > 0.35), { threshold: [0, 0.2, 0.35, 0.5, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const day = days[Math.min(dayIndex, days.length - 1)] ?? today;
  const at = refTime(data, day);
  const sourceFires = season ? (seasonFires[season.year] ?? []) : data.fires;
  const fires = useMemo(() => windowFires(sourceFires, at, win), [sourceFires, at, win]);
  const seasonPm = season ? (season.pm25[days.indexOf(day)] ?? null) : null;
  const indiaCount = useMemo(() => fires.filter((f) => f.district).length, [fires]);
  const wFrame = windFrame(data.wind, at);
  const arrival = arrivalAt(data.upwind, at);
  const imageDate = satDate(day, data.generated);
  const aq = delhiPm25(data.aq, at);
  const pmValue = season ? seasonPm : (aq?.now ?? null);
  const band = pm25Band(pmValue);
  const series = useMemo(() => {
    if (season) return season.fires.india;
    const counts = new Map<string, number>();
    for (const f of data.fires) if (f.district) counts.set(istDate(f.t), (counts.get(istDate(f.t)) ?? 0) + 1);
    return data.days.map((d) => counts.get(d) ?? 0);
  }, [data, season]);

  // A season's detections are fetched the first time it is shown.
  useEffect(() => {
    if (seasonYear == null || seasonFires[seasonYear]) return;
    let live = true;
    setSeasonLoading(true);
    loadSeasonFires(seasonYear)
      .then((f) => live && setSeasonFires((m) => ({ ...m, [seasonYear]: f })))
      .catch(() => live && say(`Couldn't load the ${seasonYear} season.`))
      .finally(() => live && setSeasonLoading(false));
    return () => {
      live = false;
    };
  }, [seasonYear]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Switch the timeline (null = last 7 days) and land on `onDay` if given, else its last day. */
  const showTimeline = useCallback(
    (year: number | null, onDay?: string) => {
      const s = year != null ? data.seasons?.seasons.find((x) => x.year === year) : null;
      const ds = s ? seasonDays(s) : data.days;
      const i = onDay ? ds.indexOf(onDay) : -1;
      setPlaying(false);
      setSeasonYear(s ? s.year : null);
      setDayIndex(i >= 0 ? i : ds.length - 1);
      if (s) track(`season-${s.year}`);
    },
    [data],
  );
  const districtList = useMemo(() => [...data.byId.values()].sort((a, b) => a.name.localeCompare(b.name)), [data]);

  // Fit padding keeps the area clear of the floating panels (same values as India Night Lights).
  const padding = isPhone ? { top: 112, bottom: 136, left: 8, right: 60 } : isMobile ? { top: 120, bottom: 150, left: 8, right: 44 } : { top: 76, bottom: 132, left: 24, right: 404 };

  const selectAndFly = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const d = id ? data.byId.get(id) : undefined;
      if (d) setFly({ bbox: d.bbox, n: Date.now() });
    },
    [data],
  );
  useEffect(() => {
    if (initial.d && data.byId.has(initial.d)) selectAndFly(initial.d);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the address bar in step with the view, so any moment can be shared.
  useEffect(() => {
    writeUrl(
      { day, w: win, d: selectedId ?? undefined, wind: layers.wind ? layers.windLevel : "off", path: layers.trajectory ? undefined : "off", season: seasonYear ?? undefined, sat: layers.sat },
      { day: season ? days[days.length - 1] : today },
    );
  }, [day, win, selectedId, layers, today, seasonYear, season, days]);

  const share = async () => {
    track("share");
    try {
      await navigator.clipboard.writeText(window.location.href);
      say("Link copied. It opens this exact view.");
    } catch {
      say("Copy the link from the address bar to share this view.");
    }
  };

  // Play: step through days, stopping at today.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(
      () =>
        setDayIndex((i) => {
          if (i >= days.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      // A season has ~90 days, so it plays faster than the 7-day view.
      (season ? 500 : 1200) / speed,
    );
    return () => clearInterval(t);
  }, [playing, speed, days.length, season]);
  const togglePlay = () => {
    if (!playing && dayIndex >= days.length - 1) setDayIndex(0);
    if (!playing) track("play");
    setPlaying((p) => !p);
  };

  // Arrow keys scrub the timeline from anywhere on the page (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable], .maplibregl-canvas, [role=slider]") || e.altKey || e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setPlaying(false);
      setDayIndex((i) => Math.min(Math.max(i + (e.key === "ArrowLeft" ? -1 : 1), 0), days.length - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [days.length]);

  const windowToggle = (cls: string) => (
    <div className={`toggle ${cls}`} role="radiogroup" aria-label="Show fires from the last">
      {(["24h", "3d", "7d"] as Window[]).map((w) => (
        <button key={w} type="button" role="radio" aria-checked={win === w} className={win === w ? "on" : ""} onClick={() => {
            setWin(w);
            if (w !== "24h") track(`window-${w}`);
          }}>
          {WINDOW_LABEL[w]}
        </button>
      ))}
    </div>
  );
  const shareBtn = (cls: string) => (
    <button type="button" className={cls} onClick={share} aria-label="Copy a link to this view">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M8 12l4-4M7 9.5L5.5 11a3 3 0 004.2 4.2l1.5-1.5M13 10.5l1.5-1.5a3 3 0 00-4.2-4.2L8.8 6.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="chip-text">Share</span>
    </button>
  );
  const delhiBtn = (cls: string) => (
    <button type="button" className={cls} onClick={() => {
        setFly({ bbox: [76.6, 28.1, 77.8, 29.1], n: Date.now() });
        track("zoom-delhi");
      }} aria-label="Zoom to Delhi">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3" fill="currentColor" />
        <path d="M10 1v3M10 16v3M1 10h3M16 10h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      <span className="chip-text">Delhi</span>
    </button>
  );
  const legend = <Legend window={win} wind={layers.wind && wFrame != null} path={layers.trajectory && !!arrival} sensor={season ? "NOAA-20 only" : undefined} sat={layers.sat} satDate={imageDate} />;
  const pmText =
    pmValue != null ? (
      <>
        <span className={`mono ${band?.cls ?? ""}`}>{fmtInt(pmValue)}</span> <span className={band?.cls}>{band?.name}</span>
      </>
    ) : (
      <span className="muted">{season ? "gap" : "–"}</span>
    );
  const pmLabel = season ? "Delhi PM2.5 · day" : "Delhi PM2.5";

  return (
    <>
      <Header
        districts={districtList}
        onPick={(id) => {
          selectAndFly(id);
          if (isMobile) setSheetOpen(true);
          track("search");
        }}
        compact={isMobile}
        phone={isPhone}
      />
      <main id="map" className="stage" aria-label="Fire and wind map">
        <div className="map-wrap">
          <MapView
            districts={data.districts}
            outline={data.outline}
            fires={fires}
            at={at}
            windowHours={WINDOW_HOURS[win]}
            wind={data.wind}
            windFrame={wFrame}
            windLevel={layers.windLevel}
            showWind={layers.wind}
            showDistricts={layers.districts}
            arrival={arrival}
            showTrajectory={layers.trajectory}
            sat={layers.sat}
            satDate={imageDate}
            selectedId={selectedId}
            fly={fly}
            padding={padding}
            onFireHover={setHover}
            onLoaded={() => setMapLoading(false)}
            onSelect={(id) => {
              setSelectedId(id);
              if (id && isMobile) setSheetOpen(true);
              if (id) track("map-pick");
            }}
          />
          <LayerSwitcher
            layers={layers}
            onChange={(l) => {
              if (l.windLevel !== layers.windLevel) track(`wind-${l.windLevel}`);
              if (!l.wind && layers.wind) track("wind-off");
              if (!l.trajectory && layers.trajectory) track("path-off");
              if (l.sat !== layers.sat && l.sat !== "none") track(`sat-${l.sat}`);
              setLayers(l);
            }}
            windAvailable={!!data.wind}
            trajectoryAvailable={!!data.upwind}
            seasons={[...(data.seasons?.seasons ?? [])].map((x) => x.year).reverse()}
            season={seasonYear}
            onTimeline={(y) => showTimeline(y)} compact={isPhone} after={isPhone ? <LegendChip>{legend}</LegendChip> : undefined} />
          {mapLoading && <LoadingOutline outline={data.outline} />}
          {seasonLoading && !mapLoading && (
            <div className="map-loading" role="status">
              <span className="spinner" aria-hidden="true" /> Loading the {seasonYear} season…
            </div>
          )}
          {!mapLoading && !season && overdue(data.generated) && (
            <div className="map-notice" role="status">
              This data was last updated {overdue(data.generated)}: the scheduled update is late or failed.
            </div>
          )}
          {!mapLoading && !seasonLoading && fires.length === 0 && !overdue(data.generated) && (
            <div className="map-notice" role="status">
              No fire detections in this window. Clouds can hide fires from the satellites.
            </div>
          )}
          {hover && !isMobile && <FireTip h={hover} data={data} />}
        </div>

        {isPhone ? (
          <>
            <div className={`kpi-strip phone ${statsOpen ? "open" : ""}`}>
              <button
                type="button"
                className="kpi-line"
                aria-expanded={statsOpen}
                onClick={() => {
                  setStatsOpen((o) => !o);
                  setIntro(false);
                }}
              >
                {intro ? (
                  <span className="kpi-tagline">{TAGLINE}</span>
                ) : (
                  <span className="kpi-summary">
                    <b>{dayLabel(day)}</b>
                    <span className="sep"> · </span>
                    <span className="fire mono">{fmtInt(indiaCount)}</span> fires
                    <span className="sep"> · </span>PM2.5 {pmText}
                  </span>
                )}
                <svg className="chev" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {statsOpen && (
                <div className="kpi-more">
                  <div className="kpi">
                    <span className="kpi-label">Day</span>
                    <span className="kpi-month">{dayLabel(day, true)}</span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-label">Fire detections · {WINDOW_LABEL[win]}</span>
                    <span className="kpi-value fire">
                      {fmtInt(indiaCount)} <small className="muted">in India, satellite detections</small>
                    </span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-label">{pmLabel}</span>
                    <span className="kpi-value">
                      {pmText}{" "}
                      <small className="muted">{season ? "µg/m³, daily mean" : aq ? "µg/m³, latest hour" : "air-quality data not loaded yet"}</small>
                    </span>
                  </div>
                  <p className="muted small">{TAGLINE}</p>
                </div>
              )}
            </div>
            {windowToggle("mode-pill")}
            <div className="map-fabs" role="group" aria-label="Map actions">
              {delhiBtn("fab")}
              {shareBtn("fab")}
            </div>
          </>
        ) : (
          <>
            <div className="kpi-strip">
              <div className="kpi">
                <span className="kpi-label">Day</span>
                <span className="kpi-month">{dayLabel(day, true)}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">Fires · {WINDOW_LABEL[win]}</span>
                <span className="kpi-value fire">{fmtInt(indiaCount)}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">{pmLabel}</span>
                <span className="kpi-value">{pmText}</span>
              </div>
              {windowToggle("")}
              <div className="kpi-actions">
                {delhiBtn("chip")}
                {shareBtn("chip")}
              </div>
            </div>
            {intro && (
              <div className="intro-line" role="note">
                <span>{TAGLINE}</span>
                <button type="button" className="link-btn" aria-label="Dismiss" onClick={() => setIntro(false)}>
                  ×
                </button>
              </div>
            )}
          </>
        )}

        <SidePanel
          data={data}
          day={day}
          at={at}
          window={win}
          fires={fires}
          windLevel={layers.windLevel}
          selectedId={selectedId}
          allFires={sourceFires}
          days={days}
          season={season}
          expanded={sheetOpen}
          onToggle={() => setSheetOpen((o) => !o)}
          onClear={() => setSelectedId(null)}
          onPick={(id) => {
            selectAndFly(id);
            track("story");
          }}
          onShare={share}
          away={isMobile && !mapInView}
        />

        <div className="timebar">
          <TimeBar
            days={days}
            value={dayIndex}
            onChange={(i) => {
              setPlaying(false);
              setDayIndex(i);
            }}
            playing={playing}
            onTogglePlay={togglePlay}
            canPlay={days.length > 1}
            speed={speed}
            onSpeed={setSpeed}
            series={series}
          />
          {!isPhone && legend}
        </div>

        {toast && (
          <div key={toast.n} className="toast" role="status" aria-live="polite">
            {toast.text}
          </div>
        )}
      </main>
      <WhyItMatters data={data} />
      <Leaderboards
        data={data}
        phone={isPhone}
        onPick={(id) => {
          selectAndFly(id);
          document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "start" });
          track("leader-pick");
        }}
      />
      <Suspense fallback={<section id="season" className="panel seasons"><p className="muted">Loading seasons…</p></section>}>
        <Seasons data={data} mapSeason={seasonYear} mapDay={day} onShow={(y, d) => showTimeline(y, d)} />
      </Suspense>
      <About data={data} />
    </>
  );
}

/** Phones: the key hides behind a small chip on the map (as in India Night Lights). */
function LegendChip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="legend-chip">
      {open && (
        <div className="legend-pop" id="legend-pop">
          {children}
        </div>
      )}
      <button type="button" className="layers-btn" aria-expanded={open} aria-controls="legend-pop" onClick={() => setOpen((o) => !o)}>
        <span className="legend-swatch fire" aria-hidden="true" />
        <span>Legend</span>
      </button>
    </div>
  );
}

function FireTip({ h, data }: { h: FireHover; data: AppData }) {
  const f = h.fire;
  const d = f.district ? data.byId.get(f.district) : undefined;
  return (
    <div className="tooltip" style={{ left: h.x + 16, top: h.y + 16 }} role="status">
      <strong className="tip-name">{d ? d.name : "Across the border"}</strong>
      <span className="muted">{d ? d.state : "Outside India · not counted"}</span>
      <span className="tip-value">
        <b className="tip-fire mono">{f.frp.toFixed(1)}</b> <small>MW fire radiative power</small>
      </span>
      <span>
        {timeLabel(f.t)} · {f.night ? "night pass" : "day pass"}
      </span>
      <span className="muted small">
        {SATELLITE[f.sat] ?? f.sat} · {CONFIDENCE[f.conf] ?? "unknown"} confidence
      </span>
    </div>
  );
}
