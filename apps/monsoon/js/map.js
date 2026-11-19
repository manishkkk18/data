// Section 2: district choropleth. Two views:
//   "season" (default): IMD's official rain-gauge figure per district, 1 Jun – 24 Sep (imd_districts.json)
//   "weekly": week-by-week cumulative departure estimated from IMD's real-time 0.25° grid (weekly_2026.json),
//             animated with play/pause and a scrubber. The grid can be far off where gauges are sparse.
import { CATS, CAT, MISSING, addPatterns, bus, category, esc, fillFor, fmtDate, fmtMm, fmtPct, placeTip, projection, swatch, tok } from "./common.js";

export function initMap({ topo, weekly, imd }) {
  const districts = topojson.feature(topo, topo.objects.districts).features;
  const stateMesh = topojson.mesh(topo, topo.objects.states, (a, b) => a !== b);
  const outline = topojson.mesh(topo, topo.objects.states, (a, b) => a === b);
  const box = document.getElementById("choropleth");
  const fig = box.parentElement;
  const tip = document.getElementById("map-tip");
  const W = 800, H = 860;
  const proj = projection(districts, W, H);
  const path = d3.geoPath(proj);
  const weeks = weekly.weeks;
  const imdTo = fmtDate(imd.period.slice(-10));
  let mode = "season", week = weeks.length - 1, selected = null, timer = null;

  const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  addPatterns(svg);
  const g = svg.append("g");
  const shapes = g.append("g").selectAll("path").data(districts).join("path")
    .attr("class", "district").attr("d", path)
    .attr("stroke", "#fffdf8").attr("stroke-width", 0.35).attr("vector-effect", "non-scaling-stroke")
    .attr("tabindex", -1);
  g.append("path").datum(stateMesh).attr("d", path).attr("fill", "none").attr("stroke", tok("--ink")).attr("stroke-opacity", 0.55)
    .attr("stroke-width", 0.8).attr("vector-effect", "non-scaling-stroke").attr("pointer-events", "none");
  g.append("path").datum(outline).attr("d", path).attr("fill", "none").attr("stroke", tok("--ink")).attr("stroke-width", 1.1)
    .attr("vector-effect", "non-scaling-stroke").attr("pointer-events", "none");
  // weekly view only: districts where the grid estimate ends far from IMD's own figure
  const flagged = districts.filter((d) => imd.districts[d.properties.id]?.flag);
  const flagLayer = g.append("path").datum({ type: "FeatureCollection", features: flagged }).attr("d", path).attr("fill", "none")
    .attr("stroke", tok("--ink")).attr("stroke-width", 1.2).attr("stroke-dasharray", "3 2")
    .attr("vector-effect", "non-scaling-stroke").attr("pointer-events", "none");
  const selLayer = g.append("path").attr("fill", "none").attr("stroke", tok("--ink")).attr("stroke-width", 2.4)
    .attr("vector-effect", "non-scaling-stroke").attr("pointer-events", "none");

  const official = (d) => imd.districts[d.properties.id] || null;
  const depOf = (d) => (mode === "season" ? official(d)?.dep ?? null : weekly.districts[d.properties.id]?.d?.[week] ?? null);

  const modeBtns = [...document.querySelectorAll("#map-mode button")];
  function setMode(m) {
    mode = m;
    modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    flagLayer.attr("visibility", m === "weekly" ? "visible" : "hidden");
    document.getElementById("map-mode-note").innerHTML = m === "season"
      ? `IMD’s official figure for each district, from its rain gauges: rain from 1 June to ${imdTo} against the district’s normal. This is the season’s answer.`
      : `An <b>estimate</b> from IMD’s real-time rainfall grid, to show how the season built up. It can be far from IMD’s own figure where few rain gauges fed the grid (dashed outlines: 25+ points apart).`;
  }

  function paint(animate) {
    // colours fade between weeks; hatch patterns (url fills) can't be interpolated, so they switch directly
    const isUrl = (v) => String(v).startsWith("url");
    const fade = animate ? shapes.filter(function (d) { return !isUrl(this.getAttribute("fill")) && !isUrl(fillFor(depOf(d))); }) : null;
    const faded = new Set(fade ? fade.nodes() : []);
    shapes.filter(function () { return !faded.has(this); }).interrupt().attr("fill", (d) => fillFor(depOf(d)));
    if (fade) fade.transition().duration(380).attr("fill", (d) => fillFor(depOf(d)));
    document.getElementById("week-label").textContent = mode === "season"
      ? `Season result: 1 Jun – ${imdTo} (IMD)`
      : `Estimate, 1 Jun – ${fmtDate(weeks[week])}`;
    const slider = document.getElementById("week");
    slider.value = mode === "season" ? weeks.length - 1 : week;
    slider.setAttribute("aria-valuetext", mode === "season" ? `Season result to ${imdTo}` : `Estimate to ${fmtDate(weeks[week])}`);
    legend();
    if (selected) showPick(selected);
  }

  // legend doubles as a count of districts in each category in the current view
  function legend() {
    const counts = {};
    for (const d of districts) { const c = category(depOf(d)); counts[c] = (counts[c] || 0) + 1; }
    const max = Math.max(...Object.values(counts));
    const rows = [...CATS, MISSING].filter((c) => c.key !== "missing" || counts.missing);
    document.getElementById("legend").innerHTML = rows.map((c) => `
      <div class="leg-row"><span class="leg-sw" style="${swatch(c.key)}"></span>
        <span>${c.key === "missing" && mode === "season" ? "No IMD figure" : c.label} <span class="range">${c.range}</span></span><span class="leg-count">${counts[c.key] || 0}</span>
        <span class="leg-bar" aria-hidden="true"><i style="width:${((counts[c.key] || 0) / max) * 100}%"></i></span></div>`).join("")
      + `<p class="note" style="margin:4px 0 0">Number of map districts in each category, of ${districts.length}.</p>`
      + (mode === "weekly" && flagged.length ? `<div class="leg-row" style="margin-top:6px"><span class="leg-sw" style="background:#fffdf8;border:1.5px dashed ${tok("--ink")}"></span><span class="note" style="grid-column:2/4;margin:0">Estimate ends 25+ points from IMD’s figure (${flagged.length} districts)</span></div>` : "");
  }

  function showPick(d) {
    const o = official(d), dep = depOf(d), cat = CAT[category(dep)];
    const head = `<h3>${esc(d.properties.name)}</h3><p class="card-state">${esc(d.properties.state)}</p>
      <p class="dep" style="color:${dep != null && dep < 0 ? tok("--dry") : tok("--rain")}">${fmtPct(dep)}</p>
      <span class="chip"><i style="${swatch(cat.key)}"></i>${cat.label}</span>`;
    const body = mode === "season"
      ? (o ? `<p class="note">IMD rain gauges, 1 Jun – ${imdTo}: ${fmtMm(o.actual)} fell; ${fmtMm(o.normal)} is normal.</p>`
           : `<p class="note">IMD publishes no figure for this map district (its boundary changed, or IMD counts it with a neighbour).</p>`)
      : `<p class="note">Estimate from the real-time grid, 1 Jun – ${fmtDate(weeks[week])}.${o?.flag ? ` <b>Far from IMD’s figure here</b> (${fmtPct(o.dep)} to ${imdTo}).` : ""}</p>`;
    document.getElementById("map-pick").innerHTML = `${head}${body}
      <a class="btn" href="#district" data-open="${esc(d.properties.id)}">Open the full season →</a>`;
  }

  function select(d) {
    selected = d;
    selLayer.attr("d", d ? path(d) : null);
    if (d) showPick(d);
  }

  document.getElementById("map-pick").addEventListener("click", (e) => {
    const a = e.target.closest("[data-open]");
    if (a) bus.dispatchEvent(new CustomEvent("select", { detail: a.dataset.open }));
  });

  shapes
    .on("pointermove", (e, d) => {
      if (e.pointerType !== "mouse") return;
      const dep = depOf(d);
      tip.innerHTML = `<b>${esc(d.properties.name)}</b>, ${esc(d.properties.state)}<br>${fmtPct(dep)} · ${CAT[category(dep)].label}${mode === "weekly" ? " (estimate)" : ""}`;
      placeTip(tip, fig, e);
    })
    .on("pointerleave", () => { tip.hidden = true; })
    .on("click", (e, d) => select(d));

  // zoom & pan (pinch on phones; buttons for everyone)
  const zoom = d3.zoom().scaleExtent([1, 12]).translateExtent([[0, 0], [W, H]])
    .on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  fig.querySelector(".map-zoom").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const t = svg.transition().duration(300);
    if (b.dataset.zoom === "in") zoom.scaleBy(t, 1.6);
    else if (b.dataset.zoom === "out") zoom.scaleBy(t, 1 / 1.6);
    else zoom.transform(t, d3.zoomIdentity);
  });

  // view toggle + player (playing always shows the weekly estimate)
  const play = document.getElementById("play");
  const slider = document.getElementById("week");
  slider.max = weeks.length - 1;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function stop() { clearInterval(timer); timer = null; play.setAttribute("aria-pressed", "false"); play.setAttribute("aria-label", "Play the season week by week"); }
  modeBtns.forEach((b) => b.addEventListener("click", () => {
    stop();
    if (b.dataset.mode === "weekly" && mode !== "weekly") week = weeks.length - 1;
    setMode(b.dataset.mode); paint(false);
  }));
  play.addEventListener("click", () => {
    if (timer) return stop();
    if (mode !== "weekly" || week === weeks.length - 1) week = 0;
    setMode("weekly");
    play.setAttribute("aria-pressed", "true"); play.setAttribute("aria-label", "Pause");
    paint(!reduce);
    timer = setInterval(() => {
      if (week >= weeks.length - 1) return stop();
      week += 1; paint(!reduce);
    }, reduce ? 1200 : 700);
  });
  slider.addEventListener("input", () => { stop(); setMode("weekly"); week = +slider.value; paint(false); });

  setMode("season");
  paint(false);

  return {
    focus(id) {
      const d = districts.find((f) => f.properties.id === id);
      if (d) select(d);
    },
    districts,
  };
}
