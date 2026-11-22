// Loads the static JSON (written by scripts/), fills the hero, the verdict and the method notes,
// and starts each chart. Every number shown is read from the data files, none is typed in here.
import { getJSON, pct, pa, lakh, ym, esc } from "./common.js";
import { pulse } from "./pulse.js";
import { sectors } from "./sectors.js";
import { stateMap } from "./map.js";
import { scatter } from "./scatter.js";

const [iip, asi, meta, topo] = await Promise.all(["data/iip.json", "data/asi.json", "data/meta.json", "data/states.topo.json"].map(getJSON));

const h = iip.headline;
const P = asi.india.series.persons;
const yrs = asi.years;
const pBase = P[yrs.indexOf(asi.base)], pLast = P.at(-1);
const jobsChange = (pLast / pBase - 1) * 100;

// ---------- hero
document.getElementById("stat-output").innerHTML = `${pct(h.mfg_change_pct, 0)}<small>since ${h.from_fy}</small>`;
document.getElementById("stat-output-cap").textContent =
  `Manufacturing production, financial year ${h.from_fy} to ${h.to_fy}: ${pa(h.mfg_cagr)} on average. This year so far (${ym(h.ytd_months[0])} to ${ym(h.ytd_months.at(-1))}), output is running ${pct(h.ytd_mfg_avg_growth)} above last year.`;
document.getElementById("stat-jobs").innerHTML = `${pct(jobsChange, 0)}<small>since ${asi.base}</small>`;
document.getElementById("stat-jobs-cap").textContent =
  `${lakh(pBase)} people worked in registered factories in ${asi.base}; ${lakh(pLast)} in ${asi.latest}, ${pa(asi.india.growth.persons)}.`;
document.getElementById("asof").innerHTML =
  `Latest data: <b>IIP ${ym(meta.iip_latest_month)}</b> &nbsp;<b>ASI ${meta.asi_latest_year}</b> &nbsp;<a href="#method">why ASI ${meta.asi_latest_year}?</a>`;

const m = iip.monthly;
const PRE = "2020-02";
const mfgI = m.series.manufacturing.index;
const covidLow = m.series.manufacturing.index.reduce((a, v, i) => (v != null && v < a[0] ? [v, i] : a), [Infinity, -1]);
const recovered = mfgI.findIndex((v, i) => i > covidLow[1] && v >= mfgI[m.dates.indexOf(PRE)]);
document.getElementById("output-lede").innerHTML =
  `India's Index of Industrial Production tracks how much factories, mines and power plants produce each month. ` +
  `Manufacturing fell to ${covidLow[0].toFixed(0)} in ${ym(m.dates[covidLow[1]])} during the lockdown` +
  (recovered >= 0 ? ` and was back at its ${ym(PRE)} level by ${ym(m.dates[recovered])}. ` : `. `) +
  `In ${ym(m.dates.at(-1))} it was ${pct(m.series.manufacturing.yoy.at(-1))} on a year earlier. ` +
  `Look for a lasting change in slope after Make in India (September 2014) or the PLI schemes (2020-21): the line rises steadily, with shocks, rather than stepping up.`;

// ---------- charts
pulse(iip);
sectors(iip);
stateMap(asi, topo);
scatter(asi);

// ---------- verdict
const ig = asi.india.growth;
const elec = iip.sectors.find((s) => s.nic === "26");
const pharma = iip.sectors.find((s) => s.nic === "21");
const newRank = [...iip.sectors].sort((a, b) => b.new.change_pct - a.new.change_pct);
const c = asi.concentration;
const fBase = asi.india.series.factories[yrs.indexOf(asi.base)], fLast = asi.india.series.factories.at(-1);
const jobShare = Math.log1p(ig.persons / 100) / Math.log1p(ig.gva_real / 100);
const fast = Object.entries(asi.states).filter(([, v]) => v.latest?.persons > 300000 && v.growth.gva_real != null).sort((a, b) => b[1].growth.gva_real - a[1].growth.gva_real);
const h24 = meta.asi_2024_25_headline;
const pyears = Number(h.to_fy.slice(0, 4)) - Number(h.from_fy.slice(0, 4));

document.getElementById("answer").innerHTML =
  `<b>Yes, steadily but not dramatically, and more by hiring than by making each worker more productive.</b> ` +
  `Factory output and factory jobs have both grown by roughly half in a decade; about ${Math.round(jobShare * 100)}% of the growth in real value added came from more people working. ` +
  `Output per worker has crept up ${pa(ig.gva_per_person)}. ` +
  `The PLI sectors are only beginning to show up, and only on MoSPI's new 2022-23 index.`;

