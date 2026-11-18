import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fold, type District } from "../data";

type Props = { districts: District[]; onPick: (id: string) => void; compact?: boolean };

const SECTIONS: [string, string][] = [
  ["map", "Map"],
  ["why", "Why it matters"],
  ["insights", "Insights"],
  ["highways", "Highways"],
  ["compare", "Compare"],
  ["about", "About the data"],
];

export default function Header({ districts, onPick, compact, phone }: Props & { phone?: boolean }) {
  const [active, setActive] = useState("map");
  const [searching, setSearching] = useState(false);
  const nav = useRef<HTMLElement>(null);

  // The tab for the section on screen is highlighted (and kept in view on the phone tab bar).
  useEffect(() => {
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id, e.isIntersecting ? e.intersectionRect.height : 0));
        let best = "map";
        let most = 0;
        seen.forEach((h, id) => {
          if (h > most) [best, most] = [id, h];
        });
        setActive(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    const t = setTimeout(() => SECTIONS.forEach(([id]) => document.getElementById(id) && io.observe(document.getElementById(id)!)), 500);
    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, []);
  useEffect(() => {
    const a = nav.current?.querySelector<HTMLElement>(`a[href="#${active}"]`);
    if (a && nav.current && nav.current.scrollWidth > nav.current.clientWidth) {
      nav.current.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" });
    }
  }, [active]);

  return (
    <header className={`header ${searching ? "searching" : ""}`}>
      <a className="brand" href="#map" aria-label="India Night Lights, back to the map">
        <Logo />
        <span className="brand-name">India Night Lights</span>
      </a>
      <nav className="nav" aria-label="Sections" ref={nav}>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined}>
            {label}
          </a>
        ))}
      </nav>
      {phone && !searching ? (
        <button type="button" className="icon-btn search-toggle" aria-label="Search districts" onClick={() => setSearching(true)}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M14 14l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <div className="header-search">
          <Search
            districts={districts}
            onPick={(id) => {
              onPick(id);
              setSearching(false);
            }}
            compact={compact}
            autoFocus={phone}
            placeholder={phone ? "Search a district" : undefined}
          />
          {phone && (
            <button type="button" className="icon-btn" aria-label="Close search" onClick={() => setSearching(false)}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      )}
    </header>
  );
}

export function Search({ districts, onPick, compact, placeholder, label = "Search districts", autoFocus }: Props & { placeholder?: string; label?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const results = useMemo(() => {
    const term = fold(q.trim());
    if (!term) return [];
    const starts: District[] = [];
    const contains: District[] = [];
    for (const d of districts) {
      if (fold(d.name).startsWith(term) || d.aliases.some((a) => fold(a).startsWith(term))) starts.push(d);
      else if (d.search.includes(term)) contains.push(d);
      if (starts.length >= 8) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [q, districts]);

  const pick = (d: District) => {
    onPick(d.id);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="search">
      <label htmlFor={`${listId}-input`} className="sr-only">{label}</label>
      <svg className="search-icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M14 14l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        id={`${listId}-input`}
        type="search"
        placeholder={placeholder ?? (compact ? "Search" : "Search a district")}
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && results[active]) pick(results[active]);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && results.length > 0 && (
        <ul className="search-results" id={listId} role="listbox">
          {results.map((d, i) => (
            <li
              key={d.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(d);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>
                {d.name}
                {matchedAlias(d, q) && <span className="muted"> · {matchedAlias(d, q)}</span>}
              </span>
              <span className="muted">{d.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The alternative name the user typed, if that's how this district matched. */
function matchedAlias(d: District, q: string) {
  const term = fold(q.trim());
  if (!term || fold(d.name).includes(term)) return null;
  return d.aliases.find((a) => fold(a).includes(term)) ?? null;
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="#232B40" strokeWidth="2" />
      <circle cx="12" cy="12" r="3.2" fill="#FFB547" />
      <circle cx="20.5" cy="17.5" r="2" fill="#FFB547" opacity=".8" />
      <circle cx="14" cy="21.5" r="1.4" fill="#FFB547" opacity=".6" />
      <circle cx="21" cy="10" r="1" fill="#FFB547" opacity=".5" />
    </svg>
  );
}
