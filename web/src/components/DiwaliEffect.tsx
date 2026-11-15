import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { fmtPct, type Diwali } from "../data";

const DiwaliChart = lazy(() => import("./DiwaliChart"));

function longDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function DiwaliEffect({ data }: { data: Diwali | null }) {
  const years = data?.years.filter((y) => Object.values(y.effect).some((v) => v != null)) ?? [];
  const [year, setYear] = useState(() => years[years.length - 1]?.year);
  const [city, setCity] = useState<string | null>(null);
  // Load the chart library only when the section is near the viewport.
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = section.current;
    if (!el || near) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  if (!data || years.length === 0) return null;
  const y = years.find((v) => v.year === year) ?? years[years.length - 1];
  const rows = data.cities.map((c) => ({ city: c, effect: y.effect[c], clear: y.clear_baseline_nights[c] ?? 0 }));
  const sorted = [...rows].sort((a, b) => (b.effect ?? -Infinity) - (a.effect ?? -Infinity));
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.effect ?? 0)), 1);
  const shownCity = city && data.cities.includes(city) ? city : sorted[0].city;

  return (
    <section id="diwali" ref={section} className="panel diwali" aria-labelledby="diwali-title">
      <div className="diwali-head">
        <div>
          <h2 id="diwali-title">The Diwali effect</h2>
          <p className="muted small">
            How much brighter each city was on Diwali night ({longDate(y.date)}) than on a normal night that fortnight, from NASA's daily night-light data.
          </p>
        </div>
        <div className="year-pills" role="radiogroup" aria-label="Year">
          {years.map((v) => (
            <button key={v.year} type="button" role="radio" aria-checked={v.year === y.year} className={v.year === y.year ? "on" : ""} onClick={() => setYear(v.year)}>
              {v.year}
            </button>
          ))}
        </div>
      </div>

      <div className="diwali-body">
        <ol className="bars diverging" aria-label={`Diwali night brightness change by city, ${y.year}`}>
          {sorted.map((r) => (
            <li key={r.city}>
              <button type="button" className={`bar-row ${r.city === shownCity ? "on" : ""}`} onClick={() => setCity(r.city)} aria-pressed={r.city === shownCity}>
                <span className="bar-name">{r.city}</span>
                <span className="bar-value">{r.effect == null ? <span className="muted">cloudy</span> : fmtPct(r.effect, true)}</span>
                <span className="bar-track split" aria-hidden="true">
                  {r.effect != null && (
                    <span
                      className={`bar-fill ${r.effect >= 0 ? "blue-fill pos" : "red-fill neg"}`}
                      style={{ width: `${(Math.abs(r.effect) / maxAbs) * 50}%` }}
                    />
                  )}
                </span>
                {r.effect == null && (
                  <span className="sr-only">
                    {" "}
                    No result: Diwali night was cloudy or too few clear normal nights ({r.clear}).
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
        <div>
          {near ? (
            <Suspense fallback={<div className="chart-placeholder"><p className="muted small">Loading chart…</p></div>}>
              <DiwaliChart data={data} year={y.year} city={shownCity} />
            </Suspense>
          ) : (
            <div className="chart-placeholder" />
          )}
        </div>
      </div>
      <p className="muted small diwali-note">
        Normal nights are 3–7 days either side; the days right around Diwali are left out because lights go up early. "Cloudy" means Diwali night itself or too many of the
        normal nights were hidden by cloud, so there is no honest number. Fireworks smoke can dim the satellite's view, so a small or negative change doesn't always mean
        fewer lights.
      </p>
    </section>
  );
}
