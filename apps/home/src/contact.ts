// Contact form → Web3Forms → email. Validates in the browser (with inline errors), shows
// sending / sent / failed states, and keeps spam down with a honeypot and one send per
// minute per browser.
import { LIMITS, MIN_SECONDS_BETWEEN_SENDS, WEB3FORMS_ACCESS_KEY, WEB3FORMS_ENDPOINT } from "./config";

const LAST_SENT_KEY = "contact:last-sent";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Field = "name" | "email" | "message";

function lastSent(): number {
  try {
    return Number(localStorage.getItem(LAST_SENT_KEY)) || 0;
  } catch {
    return 0;
  }
}
function rememberSent() {
  try {
    localStorage.setItem(LAST_SENT_KEY, String(Date.now()));
  } catch {
    /* private mode: the minute limit just won't persist */
  }
}

export function setupContactForm(onSent?: () => void) {
  const form = document.getElementById("contact-form") as HTMLFormElement | null;
  if (!form) return;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const inputs: Record<Field, HTMLInputElement | HTMLTextAreaElement> = {
    name: $("cf-name"),
    email: $("cf-email"),
    message: $("cf-message"),
  };
  const interest = $<HTMLSelectElement>("cf-interest");
  const honeypot = $<HTMLInputElement>("cf-botcheck");
  const submit = $<HTMLButtonElement>("cf-submit");
  const status = $<HTMLParagraphElement>("cf-status");
  const count = $<HTMLParagraphElement>("cf-message-count");

  const check = (f: Field): string => {
    const v = inputs[f].value.trim();
    if (f === "name") {
      if (!v) return "Please tell me your name.";
      if (v.length > LIMITS.name) return `Please keep your name under ${LIMITS.name} characters.`;
    }
    if (f === "email") {
      if (!v) return "Please add your email so I can reply.";
      if (v.length > LIMITS.email || !EMAIL.test(v)) return "That doesn't look like an email address. Check for typos.";
    }
    if (f === "message") {
      if (!v) return "Please write a message.";
      if (v.length > LIMITS.message) return `Please keep your message under ${LIMITS.message.toLocaleString("en-IN")} characters.`;
    }
    return "";
  };
  const show = (f: Field, msg: string) => {
    const el = inputs[f];
    el.setAttribute("aria-invalid", msg ? "true" : "false");
    $(`cf-${f}-error`).textContent = msg;
  };
  const touched = new Set<Field>();
  (Object.keys(inputs) as Field[]).forEach((f) => {
    inputs[f].addEventListener("blur", () => {
      if (inputs[f].value.trim()) touched.add(f);
      if (touched.has(f)) show(f, check(f));
    });
    // Once a field has shown an error, clear it as soon as it's fixed.
    inputs[f].addEventListener("input", () => {
      if (inputs[f].getAttribute("aria-invalid") === "true") show(f, check(f));
    });
  });
  const updateCount = () => {
    const n = inputs.message.value.length;
    count.textContent = `${n.toLocaleString("en-IN")} / ${LIMITS.message.toLocaleString("en-IN")}`;
    count.classList.toggle("over", n > LIMITS.message);
  };
  inputs.message.addEventListener("input", updateCount);
  updateCount();

  const setStatus = (text: string, kind: "" | "ok" | "err" = "") => {
    status.textContent = text;
    status.className = `form-status ${kind}`;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;

    // Validate everything; focus the first problem.
    const fields = Object.keys(inputs) as Field[];
    const errors = fields.map((f) => [f, check(f)] as const);
    errors.forEach(([f, m]) => {
      touched.add(f);
      show(f, m);
    });
    const first = errors.find(([, m]) => m);
    if (first) {
      setStatus("Please fix the highlighted fields.", "err");
      inputs[first[0]].focus();
      return;
    }

    // Bots fill the hidden checkbox: pretend all is well and send nothing.
    if (honeypot.checked) {
      form.reset();
      setStatus("Thanks — I'll get back to you soon.", "ok");
      return;
    }

    const wait = MIN_SECONDS_BETWEEN_SENDS - Math.floor((Date.now() - lastSent()) / 1000);
    if (wait > 0) {
      setStatus(`You've just sent a message. You can send another in ${wait} seconds.`, "err");
      return;
    }

    const name = inputs.name.value.trim();
    const body = {
      access_key: WEB3FORMS_ACCESS_KEY,
      subject: `India from data: message from ${name}`,
      from_name: "India from data",
      name,
      email: inputs.email.value.trim(),
      message: inputs.message.value.trim(),
      interest: interest.value || "Not said",
      page: location.href.split("#")[0],
      botcheck: false,
    };

    submit.disabled = true;
    submit.textContent = "Sending…";
    form.setAttribute("aria-busy", "true");
    setStatus("");
    try {
      const r = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean };
      if (!r.ok || !j.success) throw new Error(`send failed (${r.status})`);
      rememberSent();
      form.reset();
      updateCount();
      fields.forEach((f) => show(f, ""));
      touched.clear();
      submit.textContent = "Sent";
      setStatus("Thanks — I'll get back to you soon.", "ok");
      onSent?.();
      // Ready for another message after the minute is up.
      setTimeout(() => {
        submit.disabled = false;
        submit.textContent = "Send message";
      }, MIN_SECONDS_BETWEEN_SENDS * 1000);
    } catch {
      submit.disabled = false;
      submit.textContent = "Try again";
      setStatus("Sorry, that didn't go through. Your message is still here. Check your connection and press Try again.", "err");
    } finally {
      form.removeAttribute("aria-busy");
    }
  });
}
