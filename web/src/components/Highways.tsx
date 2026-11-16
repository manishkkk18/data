import { useEffect, useMemo, useRef, useState } from "react";
import { RAD_STOPS, fmtPct, fmtRad } from "../data";
import { COLOR_A, COLOR_B, MARKER } from "./chartColors";
import { track } from "../analytics";

type S = { median: number | null; mean: number | null; lit: number | null; n: number };
export type Corridor = {
  id: string;
  name: string;
  kind: "gq" | "expressway";
  road: string;
  opened: number | null;
  route_km: number;
  bin_km: number;
  labels: { name: string; km: number; city: boolean }[];
  bbox: [number, number, number, number];
  years: number[];
  strip: S[];
  country: S[];
  profile: (number | null)[][];
};
type Corridors = { strip_km: number; country_km: [number, number]; city_radius_km: number; lit_threshold: number; corridors: Corridor[] };

type Props = { available: boolean; onShow: (c: Corridor) => void; shownId: string | null };

const pct = (a: number | null, b: number | null) => (a != null && b != null && a > 0 ? ((b - a) / a) * 100 : null);

/** First and last year with a value. */
function ends(c: Corridor, key: "strip" | "country", f: "median" | "lit") {
  const idx = c.years.map((_, i) => i).filter((i) => c[key][i]?.[f] != null);
  if (idx.length < 2) return null;
  const a = idx[0];
  const b = idx[idx.length - 1];
  return { y0: c.years[a], y1: c.years[b], v0: c[key][a][f]!, v1: c[key][b][f]! };
}

function summary(c: Corridor) {
  const sm = ends(c, "strip", "median");
  const cm = ends(c, "country", "median");
  const lit = ends(c, "strip", "lit");
  return {
    lit,
    strip: sm ? pct(sm.v0, sm.v1) : null,
    country: cm ? pct(cm.v0, cm.v1) : null,
    y0: sm?.y0,
    y1: sm?.y1,
  };
}

// Same colour scale as the map (log radiance).
function radColor(v: number | null) {
  if (v == null) return "transparent";
  const lv = Math.log10(Math.max(v, RAD_STOPS[0][0]));
  for (let i = 1; i < RAD_STOPS.length; i++) {
    const [a, ca] = RAD_STOPS[i - 1];
    const [b, cb] = RAD_STOPS[i];
    if (lv <= Math.log10(b) || i === RAD_STOPS.length - 1) {
      const t = Math.min(Math.max((lv - Math.log10(a)) / (Math.log10(b) - Math.log10(a)), 0), 1);
      const h = (s: string, k: number) => parseInt(s.slice(1 + 2 * k, 3 + 2 * k), 16);
      const mix = [0, 1, 2].map((k) => Math.round(h(ca, k) + (h(cb, k) - h(ca, k)) * t));
      return `rgb(${mix.join(",")})`;
    }
  }
  return RAD_STOPS[RAD_STOPS.length - 1][1];
}

