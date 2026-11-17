// Shareable URLs: the view lives in the query string (same approach as India Night Lights).
//   ?day=2026-11-15&w=3d&d=punjab--sangrur&wind=10m

import type { Window, WindLevel } from "./data";

export type UrlState = { day?: string; w?: Window; d?: string; wind?: WindLevel | "off" };

export function readUrl(): UrlState {
  const q = new URLSearchParams(window.location.search);
  const w = q.get("w");
  const wind = q.get("wind");
  return {
    day: /^\d{4}-\d{2}-\d{2}$/.test(q.get("day") ?? "") ? q.get("day")! : undefined,
    w: w === "3d" || w === "7d" || w === "24h" ? w : undefined,
    d: /^[a-z0-9-]+$/.test(q.get("d") ?? "") ? q.get("d")! : undefined,
    wind: wind === "10m" || wind === "off" ? wind : undefined,
  };
}

/** Update the address bar without adding history entries; defaults are left out. */
export function writeUrl(s: UrlState, defaults: { day: string }) {
  const q = new URLSearchParams(window.location.search);
  const set = (k: string, v: string | undefined) => (v ? q.set(k, v) : q.delete(k));
  set("day", s.day && s.day !== defaults.day ? s.day : undefined);
  set("w", s.w && s.w !== "24h" ? s.w : undefined);
  set("d", s.d);
  set("wind", s.wind && s.wind !== "850hPa" ? s.wind : undefined);
  const qs = q.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", url);
}
