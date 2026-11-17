import { AOD_STOPS, dayLabel, WINDOW_HOURS, type SatLayer, type Window } from "../data";

export const FIRE_NEW = "#FF7A3D";
export const FIRE_OLD = "#E5484D";
export const WIND_BLUE = "#6EA8FF";

/** Fire key: colour = age within the window, size = fire radiative power. Same layout as India Night Lights' legend. */
type Props = { window: Window; wind: boolean; path?: boolean; sensor?: string; sat?: SatLayer; satDate?: string };

export default function Legend({ window: w, wind, path, sensor, sat = "none", satDate }: Props) {
  const hours = WINDOW_HOURS[w];
  const ticks = hours <= 24 ? [0, 12, 24] : hours <= 72 ? [0, 24, 48, 72] : [0, 2, 4, 7].map((d) => d * 24);
  const label = (h: number) => (h === 0 ? "now" : h < 48 ? `${h} h` : `${h / 24} d`);
  return (
    <div className="legend" aria-label={`Legend: fire detections coloured by age, from newest (orange) to ${hours} hours old (red); dot size shows fire power`}>
      <div className="legend-bar fire-bar" style={{ background: `linear-gradient(90deg, ${FIRE_NEW}, ${FIRE_OLD})` }} />
      <div className="legend-ticks" aria-hidden="true">
        {ticks.map((h) => {
          const p = (h / hours) * 100;
          return (
            <span key={h} style={{ left: `${p}%`, transform: p <= 0 ? "none" : p >= 100 ? "translateX(-100%)" : undefined }}>
              {label(h)}
            </span>
          );
        })}
      </div>
      <div className="legend-foot">
        <span className="muted">Detection age{sensor ? ` · ${sensor}` : ""}</span>
        <span className="legend-gap legend-size" title="Fire radiative power">
          <i className="dot s" aria-hidden="true" />
          <i className="dot m" aria-hidden="true" />
          <i className="dot l" aria-hidden="true" /> Fire power
        </span>
        {wind && (
          <span className="legend-gap">
            <svg className="legend-arrow" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 8h10M9 4.5L12.5 8 9 11.5" fill="none" stroke={WIND_BLUE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Wind
          </span>
        )}
        {path && (
          <span className="legend-gap">
            <svg className="legend-path" viewBox="0 0 18 10" aria-hidden="true">
              <path d="M1 5h16" stroke="#CFE0FF" strokeWidth="2" strokeLinecap="round" />
              <circle cx="9" cy="5" r="2.5" fill="#0B0F1A" stroke="#CFE0FF" strokeWidth="1.5" />
            </svg>
            Air's path
          </span>
        )}
      </div>
      {sat === "aod" && (
        <div className="legend-sat" aria-label="Haze: aerosol optical depth from NASA, 0 to 0.75 or more">
          <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${AOD_STOPS.map(([v, c]) => `${c} ${((v / 0.75) * 100).toFixed(0)}%`).join(", ")})` }} />
          <div className="legend-ticks" aria-hidden="true">
            <span style={{ left: 0, transform: "none" }}>0 · clear</span>
            <span style={{ left: "100%", transform: "translateX(-100%)" }}>0.75+ · thick haze</span>
          </div>
          <span className="muted legend-sat-note">Aerosol optical depth, NASA NOAA-20{satDate ? ` · ${dayLabel(satDate, true)}` : ""} · blank = cloud or no retrieval</span>
        </div>
      )}
      {sat === "true" && (
        <p className="muted legend-sat-note">NASA true-colour image, NOAA-20{satDate ? ` · ${dayLabel(satDate, true)}` : ""}, around 13:30 IST</p>
      )}
    </div>
  );
}
