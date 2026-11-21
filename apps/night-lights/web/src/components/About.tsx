import { monthLabel, type Monthly } from "../data";
import { track } from "../analytics";

export default function About({ monthly }: { monthly: Monthly }) {
  const first = monthly.months[0];
  const last = monthly.months[monthly.months.length - 1];
  return (
    <section id="about" className="panel about" aria-labelledby="about-title">
      <h2 id="about-title">About the data</h2>
      <div className="about-grid">
        <div>
          <h3>Source</h3>
          <p>
            NASA <a href="https://blackmarble.gsfc.nasa.gov/" target="_blank" rel="noopener">Black Marble</a> monthly night lights
            (VNP46A3, Collection 2), from the VIIRS sensor on the Suomi NPP satellite. Snow-free, near-nadir composite, about 500 m per pixel.
            Currently loaded: {first === last ? monthLabel(first) : `${monthLabel(first)} – ${monthLabel(last)}`}.
          </p>
          <p>
            Radiance is in nanowatts per cm² per steradian. A pixel counts as <em>lit</em> at ≥ {monthly.lit_threshold} nW/cm²/sr.
          </p>
        </div>
        <div>
          <h3>Honest gaps</h3>
          <p>
            Clouds hide the ground, especially in monsoon months (and snow hides the high Himalaya in winter). NASA fills cloudy pixels
            in from earlier months; we never count those as observed. If less than {monthly.min_valid_pct}% of a district was actually seen,
            its value is a gap.
          </p>
          <p>
            Where NASA has a fill-in estimate for a gap, the map shows it with a light hatch and the panel labels it "NASA estimate". Estimates
            are never used in ranks, changes, growth or insights. Districts with no estimate either are dark-hatched.
          </p>
          <p>Night lights track electrification and urban activity, but also gas flares and festivals. Treat them as a proxy, not GDP.</p>
        </div>
        <div>
          <h3>Boundaries</h3>
          <p>
            District boundaries: <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a> (from the
            Government of India's Local Government Directory via Pathways Data, 2021, ODbL). India's outline follows the official national
            outline, including all of Jammu &amp; Kashmir and Ladakh (Gilgit-Baltistan, PoK, Aksai Chin, Shaksgam and Siachen) and Arunachal
            Pradesh. The basemap's own (OpenStreetMap) borders are hidden at every zoom; zoomed in, a more detailed (~170 m) outline is used.
          </p>
          <p>
            734 districts; districts created after 2021 are counted within their parent district. The source has no district data for
            Gilgit-Baltistan and PoK, so that area is shown as one unit and left out of ranks and insights.
          </p>
        </div>
        <div>
          <h3>Growth and map layers</h3>
          <p>
            "Growth since 2015" compares each district with the same calendar month in 2015, so seasonal swings cancel out. For the map
            colours a small offset (0.3 nW/cm²/sr) is added to both months so near-dark districts don't swing wildly; the tooltip shows the
            plain % change.
          </p>
          <p>
            Extra layers come from <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>: the Black Marble
            2016 night-lights image (VIIRS_Black_Marble) and VIIRS NOAA-20 true colour for 21 Feb 2026, a clear day over India. Both stop at
            roughly 300–500 m detail and are not tied to the month on the slider.
          </p>
        </div>
        <div>
          <h3>Credits</h3>
          <p>
            Satellite imagery: NASA GIBS. Basemap: <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> ©{" "}
            <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>, data ©{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. Processed with
            the World Bank's blackmarblepy and exactextract. Visits are counted anonymously with GoatCounter (no cookies).
          </p>
          <p className="also-by">
            Also by me: <a href="/data/india/smoke-watch/">India Smoke Watch</a>, whose smoke your city is breathing today.
          </p>
          <p className="connect">
            Liked the data and visuals? <a href="/data/india/#contact">Connect with me →</a>
            <span className="sep"> · </span>
            <a href="/data/india/">All projects</a>
            <span className="sep"> · </span>
            <a href="/data/india/#support" onClick={() => track("support")}>
              Support ☕
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
