// 3. State choropleth from the Annual Survey of Industries, plus a state panel (bottom sheet on phones).
import { C, pct, pa, int, lakh, crore, rsLakh, esc, segmented, tooltip, rel, onResize, track } from "./common.js";

const METRICS = {
  gva_real: { name: "Real GVA", long: "Gross value added at 2011-12 prices", fmt: crore },
  factories: { name: "Factories", long: "Number of factories", fmt: int },
  persons: { name: "Jobs", long: "Persons engaged", fmt: lakh },
  gva_per_person: { name: "GVA per worker", long: "Real GVA per person engaged, 2011-12 prices", fmt: rsLakh },
};
const GROWTH_T = [-6, -3, -1, 1, 3, 6]; // % a year; 7 bins, neutral grey for -1..+1

export function stateMap(asi, topo) {
  const el = document.getElementById("map");
  const tip = tooltip(document.getElementById("map-tip"), el.parentElement);
  const panel = document.getElementById("panel");
  const select = document.getElementById("state-select");
  const feats = topojson.feature(topo, topo.objects.states).features;
  const S = asi.states;
  let metric = "gva_real", mode = "level", selected = null;

  for (const f of feats) if (!S[f.properties.state]) console.warn("no ASI data for", f.properties.state);
  document.getElementById("mode-level").textContent = `Level, ${asi.latest}`;
  document.getElementById("mode-growth").textContent = `Growth a year since ${asi.base}`;

  const c = asi.concentration;
  const big = Object.entries(S).filter(([, v]) => v.latest?.persons > 300000 && v.growth.gva_real != null).sort((a, b) => b[1].growth.gva_real - a[1].growth.gva_real);
  document.getElementById("states-lede").innerHTML =
    `Five states (${c[asi.latest].states.join(", ")}) still make ${c[asi.latest].share}% of the value added in India's registered factories, ` +
    `down from ${c[asi.base].share}% in ${asi.base}. Among states with over 3 lakh factory jobs, real GVA grew fastest in ${big.slice(0, 3).map(([k, v]) => `${k} (${pct(v.growth.gva_real)})`).join(", ")} a year, ` +
    `and slowest in ${big.slice(-2).reverse().map(([k, v]) => `${k} (${pct(v.growth.gva_real)})`).join(" and ")}. ` +
    `Latest year: <b>ASI ${asi.latest}</b>.`;

  Object.keys(S).sort().forEach((n) => select.add(new Option(n, n)));
  select.addEventListener("change", () => select.value && open(select.value, true));

  segmented(document.getElementById("metric"), "m", (m) => { metric = m; draw(); track(`map-${m}`); });
  segmented(document.getElementById("mapmode"), "k", (k) => { mode = k; draw(); track(`map-${k}`); });

  const value = (name) => (mode === "level" ? S[name]?.latest?.[metric] : S[name]?.growth?.[metric]) ?? null;

  function scale() {
    if (mode === "growth") return d3.scaleThreshold().domain(GROWTH_T).range(C.div);
    const vals = Object.keys(S).map(value).filter((v) => v != null);
    return d3.scaleQuantile().domain(vals).range(C.seq);
  }

  function legend(sc) {
    const L = document.getElementById("map-legend");
    const m = METRICS[metric];
    if (mode === "growth") {
      L.innerHTML = `<div class="scale">${C.div.map((c) => `<span style="background:${c}"></span>`).join("")}</div>` +
        `<div class="ticks"><span>shrinking</span>${GROWTH_T.map((t) => `<span>${t > 0 ? "+" : ""}${t}%</span>`).join("")}<span>growing</span></div>` +
        `<div class="extra"><span>${m.long}: average change a year, ${asi.base} to ${asi.latest}</span><span><i class="hatch-sw"></i>No ${asi.base} figure</span></div>`;
    } else {
      const q = sc.quantiles();
      L.innerHTML = `<div class="scale">${C.seq.map((c) => `<span style="background:${c}"></span>`).join("")}</div>` +
        `<div class="ticks"><span>low</span>${q.map((t) => `<span>${short(t)}</span>`).join("")}<span>high</span></div>` +
        `<div class="extra"><span>${m.long}, ${asi.latest} (six equal groups of states)</span><span><i class="hatch-sw"></i>No data</span></div>`;
    }
  }
  const short = (v) => (metric === "gva_per_person" ? v.toFixed(1) : metric === "gva_real" ? (v >= 1e5 ? `${(v / 1e5).toFixed(1)}L cr` : `${Math.round(v / 1e3)}k cr`) : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : `${Math.round(v / 1e3)}k`);

  function draw() {
    el.innerHTML = "";
    const W = el.clientWidth, H = Math.round(W * 1.08);
    if (W < 200) return; // not laid out yet
    const proj = d3.geoMercator().fitExtent([[4, 4], [W - 4, H - 4]], { type: "FeatureCollection", features: feats });
    const path = d3.geoPath(proj);
    const sc = scale();
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H)
      .attr("role", "img").attr("aria-label", `Map of India's states shaded by ${METRICS[metric].long}${mode === "growth" ? " growth" : ""}`);
    const defs = svg.append("defs");
    defs.append("pattern").attr("id", "hatch").attr("width", 5).attr("height", 5).attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)")
      .call((p) => { p.append("rect").attr("width", 5).attr("height", 5).attr("fill", C.paper); p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 5).attr("stroke", C.steel).attr("stroke-width", 1.2); });
    svg.append("g").selectAll("path").data(feats).join("path")
      .attr("class", (d) => `state${d.properties.state === selected ? " sel" : ""}`)
      .attr("d", path)
      .attr("fill", (d) => { const v = value(d.properties.state); return v == null ? "url(#hatch)" : sc(v); })
      .on("pointermove", (ev, d) => hover(ev, d.properties.state))
      .on("pointerleave", () => tip.hide())
      .on("click", (ev, d) => open(d.properties.state, false));
    svg.select(".sel")?.raise();
    legend(sc);
  }

  function hover(ev, name) {
    if (ev.pointerType === "touch") return; // on phones a tap opens the panel instead
    const v = value(name);
    const m = METRICS[metric];
    const [x, y] = rel(ev, el.parentElement);
    tip.show(`<b>${esc(name)}</b><div class="row"><span>${m.name}${mode === "growth" ? " growth" : ""}</span><span>${mode === "growth" ? pa(v) : m.fmt(v)}</span></div>` +
      (v == null ? `<div class="dim">${esc(S[name]?.flags?.[0] ?? "No ASI data")}</div>` : `<div class="dim">Click for details</div>`), x, y);
  }

  function open(name, fromSelect) {
    selected = name;
    select.value = name;
    tip.hide();
    draw();
    const s = S[name];
    track("state-panel");
    panel.classList.toggle("sheet", window.innerWidth < 960);
    if (!s) { panel.innerHTML = `<p class="panel-empty">No ASI data for ${esc(name)}.</p>`; return; }
    const L = s.latest || {};
    const g = s.growth;
    panel.innerHTML = `
      <div class="panel-head"><div><p class="kicker" style="margin:0">ASI ${asi.latest}</p><h3>${esc(name)}</h3></div>
        <button class="close" type="button" aria-label="Close state details">×</button></div>
      <div class="kpis">
        ${kpi("Real GVA", crore(L.gva_real), g.gva_real)}
        ${kpi("Jobs (persons engaged)", lakh(L.persons), g.persons)}
        ${kpi("Factories", int(L.factories), g.factories)}
        ${kpi("GVA per worker", rsLakh(L.gva_per_person), g.gva_per_person)}
      </div>
      <h4>Trend since ${asi.years[0]}</h4>
      <div class="trend-pair">
        <div><div class="t-cap">Real GVA (₹ crore, 2011-12 prices)</div><svg class="trend" data-k="gva_real" viewBox="0 0 150 60" width="100%" height="60"></svg></div>
        <div><div class="t-cap">Persons engaged</div><svg class="trend" data-k="persons" viewBox="0 0 150 60" width="100%" height="60"></svg></div>
      </div>
      <h4>Top industries by GVA, ${asi.latest}</h4>
      <ul class="top-ind">${s.top.map((t, i) => `<li><span>${esc(t.name)}</span><svg class="spark" data-i="${i}" viewBox="0 0 70 18" width="70" height="18" aria-label="Real GVA trend, ${esc(t.name)}"></svg><span class="pct">${t.share}%</span></li>`).join("")}</ul>
      <p class="note" style="margin-top:6px">Share of the state's factory GVA; line: real GVA since ${asi.years[0]}.${s.suppressed_share ? ` ${s.suppressed_share}% sits in "Other", where ASI groups industries with too few factories to publish separately.` : ""}</p>
      ${s.flags.length ? `<div class="flags">${s.flags.map((f) => `<p>${esc(f)}</p>`).join("")}</div>` : ""}`;
    panel.querySelector(".close").addEventListener("click", close);
    panel.querySelectorAll("svg.trend").forEach((svg) => spark(svg, s.series[svg.dataset.k], 150, 60, C.ink, true));
    panel.querySelectorAll("svg.spark").forEach((svg) => spark(svg, s.top[Number(svg.dataset.i)].gva_real, 70, 18, C.series.mining, false));
    if (!fromSelect && window.innerWidth >= 960) panel.focus({ preventScroll: true });
    if (window.innerWidth < 960) panel.focus({ preventScroll: true });
  }

  function close() {
    selected = null;
    select.value = "";
    panel.classList.remove("sheet");
    panel.innerHTML = `<p class="panel-empty">Choose a state to see its top industries, its trend since ${asi.years[0]}, and what changed since ${asi.base}.</p>`;
    draw();
  }
  document.addEventListener("keydown", (e) => e.key === "Escape" && selected && close());

  const kpi = (k, v, g) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="g">${g == null ? "growth: n/a" : `${pct(g)}/yr since ${asi.base}`}</div></div>`;

  function spark(svgEl, vals, w, h, col, axis) {
    const svg = d3.select(svgEl);
    const ok = vals.map((v, i) => [i, v]).filter((d) => d[1] != null);
    if (ok.length < 2) return;
    const x = d3.scaleLinear().domain([0, vals.length - 1]).range([2, w - 2]);
    const y = d3.scaleLinear().domain([0, d3.max(ok, (d) => d[1])]).range([h - (axis ? 12 : 2), 2]);
    svg.append("path").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(ok)).attr("fill", "none").attr("stroke", col).attr("stroke-width", 2);
    svg.append("circle").attr("cx", x(ok.at(-1)[0])).attr("cy", y(ok.at(-1)[1])).attr("r", 2.5).attr("fill", col);
    if (axis) {
      svg.append("text").attr("x", 2).attr("y", h - 1).attr("font-size", 9).attr("font-family", "var(--mono)").attr("fill", C.muted).text(asi.years[0]);
      svg.append("text").attr("x", w - 2).attr("y", h - 1).attr("text-anchor", "end").attr("font-size", 9).attr("font-family", "var(--mono)").attr("fill", C.muted).text(asi.latest);
    }
  }

  draw();
  onResize(el, draw);

  // table view
  const rows = Object.entries(S).sort((a, b) => (b[1].latest?.gva_real ?? -1) - (a[1].latest?.gva_real ?? -1));
  document.getElementById("states-table").innerHTML =
    `<table><thead><tr><th>State</th><th>Real GVA (₹ cr)</th><th>Factories</th><th>Jobs</th><th>GVA/worker (₹ lakh)</th><th>GVA a year</th><th>Factories a year</th><th>Jobs a year</th><th>GVA/worker a year</th></tr></thead><tbody>` +
    rows.map(([n, s]) => `<tr><td>${esc(n)}${s.flags.length ? " *" : ""}</td><td>${int(s.latest?.gva_real)}</td><td>${int(s.latest?.factories)}</td><td>${int(s.latest?.persons)}</td><td>${s.latest?.gva_per_person?.toFixed(2) ?? "–"}</td>` +
      ["gva_real", "factories", "persons", "gva_per_person"].map((k) => `<td>${pct(s.growth[k])}</td>`).join("") + `</tr>`).join("") +
    `</tbody></table><p class="note">Levels: ASI ${asi.latest}. Growth: average a year, ${asi.base} to ${asi.latest}. * See the state's notes (boundary changes or missing years).</p>`;
}
