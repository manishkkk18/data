import { useId, useState, type ReactNode } from "react";
import { SAT, type SatLayer, type WindLevel } from "../data";

// Same component and classes as India Night Lights' Layers sheet; the options are this app's.
export type Layers = { wind: boolean; windLevel: WindLevel; districts: boolean; trajectory: boolean; sat: SatLayer };

const WIND_OPTIONS: { value: WindLevel; label: string; note: string }[] = [
  { value: "850hPa", label: "Wind aloft (~1.5 km)", note: "850 hPa, where smoke travels far" },
  { value: "10m", label: "Wind near the ground", note: "10 m above ground" },
];

type Props = {
  layers: Layers;
  onChange: (l: Layers) => void;
  windAvailable: boolean;
  trajectoryAvailable: boolean;
  seasons: number[]; // years with season data, newest first
  season: number | null; // null = last 7 days
  onTimeline: (year: number | null) => void;
  compact?: boolean; // phones: one button holds every map option
  after?: ReactNode; // shown after the Layers button (the legend chip on phones)
};

export default function LayerSwitcher({ layers, onChange, windAvailable, trajectoryAvailable, seasons, season, onTimeline, compact, after }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const set = (patch: Partial<Layers>) => onChange({ ...layers, ...patch });
  return (
    <div className={`layers ${compact ? "compact" : ""} ${open ? "open" : ""}`}>
      {open && (
        <div className="layers-panel" id={`${id}-panel`}>
          {seasons.length > 0 && (
            <fieldset className="timeline-set">
              <legend>Timeline</legend>
              <label className={`layer-opt ${season == null ? "on" : ""}`}>
                <input type="radio" name={`${id}-tl`} checked={season == null} onChange={() => onTimeline(null)} />
                <span>
                  <span className="layer-label">Last 7 days</span>
                  <span className="layer-note">All satellites, with wind and the air's path</span>
                </span>
              </label>
              <div className="season-opts" role="presentation">
                {seasons.map((y) => (
                  <label key={y} className={`layer-opt season-opt ${season === y ? "on" : ""}`}>
                    <input type="radio" name={`${id}-tl`} checked={season === y} onChange={() => onTimeline(y)} />
                    <span className="layer-label">{y}</span>
                  </label>
                ))}
              </div>
              <span className="layer-note season-note">Seasons run 15 Sep – 15 Dec, NOAA-20 only, so years compare fairly</span>
            </fieldset>
          )}
          <label className={`switch ${trajectoryAvailable ? "" : "disabled"}`}>
            <input
              type="checkbox"
              role="switch"
              checked={layers.trajectory && trajectoryAvailable}
              disabled={!trajectoryAvailable}
              onChange={(e) => set({ trajectory: e.target.checked })}
            />
            <span className="switch-track" aria-hidden="true" />
            <span>
              <span className="layer-label">Air's path into Delhi</span>
              <span className="layer-note">{trajectoryAvailable ? "Last 48 h; solid ~1.5 km up, dashed near the ground" : "Not available this run"}</span>
            </span>
          </label>
          <label className={`switch ${windAvailable ? "" : "disabled"}`}>
            <input type="checkbox" role="switch" checked={layers.wind && windAvailable} disabled={!windAvailable} onChange={(e) => set({ wind: e.target.checked })} />
            <span className="switch-track" aria-hidden="true" />
            <span>
              <span className="layer-label">Wind arrows</span>
              <span className="layer-note">{windAvailable ? "Point the way the wind blows; longer is faster" : "Wind data unavailable this run"}</span>
            </span>
          </label>
          <fieldset disabled={!layers.wind || !windAvailable}>
            <legend>Wind height</legend>
            {WIND_OPTIONS.map((o) => (
              <label key={o.value} className={`layer-opt ${layers.windLevel === o.value ? "on" : ""}`}>
                <input type="radio" name={`${id}-wind`} value={o.value} checked={layers.windLevel === o.value} onChange={() => set({ windLevel: o.value })} />
                <span>
                  <span className="layer-label">{o.label}</span>
                  <span className="layer-note">{o.note}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Satellite image</legend>
            {(["none", "true", "aod"] as SatLayer[]).map((v) => (
              <label key={v} className={`layer-opt ${layers.sat === v ? "on" : ""}`}>
                <input type="radio" name={`${id}-sat`} value={v} checked={layers.sat === v} onChange={() => set({ sat: v })} />
                <span>
                  <span className="layer-label">{v === "none" ? "None (dark map)" : SAT[v].label}</span>
                  <span className="layer-note">{v === "none" ? "Fires and wind on the basemap" : SAT[v].note}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="switch">
            <input type="checkbox" role="switch" checked={layers.districts} onChange={(e) => set({ districts: e.target.checked })} />
            <span className="switch-track" aria-hidden="true" />
            <span>
              <span className="layer-label">District outlines</span>
              <span className="layer-note">All of India's districts</span>
            </span>
          </label>
          <p className="layers-credit">
            Fires: <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a> · Wind:{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · Imagery:{" "}
            <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>
          </p>
        </div>
      )}
      <div className="layers-row">
        <button type="button" className="layers-btn" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2l8 4-8 4-8-4z" fill="currentColor" />
            <path d="M2 10l8 4 8-4M2 14l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <span>Layers</span>
        </button>
        {after}
      </div>
    </div>
  );
}
