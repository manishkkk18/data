// Loads the static JSON (written by scripts/), fills the hero, the verdict and the method notes,
// and starts each chart. Every number shown is read from the data files, none is typed in here;
// the headline figures all come from data/headline.json (scripts/build.py, build_headline).
import { getJSON, pct, pa, lakh, ym, esc } from "./common.js";
import { pulse } from "./pulse.js";
import { sectors } from "./sectors.js";
import { stateMap } from "./map.js";
import { scatter } from "./scatter.js";
import { invest } from "./invest.js";
import { screenSection } from "./screen.js";

const [iip, asi, meta, topo, HL, INV, SCR] = await Promise.all(
  ["data/iip.json", "data/asi.json", "data/meta.json", "data/states.topo.json", "data/headline.json", "data/invest.json", "data/screen.json"].map(getJSON),
);

const O = HL.output, OL = HL.output_linked, F = HL.factory, SW = HL.same_window, D = HL.deflation_latest;
const h = iip.headline;
const yrs = asi.years;
const range = (a, b) => `${a} to ${b}`;
const n0 = (v) => `${Math.round(v)}%`; // unsigned, for prose after "up" / "rose"

// ---------- hero: two stats, each with its own source and window
document.getElementById("stat-output-label").textContent = `Factory output index, ${range(O.from_fy, O.to_fy)}`;
document.getElementById("stat-output").innerHTML = `${pct(O.change_pct, 0)}<small>in ${O.years} years</small>`;
document.getElementById("stat-output-cap").textContent =
  `How much factories produce, on MoSPI's index: ${pa(O.cagr)} on average. ` +
  `This year so far (${ym(HL.ytd.months[0])} to ${ym(HL.ytd.months.at(-1))}) it is running ${pct(HL.ytd.mfg_avg_growth)} above last year.`;
document.getElementById("stat-factory-label").textContent = `Registered factories, ${range(F.from_fy, F.to_fy)}`;
document.getElementById("stat-gva").textContent = pct(F.gva_real_change_pct, 0);
document.getElementById("stat-jobs").textContent = pct(F.persons_change_pct, 0);
document.getElementById("stat-factory-cap").textContent =
  `Same survey, same ${F.years} years: value added grew faster than jobs (${lakh(F.persons_from)} → ${lakh(F.persons_to)} people), ` +
  `so output per worker rose about ${F.gva_per_person_cagr.toFixed(1)}% a year.`;
document.getElementById("asof").innerHTML =
  `Latest data: <b>IIP ${ym(meta.iip_latest_month)}</b> &nbsp;<b>ASI ${meta.asi_latest_year}</b> &nbsp;<a href="#method">why ASI ${meta.asi_latest_year}?</a>`;

const m = iip.monthly;
const PRE = "2020-02";
const mfgI = m.series.manufacturing.index;
const covidLow = mfgI.reduce((a, v, i) => (v != null && v < a[0] ? [v, i] : a), [Infinity, -1]);
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
scatter(asi, HL);
invest(INV);
screenSection(SCR);

// ---------- verdict
const elec = iip.sectors.find((s) => s.nic === "26");
const pharma = iip.sectors.find((s) => s.nic === "21");
const newRank = [...iip.sectors].sort((a, b) => b.new.change_pct - a.new.change_pct);
const ord = (n) => ["1st", "2nd", "3rd"][n - 1] ?? `${n}th`;
const c = asi.concentration;
const ig = asi.india.growth;
const fBase = asi.india.series.factories[yrs.indexOf(asi.base)], fLast = asi.india.series.factories.at(-1);
const fast = Object.entries(asi.states).filter(([, v]) => v.latest?.persons > 300000 && v.growth.gva_real != null).sort((a, b) => b[1].growth.gva_real - a[1].growth.gva_real);
const h24 = meta.asi_2024_25_headline;
const ppLo = Math.min(F.gva_per_person_cagr_to_prev, F.gva_per_person_cagr), ppHi = Math.max(F.gva_per_person_cagr_to_prev, F.gva_per_person_cagr);
const ppRange = `about ${ppLo.toFixed(1)}–${ppHi.toFixed(1)}% a year`;