const cards = [
  {
    stamp: ["partly", "Growing, not booming"],
    title: "Output is up, at a steady pace",
    body: `Manufacturing production rose ${pct(h.mfg_change_pct)} from ${h.from_fy} to ${h.to_fy}, ${pa(h.mfg_cagr)}. That is steady growth, not a surge. ` +
      `The new 2022-23 index shows faster momentum: ${pct(h.new_mfg_change_pct)} in three years, and ${pct(h.ytd_mfg_avg_growth)} on average in ${ym(h.ytd_months[0])} to ${ym(h.ytd_months.at(-1))}.`,
    cite: `IIP Manufacturing, 2011-12 series: ${h.mfg_from} (${h.from_fy}) → ${h.mfg_to} (${h.to_fy}). 2022-23 series: 100 → ${(100 + h.new_mfg_change_pct).toFixed(1)} (${h.new_to_fy}).`,
  },
  {
    stamp: ["yes", "Yes"],
    title: "Factories are hiring",
    body: `Persons engaged in registered factories rose from ${lakh(pBase)} to ${lakh(pLast)} (${pct(jobsChange)}) between ${asi.base} and ${asi.latest}, ${pa(ig.persons)}. ` +
      `MoSPI's ASI ${"2024-25"} release puts employment ${pct(h24.employment_growth_pct)} higher again in the following year.`,
    cite: `ASI persons engaged, all industries: ${Math.round(pBase).toLocaleString("en-IN")} → ${Math.round(pLast).toLocaleString("en-IN")}. ASI 2024-25 press note, 30 Sep 2026.`,
  },
  {
    stamp: ["notyet", "Not yet"],
    title: "Productivity: slow gains",
    body: `Real value added grew ${pa(ig.gva_real)} while jobs grew ${pa(ig.persons)}, so value added per worker rose ${pa(ig.gva_per_person)}. ` +
      `About ${Math.round(jobShare * 100)}% of the output growth came from adding workers, not from each worker producing more.`,
    cite: `ASI real GVA (deflated by WPI Manufactured products) per person engaged, ${asi.base} → ${asi.latest}: ₹${asi.india.series.gva_per_person[yrs.indexOf(asi.base)]} → ₹${asi.india.series.gva_per_person.at(-1)} lakh at 2011-12 prices.`,
  },
  {
    stamp: ["partly", "Too early to call"],
    title: "PLI sectors: early signs",
    body: `Electronics grew ${pct(elec.new.change_pct)} on the new index since 2022-23, the ${["1st", "2nd", "3rd"][newRank.indexOf(elec)] ?? `${newRank.indexOf(elec) + 1}th`} fastest of 23 industries. Its old index, which barely counts phones, shows only ${pct(elec.change_pct)} since ${h.from_fy}. ` +
      `Pharma doubled (${pct(pharma.change_pct)}), but mostly before PLI began, and is up ${pct(pharma.new.change_pct)} since 2022-23.`,
    cite: `IIP NIC 26 and 21: 2011-12 series ${h.from_fy} → ${h.to_fy}; 2022-23 series 2022-23 → ${h.new_to_fy}. PLI schemes started in 2020-21.`,
  },
  {
    stamp: ["partly", "Slowly"],
    title: "Spreading beyond the big five",
    body: `${c[asi.latest].states.join(", ")} make ${c[asi.latest].share}% of factory value added, down from ${c[asi.base].share}% in ${asi.base}. ` +
      `Among states with over 3 lakh factory jobs, ${fast.slice(0, 3).map((d) => d[0]).join(", ")} grew fastest; ${fast.at(-1)[0]} grew slowest (${pa(fast.at(-1)[1].growth.gva_real)}).`,
    cite: `ASI GVA (current prices) share of the top five states, ${asi.base} vs ${asi.latest}. State growth: real GVA a year; see the map.`,
  },
  {
    stamp: ["notyet", "Not yet"],
    title: "Few new factories",
    body: `The number of factories grew only ${pa(ig.factories)}, from ${Math.round(fBase).toLocaleString("en-IN")} to ${Math.round(fLast).toLocaleString("en-IN")}. ` +
      `Growth has come from existing factories getting bigger (more workers each) more than from many new ones opening.`,
    cite: `ASI number of factories, all industries, ${asi.base} → ${asi.latest}.`,
  },
];
document.getElementById("verdict-cards").innerHTML = cards.map((k) => `
  <article class="vcard"><span class="stamp ${k.stamp[0]}">${k.stamp[1]}</span><h3>${esc(k.title)}</h3><p>${k.body}</p><p class="cite">${esc(k.cite)}</p></article>`).join("");

