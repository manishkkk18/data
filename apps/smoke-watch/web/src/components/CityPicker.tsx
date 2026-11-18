import { useEffect, useId, useRef, useState } from "react";
import { fmtInt, NAQI_PM25, type CityInfo } from "../data";

// City picker: a chip in the KPI strip (Night Lights' chip style) opening a list in the
// search-results style. Each row shows the city's PM2.5 now with its band name.

type Props = { cities: CityInfo[]; value: string; onPick: (id: string) => void; className?: string };

export default function CityPicker({ cities, value, onPick, className = "chip" }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const city = cities.find((c) => c.id === value) ?? cities[0];

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="city-picker" ref={box}>
      <button type="button" className={`${className} city-chip`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 18s-5.5-5.2-5.5-9.5a5.5 5.5 0 0111 0C15.5 12.8 10 18 10 18z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="10" cy="8.5" r="2" fill="currentColor" />
        </svg>
        <span className="city-chip-name">{city.name}</span>
        <svg className="chev" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="search-results city-list" id={`${id}-list`} role="listbox" aria-label="City">
          {cities.map((c) => {
            const a = c.pm25?.aqi;
            const band = a ? NAQI_PM25.find((b) => b.name === a.band) : null;
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={c.id === value}
                tabIndex={0}
                onClick={() => {
                  onPick(c.id);
                  setOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick(c.id);
                    setOpen(false);
                  }
                }}
              >
                <span>{c.name}</span>
                <span className="muted city-pm">
                  {a ? (
                    <>
                      AQI <span className={`mono ${band?.cls ?? ""}`}>{fmtInt(a.value)}</span> <span className={band?.cls}>{a.band}</span>
                    </>
                  ) : (
                    "no AQI yet"
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
