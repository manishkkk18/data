// Builds the home page's support card from packages/config/support.ts at build time: the UPI
// button, the desktop QR dialog (QR drawn here as an inline SVG, so the page makes no runtime
// requests for it) and the optional international link. Anything not configured is left out;
// with nothing configured the card isn't rendered at all.
import QRCode from "qrcode";
import { SUPPORT, upiLink, type SupportConfig } from "../../../packages/config/support";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The QR code for a link, as an SVG string: dark modules on white, so every scanner reads it. */
export async function qrSvg(text: string): Promise<string> {
  const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#0b0f1a", light: "#ffffff" } });
  return svg.replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
}

export async function supportCard(c: SupportConfig = SUPPORT): Promise<string> {
  const link = upiLink(c);
  const intl = c.international.url.trim() ? c.international : null;
  if (!link && !intl) return "";
  const upiButton = link
    ? `<a class="btn btn-primary support-upi" id="support-upi" href="${esc(link)}"><span class="rupee" aria-hidden="true">₹</span> Buy me a chai (UPI)</a>`
    : "";
  const intlButton = intl
    ? `<a class="btn" id="support-intl" href="${esc(intl.url)}" target="_blank" rel="noopener">${esc(intl.label || "Support from abroad")} <span aria-hidden="true">↗</span></a>`
    : "";
  const dialog = link
    ? `
        <dialog class="upi-dialog" id="upi-dialog" aria-labelledby="upi-title" aria-describedby="upi-help">
          <h3 id="upi-title">Buy me a chai</h3>
          <div class="upi-qr" role="img" aria-label="QR code to pay ${esc(c.upi.name)} by UPI">${await qrSvg(link)}</div>
          <p id="upi-help">Scan with any UPI app</p>
          <div class="upi-id">
            <span class="upi-id-label">UPI ID</span>
            <code id="upi-id">${esc(c.upi.id)}</code>
            <button type="button" class="btn" id="upi-copy">Copy</button>
          </div>
          <p class="upi-status" id="upi-status" role="status" aria-live="polite"></p>
          <button type="button" class="btn upi-close" id="upi-close">Close</button>
        </dialog>`
    : "";
  return `<section class="support" id="support" aria-labelledby="support-title">
        <div class="support-card">
          <div class="support-text">
            <h2 id="support-title">Enjoying the maps?</h2>
            <p>These sites are free and ad-free, built in my spare time with open data. If one taught you something, you can buy me a chai.</p>
            <p class="support-note">Optional and always appreciated. The data stays free either way.</p>
          </div>
          <div class="support-actions">
            ${upiButton}
            ${intlButton}
          </div>
        </div>${dialog}
      </section>`;
}
