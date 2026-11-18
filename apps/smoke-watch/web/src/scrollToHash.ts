// Section links (#leaders, #highways, …) on first load: the browser jumps to the anchor
// before the app has rendered it, so it stays at the top. Wait for the element, let the
// layout above it settle, then scroll there. Gives up after a few seconds, and never
// fights a visitor who has already started scrolling.
export function scrollToHashWhenReady(timeoutMs = 15000) {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id || !/^[\w-]+$/.test(id)) return;
  let userMoved = false;
  const stop = () => (userMoved = true);
  const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }));
  const started = performance.now();
  let lastTop: number | null = null;
  let stableSince = 0;
  const tick = () => {
    if (userMoved || performance.now() - started > timeoutMs) return done();
    const el = document.getElementById(id);
    if (el) {
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      if (top !== lastTop) {
        lastTop = top;
        stableSince = performance.now();
      } else if (performance.now() - stableSince > 400) {
        el.scrollIntoView({ block: "start" });
        return done();
      }
    }
    setTimeout(tick, 100);
  };
  const done = () => events.forEach((e) => window.removeEventListener(e, stop));
  tick();
}
