import { useEffect, useRef, useState } from "react";
import { monthLabel } from "../data";

type Props = {
  months: string[];
  value: number;
  onChange: (i: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  canPlay: boolean;
  speed: 1 | 2;
  onSpeed: (s: 1 | 2) => void;
  national: (number | null)[]; // national average per month, drawn faintly behind the track
};

const THUMB = 20; // px, matches the CSS thumb size

export default function TimeBar({ months, value, onChange, playing, onTogglePlay, canPlay, speed, onSpeed, national }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = months.length;
  const frac = n > 1 ? value / (n - 1) : 1;
  // The range thumb travels from THUMB/2 to width - THUMB/2.
  const thumbX = THUMB / 2 + frac * (width - THUMB);
  // Keep the month label inside the track at both ends (it is ~64px wide).
  const labelX = Math.min(Math.max(thumbX, 32), Math.max(32, width - 32));
  // Year labels at least ~44 px apart, whatever the width.
  const pxPerYear = ((width - THUMB) * 12) / Math.max(n, 1);
  const step = Math.max(1, Math.ceil(44 / pxPerYear));
  const starts = months
    .map((mo, i) => ({ year: mo.slice(0, 4), i }))
    .filter((y, k, arr) => k === 0 || y.year !== arr[k - 1].year)
    .filter((y, k, arr) => !(k === 0 && arr[1] && arr[1].i - y.i < 6));
  const anchor = Number(starts[0]?.year ?? 0);
  const years = starts.filter((y) => (Number(y.year) - anchor) % step === 0);

  // Faint national-brightness line behind the track, on the same x positions as the thumb.
  const vals = national.filter((v): v is number => v != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const h = 22;
  let path = "";
  let pen = false;
  national.forEach((v, i) => {
    if (v == null) return void (pen = false);
    const x = THUMB / 2 + (i / Math.max(n - 1, 1)) * (width - THUMB);
    const y = h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4);
    path += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  });

  return (
    <div className="timebar-controls">
      <button type="button" className="play" onClick={onTogglePlay} disabled={!canPlay} aria-label={playing ? "Pause" : "Play through the months"}>
        {playing ? (
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="5" y="4" width="3.5" height="12" rx="1" />
            <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6 4l10 6-10 6z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="speed"
        onClick={() => onSpeed(speed === 1 ? 2 : 1)}
        aria-label={`Playback speed ${speed}×, switch to ${speed === 1 ? 2 : 1}×`}
        title="Playback speed"
      >
        {speed}×
      </button>
      <div className="slider" ref={ref}>
        {path && (
          <svg className="slider-spark" width={width} height={h} aria-hidden="true">
            <path d={path} />
          </svg>
        )}
        <span className="thumb-label" style={{ left: labelX }} aria-hidden="true">
          {monthLabel(months[value], true)}
        </span>
        <label htmlFor="month-slider" className="sr-only">
          Month
        </label>
        <input
          id="month-slider"
          type="range"
          min={0}
          max={Math.max(n - 1, 1)}
          step={1}
          value={n < 2 ? 1 : value}
          disabled={n < 2}
          aria-valuetext={monthLabel(months[value])}
          aria-describedby="month-slider-help"
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span id="month-slider-help" className="sr-only">
          Use the left and right arrow keys anywhere on the page to step through months; hold Shift to jump a year.
        </span>
        <div className="ticks" aria-hidden="true">
          {years.map((y) => (
            <span key={y.year} style={{ left: THUMB / 2 + (y.i / Math.max(n - 1, 1)) * (width - THUMB) }}>
              {y.year}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
