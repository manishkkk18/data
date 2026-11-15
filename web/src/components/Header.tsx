import { useId, useMemo, useState } from "react";
import { fold, type District } from "../data";

type Props = { districts: District[]; onPick: (id: string) => void; compact?: boolean };

export default function Header({ districts, onPick, compact }: Props) {
  return (
    <header className="header">
      <a className="brand" href="#map" aria-label="India Night Lights, back to the map">
        <Logo />
        <span className="brand-name">India Night Lights</span>
      </a>
      <nav className="nav" aria-label="Sections">
        <a href="#map" aria-current="page">Map</a>
        <span className="nav-soon" aria-disabled="true" title="Coming in a later phase">Insights</span>
        <span className="nav-soon" aria-disabled="true" title="Coming in a later phase">Compare</span>
        <a href="#about">About the data</a>
      </nav>
      <Search districts={districts} onPick={onPick} compact={compact} />
    </header>
  );
}

function Search({ districts, onPick, compact }: Props) {
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
      <label htmlFor={`${listId}-input`} className="sr-only">Search districts</label>
      <svg className="search-icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M14 14l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        id={`${listId}-input`}
        type="search"
        placeholder={compact ? "Search" : "Search a district"}
        autoComplete="off"
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
