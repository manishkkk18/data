import { useEffect, useState } from "react";

/**
 * Load-time readout for testing on real devices: add ?perf to the URL.
 * Reads the timing marks MapView records, measured from when the page started loading.
 */
export default function PerfBadge() {
  const enabled = new URLSearchParams(window.location.search).has("perf");
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      const get = (name: string) => performance.getEntriesByName(name)[0]?.startTime;
      const s = (ms?: number) => (ms == null ? "…" : `${(ms / 1000).toFixed(1)} s`);
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      setLines([
        `page ready ${s(nav?.domContentLoadedEventEnd)}`,
        `map style ${s(get("style-loaded"))}`,
        `districts drawn ${s(get("districts-loaded"))}`,
        `map settled ${s(get("map-idle"))}`,
        `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
      ]);
    };
    read();
    const t = setInterval(read, 500);
    const stop = setTimeout(() => clearInterval(t), 30000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div className="perf-badge" role="status" aria-label="Load timings">
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}
