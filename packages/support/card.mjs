// The support card's HTML, built at build time from packages/config/support.json: the UPI
// button, the QR dialog (the QR code drawn here as inline SVG, so pages make no runtime
// requests for it) and the optional international link. Anything not configured is left out;
// with nothing configured there is no card at all.
//
// Used by every page: the Vite apps through ./vite.mjs, the static Monsoon page through
// ./inject.mjs. Behaviour is in ./client.js, looks in ./support.css.
import { readFileSync } from "node:fs";
import QRCode from "qrcode";

const CONFIG = new URL("../config/support.json", import.meta.url);

export function readConfig() {
  return JSON.parse(readFileSync(CONFIG, "utf8"));
}

/** The UPI deep link (no fixed amount; every value URL-encoded), or null if UPI isn't set up. */
export function upiLink(c = readConfig()) {
  const id = (c.upi?.id ?? "").trim();
  const name = (c.upi?.name ?? "").trim();
  const note = (c.upi?.note ?? "").trim();
  if (!id || !name) return null;
  const q = [["pa", id], ["pn", name], ["cu", "INR"], ["tn", note]].filter(([, v]) => v);
  return `upi://pay?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A QR code as SVG: dark modules on white, so every scanner reads it. */
export async function qrSvg(text) {
  const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#0b0f1a", light: "#ffffff" } });
  return svg.replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
}

/**
 * The card. `track` is the page's analytics prefix (e.g. "india-night-lights"); clicks are
 * counted as <track>/support-… with no personal data.
 */
export async function supportCardHtml({ track = "india-from-data" } = {}, c = readConfig()) {
  const link = upiLink(c);
  const intl = (c.international?.url ?? "").trim() ? c.international : null;
  if (!link && !intl) return "";
  const upiButton = link
    ? `<a class="sp-btn sp-primary" data-sp="upi" href="${esc(link)}"><span class="sp-rupee" aria-hidden="true">₹</span> Buy me a chai (UPI)</a>`
    : "";
  const intlButton = intl
    ? `<a class="sp-btn" data-sp="intl" href="${esc(intl.url)}" target="_blank" rel="noopener">${esc(intl.label || "Support from abroad")} <span aria-hidden="true">↗</span></a>`
    : "";
  const dialog = link
    ? `
  <dialog class="sp-dialog" aria-labelledby="sp-title" aria-describedby="sp-help">
    <h3 id="sp-title">Buy me a chai</h3>
    <div class="sp-qr" role="img" aria-label="QR code to pay ${esc(c.upi.name)} by UPI">${await qrSvg(link)}</div>
    <p id="sp-help">Scan with any UPI app</p>
    <div class="sp-id">
      <span class="sp-id-label">UPI ID</span>
      <code data-sp="id">${esc(c.upi.id)}</code>
      <button type="button" class="sp-btn" data-sp="copy">Copy</button>
    </div>
    <p class="sp-status" role="status" aria-live="polite"></p>
    <button type="button" class="sp-btn sp-close" data-sp="close">Close</button>
  </dialog>`
    : "";
  return `<section class="sp" id="support" aria-labelledby="sp-heading" data-track="${esc(track)}">
  <div class="sp-card">
    <div class="sp-text">
      <h2 id="sp-heading">Enjoying the maps?</h2>
      <p>These sites are free and ad-free, built in my spare time with open data. If one taught you something, you can buy me a chai.</p>
      <p class="sp-note">Optional and always appreciated. The data stays free either way.</p>
    </div>
    <div class="sp-actions">${upiButton}${intlButton}</div>
  </div>${dialog}
</section>`;
}
