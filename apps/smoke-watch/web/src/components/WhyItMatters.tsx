/** Why farm smoke matters, why satellites help, and the limits. Same layout as India Night Lights'
 * "Why it matters". Every fact links to its source; numbers marked "our data" are computed here. */
import type { ReactNode } from "react";
import type { AppData } from "../data";

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener">
    {children}
  </a>
);

const ROWS: { title: string; text: ReactNode; icon: ReactNode }[] = [
  {
    title: "A short window, a quick fix",
    text: (
      <>
        Punjab's 2009 groundwater law bars transplanting paddy before 10 June (later 15 June), so it's harvested late, leaving only weeks before wheat must be
        sown.
        Burning the leftover straw is the fastest way to clear a field (<A href="https://theprint.in/theprint-essential/what-is-the-punjab-groundwater-conservation-law-why-its-being-blamed-for-delhis-air-pollution/1838049">ThePrint</A>,{" "}
        <A href="https://www.downtoearth.org.in/news/stubble-burning-amid-rising-fodder-prices-why-the-paradox-83413">Down To Earth</A>).
      </>
    ),
    icon: <path d="M3 17h14M6 17V9M10 17V6M14 17v-5M4 9c1-2 3-2 4 0M8 6c1-2 3-2 4 0" />,
  },
  {
    title: "PM2.5 harms health",
    text: (
      <>
        These particles reach deep into the lungs and blood. WHO's 2021 guideline for a 24-hour average is <b>15 µg/m³</b> (
        <A href="https://iris.who.int/handle/10665/345329">WHO</A>); India's own standard is <b>60 µg/m³</b> (
        <A href="https://leap.unep.org/akn/in/act/2009/b-29016-20-90-pci-l/eng@2009-11-18">2009 national standards</A>).
      </>
    ),
    icon: <path d="M10 17s-6-3.5-6-8a3.5 3.5 0 016-2.4A3.5 3.5 0 0116 9c0 4.5-6 8-6 8z" />,
  },
  {
    title: "The share swings day to day",
    text: (
      <>
        The government's forecasting system for Delhi puts farm fires at about 7% of its PM2.5 on average after the monsoon, while on peak days a single main
        source, farm fires or Delhi's own, can reach 65–69% (<A href="https://gmd.copernicus.org/articles/17/2617/2024/">IITM, Geoscientific Model Development</A>). Delhi's winter smog stays after the fires fade (
        <A href="https://www.cseindia.org/beyond-the-burn-delhi-s-winter-smog-intensifies-even-after-stubble-fires-fade-12982">CSE</A>).
      </>
    ),
    icon: <path d="M2 14h3l2-6 3 9 3-12 2 9h3" />,
  },
  {
    title: "Satellites see every field the same way",
    text: (
      <>
        NASA's VIIRS sensors scan the whole region twice a day at 375 m, with the same method in every state and every year (
        <A href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</A>), so places and seasons can be compared fairly.
      </>
    ),
    icon: <path d="M10 2v3M10 15v3M2 10h3M15 10h3M5 5l2 2M13 13l2 2M5 15l2-2M13 7l2-2M10 7a3 3 0 100 6 3 3 0 000-6z" />,
  },
];

export default function WhyItMatters({ data }: { data: AppData }) {
  // Our data: fire detections and Delhi's season PM2.5, first full season with good PM2.5 vs the latest complete season.
  const s = data.seasons?.seasons ?? [];
  const full = s.filter((x) => x.complete);
  const a = full.find((x) => x.year === 2021) ?? full[0];
  const b = full[full.length - 1];
  const tot = (x: (typeof s)[number]) => x.fires.india.reduce((p, q) => p + q, 0);
  const pmMean = (x: (typeof s)[number]) => {
    const v = x.pm25.filter((y, i): y is number => y != null && x.pm25_source?.[i] !== "embassy");
    return v.length >= 0.8 * x.pm25.length ? v.reduce((p, q) => p + q, 0) / v.length : null;
  };
  const anchor = a && b && a !== b ? { a, b, fa: tot(a), fb: tot(b), pa: pmMean(a), pb: pmMean(b) } : null;

  return (
    <section id="why" className="panel why" aria-labelledby="why-title">
      <div className="why-head">
        <h2 id="why-title">Why it matters</h2>
        <p>
          Every October and November, rice-stubble fires in Punjab and Haryana coincide with Delhi's worst air of the year. This site shows <b>where</b>{" "}
          the fires are, <b>where the wind was coming from</b>, and how Delhi's air compares, without claiming to know how much of the smoke is from fires.
        </p>
      </div>
      <ul className="why-rows">
        {ROWS.map((r) => (
          <li key={r.title}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {r.icon}
            </svg>
            <span>
              <b>{r.title}.</b> {r.text}
            </span>
          </li>
        ))}
      </ul>
      {anchor && (
        <p className="why-anchor">
          From our data: NOAA-20 detected <b>{anchor.fa.toLocaleString("en-IN")}</b> fires in India in the {anchor.a.year} season and{" "}
          <b>{anchor.fb.toLocaleString("en-IN")}</b> in {anchor.b.year} ({Math.round(((anchor.fb - anchor.fa) / anchor.fa) * 100)}%)
          {anchor.pa != null && anchor.pb != null ? (
            <>
              , while Delhi's average PM2.5 over the same season went from <b>{Math.round(anchor.pa)}</b> to <b>{Math.round(anchor.pb)}</b> µg/m³
            </>
          ) : null}
          . Some of that fall in detections may be burning that has moved to after the satellite passes (see Limits).
        </p>
      )}

      <div id="limits" className="limits">
        <h3 className="trend-title">Limits</h3>
        <ul className="about-points">
          <li>
            <b>Satellites only see fires burning as they pass over</b>, around 1:30 pm and 1:30 am for VIIRS. An ISRO study found peak burning in Punjab and
            Haryana moved from early afternoon to early evening between 2020 and 2024 (
            <A href="https://www.currentscience.ac.in/Volumes/129/10/0921.pdf">Current Science</A>), and NASA reports most 2025 fires burned between 4 and 6 pm (
            <A href="https://science.nasa.gov/earth/earth-observatory/new-timing-for-stubble-burning-in-india">NASA Earth Observatory</A>). So detections now
            likely undercount burning, more than in earlier years; an iFOREST report says most fires now fall outside the satellites' windows (
            <A href="https://www.tribuneindia.com/news/delhi/satellites-miss-majority-of-stubble-fires-delhi-air-pollution-underestimated-report">The Tribune</A>).
          </li>
          <li>
            <b>Small, short or cloud-hidden fires are missed</b>, and a detection is a 375 m pixel that saw heat, not a field or an area burned. One fire can be
            seen by several satellites.
          </li>
          <li>
            <b>Delhi has many other sources</b>: vehicles, industry, construction dust, waste and household burning. Cold, still weather traps all of them.
          </li>
          <li>
            <b>The air's path is simple</b>: winds on a 1° grid at two heights, no rising, sinking or mixing. Upwind shares show where burning was along the
            path, not how much of Delhi's PM2.5 it caused. This is not a source-apportionment study.
          </li>
          <li>
            <b>Air-quality gaps</b>: OpenAQ has no Delhi government-monitor data from mid-October 2022 through 2024; those days use the US Embassy monitor alone,
            labelled. Days with too few stations are left empty, never filled in.
          </li>
        </ul>
      </div>
    </section>
  );
}
