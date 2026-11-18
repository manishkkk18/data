import { GROWTH_STOPS, GROWTH_TICKS, LEGEND_TICKS, RAD_STOPS, fmtRad } from "../data";

/** A colour band being hovered: districts whose value (feature-state `key`) is in [lo, hi). */
export type Highlight = { key: "lrad" | "g"; lo: number; hi: number } | null;

type Props = { growth: boolean; onHighlight: (h: Highlight) => void };

export default function Legend({ growth, onHighlight }: Props) {
  // Bands between neighbouring colour stops, in the units the map colours by.
  const stops = growth ? GROWTH_STOPS.map(([v, c]) => [v, c] as const) : RAD_STOPS.map(([v, c]) => [Math.log10(v), c] as const);
  const lo = stops[0][0];
  const hi = stops[stops.length - 1][0];
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const gradient = `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${pos(v).toFixed(1)}%`).join(", ")})`;
  const key = growth ? "g" : "lrad";
  const label = (v: number) => (growth ? `${v >= 0 ? "+" : ""}${Math.round((2 ** v - 1) * 100)}%` : fmtRad(10 ** v));
  const bands = stops.slice(1).map(([v, _], i) => {
    const a = stops[i][0];
    // The ends stretch to cover everything beyond the scale.
    return { a, b: v, lo: i === 0 ? -99 : a, hi: i === stops.length - 2 ? 99 : v };
  });

  return (
    <div
      className="legend"
      aria-label={growth ? "Legend: change in brightness since the same month in 2015" : "Legend: radiance in nanowatts per square centimetre per steradian, log scale"}
      onMouseLeave={() => onHighlight(null)}
    >
      <div className="legend-bar" style={{ background: gradient }}>
        {bands.map((band) => (
          <button
            key={band.a}
            type="button"
            className="legend-band"
            style={{ left: `${pos(band.a)}%`, width: `${pos(band.b) - pos(band.a)}%` }}
            aria-label={`Highlight districts from ${label(band.a)} to ${label(band.b)}`}
            title={`${label(band.a)} – ${label(band.b)}`}
            onMouseEnter={() => onHighlight({ key, lo: band.lo, hi: band.hi })}
            onFocus={() => onHighlight({ key, lo: band.lo, hi: band.hi })}
            onBlur={() => onHighlight(null)}
          />
        ))}
      </div>
      <div className="legend-ticks" aria-hidden="true">
        {growth
          ? GROWTH_TICKS.map(([v, t]) => (
              <span key={t} style={{ left: `${pos(v)}%`, transform: pos(v) <= 0 ? "none" : pos(v) >= 100 ? "translateX(-100%)" : undefined }}>
                {t}
              </span>
            ))
          : LEGEND_TICKS.map((t) => (
              <span key={t} style={{ left: `${pos(Math.log10(t))}%` }}>
                {t}
              </span>
            ))}
      </div>
      <div className="legend-foot">
        <span className="muted">{growth ? "vs same month in 2015" : "nW/cm²/sr"}<span className="hover-hint"> · hover a band</span></span>
        {!growth && (
          <span className="legend-gap">
            <i className="est" aria-hidden="true" /> Estimate
          </span>
        )}
        <span className="legend-gap">
          <i aria-hidden="true" /> No data
        </span>
      </div>
    </div>
  );
}
