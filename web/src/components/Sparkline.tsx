// A tiny line of a series, with breaks where values are missing (never bridged).
type Props = {
  values: (number | null | undefined)[];
  width: number;
  height: number;
  className?: string;
  marker?: number; // index to mark with a dot
  log?: boolean; // log scale, for radiance that spans orders of magnitude
};

export default function Sparkline({ values, width, height, className, marker, log }: Props) {
  const f = (v: number) => (log ? Math.log10(Math.max(v, 0.01)) : v);
  const nums = values.filter((v): v is number => v != null).map(f);
  if (nums.length < 2) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * width;
  const y = (v: number) => height - 1 - ((f(v) - lo) / (hi - lo || 1)) * (height - 2);
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  const mv = marker != null ? values[marker] : null;
  return (
    <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      {mv != null && <circle cx={x(marker!)} cy={y(mv)} r="2.5" fill="currentColor" />}
    </svg>
  );
}
