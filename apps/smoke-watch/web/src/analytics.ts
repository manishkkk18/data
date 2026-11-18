// Page views come from the GoatCounter script in index.html (same account as India Night
// Lights and the portfolio). This adds a few anonymous feature-use events so we can see which
// features people actually try. No cookies, no personal data; GoatCounter skips localhost,
// so development doesn't count. Copied from India Night Lights; only the path prefix differs.

type GoatCounter = { count?: (opts: { path: string; title?: string; event?: boolean }) => void };

const sent = new Set<string>();

/** Count a feature use once per page visit, e.g. track("play"). */
export function track(name: string) {
  if (sent.has(name)) return;
  const gc = (window as unknown as { goatcounter?: GoatCounter }).goatcounter;
  if (!gc?.count) return; // script blocked or not loaded yet: fine, skip
  sent.add(name);
  gc.count({ path: `delhi-smoke-watch/${name}`, title: name, event: true });
}
