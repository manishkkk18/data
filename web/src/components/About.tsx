import { monthLabel, type Monthly } from "../data";

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
            Clouds hide the ground, especially in monsoon months. NASA fills some cloudy pixels from past data; we drop those, and if
            less than {monthly.min_valid_pct}% of a district was actually observed, we show it hatched instead of guessing.
          </p>
          <p>Night lights track electrification and urban activity, but also gas flares and festivals. Treat them as a proxy, not GDP.</p>
        </div>
        <div>
          <h3>Boundaries</h3>
          <p>
            District boundaries: <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a> (from the
            Government of India's Local Government Directory via Pathways Data, 2021, ODbL). India's outline follows the official national
            outline, including all of Jammu & Kashmir and Ladakh; the basemap's own (OpenStreetMap) borders are hidden. 735 districts; districts created after 2021 are counted
            within their parent district.
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
        </div>
      </div>
    </section>
  );
}
