// Entry: load the static JSON, then build each section. Everything here is read-only data from data/.
import { CAT, category, esc, fmtDate, fmtPct, load, tok } from "./common.js";
import { initMap } from "./map.js";
import { initDistrict } from "./district.js";
import { initOnset } from "./onset.js";
import { initSowing } from "./sowing.js";

function hero(meta) {
  const off = meta.official, all = off.regions["All India"];
  document.getElementById("hero-pct").textContent = `${all.pct_of_lpa}%`;
  document.getElementById("hero-sub").innerHTML =
    `${all.actual_mm} mm fell between June and September, against a long-period average of ${all.lpa_mm} mm` +
    `${off.rank.length ? `: the ${esc(off.rank[0])}, and the ${esc(off.rank[1])}` : ""}. Source: <a href="${off.source}">IMD</a>.`;
  const months = [["6", "June"], ["7", "July"], ["8", "Aug"], ["9", "Sept"]].filter(([k]) => off.monthly[k]);
  const max = Math.max(120, ...months.map(([k]) => off.monthly[k].pct_of_lpa));
  document.getElementById("hero-months").innerHTML = `
    <div class="months">${months.map(([k, name]) => {
      const v = off.monthly[k].pct_of_lpa, c = CAT[category(v - 100)];
      return `<div class="month"><div class="month-val">${v}%</div>
        <div class="month-bar" role="img" aria-label="${name}: ${v}% of normal">
          <span class="norm" style="bottom:${(100 / max) * 100}%"></span>
          <span class="fill" style="height:${(v / max) * 100}%;background:${c.color};${c.key === "N" ? `outline:1px solid ${tok("--past")}` : ""}"></span></div>
        <div class="month-name">${name}</div></div>`;
    }).join("")}</div>
    <p class="months-caption">Each month’s rain as a share of its normal. Dashed line = 100%. Bar colour uses the map’s categories.</p>`;
}