// ---------- method
const lf = m.link_factors;
const checks = meta.checks.map((c) => `<tr><td>${esc(c.what)}</td><td>${c.published}</td><td>${typeof c.ours === "number" ? +c.ours.toFixed(2) : c.ours}</td>` +
  `<td class="${c.status === "match" ? "ok" : "rev"}">${c.status === "match" ? "matches" : c.status === "revised" ? "revised since" : esc(c.status)}</td><td><a href="${esc(c.source)}">source</a></td></tr>`).join("");
document.getElementById("method-body").innerHTML = `
  <div>
    <h3>Sources</h3>
    <ul>
      <li><b>Index of Industrial Production (IIP)</b>, MoSPI, monthly, via the <a href="https://esankhyiki.mospi.gov.in/">eSankhyiki</a> API: 2011-12 series (Apr 2012 to Mar 2026) and 2022-23 series (from Apr 2023, latest ${ym(meta.iip_latest_month)}).</li>
      <li><b>Annual Survey of Industries (ASI)</b>, MoSPI, by state and NIC 2008 two-digit industry, ${yrs[0]} to ${asi.latest}, via eSankhyiki. Covers registered factories only, not the informal sector, where most manufacturing jobs are.</li>
      <li><b>Wholesale Price Index</b>, Office of the Economic Adviser (DPIIT), "Manufactured products", base 2011-12, financial-year averages, used to turn rupees into 2011-12 prices.</li>
      <li><b>State boundaries</b>: geoBoundaries (ODbL), the same file the site's Monsoon page uses.</li>
    </ul>
    <h3 style="margin-top:18px">Data lags</h3>
    <ul>
      <li>IIP: a quick estimate about 4 weeks after the month ends, revised the following month and again later.</li>
      <li>ASI: about 15 to 18 months after the financial year ends. ${esc(meta.asi_newer_note)}</li>
    </ul>
  </div>
  <div>
    <h3>Choices and caveats</h3>
    <ul>
      <li><b>Two IIP base years, joined only where MoSPI says how.</b> The monthly lines use MoSPI's official linking factors (old index ÷ ${lf.Manufacturing} for Manufacturing, ${lf.Mining} Mining, ${lf.Electricity} Electricity) before April 2023. Industry cards never join the series, because MoSPI publishes no linking factors below the sector level.</li>
      <li><b>The old index ages.</b> Its item basket was fixed in 2011-12, so fast-growing new products (smartphones especially) are under-counted. Treat its electronics figure with care.</li>
      <li><b>Real values</b>: ASI's rupee figures are divided by WPI Manufactured products (2011-12 = 100), so prices of what factories sell are taken out. Real series start in 2011-12, the first year of that WPI.</li>
      <li><b>Growth window</b>: ${asi.base} (the year before Make in India, September 2014) to ${asi.latest}, as an average a year. Pre-2014 trends are not compared: the IIP series only starts in 2012-13.</li>
      <li><b>State changes</b>: Telangana is reported separately from 2012-13. Jammu &amp; Kashmir and Ladakh are combined for growth, because Ladakh is reported only from 2019-20. Dadra &amp; Nagar Haveli and Daman &amp; Diu are summed before their 2020 merger. Arunachal Pradesh, Mizoram and Lakshadweep have no ${asi.base} figure, so they get no growth figure; they are hatched on the map.</li>
      <li><b>State totals</b> are ASI's own "all industries" figures. Top-industry lists leave out the "Other" group, where ASI places industries with too few factories to publish.</li>
      <li><b>PLI tags</b> place each Production Linked Incentive scheme in the industry group where most of it falls. A scheme can be a small part of a large group.</li>
    </ul>
  </div>
  <div style="grid-column:1/-1">
    <h3>Checked against MoSPI's published figures</h3>
    <div class="tbl-scroll"><table class="checks"><thead><tr><th>Figure</th><th>Published</th><th>This page</th><th>Result</th><th></th></tr></thead><tbody>${checks}</tbody></table></div>
    <p class="note">"Revised since": the press release had a quick estimate, and MoSPI's data now holds the revised number. Data built ${meta.built}. Pipeline and refresh steps: <a href="https://github.com/manishkkk18/data/tree/main/apps/manufacturing-insights">GitHub</a>.</p>
  </div>`;
