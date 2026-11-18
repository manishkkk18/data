import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CrossCheck as CrossCheckData } from "../data";

const CrossCheckChart = lazy(() => import("./CrossCheckChart"));

type Props = { data: CrossCheckData | null; preferredState?: string };

function describe(r: number) {
  if (r >= 0.8) return "strongly agree";
  if (r >= 0.6) return "broadly agree";
  if (r >= 0.4) return "partly agree";
  return "agree only weakly";
}

export default function CrossCheck({ data, preferredState }: Props) {
  const states = data?.states.filter((s) => Object.keys(s.bhuvan).length > 0).map((s) => s.state) ?? [];
  // Load the chart library only when the visitor scrolls near this section, so it
  // doesn't compete with the map for bandwidth on first load.
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = section.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const [state, setState] = useState(() => (preferredState && states.includes(preferredState) ? preferredState : states.includes("Karnataka") ? "Karnataka" : states[0]));
  // Follow the district selected on the map.
  useEffect(() => {
    if (preferredState && states.includes(preferredState)) setState(preferredState);
  }, [preferredState]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || states.length === 0) return null;
  const a = data.agreement;
  const sources = Object.entries(data.ours_source);
  const allMonthly = sources.every(([, s]) => s.startsWith("monthly"));

  return (
    <section id="crosscheck" ref={section} className="panel crosscheck" aria-labelledby="crosscheck-title">
      <div className="crosscheck-head">
        <div>
          <h2 id="crosscheck-title">Cross-check with ISRO Bhuvan</h2>
          <p className="muted small">
            State trends from our pipeline next to the yearly figures published by NRSC/ISRO's Bhuvan night-lights portal. Both are indexed to {data.base_year} = 100,
            because Bhuvan's statistic is defined differently from ours, so only the trends are comparable.
          </p>
        </div>
        <label className="select">
          <span className="sr-only">State</span>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="crosscheck-body">
        <Suspense fallback={<div className="chart-placeholder"><p className="muted small">Loading chart…</p></div>}>
          {near ? <CrossCheckChart data={data} state={state} /> : <div className="chart-placeholder" />}
        </Suspense>
        <div className="crosscheck-notes">
          {a?.spearman != null && (
            <p className="agreement">
              <span className="agreement-value">{a.spearman.toFixed(2)}</span>
              <span>
                Across {a.states} states, the two sources <b>{describe(a.spearman)}</b> on which states brightened most from {a.from} to {a.to} (rank correlation; 1 = identical
                ordering).
              </span>
            </p>
          )}
          <ul className="small muted">
            <li>
              <b>Collection break ("Bhuvan C2" on the chart):</b> Bhuvan's {data.break_year - 1} and earlier values come from NASA Collection 1, and {data.break_year} onwards from Collection 2, so its jump into{" "}
              {data.break_year} may partly be a change of method. Ours use Collection 2 throughout. Agreement is measured before the break.
            </li>
            <li>
              <b>Our yearly values:</b>{" "}
              {allMonthly
                ? "for now each year comes from the months processed so far (often a single October), which is noisy. They switch to NASA's annual product once it has been processed."
                : sources.map(([y, s]) => `${y}: ${s}`).join(", ")}
            </li>
            {data.excluded.length > 0 && (
              <li>
                <b>Left out:</b> Dadra &amp; Nagar Haveli and Daman &amp; Diu. Bhuvan lists them separately, while our boundaries merge them into one UT, and two averages
                can't be combined without their areas.
              </li>
            )}
            <li>
              Source:{" "}
              <a href="https://bhuvan-app1.nrsc.gov.in/bhuvan_ntl/" target="_blank" rel="noopener">
                Bhuvan NTL (NRSC/ISRO)
              </a>
              , fetched {data.generated.slice(0, 10)}.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
