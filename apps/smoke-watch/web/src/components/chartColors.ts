// Chart colours come from theme.css (--chart-a ochre, --chart-b violet, validated with the
// dataviz palette checker on the Haze panel); the selected-day marker is the teal selection colour.
import { theme } from "../theme";

export const chartColors = () => {
  const t = theme();
  return { A: t.chartA, B: t.chartB, MARKER: t.select, FIRE: t.fire[1], AXIS: t.muted, GRID: t.border };
};
