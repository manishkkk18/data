import { useEffect, useRef, useState } from "react";
import { dayLabel } from "../data";

// Same component as India Night Lights' timeline, stepping through days instead of months.
type Props = {
  days: string[]; // IST dates, oldest first
  value: number;
  onChange: (i: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  canPlay: boolean;
  speed: 1 | 2;
  onSpeed: (s: 1 | 2) => void;
  series: (number | null)[]; // detections per day, drawn faintly behind the track
};

const THUMB = 20; // px, matches the CSS thumb size

export default function TimeBar({ days, value, onChange, playing, onTogglePlay, canPlay, speed, onSpeed, series }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = days.length;
  const frac = n > 1 ? value / (n - 1) : 1;
  const xAt = (i: number) => THUMB / 2 + (i / Math.max(n - 1, 1)) * (width - THUMB);
  const thumbX = THUMB / 2 + frac * (width - THUMB);
  const labelX = Math.min(Math.max(thumbX, 32), Math.max(32, width - 32));
  // Day ticks at least ~44 px apart.
  const step = Math.max(1, Math.ceil(44 / ((width - THUMB) / Math.max(n - 1, 1))));

  // Faint daily-detections line behind the track, on the same x positions as the thumb.
  const vals = series.filter((v): v is number => v != null);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(...vals);
  const h = 22;
  let path = "";
  let pen = false;
  series.forEach((v, i) => {
    if (v == null) return void (pen = false);
    const y = h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4);
    path += `${pen ? "L" : "M"}${xAt(i).toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  });

  return (
    <div className="timebar-controls">
      <button type="button" className="play" onClick={onTogglePlay} disabled={!canPlay} aria-label={playing ? "Pause" : "Play through the days"}>
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
          {n ? dayLabel(days[value]) : "–"}
        </span>
        <label htmlFor="day-slider" className="sr-only">
          Day
        </label>
        <input
          id="day-slider"
          type="range"
          min={0}
          max={Math.max(n - 1, 1)}
          step={1}
          value={n < 2 ? 1 : value}
          disabled={n < 2}
          aria-valuetext={n ? dayLabel(days[value], true) : undefined}
          aria-describedby="day-slider-help"
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span id="day-slider-help" className="sr-only">
          Use the left and right arrow keys anywhere on the page to step through days.
        </span>
        <div className="ticks" aria-hidden="true">
          {days.map((d, i) =>
            i % step === 0 ? (
              <span key={d} style={{ left: xAt(i) }}>
                {dayLabel(d)}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
