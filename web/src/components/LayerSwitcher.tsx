import { useId, useState } from "react";

export type BaseLayer = "districts" | "night" | "day";

const OPTIONS: { value: BaseLayer; label: string; note: string }[] = [
  { value: "districts", label: "District brightness", note: "Our monthly data, by district" },
  { value: "night", label: "Night lights (NASA)", note: "Raw satellite image, 2016 · not month-synced" },
  { value: "day", label: "Daytime satellite", note: "True colour, 21 Feb 2026 · ~300 m detail" },
];

type Props = {
  base: BaseLayer;
  threeD: boolean;
  onBase: (b: BaseLayer) => void;
  onThreeD: (on: boolean) => void;
};

export default function LayerSwitcher({ base, threeD, onBase, onThreeD }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="layers">
      {open && (
        <div className="layers-panel" id={`${id}-panel`}>
          <fieldset>
            <legend>Map shows</legend>
            {OPTIONS.map((o) => (
              <label key={o.value} className={`layer-opt ${base === o.value ? "on" : ""}`}>
                <input type="radio" name={`${id}-base`} value={o.value} checked={base === o.value} onChange={() => onBase(o.value)} />
                <span>
                  <span className="layer-label">{o.label}</span>
                  <span className="layer-note">{o.note}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className={`switch ${base !== "districts" ? "disabled" : ""}`}>
            <input type="checkbox" role="switch" checked={threeD} disabled={base !== "districts"} onChange={(e) => onThreeD(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            <span>
              <span className="layer-label">3D lights skyline</span>
              <span className="layer-note">{base === "districts" ? "Districts rise by brightness" : "Only with district brightness"}</span>
            </span>
          </label>
          <p className="layers-credit">
            Satellite layers: <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank" rel="noopener">NASA GIBS</a>
          </p>
        </div>
      )}
      <button type="button" className="layers-btn" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2l8 4-8 4-8-4z" fill="currentColor" />
          <path d="M2 10l8 4 8-4M2 14l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span>Layers{threeD && base === "districts" ? " · 3D" : ""}</span>
      </button>
    </div>
  );
}
