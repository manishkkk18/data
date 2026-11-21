// The support card's behaviour, on every page that has one (it sets itself up on import).
// The button opens a small dialog (native <dialog>, showModal: focus stays inside, Esc closes):
//  - on a computer: the QR code to scan with a phone, and the UPI ID with a copy button;
//  - on a phone (touch, no hover): copy the UPI ID first, then "save QR image" for "scan from
//    gallery" in the UPI app.
// There is deliberately no upi:// "open the app" link: UPI apps decline payments that start from
// a website link to a personal UPI ID (PhonePe at once, Paytm after the PIN), while paying the ID
// or scanning the QR code works.
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

  const open = (phone) => {
    status.textContent = "";
    dialog.toggleAttribute("data-phone", phone);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    $("copy")?.focus();
  };
  const close = () => (typeof dialog.close === "function" ? dialog.close() : dialog.removeAttribute("open"));

  button.addEventListener("click", () => {
    const phone = isPhone();
    track(phone ? "support-upi-sheet" : "support-upi-qr");
    open(phone);
  });
  $("close")?.addEventListener("click", close);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close(); // a click on the dimmed backdrop
  });

  $("copy")?.addEventListener("click", async () => {
    const idEl = $("id");
    try {
      await navigator.clipboard.writeText(idEl.textContent);
      status.textContent = "UPI ID copied. Paste it in your UPI app under Pay → To UPI ID.";
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

  $("save")?.addEventListener("click", async () => {
    try {
      const file = await qrPng(dialog.querySelector(".sp-qr svg"));
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "UPI QR code" }); // phones: save to photos, or share
      } else {
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: file.name, hidden: true });
        document.body.append(a); // some browsers only download from a link that is in the page
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
      status.textContent = "QR code saved. In your UPI app, tap Scan, then pick it from your gallery.";
      track("support-save-qr");
    } catch (err) {
      if (err?.name !== "AbortError") status.textContent = "Couldn't save the image here: take a screenshot of the QR code instead.";
    }
  });
}

/** The QR code as a PNG file, drawn from its SVG with a white border (made in the browser). */
async function qrPng(svg) {
  const size = 720;
  const pad = 48;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  await img.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, pad, pad, size - 2 * pad, size - 2 * pad);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  return new File([blob], "chai-upi-qr.png", { type: "image/png" });
}

function init() {
  document.querySelectorAll("section.sp").forEach(setup);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