document.getElementById("answer").innerHTML =
  `<b>Yes, steadily but not dramatically, and more by hiring than by making each worker more productive.</b> ` +
  `The factory output index is up ${n0(O.change_pct)} over ${O.years} years. In registered factories, real value added rose ${n0(F.gva_real_change_pct)} and jobs ${n0(F.persons_change_pct)} over ${F.years} years, ` +
  `so roughly ${F.jobs_share_of_growth_pct}% of the growth came from more people working and output per worker rose ${ppRange}. ` +
  `The PLI sectors are only beginning to show up, and mainly on MoSPI's new 2022-23 index.`;

const cards = [
  {
    stamp: ["partly", "Growing, not booming"],
    title: "Output is up, at a steady pace",
    body: `The factory output index rose ${pct(O.change_pct)} from ${O.from_fy} to ${O.to_fy}, ${pa(O.cagr)}: steady growth, not a surge. ` +
      `The new 2022-23 index shows more momentum lately, ${pct(h.new_mfg_change_pct)} in three years and ${pct(HL.ytd.mfg_avg_growth)} on average in ${ym(HL.ytd.months[0])} to ${ym(HL.ytd.months.at(-1))}.`,
    cite: `IIP manufacturing, 2011-12 series: ${O.from} (${O.from_fy}) → ${O.to} (${O.to_fy}). 2022-23 series: 100 → ${(100 + h.new_mfg_change_pct).toFixed(1)} (${h.new_to_fy}).`,
  },
  {
    stamp: ["yes", "Yes"],
    title: "Factories are hiring",
    body: `People employed in registered factories rose from ${lakh(F.persons_from)} to ${lakh(F.persons_to)} (${pct(F.persons_change_pct)}) between ${F.from_fy} and ${F.to_fy}, ${pa(F.persons_cagr)}. ` +
      `MoSPI's ASI 2024-25 release puts employment ${pct(h24.employment_growth_pct)} higher again in the following year.`,
    cite: `ASI persons engaged, all industries: ${Math.round(F.persons_from).toLocaleString("en-IN")} → ${Math.round(F.persons_to).toLocaleString("en-IN")}. ASI 2024-25 press note, 30 Sep 2026.`,
  },
  {
    stamp: ["notyet", "Not yet"],
    title: "Productivity: slow gains",
    body: `Real value added grew ${pa(F.gva_real_cagr)} and jobs ${pa(F.persons_cagr)}, so value added per worker rose ${pa(F.gva_per_person_cagr)}, and ${pa(F.gva_per_person_cagr_to_prev)} up to ${F.prev_fy}. ` +
      `The difference is one year: in ${D.latest_fy} wholesale prices of manufactured goods fell, which turns ${pct(D.nominal_growth_pct)} nominal growth into ${pct(D.real_growth_pct)} real and may overstate it. Either way, most growth came from adding workers.`,
    cite: `ASI real GVA per person engaged (deflated by WPI Manufactured products), ${F.from_fy} → ${F.to_fy}: ₹${F.gva_per_person_from} → ₹${F.gva_per_person_to} lakh at 2011-12 prices.`,
  },
  {
    stamp: ["partly", "Too early to call"],
    title: "PLI sectors: early signs",
    body: `Electronics grew ${pct(elec.new.change_pct)} on the new index since 2022-23, the ${ord(newRank.indexOf(elec) + 1)} fastest of 23 industries. Its old index, which under-counts phone assembly, shows only ${pct(elec.change_pct)} since ${O.from_fy}. ` +
      `Pharma doubled on the old index (${pct(pharma.change_pct)}), but mostly before PLI began, and is up ${pct(pharma.new.change_pct)} since 2022-23.`,
    cite: `IIP NIC 26 and 21: 2011-12 series ${O.from_fy} → ${O.to_fy}; 2022-23 series 2022-23 → ${h.new_to_fy}; never joined. PLI schemes started in 2020-21.`,
  },
  {
    stamp: ["partly", "Slowly"],
    title: "Spreading beyond the big five",
    body: `${c[asi.latest].states.join(", ")} make ${c[asi.latest].share}% of factory value added, down from ${c[asi.base].share}% in ${asi.base}. ` +
      `Among states with over 3 lakh factory jobs, ${fast.slice(0, 3).map((d) => d[0]).join(", ")} grew fastest; ${fast.at(-1)[0]} grew slowest (${pa(fast.at(-1)[1].growth.gva_real)}).`,
    cite: `ASI GVA (current prices) share of the top five states, ${asi.base} vs ${asi.latest}. State growth: real GVA a year; see the map.`,
  },
  (() => {
    const lead = SCR.rows.filter((r) => r.label === "Rising + backed");
    const rising = SCR.rows.filter((r) => r.label === "Rising, unconfirmed").slice(0, 3);
    const im = INV.imports, capG = (im.capital_all.at(-1) / im.capital_all.at(-3) - 1) * 100;
    const nAvail = Object.values(SCR.signals_available).filter(Boolean).length;
    return {
      stamp: [lead.length ? "partly" : "notyet", lead.length ? "Early signs" : "Not yet"],
      title: "Is the money following?",
      body: `Capital-goods imports grew ${pct(capG, 0)} in two years (${im.fys.at(-3)} to ${im.fys.at(-1)}), and PLI firms report ₹${(INV.pli.total.investment / 1e5).toFixed(2)} lakh crore invested. ` +
        (lead.length ? `On the momentum screen, ${lead.map((r) => r.name.toLowerCase()).join(", ")} ${lead.length === 1 ? "is" : "are"} both rising and backed by at least ${SCR.thresholds.checks_for_backed} investment signals. ` : `No industry yet passes the screen's "Rising + backed" test. `) +
        `${rising.map((r) => r.name).join(", ")} are rising but not yet confirmed${nAvail < 5 ? `, partly because only ${nAvail} of 5 signals have data so far` : ""}.`,
      cite: `Momentum screen: IIP old vs new index relative to manufacturing; signals from TradeStat, ASI and NITI Aayog (PLI). TradeStat capital goods within HS 84-85, US$: ${(im.capital_all.at(-3) / 1000).toFixed(1)} → ${(im.capital_all.at(-1) / 1000).toFixed(1)} bn.`,
    };
  })(),
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
    <h3 style="margin-top:18px">Which window each headline uses</h3>
    <ul>
      <li><b>Factory output index</b>: IIP manufacturing, ${range(O.from_fy, O.to_fy)} (${O.years} years), on the 2011-12 series alone, which runs to ${O.to_fy}: ${O.from} → ${O.to}, ${pct(O.change_pct)}. ` +
      `Taking ${OL.to_fy} from the new 2022-23 series instead, linked with MoSPI's factor (${OL.new_index} × ${OL.factor} = ${OL.to}), gives ${pct(OL.change_pct)}. The page uses the lower, single-series figure.</li>
      <li><b>Value added, jobs and output per worker</b>: ASI, ${range(F.from_fy, F.to_fy)} (${F.years} years), all from the same survey and window, so they can be compared with each other. They are not directly comparable with the output index above, which covers a different window and measures something else (next point).</li>
    </ul>
  </div>
  <div>
    <h3>Choices and caveats</h3>
    <ul>
      <li><b>Why the output index and value added disagree.</b> Over the same ${F.years} years (${range(SW.from_fy, SW.to_fy)}), the IIP manufacturing index rose ${pct(SW.iip_change_pct)} (${SW.iip_from} → ${SW.iip_to}) while ASI real value added rose ${pct(SW.asi_gva_real_change_pct)}. ` +
      `The IIP counts the volume of a fixed list of products chosen in 2011-12, so it misses newer products and quality upgrades. ASI measures value added by all registered factories, turned into real terms with one price index. The two answer different questions, and neither is wrong.</li>
      <li><b>One price index for everything.</b> ASI's rupee figures are divided by WPI Manufactured products (2011-12 = 100), which takes out the prices factories sell at, not the prices they pay for inputs. In ${D.latest_fy} that index fell (${D.wpi_prev} → ${D.wpi_latest}), turning ${pct(D.nominal_growth_pct)} nominal growth in value added into ${pct(D.real_growth_pct)} real. Value added is output minus inputs; when input prices move differently from output prices, deflating it with a single output-price index can distort real growth (a proper "double deflation" would deflate inputs separately). The ${D.latest_fy} jump likely overstates the latest real gain and the rise in output per worker. Up to ${F.prev_fy}, output per worker grew ${pa(F.gva_per_person_cagr_to_prev)}; to ${F.to_fy}, ${pa(F.gva_per_person_cagr)}.</li>
      <li><b>Two IIP base years, joined only where MoSPI says how.</b> The monthly lines use MoSPI's official linking factors (old index ÷ ${lf.Manufacturing} for Manufacturing, ${lf.Mining} Mining, ${lf.Electricity} Electricity) before April 2023. Industry cards never join the series, because MoSPI publishes no linking factors below the sector level.</li>
      <li><b>The old index ages.</b> Its item basket was fixed in 2011-12, so fast-growing new products (smartphone and electronics assembly especially) are under-counted. That is why each industry card also shows the new basket's change since 2022-23.</li>
      <li><b>Growth window</b>: ${asi.base} (the year before Make in India, September 2014) to ${asi.latest}, as an average a year. Pre-2014 trends are not compared: the IIP series only starts in 2012-13.</li>
      <li><b>State changes</b>: Telangana is reported separately from 2012-13. Ladakh is reported only from 2019-20, so on growth maps Jammu &amp; Kashmir carries the combined figure (J&amp;K incl. Ladakh) and Ladakh shows "no separate data". Dadra &amp; Nagar Haveli and Daman &amp; Diu are summed before their 2020 merger. Arunachal Pradesh, Mizoram and Lakshadweep have no ${asi.base} figure, so they get no growth figure.</li>
      <li><b>Small bases</b>: growth rates for states with under 10,000 factory workers in ${asi.base}, or with more than half their output in ASI's suppressed "Other" group, swing wildly. They are greyed on growth maps and left out of the scatter; their numbers stay in the table.</li>
      <li><b>Colour scales</b>: level maps split states into six equal-sized groups (sextiles), so one outlier, such as Sikkim's value added per worker, doesn't wash out the rest. Growth maps use fixed bands around zero.</li>
      <li><b>State totals</b> are ASI's own "all industries" figures. Top-industry lists leave out the "Other" group, where ASI places industries with too few factories to publish.</li>
      <li><b>PLI tags</b> place each Production Linked Incentive scheme in the industry group where most of it falls. A scheme can be a small part of a large group.</li>
    </ul>
  </div>
  <div style="grid-column:1/-1">
    <h3>Investment pipeline and momentum screen</h3>
    <ul>
      <li><b>Sources</b>: capital-goods imports from <a href="${INV.imports.source}">TradeStat</a> (Department of Commerce, data by DGCI&amp;S), HS 4-digit, financial years ${INV.imports.fys[0]} to ${INV.imports.fys.at(-1)}, in US$ (so exchange-rate moves don't count as growth). PLI investment, production and jobs per scheme from <a href="${INV.pli.link}">${esc(INV.pli.source)}</a>, to ${INV.pli.as_of}, each figure stored with its page. ASI gross fixed capital formation and fixed capital by industry (MoSPI). ` +
        `Bank credit: RBI "Sectoral Deployment of Bank Credit" (Statement 2, industry-wise), September of each year from ${INV.credit.septembers?.[0] ?? "–"} to ${INV.credit.last ?? "–"}, ${INV.credit.files?.length ?? 0} releases, the newest release used for any date. ` +
        `Capacity in use: RBI OBICUS, every quarter since ${INV.obicus.series?.[0]?.quarter ?? "–"}. FDI: DPIIT's sector-wise/year-wise FDI equity table (FDI Newsletter, April 2026), US$, calendar years. ` +
        `These three are downloaded by hand from the publishers' sites (their file servers block scripts) and kept in the repository.</li>
      <li><b>Bank credit dates.</b> From December 2025 RBI reports month-end figures, so the latest year-on-year comparison (${INV.credit.prev ?? ""} to ${INV.credit.last ?? ""}) runs slightly longer than a year. It lifts all industries alike; the signal compares each industry with all industry over the same dates, so the effect largely cancels.</li>
      <li><b>FDI is a tilt, not growth.</b> DPIIT's full sector table is by calendar year, with 2000-2022 combined. So the FDI signal asks whether an industry's share of FDI into manufacturing in ${INV.fdi.periods?.[1] ?? ""}-${INV.fdi.periods?.[3] ?? ""} is higher than its share in 2000-2022 (✓ if at least ${SCR.thresholds.fdi_pct}% higher). Individual large deals can swing a small sector's share.</li>
      <li><b>Each source groups industries its own way.</b> RBI credit, DPIIT FDI, PLI schemes and HS trade codes are matched to ${Object.keys(INV.groups).length} industry groups, each match flagged exact, approximate or loose. Industries in the same group share that group's signals. <a href="data/industry_map.csv" download>Download the full mapping (CSV)</a>.</li>
      <li><b>Capital-goods imports are a narrow signal.</b> Chapters 84-85 are mostly phones, chips, laptops and parts, which are left out. Of the machinery that remains, most is general-purpose (pumps, motors, transformers) and counts only in the all-industry total. Only machinery specific to one industry feeds that industry's signal, so chemicals, pharma, petroleum and other manufacturing have no import signal. Machine tools are shared between metal products, machinery and vehicles.</li>
      <li><b>PLI "committed" figures</b> are published for only ${INV.pli.schemes.filter((s) => s.committed != null).length} of ${INV.pli.schemes.length} schemes; elsewhere the PLI signal is "no data". A target can be a minimum threshold, so beating it is not the same as the scheme being complete.</li>
      <li><b>Momentum compares two indices.</b> The new 2022-23 index and the old 2011-12 one count different products, and the new one grows faster for manufacturing as a whole (${pct(SCR.reference.recent_all)} vs ${pct(SCR.reference.longrun_all)} a year over their windows). So each industry is judged by its gap to manufacturing on each index, never by its raw rates. The two index levels are never joined.</li>
      <li><b>What this is</b>: a momentum screen, not a forecast, and not investment advice. It shows where recent growth and investment signals line up. Small bases, the basket change, one-off spikes and import-heavy assembly can all make an industry look stronger than it is; the watchlist names the relevant risk for each.</li>
    </ul>
    <div class="tbl-scroll"><table><thead><tr><th>Group</th><th>NIC</th><th>RBI credit</th><th>DPIIT FDI</th><th>PLI schemes</th><th>Import codes (HS4)</th></tr></thead><tbody>${mapRows()}</tbody></table></div>
  </div>
  <div style="grid-column:1/-1">
    <h3>Checked against MoSPI's published figures</h3>
    <div class="tbl-scroll"><table class="checks"><thead><tr><th>Figure</th><th>Published</th><th>This page</th><th>Result</th><th></th></tr></thead><tbody>${checks}</tbody></table></div>
    <p class="note">"Revised since": the press release had a quick estimate, and MoSPI's data now holds the revised number. Data built ${meta.built}. Pipeline and refresh steps: <a href="https://github.com/manishkkk18/data/tree/main/apps/manufacturing-insights">GitHub</a>.</p>
  </div>`;

/** The mapping summary table for the method notes, from data/industry_map.csv. */
function mapRows() {
  return INV.mapping_summary.map((g) => `<tr><td>${esc(g.name)}</td><td>${esc(g.nic)}</td>${["rbi_credit", "dpiit_fdi", "pli", "hs4"].map((s) =>
    `<td style="white-space:normal;text-align:left;font-family:var(--sans);font-size:12.5px">${g[s].length ? g[s].map((x) => `${esc(x.cat)} <span class="dim" style="color:var(--muted)">(${x.conf})</span>`).join("; ") : "no data"}</td>`).join("")}</tr>`).join("");
}