function method(meta, imd) {
  const c = meta.checks, a = c.all_india;
  const latest = c.districts[c.districts.length - 1];
  const fmt = (v) => (v == null ? "–" : v);
  document.getElementById("method-body").innerHTML = `
  <div>
    <h3>Rainfall: the season’s answer</h3>
    <p>The season result for each district, on the map and at the top of every district card, is <b>IMD’s own figure from its rain gauges</b>:
      the cumulative rainfall from 1 June to ${fmtDate(imd.period.slice(-10))} against the district’s normal, from IMD’s district table
      (<a href="${imd.snapshot}">archived copy</a>). IMD overwrites that table every week and doesn’t archive it, and the last copy saved
      during the season is from ${fmtDate(imd.period.slice(-10))}, six days before the season ended. ${Object.keys(imd.districts).length} of the map’s
      ${meta.names.map_districts} districts have one; the rest are shown as having no IMD figure.
      The all-India headline (${a.imd_pct_of_lpa}%) is IMD’s end-of-season figure.</p>
    <h3>Rainfall: week by week (an estimate)</h3>
    <p>The weekly animation, the weekly line on each card and the earlier seasons come from IMD Pune’s <a href="https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_NetCDF.html">0.25° gridded daily rainfall</a>
      (Pai et al. 2014): the final quality-checked grids for 1971–2025 and IMD’s real-time daily grids for 2026. Each district is the area-weighted
      average of the grid cells it overlaps. “Normal” is the 1971–2020 average for the same dates, the base period of IMD’s long-period average.
      Departure is cumulative from 1 June, to the end of each IMD week (Wednesday), and the categories are IMD’s.</p>
    <p><b>How far to trust the estimate.</b> For India as a whole it is close: the rain that fell matches IMD’s total (the grid’s normal,
      ${fmt(a.ours_normal_mm)} mm, is a little below IMD’s ${fmt(a.imd_lpa_mm)} mm, so its percentages run 2–3 points wetter).
      District by district it is much rougher. The 2026 real-time grid is built from far fewer rain gauges than IMD’s final grids (not yet published
      for 2026), and where rain changes sharply over a few kilometres, as along the Western Ghats or in the northeastern hills, missing gauges can
      put a district’s estimate far off${imd.districts["maharashtra--satara"] ? `: Satara, for example, comes out at ${fmtPct(imd.districts["maharashtra--satara"].grid)} against IMD’s ${fmtPct(imd.districts["maharashtra--satara"].dep)}` : ""}.
      ${latest ? `In ${latest.flagged} districts the estimate ends 25 or more points from IMD’s figure; they get a dashed outline in the weekly view
      and a warning on their card.` : ""} That is why the season result always comes from IMD.</p>
    ${meta.missing_days_2026.length ? `<p><b>Gaps:</b> no real-time grid was available for ${meta.missing_days_2026.map(fmtDate).join(", ")}; districts are shown as missing from those weeks on, never filled.</p>` : ""}
    <h3>Checked against IMD’s published figures</h3>
    <div class="tablewrap"><table>
      <thead><tr><th></th><th>IMD</th><th>This site</th></tr></thead><tbody>
      <tr><td>All-India season, % of normal</td><td>${fmt(a.imd_pct_of_lpa)}%</td><td>${fmt(a.ours_pct_of_normal)}%</td></tr>
      <tr><td>All-India normal (mm)</td><td>${fmt(a.imd_lpa_mm)}</td><td>${fmt(a.ours_normal_mm)}</td></tr>
      ${Object.entries(c.monthly).map(([k, v]) => `<tr><td>${["", "", "", "", "", "", "June", "July", "August", "September"][+k]}, % of normal</td><td>${fmt(v.imd)}%</td><td>${fmt(v.ours)}%</td></tr>`).join("")}
    </tbody></table></div>
    ${latest ? `<p>The weekly estimate district by district, against IMD’s own district table for ${esc(latest.period.replace(" to ", " – "))}
      (<a href="${latest.snapshot}">archived copy</a>), across ${latest.districts_compared} districts whose boundaries match: rank correlation
      ${latest.spearman_r}, median difference ${latest.median_abs_diff_pts} percentage points, same IMD category for ${latest.same_category_pct}%
      and within one category for ${latest.within_one_category_pct}%. Gridded averages smooth over individual rain gauges, so small or hilly districts differ most
      (largest gaps: ${latest.largest_gaps.map((g) => `${esc(g.district)} IMD ${fmtPct(g.imd)}, here ${fmtPct(g.ours)}`).join("; ")}).</p>` : ""}
  </div>
  <div>
    <h3>District boundaries &amp; names</h3>
    <p><a href="https://www.geoboundaries.org/">geoBoundaries</a> gbOpen IND ADM2 (2021, from the Local Government Directory; ODbL 1.0), simplified with mapshaper.
      It has ${meta.names.map_districts} districts; IMD lists ${meta.names.imd_districts}. ${meta.names.auto} names matched automatically and
      ${meta.names.manual} through a hand-checked table (spellings and renamings such as Allahabad → Prayagraj).
      ${meta.names.no_polygon.length} newer districts have no shape of their own on the 2021 map; searching for them opens the district they were carved from:
      ${meta.names.no_polygon.map((n) => esc(n.imd)).join(", ")}.</p>
    <h3>Arrival</h3>
    <p>The daily “northern limit of monsoon” lines are taken from IMD’s <a href="https://internal.imd.gov.in/pages/press_release_mausam.php">press releases</a>;
      place names were located with OpenStreetMap Nominatim. Normal arrival dates are from IMD’s 2020 re-determination (1961–2019, <a href="https://internal.imd.gov.in/press_release/20200515_pr_804.pdf">CRS report 3/2020</a>).</p>
    <h3>Sowing</h3>
    <p>The Agriculture Ministry’s weekly kharif area reports, as published by PIB. The state-wise area table itself was not reachable
      (agriwelfare.gov.in pages missing, UPAG down), so only the states each release names as major rises or falls are shown. Unnamed states are missing, not zero.
      Sowing also depends on irrigation, prices and reservoirs, so the chart shows a pattern to look at, not cause and effect.</p>
    <h3>Reproduce</h3>
    <p>The Python pipeline in <code>apps/monsoon/scripts/</code> downloads every source and writes the JSON this page reads; see its README. Data built ${fmtDate(meta.generated)} ${meta.generated.slice(0, 4)}.</p>
  </div>`;
}

async function main() {
  try {
    const [topo, weekly, aliases, meta, imd] = await Promise.all([load("districts.topo.json"), load("weekly_2026.json"), load("aliases.json"), load("meta.json"), load("imd_districts.json")]);
    hero(meta);
    const map = initMap({ topo, weekly, imd });
    initDistrict({ districts: map.districts, aliases, weekly, map, imd });
    method(meta, imd);
    const [onset, sowing] = await Promise.all([load("onset_2026.json"), load("sowing_2026.json")]);
    initOnset({ topo, onset });
    initSowing({ sowing, imd });
  } catch (err) {
    console.error(err);
    const p = document.createElement("p");
    p.className = "wrap note";
    p.textContent = `Some data could not be loaded (${err.message}). Try reloading the page.`;
    document.querySelector("main").prepend(p);
  }
}
main();
