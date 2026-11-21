// The support card's behaviour. The UPI button is a real link to the upi:// deep link:
//  - on a phone (touch, no hover) it opens the UPI app; if nothing opens it within a moment
//    (no UPI app installed), the QR dialog appears instead;
//  - everywhere else the QR dialog opens: scan it with a phone, or copy the UPI ID.
// The dialog is the native <dialog> (showModal): focus stays inside it and Esc closes it.

const isPhone = () => window.matchMedia("(pointer: coarse) and (hover: none)").matches;

export function setupSupport(track: (name: string) => void) {
  const button = document.getElementById("support-upi") as HTMLAnchorElement | null;
  const dialog = document.getElementById("upi-dialog") as HTMLDialogElement | null;
  document.getElementById("support-intl")?.addEventListener("click", () => track("support-intl"));
  if (!button || !dialog) return;

  const status = document.getElementById("upi-status")!;
  const open = () => {
    status.textContent = "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    document.getElementById("upi-copy")?.focus();
  };
  const close = () => (typeof dialog.close === "function" ? dialog.close() : dialog.removeAttribute("open"));

  button.addEventListener("click", (e) => {
    if (isPhone()) {
      track("support-upi-app");
      // Let the link open the UPI app. If the page is still showing a moment later, no app
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

  document.getElementById("upi-close")?.addEventListener("click", close);
  // Click on the dimmed backdrop (outside the dialog box) closes it too.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });

  document.getElementById("upi-copy")?.addEventListener("click", async () => {
    const id = document.getElementById("upi-id")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(id);
      status.textContent = "UPI ID copied.";
      track("support-copy");
    } catch {
      // No clipboard access: select the text so it can be copied by hand.
      const r = document.createRange();
      r.selectNodeContents(document.getElementById("upi-id")!);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      status.textContent = "Press Ctrl+C (or long-press) to copy the selected ID.";
    }
  });
}
