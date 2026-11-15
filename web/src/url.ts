// Shareable URLs: the view (district, month, metric, layer, 3D) lives in the query string.
//   ?d=karnataka--bangalore&m=2025-10&metric=growth&layer=night&3d=1

export type UrlState = { d?: string; m?: string; metric?: "radiance" | "growth"; layer?: "districts" | "night" | "day"; threeD?: boolean };

export function readUrl(): UrlState {
  const q = new URLSearchParams(window.location.search);
  const metric = q.get("metric");
  const layer = q.get("layer");
  return {
    d: q.get("d") ?? undefined,
    m: /^\d{4}-\d{2}$/.test(q.get("m") ?? "") ? q.get("m")! : undefined,
    metric: metric === "growth" ? "growth" : undefined,
    layer: layer === "night" || layer === "day" ? layer : undefined,
    threeD: q.get("3d") === "1" || undefined,
  };
}

/** Update the address bar without adding history entries; defaults are left out. */
export function writeUrl(s: UrlState, defaultMonth: string) {
  const q = new URLSearchParams(window.location.search);
  const set = (k: string, v: string | undefined) => (v ? q.set(k, v) : q.delete(k));
  set("d", s.d);
  set("m", s.m && s.m !== defaultMonth ? s.m : undefined);
  set("metric", s.metric === "growth" ? "growth" : undefined);
  set("layer", s.layer && s.layer !== "districts" ? s.layer : undefined);
  set("3d", s.threeD ? "1" : undefined);
  const qs = q.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", url);
}
