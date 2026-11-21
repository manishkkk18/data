// "Support" settings for the /data/india sites: the ONE place these live.
// The home page builds its support card from this at build time (apps/home/vite.config.ts);
// the apps only link to /data/india/#support. Leave a value empty to hide what it powers.

export type SupportConfig = {
  upi: {
    id: string; // UPI ID (VPA); shown on the page and inside the QR code
    name: string; // payee name UPI apps show; should match the account's name
    note: string; // the payment note (tn) pre-filled in the UPI app
  };
  // For supporters outside India, e.g. { label: "Ko-fi", url: "https://ko-fi.com/…" }.
  // Empty url = no button.
  international: { label: string; url: string };
};

export const SUPPORT: SupportConfig = {
  upi: { id: "manish.kukrejam@ybl", name: "Manish Kukreja", note: "Thanks for India from data" },
  international: { label: "", url: "" },
};

/** The UPI deep link (no fixed amount; every value URL-encoded), or null if UPI isn't set up. */
export function upiLink(c: SupportConfig = SUPPORT): string | null {
  const { id, name, note } = c.upi;
  if (!id.trim() || !name.trim()) return null;
  const q = [
    ["pa", id.trim()],
    ["pn", name.trim()],
    ["cu", "INR"],
    ["tn", note.trim()],
  ].filter(([, v]) => v);
  return `upi://pay?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}
