// The map (MapLibre) and charts (Recharts, canvas) can't use CSS variables, so they read the
// Haze tokens from theme.css here. Read on first use, after the stylesheet has loaded, so
// theme.css stays the one place every colour is defined.
type Theme = ReturnType<typeof read>;
let cache: Theme | null = null;

function read() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const rgb = (name: string, a: number) => `rgba(${v(name).split(/\s+/).join(",")},${a})`;
  return {
    bg: v("--bg"),
    border: v("--border"),
    text: v("--text"),
    muted: v("--muted"),
    accent: v("--accent"),
    select: v("--select"),
    selectSoft: v("--select-soft"),
    selectGlow: rgb("--select-rgb", 0.6),
    fire: [v("--fire-1"), v("--fire-2"), v("--fire-3"), v("--fire-4")] as const,
    fireHover: v("--fire-1"),
    mapLand: v("--map-land"),
    mapWater: v("--map-water"),
    mapLabel: v("--map-label"),
    mapLine: (a: number) => rgb("--map-line-rgb", a),
    mapSky: v("--map-sky"),
    mapHorizon: v("--map-horizon"),
    mapFog: v("--map-fog"),
    chartA: v("--chart-a"),
    chartB: v("--chart-b"),
  };
}

export function theme(): Theme {
  return (cache ??= read());
}
