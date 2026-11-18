/** Plain-language case for night lights: what we measure, why it matters, and its limits. */
import type { ReactNode } from "react";

const ROWS: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: "A monthly economic pulse",
    text: "Electrification and activity show up every month for every district, while district GDP figures are rare and slow.",
    icon: <path d="M2 14h3l2-6 3 9 3-12 2 9h3" />,
  },
  {
    title: "Growth you can see",
    text: "New suburbs, highways and industrial zones light up as they're built.",
    icon: <path d="M3 17V9l4-3v11M7 17V5l5-3v15M12 17V8l5 2v7M2 17h16" />,
  },
  {
    title: "Events, not just trends",
    text: "Festivals like Diwali, power outages and recovery after a disaster all leave a mark.",
    icon: <path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.5 4.5l2 2M13.5 13.5l2 2M4.5 15.5l2-2M13.5 6.5l2-2M10 7a3 3 0 100 6 3 3 0 000-6z" />,
  },
  {
    title: "Fair comparisons",
    text: "One consistent, open dataset, so anyone can compare any two places on equal terms.",
    icon: <path d="M10 3v14M5 17h10M3 7h14M3 7l-1.5 5a2.5 2.5 0 005 0zM17 7l-1.5 5a2.5 2.5 0 003 0z" />,
  },
];

export default function WhyItMatters() {
  return (
    <section id="why" className="panel why" aria-labelledby="why-title">
      <div className="why-head">
        <h2 id="why-title">Why night lights matter</h2>
        <p>
          We measure <b>radiance</b>: how much artificial light satellites see at night, averaged over each district, every month since 2015.
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
      <p className="why-anchor">
        ISRO's National Remote Sensing Centre found that India's night-time radiance rose about <b>43%</b> between 2012 and 2021 (
        <a href="https://www.isro.gov.in/media_isro/pdf/Publications/book/NTL_Atlas.pdf" target="_blank" rel="noopener">
          NRSC night-time light atlas
        </a>
        ,{" "}
        <a
          href="https://www.business-standard.com/article/current-affairs/night-time-light-radiance-in-india-rose-43-in-last-10-years-report-123013000195_1.html"
          target="_blank"
          rel="noopener"
        >
          coverage
        </a>
        ).
      </p>
      <p className="why-limits muted">
        <b>Limits:</b> light isn't GDP. Clouds, gas flares and saturation in dense city cores all affect it.
      </p>
    </section>
  );
}
