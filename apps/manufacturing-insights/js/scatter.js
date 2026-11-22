// 4. Jobs vs output: growth in persons engaged (x) against growth in real GVA (y), ASI base year to latest.
// Above the diagonal output grew faster than jobs (more output per worker); below it, the reverse.
import { C, pct, pa, lakh, rsLakh, esc, segmented, tooltip, rel, onResize, track } from "./common.js";

export function scatter(asi, HL) {
  const el = document.getElementById("scatter");
  const tip = tooltip(document.getElementById("scatter-tip"), el.parentElement);
  let mode = "states";
  segmented(document.getElementById("scatter-mode"), "x", (m) => { mode = m; draw(); track(`scatter-${m}`); });

  const ig = asi.india.growth;
  const states = Object.entries(asi.states)
    .filter(([, s]) => s.growth.gva_real != null && !s.small_base && s.latest?.persons > 50000)
    .map(([n, s]) => ({ name: s.growth_label ? "J&K incl. Ladakh" : n, x: s.growth.persons, y: s.growth.gva_real, size: s.latest.persons, pp: s.latest.gva_per_person, lead: false }));
  const inds = asi.sectors.filter((s) => s.growth.gva_real != null && s.growth.persons != null)
    .map((s) => ({ name: s.name, x: s.growth.persons, y: s.growth.gva_real, size: s.persons, pp: s.gva_per_person, cap: s.capital_per_person, lead: s.pli === "lead" }));
  const F = HL.factory, SW = HL.same_window;
  const below = states.filter((d) => d.y < d.x);
  const labourHeavy = [...inds].sort((a, b) => (a.cap ?? 0) - (b.cap ?? 0)).slice(0, 3).map((d) => d.name.toLowerCase());

  document.getElementById("jobs-lede").innerHTML =
    `Across India's registered factories, jobs grew ${pa(F.persons_cagr)} and real value added ${pa(F.gva_real_cagr)} between ${F.from_fy} and ${F.to_fy}, ` +
    `so output per worker rose ${pa(F.gva_per_person_cagr)}. Roughly ${F.jobs_share_of_growth_pct}% of the growth came from more people working, and ${100 - F.jobs_share_of_growth_pct}% from each producing more. ` +
    `In ${below.length} of ${states.length} states shown, jobs grew faster than output (below the line). ` +
    `The industries with the least fixed capital per worker are ${labourHeavy.join(", ")}.`;
  document.getElementById("scatter-caption").innerHTML =
    `Average change a year, ${asi.base} to ${asi.latest} (ASI, all registered factories). Real GVA deflated with WPI Manufactured products. ` +
    `Circle size: persons engaged in ${asi.latest}. States with fewer than 50,000 factory workers, and those without a ${asi.base} figure, are left out, ` +
    `so are small bases (see the map). J&amp;K includes Ladakh. Dashed line: output and jobs growing at the same pace.`;
  const gap = document.createElement("p");
  gap.className = "gap-note";
  gap.innerHTML =
    `<b>Why is this bigger than the output index?</b> Over the same years (${SW.from_fy} to ${SW.to_fy}) the IIP manufacturing index rose ${pct(SW.iip_change_pct)} but ASI real value added rose ${pct(SW.asi_gva_real_change_pct)}. ` +
    `The IIP counts the volume of a fixed list of products chosen in 2011-12, so newer products and upgrades are missed. ASI measures the value factories add, turned into real terms with one price index, ` +
    `which can overstate real growth in years when that index falls (as in ${HL.deflation_latest.latest_fy}). <a href="#method">More in the method notes</a>.`;
  document.getElementById("scatter-caption").after(gap);

  function draw() {
    el.innerHTML = "";
    const data = mode === "states" ? states : inds;
    const W = el.clientWidth, narrow = W < 600;
    const H = narrow ? 380 : 480;
    if (W < 200) return; // not laid out yet
    const mg = { t: 16, r: 16, b: 44, l: 48 };
    const ext = (k) => d3.extent([...data.map((d) => d[k]), ig.persons, ig.gva_real, 0]);
    const [x0, x1] = ext("x"), [y0, y1] = ext("y");
    const lo = Math.min(x0, y0) - 1, hi = Math.max(x1, y1) + 1;
    const x = d3.scaleLinear().domain([Math.floor(Math.min(lo, x0 - 1)), Math.ceil(x1 + 1)]).range([mg.l, W - mg.r]);
    const y = d3.scaleLinear().domain([Math.floor(Math.min(lo, y0 - 1)), Math.ceil(hi)]).range([H - mg.b, mg.t]);
    const r = d3.scaleSqrt().domain([0, d3.max(data, (d) => d.size)]).range([0, narrow ? 18 : 26]);
    const svg = d3.select(el).append("svg").attr("width", W).attr("height", H).attr("role", "img")
      .attr("aria-label", `Scatter of ${mode}: employment growth against real output growth`);

    svg.append("g").attr("class", "gridline").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(6).tickSize(-(W - mg.l - mg.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat((v) => `${v}%`));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(narrow ? 5 : 8).tickFormat((v) => `${v}%`));
    svg.append("text").attr("class", "quad").attr("x", W - mg.r).attr("y", H - 8).attr("text-anchor", "end").text("Jobs: growth a year →");
    svg.append("text").attr("class", "quad").attr("transform", `translate(14,${mg.t}) rotate(-90)`).attr("text-anchor", "end").text("← Real GVA: growth a year");
    svg.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", mg.t).attr("y2", H - mg.b).attr("stroke-opacity", .5);
    svg.append("line").attr("class", "zero").attr("x1", mg.l).attr("x2", W - mg.r).attr("y1", y(0)).attr("y2", y(0)).attr("stroke-opacity", .5);
    const d0 = Math.max(x.domain()[0], y.domain()[0]), d1 = Math.min(x.domain()[1], y.domain()[1]);
    svg.append("line").attr("class", "diag").attr("x1", x(d0)).attr("y1", y(d0)).attr("x2", x(d1)).attr("y2", y(d1));
    svg.append("text").attr("class", "quad").attr("x", x(d0) + 8).attr("y", mg.t + 14).text("Output per worker rising ↑");
    svg.append("text").attr("class", "quad").attr("x", W - mg.r - 4).attr("y", y(d0) - 8).attr("text-anchor", "end").text("Jobs outpacing output ↓");

    const g = svg.append("g");
    const sorted = [...data].sort((a, b) => b.size - a.size);
    g.selectAll("circle").data(sorted).join("circle").attr("class", "dot")
      .attr("cx", (d) => x(d.x)).attr("cy", (d) => y(d.y)).attr("r", (d) => Math.max(4, r(d.size)))
      .attr("fill", (d) => (d.lead ? C.accent : d.y >= d.x ? C.series.mining : C.div[1])).attr("fill-opacity", .85)
      .on("pointermove pointerdown", (ev, d) => {
        const [px, py] = rel(ev, el.parentElement);
        tip.show(`<b>${esc(d.name)}</b><div class="row"><span>Jobs</span><span>${pa(d.x)}</span></div><div class="row"><span>Real GVA</span><span>${pa(d.y)}</span></div>` +
          `<div class="row"><span>Jobs, ${asi.latest}</span><span>${lakh(d.size)}</span></div><div class="row"><span>GVA per worker</span><span>${rsLakh(d.pp)}</span></div>` +
          (d.cap != null ? `<div class="row"><span>Fixed capital/worker</span><span>${rsLakh(d.cap)}</span></div>` : ""), px, py);
      })
      .on("pointerleave", () => tip.hide());
    // India
    svg.append("circle").attr("cx", x(ig.persons)).attr("cy", y(ig.gva_real)).attr("r", 7).attr("fill", "none").attr("stroke", C.ink).attr("stroke-width", 2.5);
    svg.append("text").attr("class", "series-label").attr("x", x(ig.persons) + 11).attr("y", y(ig.gva_real) + 5).attr("fill", C.ink).text("India");
    // labels, biggest first, skipping any that would overlap one already placed (the rest: tooltip, table)
    const placed = [[x(ig.persons) - 8, y(ig.gva_real) - 10, x(ig.persons) + 60, y(ig.gva_real) + 8]];
    const hit = (a) => placed.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);
    for (const d of sorted.slice(0, narrow ? 5 : 16)) {
      const rx = Math.max(4, r(d.size));
      const w = d.name.length * 7, tx = x(d.x) + rx + 3, ty = y(d.y) + 4;
      const right = tx + w < W - mg.r;
      const box = right ? [tx, ty - 11, tx + w, ty + 3] : [x(d.x) - rx - 3 - w, ty - 11, x(d.x) - rx - 3, ty + 3];
      if (hit(box)) continue;
      placed.push(box);
      g.append("text").attr("class", "dot-label").attr("x", right ? tx : x(d.x) - rx - 3).attr("text-anchor", right ? "start" : "end").attr("y", ty).text(d.name);
    }

    legend.innerHTML = `<span class="key"><span class="sw box" style="background:${C.series.mining}"></span>Output grew faster than jobs</span>` +
      `<span class="key"><span class="sw box" style="background:${C.div[1]}"></span>Jobs grew faster than output</span>` +
      (mode === "sectors" ? `<span class="key"><span class="sw box" style="background:${C.accent}"></span>PLI focus: electronics, pharma</span>` : "") +
      `<span class="key"><span class="sw box" style="background:none;border:2px solid ${C.ink};border-radius:50%"></span>All India</span>`;
  }
  const legend = document.createElement("div");
  legend.className = "legend";
  el.parentElement.before(legend);
  draw();
  onResize(el, draw);
}
