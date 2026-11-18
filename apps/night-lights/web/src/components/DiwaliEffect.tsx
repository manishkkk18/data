import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { fmtPct, fmtRad, type AppData, type DiwaliDistricts } from "../data";
import { Search } from "./Header";
import { track } from "../analytics";

const DiwaliChart = lazy(() => import("./DiwaliChart"));

function longDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
}

type Focus = { kind: "city"; name: string } | { kind: "district"; id: string };
type Props = { app: AppData; selectedId: string | null };

export default function DiwaliEffect({ app, selectedId }: Props) {
  const data = app.diwali;
  const years = data?.years.filter((y) => Object.values(y.effect).some((v) => v != null)) ?? [];
  const [year, setYear] = useState(() => years[years.length - 1]?.year);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [districtData, setDistrictData] = useState<DiwaliDistricts | null>(null);
  const hasDistrictFile = app.optionalFiles.includes("diwali_districts.json");
  const districtList = useMemo(() => [...app.byId.values()].sort((a, b) => a.name.localeCompare(b.name)), [app]);

  // Load the chart library and the per-district file only when the section is near.
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = section.current;
    if (!el || near) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near || !hasDistrictFile || districtData) return;
    fetch(`${import.meta.env.BASE_URL}data/diwali_districts.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDistrictData(d))
      .catch(() => {});
  }, [near, hasDistrictFile, districtData]);
  // Follow the district selected on the map.
  useEffect(() => {
    if (selectedId) setFocus({ kind: "district", id: selectedId });
  }, [selectedId]);

  if (!data || years.length === 0) return null;
  const y = years.find((v) => v.year === year) ?? years[years.length - 1];
  const rows = data.cities.map((c) => ({ city: c, effect: y.effect[c], clear: y.clear_baseline_nights[c] ?? 0 }));
  const sorted = [...rows].sort((a, b) => (b.effect ?? -Infinity) - (a.effect ?? -Infinity));
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.effect ?? 0)), 1);

  // What the chart and the district card show.
  const shown: Focus = focus ?? { kind: "city", name: sorted[0].city };
  const dYear = districtData?.years.find((v) => v.year === y.year);
  const col = shown.kind === "district" && districtData ? districtData.ids.indexOf(shown.id) : -1;
  const district = shown.kind === "district" ? app.byId.get(shown.id) : undefined;
  const dNights: Record<string, number | null> | null = dYear && col >= 0 ? Object.fromEntries(Object.entries(dYear.nights).map(([o, v]) => [o, v[col]])) : null;
  const dEffect = dYear && col >= 0 ? dYear.effect[col] : null;
  const dClear = dYear && col >= 0 ? dYear.clear_baseline_nights[col] : 0;
  const dBase = dNights ? median(data.baseline_offsets.map((o) => dNights[String(o)]).filter((v): v is number => v != null)) : null;

  const chart =
    shown.kind === "city"
      ? { label: shown.name, nights: Object.fromEntries(Object.entries(y.nights).map(([o, v]) => [o, v[shown.name] ?? null])) }
      : dNights && district
        ? { label: district.name, nights: dNights }
        : null;

  return (
    <section id="diwali" ref={section} className="panel diwali" aria-labelledby="diwali-title">
      <div className="diwali-head">
        <div>
          <h2 id="diwali-title">The Diwali effect</h2>
          <p className="muted small">
            How much brighter each place was on Diwali night ({longDate(y.date)}) than on a normal night that fortnight, from NASA's daily night-light data.
          </p>
        </div>
        <div className="year-pills" role="radiogroup" aria-label="Year">
          {years.map((v) => (
            <button
              key={v.year}
              type="button"
              role="radio"
              aria-checked={v.year === y.year}
              className={v.year === y.year ? "on" : ""}
              onClick={() => {
                setYear(v.year);
                track("diwali-year");
              }}
            >
              {v.year}
            </button>
          ))}
        </div>
      </div>

      <div className="diwali-body">
        <div className="diwali-left">
          <h3 className="diwali-sub">8 major cities</h3>
          <ol className="bars diverging" aria-label={`Diwali night brightness change by city, ${y.year}`}>
            {sorted.map((r) => {
              const on = shown.kind === "city" && shown.name === r.city;
              return (
                <li key={r.city}>
                  <button type="button" className={`bar-row ${on ? "on" : ""}`} onClick={() => setFocus({ kind: "city", name: r.city })} aria-pressed={on}>
                    <span className="bar-name">{r.city}</span>
                    <span className="bar-value">
                      {r.effect == null ? (
                        <span className="muted">cloudy</span>
                      ) : (
                        <>
                          {fmtPct(r.effect, true)}
                          {/* Fewer than 5 clear normal nights: the comparison is shakier, so say so. */}
                          {r.clear < 5 && <span className="few-nights" title={`Only ${r.clear} clear normal nights to compare with`}> · {r.clear} nights</span>}
                        </>
                      )}
                    </span>
                    <span className="bar-track split" aria-hidden="true">
                      {r.effect != null && (
                        <span className={`bar-fill ${r.effect >= 0 ? "blue-fill pos" : "red-fill neg"}`} style={{ width: `${(Math.abs(r.effect) / maxAbs) * 50}%` }} />
                      )}
                    </span>
                    {r.effect == null && <span className="sr-only"> No result: Diwali night was cloudy or too few clear normal nights ({r.clear}).</span>}
                  </button>
                </li>
              );
            })}
          </ol>

          {(y.district_top?.length ?? 0) > 0 && (
            <>
              <h3 className="diwali-sub">Biggest jumps, all districts</h3>
              <ol className="bars diverging" aria-label={`Districts with the biggest Diwali night brightening, ${y.year}`}>
                {y.district_top!.map((r) => {
                  const d = app.byId.get(r.id);
                  if (!d) return null;
                  const on = shown.kind === "district" && shown.id === r.id;
                  const topMax = Math.max(...y.district_top!.map((t) => t.effect), 1);
                  return (
                    <li key={r.id}>
                      <button type="button" className={`bar-row ${on ? "on" : ""}`} onClick={() => setFocus({ kind: "district", id: r.id })} aria-pressed={on}>
                        <span className="bar-name">
                          {d.name} <span className="muted">{d.state}</span>
                        </span>
                        <span className="bar-value">{fmtPct(r.effect, true)}</span>
                        <span className="bar-track" aria-hidden="true">
                          <span className="bar-fill blue-fill" style={{ width: `${(r.effect / topMax) * 100}%` }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="muted small diwali-top-note">Lit districts only (normal night at least 2 nW/cm²/sr, 5+ clear normal nights), so very dark places with big percentage swings don't top the list.</p>
            </>
          )}

          <h3 className="diwali-sub">Any district</h3>
          {
            <>
              <Search
                districts={districtList}
                onPick={(id) => {
                  setFocus({ kind: "district", id });
                  track("diwali-district");
                }}
                placeholder="Search a district"
                label="Find a district's Diwali effect"
              />
              {shown.kind === "district" && district && (
                <div className="diwali-card" aria-live="polite">
                  <p className="diwali-card-name">
                    {district.name} <span className="muted">· {district.state}</span>
                  </p>
                  {!hasDistrictFile ? (
                    <p className="muted small">District-level Diwali figures are still being processed. The 8 major cities above are ready now.</p>
                  ) : !districtData ? (
                    <p className="muted small">Loading district figures…</p>
                  ) : !dYear ? (
                    <p className="muted small">District figures for Diwali {y.year} aren't processed yet. Try another year.</p>
                  ) : dEffect == null ? (
                    <p className="muted small">
                      No result: {dNights?.["0"] == null ? "Diwali night was cloudy here" : `only ${dClear} clear normal nights to compare with`}, so there's no honest number.
                    </p>
                  ) : (
                    <>
                      <p className="diwali-card-value">
                        <span className={dEffect >= 0 ? "blue" : "red"}>{fmtPct(dEffect, true)}</span> on Diwali night
                      </p>
                      <p className="muted small">
                        {fmtRad(dNights?.["0"])} vs a normal night of {fmtRad(dBase)} nW/cm²/sr · {dClear} clear normal nights
                        {dClear < 5 ? " (few, so treat with care)" : ""}
                      </p>
                      {dBase != null && dBase < 1 && (
                        <p className="small gap-note">A dim district: small changes in light swing the percentage a lot.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          }
        </div>
        <div>
          {near && chart ? (
            <Suspense fallback={<div className="chart-placeholder"><p className="muted small">Loading chart…</p></div>}>
              <DiwaliChart window={data.window} baselineOffsets={data.baseline_offsets} date={y.date} year={y.year} label={chart.label} nights={chart.nights} />
            </Suspense>
          ) : (
            <div className="chart-placeholder" />
          )}
        </div>
      </div>
      <p className="muted small diwali-note">
        Normal nights are 3–7 days either side; the days right around Diwali are left out because lights go up early. Even so, many places stay lit for a week or more, so
        these figures understate the jump. "Cloudy" means Diwali night itself or too many normal nights were hidden by cloud, so there is no honest number; "· 3 nights"
        marks a comparison resting on fewer than 5 clear normal nights. Fireworks smoke can dim the satellite's view, so a small or negative change doesn't always mean
        fewer lights.
      </p>
    </section>
  );
}