export default function Highways({ available, onShow, shownId }: Props) {
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [data, setData] = useState<Corridors | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    const el = section.current;
    if (!el || near) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near || !available || data) return;
    fetch(`${import.meta.env.BASE_URL}data/corridors.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, [near, available, data]);

  const rows = useMemo(
    () =>
      (data?.corridors ?? [])
        .map((c) => ({ c, s: summary(c) }))
        .sort((a, b) => (b.s.lit ? b.s.lit.v1 - b.s.lit.v0 : -1e9) - (a.s.lit ? a.s.lit.v1 - a.s.lit.v0 : -1e9)),
    [data],
  );
  if (!available) return null;
  const sel = rows.find((r) => r.c.id === (pick ?? rows[0]?.c.id));

  return (
    <section id="highways" ref={section} className="panel highways" aria-labelledby="highways-title">
      <div className="diwali-head">
        <div>
          <h2 id="highways-title">Highway corridors</h2>
          <p className="muted">
            The satellite passes over at 1:30 am and sees ~500 m at a time, so it can't count cars. What it does see is the
            <b> lit development along a road</b>: street lights, toll plazas, fuel stations, dhabas, warehouses and the towns that grow
            beside it. Here's how that has changed since 2015 on the Golden Quadrilateral and newer expressways.
          </p>
        </div>
      </div>

      {!data ? (
        <p className="muted">Loading corridors…</p>
      ) : (
        <div className="hw-body">
          <div className="hw-table-wrap">
            <table className="compare-table hw-table">
              <caption className="sr-only">Highway corridors ranked by the rise in the share of the road strip that is lit</caption>
              <thead>
                <tr>
                  <th scope="col">Corridor</th>
                  <th scope="col">Lit share</th>
                  <th scope="col" title={`Median brightness within ${data.strip_km} km of the road`}>
                    Road strip
                  </th>
                  <th scope="col" title={`Median brightness ${data.country_km[0]}–${data.country_km[1]} km from the road`}>
                    Countryside
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, s }) => {
                  const on = sel?.c.id === c.id;
                  return (
                    <tr key={c.id} className={on ? "on" : ""}>
                      <th scope="row">
                        <button
                          type="button"
                          className="link-btn hw-name"
                          aria-pressed={on}
                          onClick={() => {
                            setPick(c.id);
                            track("corridor");
                          }}
                        >
                          {c.name}
                          <span className="muted">{c.kind === "gq" ? " · Golden Quadrilateral" : c.opened ? ` · opened ${c.opened}` : ""}</span>
                        </button>
                      </th>
                      <td>{s.lit ? `${Math.round(s.lit.v0)}% → ${Math.round(s.lit.v1)}%` : "–"}</td>
                      <td className={s.strip == null ? "muted" : s.strip >= 0 ? "blue" : "red"}>{s.strip == null ? "–" : fmtPct(s.strip, true)}</td>
                      <td className="muted">{s.country == null ? "–" : fmtPct(s.country, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">
              {rows[0]?.s.y0 ?? 2015} → {rows[0]?.s.y1 ?? ""}, NASA annual composites. Lit share: part of the road strip at or above {data.lit_threshold} nW/cm²/sr.
              Brightness is the median pixel, so one bright town doesn't swing it. Stretches within {data.city_radius_km} km of big cities are left out.
            </p>
          </div>
          {sel && <Detail c={sel.c} s={sel.s} meta={data} onShow={onShow} shown={shownId === sel.c.id} />}
        </div>
      )}
    </section>
  );
}

function Detail({ c, s, meta, onShow, shown }: { c: Corridor; s: ReturnType<typeof summary>; meta: Corridors; onShow: (c: Corridor) => void; shown: boolean }) {
  const ahead = s.strip != null && s.country != null ? s.strip - s.country : null;
  return (
    <div className="hw-detail">
      <div className="hw-detail-head">
        <div>
          <h3 className="hw-title">{c.name}</h3>
          <p className="muted small">
            {c.road} · about {c.route_km.toLocaleString("en-IN")} km{c.opened ? ` · opened ${c.opened}` : ""}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => onShow(c)} aria-pressed={shown}>
          {shown ? "Shown on map" : "Show on map"}
        </button>
      </div>
      {s.lit && (
        <p className="plain">
          In {s.lit.y0}, <b>{Math.round(s.lit.v0)}%</b> of the road strip was lit; by {s.lit.y1}, <b>{Math.round(s.lit.v1)}%</b>.
          {ahead != null && (
            <>
              {" "}
              It brightened {ahead >= 0 ? "faster" : "slower"} than the countryside {meta.country_km[0]}–{meta.country_km[1]} km away (
              <b>{fmtPct(s.strip!, true)}</b> vs <b>{fmtPct(s.country!, true)}</b>).
            </>
          )}
        </p>
      )}
      <TrendLines c={c} />
      <Strip c={c} />
    </div>
  );
}

/** Median brightness of the road strip and of the countryside, per year. */
function TrendLines({ c }: { c: Corridor }) {
  const W = 560;
  const H = 180;
  const P = { l: 40, r: 92, t: 12, b: 24 };
  const a = c.strip.map((v) => v.median);
  const b = c.country.map((v) => v.median);
  const all = [...a, ...b].filter((v): v is number => v != null);
  if (all.length < 2) return null;
  const max = Math.max(...all) * 1.1;
  const y0 = c.years[0];
  const y1 = c.years[c.years.length - 1];
  const x = (yr: number) => P.l + ((yr - y0) / Math.max(y1 - y0, 1)) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) return void (pen = false);
      d += `${pen ? "L" : "M"}${x(c.years[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const ticks = [0, max / 2, max].map((v) => Math.round(v * 10) / 10);
  const lastA = [...a].reverse().find((v) => v != null);
  const lastB = [...b].reverse().find((v) => v != null);
  return (
    <figure className="hw-chart">
      <figcaption className="trend-legend">
        <span>
          <i style={{ background: COLOR_A }} /> Road strip (within 2 km)
        </span>
        <span>
          <i style={{ background: COLOR_B }} /> Countryside (10–20 km away)
        </span>
        {c.opened && c.opened >= y0 && (
          <span>
            <i className="dash" style={{ borderColor: MARKER }} /> Opened
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Median brightness along ${c.name} and in the countryside nearby, ${y0} to ${y1}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={P.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
              {t}
            </text>
          </g>
        ))}
        {c.years.map((yr) =>
          (yr - y0) % 2 === 0 ? (
            <text key={yr} x={x(yr)} y={H - 6} textAnchor="middle" className="axis">
              {yr}
            </text>
          ) : null,
        )}
        {c.opened && c.opened >= y0 && c.opened <= y1 && (
          <line x1={x(c.opened)} x2={x(c.opened)} y1={P.t} y2={H - P.b} stroke={MARKER} strokeDasharray="4 4" strokeWidth={1.5} />
        )}
        <path d={path(b)} fill="none" stroke={COLOR_B} strokeWidth={2} />
        <path d={path(a)} fill="none" stroke={COLOR_A} strokeWidth={2} />
        {c.years.map((yr, i) => (
          <g key={yr}>
            {a[i] != null && (
              <circle cx={x(yr)} cy={y(a[i]!)} r={3} fill={COLOR_A}>
                <title>{`${yr} road strip: ${fmtRad(a[i])} nW/cm²/sr`}</title>
              </circle>
            )}
            {b[i] != null && (
              <circle cx={x(yr)} cy={y(b[i]!)} r={3} fill={COLOR_B}>
                <title>{`${yr} countryside: ${fmtRad(b[i])} nW/cm²/sr`}</title>
              </circle>
            )}
          </g>
        ))}
        {lastA != null && (
          <text x={W - P.r + 8} y={y(lastA) + 4} className="axis label">
            Road {fmtRad(lastA)}
          </text>
        )}
        {lastB != null && (
          <text x={W - P.r + 8} y={y(lastB) + 4} className="axis label">
            Country {fmtRad(lastB)}
          </text>
        )}
      </svg>
      <p className="muted small">Median radiance, nW/cm²/sr. Hover a dot for its value.</p>
    </figure>
  );
}

/** Year-by-distance strip: each cell is the average light in a 10 km stretch of the road strip. */
function Strip({ c }: { c: Corridor }) {
  const nb = Math.max(...c.profile.map((p) => p.length), 1);
  const W = 560;
  const rowH = 12;
  const L = 40;
  const H = c.years.length * rowH + 34;
  const cw = (W - L) / nb;
  // Labels along the route, skipping ones that would overlap.
  const labels: { name: string; x: number }[] = [];
  for (const l of c.labels) {
    const lx = L + (l.km / c.bin_km) * cw;
    if (labels.every((o) => Math.abs(o.x - lx) > 70)) labels.push({ name: l.name, x: Math.min(Math.max(lx, L + 20), W - 20) });
  }
  return (
    <figure className="hw-strip">
      <figcaption className="small muted">
        Along the road, year by year: brighter cells are stretches that lit up. Gaps are city stretches left out or cloud.
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Brightness along ${c.name}, in ${c.bin_km} km stretches, by year`}>
        {c.years.map((yr, r) => (
          <g key={yr}>
            <text x={L - 6} y={r * rowH + rowH - 2} textAnchor="end" className="axis">
              {yr}
            </text>
            {c.profile[r].map((v, k) =>
              v == null ? null : (
                <rect key={k} x={L + k * cw} y={r * rowH} width={cw + 0.3} height={rowH - 1} fill={radColor(v)}>
                  <title>{`${yr}, ${Math.round(k * c.bin_km)}–${Math.round((k + 1) * c.bin_km)} km from ${c.labels[0]?.name}: ${fmtRad(v)} nW/cm²/sr`}</title>
                </rect>
              ),
            )}
          </g>
        ))}
        {labels.map((l) => (
          <g key={l.name}>
            <line x1={l.x} x2={l.x} y1={c.years.length * rowH} y2={c.years.length * rowH + 5} className="grid strong" />
            <text x={l.x} y={c.years.length * rowH + 18} textAnchor="middle" className="axis">
              {l.name}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
