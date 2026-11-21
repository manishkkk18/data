// The support card's behaviour, on every page that has one (it sets itself up on import).
// The UPI button is a real link to the upi:// deep link:
//  - on a phone (touch, no hover) it opens the UPI app; if nothing has opened a moment later
//    (no UPI app installed), the QR dialog appears instead;
//  - everywhere else the QR dialog opens: scan it with a phone, or copy the UPI ID.
// The dialog is the native <dialog> (showModal): focus stays inside it and Esc closes it.
// Clicks are counted with the page's own GoatCounter (if present), with no personal data.

const isPhone = () => window.matchMedia("(pointer: coarse) and (hover: none)").matches;

function setup(card) {
  const prefix = card.dataset.track || "india-from-data";
  const track = (name) => window.goatcounter?.count?.({ path: `${prefix}/${name}`, title: name, event: true });
  const $ = (k) => card.querySelector(`[data-sp="${k}"]`);
  $("intl")?.addEventListener("click", () => track("support-intl"));

  const button = $("upi");
  const dialog = card.querySelector("dialog.sp-dialog");
  if (!button || !dialog) return;
  const status = dialog.querySelector(".sp-status");

  const open = () => {
    status.textContent = "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    $("copy")?.focus();
  };
  const close = () => (typeof dialog.close === "function" ? dialog.close() : dialog.removeAttribute("open"));

  button.addEventListener("click", (e) => {
    if (isPhone()) {
      track("support-upi-app");
      // Let the link open the UPI app. If the page is still in front a moment later, no app
      // took it, so offer the QR code and the ID instead.
      setTimeout(() => {
        if (document.visibilityState === "visible" && document.hasFocus()) open();
      }, 1500);
      return;
    }
    e.preventDefault();
    track("support-upi-qr");
    open();
  });

  $("close")?.addEventListener("click", close);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close(); // a click on the dimmed backdrop
  });

  $("copy")?.addEventListener("click", async () => {
    const idEl = $("id");
    try {
      await navigator.clipboard.writeText(idEl.textContent);
      status.textContent = "UPI ID copied.";
      track("support-copy");
    } catch {
      const r = document.createRange(); // no clipboard access: select it for a manual copy
      r.selectNodeContents(idEl);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      status.textContent = "Press Ctrl+C (or long-press) to copy the selected ID.";
    }
  });
}

function init() {
  document.querySelectorAll("section.sp").forEach(setup);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
