/** Sources, honest limits and credits. Same card layout as India Night Lights' "About the data". */
import { ago, timeLabel, type AppData } from "../data";

export default function About({ data }: { data: AppData }) {
  return (
    <section id="about" className="panel about" aria-labelledby="about-title">
      <h2 id="about-title">About the data</h2>
      <p className="last-updated">
        Data last updated <b className="mono">{timeLabel(data.generated)}</b> ({ago(data.generated)}). Refreshed every 3 hours from 15 Sep to 15 Dec, and
        daily the rest of the year.
      </p>
      <div className="about-grid">
        <div>
          <h3>Fires</h3>
          <p>
            Active-fire detections from <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a>: VIIRS (375 m) on NOAA-20 and
            NOAA-21, across India. Each dot is one satellite pixel that saw heat, with its fire radiative power (FRP, in megawatts).
          </p>
          <p>
            Counts are <em>detections</em>, not fires or area burned: one field can be seen by several satellites. Year-on-year comparisons use NOAA-20 alone,
            because Suomi NPP stopped sending data in November 2026 and NOAA-21 only began in 2023–24.
          </p>
        </div>
        <div>
          <h3>Honest gaps</h3>
          <p>
            Satellites only see fires burning as they pass over, around 1:30 pm and 1:30 am for VIIRS. Small, short or cloud-hidden fires can be missed, and a
            fire lit after the afternoon pass that is out before the night pass is never seen.
          </p>
          <p>
            Delhi's air also carries vehicle, industry, construction-dust and other pollution. This site shows where the wind came from and what was burning
            there; it is not a source-apportionment study. Missing or cloudy days are shown as gaps, never filled in.
          </p>
        </div>
        <div>
          <h3>Seasons, 2020 onward</h3>
          <p>
            Each season runs 15 Sep – 15 Dec. Only NOAA-20 detections are used, so every year is counted by the same satellite; archive (standard
            processing) data where NASA has it, near-real-time data for recent weeks. Delhi's daily PM2.5 is the mean of reference monitors that reported
            at least 18 hours that day; a day with too few such stations is a gap. OpenAQ has no government-monitor data for Delhi from mid-October 2022
            through 2024. For those days the site shows the US Embassy monitor alone, labelled as one station: in seasons with both, it tracks the city
            average closely (correlation 0.98) but reads about 8% lower. Its values are not adjusted.
          </p>
          <p>The fires-vs-PM2.5 correlation is shown for interest. Weather moves Delhi's air too, so a correlation is not a measure of cause.</p>
        </div>
        <div>
          <h3>Wind and air</h3>
          <p>
            Hourly wind at 10 m and at 850 hPa (about 1.5 km up) from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, on a
            1° grid. Delhi PM2.5 is the average of CPCB reference stations via <a href="https://openaq.org/" target="_blank" rel="noopener">OpenAQ</a>; an hour
            needs at least 3 stations and a day at least 18 hours. Bands follow India's National Air Quality Index.
          </p>
        </div>
        <div>
          <h3>Boundaries</h3>
          <p>
            Districts: <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a> (Local Government Directory via Pathways Data,
            2021, ODbL); districts created since are counted within their parent. India's outline follows the official national outline; the basemap's own
            (OpenStreetMap) borders are hidden. Fires across the border are shown but not counted for India.
          </p>
        </div>
        <div>
          <h3>Credits</h3>
          <p>
            Satellite imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a> (VIIRS NOAA-20 true colour and Deep
            Blue aerosol optical depth). Basemap: <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>,
            data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. Visits are counted
            anonymously with GoatCounter (no cookies).
          </p>
          <p className="also-by">
            Also by me:{" "}
            <a href="/data/india/night-lights/">India Night Lights</a>, how bright every Indian district is at night.
          </p>
          <p className="connect">
            Liked the data and visuals? <a href="/data/india/#contact">Connect with me →</a>
            <span className="sep"> · </span>
            <a href="/data/india/">All projects</a>
          </p>
        </div>
      </div>
    </section>
  );
}
