// Shared helpers: colour tokens from the CSS, number formats, tooltips that work on hover and tap.
const css = getComputedStyle(document.documentElement);
export const tok = (name) => css.getPropertyValue(`--${name}`).trim();

export const C = {
  ink: tok("ink"), ink2: tok("ink-2"), muted: tok("muted"), steel: tok("steel"), rule: tok("rule"),
  paper: tok("paper"), accent: tok("accent"), accentInk: tok("accent-ink"),
  series: { manufacturing: tok("s-mfg"), mining: tok("s-min"), electricity: tok("s-ele") },
  seq: ["q1", "q2", "q3", "q4", "q5", "q6"].map(tok),
  div: ["d-3", "d-2", "d-1", "d0", "d1", "d2", "d3"].map(tok),
  nodata: tok("nodata"),
};

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ym = (s) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
export const pct = (v, d = 1) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);
export const pa = (v, d = 1) => (v == null ? "–" : `${pct(v, d)} a year`);
export const int = (v) => (v == null ? "–" : Math.round(v).toLocaleString("en-IN"));
export const lakh = (v) => (v == null ? "–" : v >= 1e7 ? `${(v / 1e7).toFixed(2)} crore` : `${(v / 1e5).toFixed(2)} lakh`);
export const crore = (v) => (v == null ? "–" : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} lakh crore` : `₹${Math.round(v).toLocaleString("en-IN")} crore`);
export const rsLakh = (v) => (v == null ? "–" : `₹${v.toFixed(2)} lakh`);
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/** Segmented buttons: calls onChange(value) and keeps aria-pressed in step. */
export function segmented(el, attr, onChange) {
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.getAttribute("aria-pressed") === "true") return;
    el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    onChange(b.dataset[attr]);
  });
}

/** A tooltip positioned inside its (position:relative) container, kept on screen. */
export function tooltip(tipEl, container) {
  return {
    show(html, x, y) {
      tipEl.innerHTML = html;
      tipEl.hidden = false;
      const cw = container.clientWidth;
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let left = x + 14;
      if (left + w > cw) left = Math.max(0, x - w - 14);
      let top = y - h - 12;
      if (top < 0) top = y + 16;
      tipEl.style.left = `${left}px`;
      tipEl.style.top = `${top}px`;
    },
    hide() { tipEl.hidden = true; },
  };
}

/** Pointer position relative to an element. */
export const rel = (ev, el) => {
  const r = el.getBoundingClientRect();
  return [ev.clientX - r.left, ev.clientY - r.top];
};

/** Re-render on width change (debounced), not on every scroll-induced height change on phones. */
export function onResize(el, fn) {
  let w = el.clientWidth, t;
  new ResizeObserver(() => {
    if (el.clientWidth === w) return;
    w = el.clientWidth;
    clearTimeout(t);
    t = setTimeout(fn, 120);
  }).observe(el);
}

export const track = (name) => window.goatcounter?.count?.({ path: `india-manufacturing/${name}`, title: name, event: true });
