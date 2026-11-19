// Section links (#highways, #diwali, #leaders, …) on first load: the browser jumps to the
// anchor before the app has rendered it, so it stays at the top. Wait for the element, scroll
// there, then keep it in place for a few seconds while sections above it finish loading and
// change height. Gives up after the timeout, and never fights a visitor who has started
// scrolling.
export function scrollToHashWhenReady(timeoutMs = 15000, holdMs = 6000) {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id || !/^[\w-]+$/.test(id)) return;
  let userMoved = false;
  const stop = () => (userMoved = true);
  const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }));
  const started = performance.now();
  let lastTop: number | null = null;
  let stableSince = 0;
  let landedAt = 0; // when we first scrolled there
  let wanted = 0; // where the element sits in the viewport after scrolling (its scroll-margin)
  const done = () => events.forEach((e) => window.removeEventListener(e, stop));
  const tick = () => {
    const now = performance.now();
    if (userMoved || now - started > timeoutMs) return done();
    const el = document.getElementById(id);
    if (el && landedAt) {
      // Keep it in place while content above loads.
      if (now - landedAt > holdMs) return done();
      if (Math.abs(el.getBoundingClientRect().top - wanted) > 4) el.scrollIntoView({ block: "start" });
    } else if (el) {
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      if (top !== lastTop) {
        lastTop = top;
        stableSince = now;
      } else if (now - stableSince > 400) {
        el.scrollIntoView({ block: "start" });
        wanted = el.getBoundingClientRect().top;
        landedAt = now;
      }
    }
    setTimeout(tick, 150);
  };
  tick();
}
