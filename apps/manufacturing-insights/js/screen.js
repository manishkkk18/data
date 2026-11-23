// 6. Where's the momentum? A momentum screen backed by investment signals (data/screen.json).
// Every label follows a published rule (shown on the page); no weighted score.
import { C, tok, pct, esc, lakh, tooltip, rel, onResize, track } from "./common.js";

export const LABEL_COLOR = {
  "Rising + backed": tok("accent"),
  "Rising, unconfirmed": tok("s-ele"),
  Steady: tok("steel"),
  Fading: tok("s-min"),
};
const SIGNALS = [
  ["credit", "Credit", "Bank credit growth, latest 12 months, vs all-industry credit"],
  ["imports", "Imports", "Capital-goods imports for the industry, last 2 FYs, vs all capital goods"],
  ["fdi", "FDI", "FDI equity, latest 3 FYs vs the previous 3"],
  ["asi", "Factories", "ASI: fixed capital per worker vs India, and factory count"],
  ["pli", "PLI", "PLI actual investment as % of committed"],
];
const MARK = { check: "✓", dash: "–", cross: "✗" };

function signalText(k, s, T) {
  if (s.score == null) return s.why ?? "No data";
  if (k === "imports") return `Imports ${pct(s.value)} (${s.from_fy} to ${s.to_fy}) vs ${pct(s.reference)} for all capital goods: ${s.diff > 0 ? "+" : ""}${s.diff} pts (✓ at +${T.imports_pts}, ✗ at −${T.imports_pts}). Mapping: ${s.confidence}${s.combined ? ", machine tools shared with other metal-using industries" : ""}.`;
  if (k === "asi") return `${s.from} to ${s.to}: real fixed capital per worker ${pct(s.fcpw_cagr)} a year (India ${pct(s.india_fcpw_cagr)}); factories ${pct(s.factories_cagr)} a year. ✓ both better, – one, ✗ neither.`;
  if (k === "pli") return `${s.value}% of committed investment (${(s.used ?? []).join(", ")}). ✓ at ${T.pli_hi}%+, ✗ below ${T.pli_lo}%.`;
  return s.why ?? "";
}

/** One short, number-citing phrase per passing signal, for the watchlist. */
function evidence(k, s) {
  if (k === "imports") return `capital-goods imports ${pct(s.value)} (${s.from_fy} to ${s.to_fy}) vs ${pct(s.reference)} for all capital goods`;
  if (k === "asi") return `fixed capital per worker ${pct(s.fcpw_cagr)} a year vs India's ${pct(s.india_fcpw_cagr)}, factories ${pct(s.factories_cagr)} a year (${s.from} to ${s.to})`;
  if (k === "pli") return `PLI investment at ${s.value}% of the committed figure`;
  if (k === "credit") return `bank credit ${pct(s.value)} vs ${pct(s.reference)} for all industry`;
  if (k === "fdi") return `FDI ${pct(s.value)} over the latest 3 FYs vs the previous 3`;
  return k;
}

export function screenSection(scr) {
  const T = scr.thresholds, R = scr.reference, rows = scr.rows;
  const avail = Object.entries(scr.signals_available).filter(([, v]) => v).length;
  const byLabel = scr.counts;

  document.getElementById("momentum-lede").innerHTML =
    `A momentum screen, not a forecast: it shows which industries are growing faster than their own past pace, and whether investment signals back that up. ` +
    `Of 23 manufacturing industries, ${byLabel["Rising + backed"]} ${byLabel["Rising + backed"] === 1 ? "is" : "are"} "Rising + backed", ${byLabel["Rising, unconfirmed"]} "Rising, unconfirmed", ${byLabel.Steady} "Steady" and ${byLabel.Fading} "Fading". ` +
    (avail < 5 ? `Only ${avail} of the 5 investment signals have data so far (bank credit and FDI files are still to be added), so fewer industries can reach "backed" than will once they are in.` : "");

  document.getElementById("rule-box").innerHTML = `<b>The rule, in full</b>
    <ul>
      <li><b>Momentum</b>: growth from ${R.recent_window[0]} to ${R.recent_window[1]} on MoSPI's new index, compared with growth from ${R.longrun_window[0]} to ${R.longrun_window[1]} on the old one, <i>each relative to manufacturing as a whole</i> (${pct(R.recent_all)} and ${pct(R.longrun_all)} a year). The two indices count different products, so only gaps to the all-manufacturing line are compared, never the raw rates.</li>
      <li><b>Rising</b>: momentum more than ${T.momentum_pts} point a year above its long-run gap. <b>Fading</b>: more than ${T.momentum_pts} point below. <b>Steady</b>: in between.</li>
      <li><b>Rising + backed</b>: Rising, and at least ${T.checks_for_backed} of the 5 investment signals show ✓. Otherwise <b>Rising, unconfirmed</b>. A signal with no data counts as neither ✓ nor ✗.</li>
    </ul>`;

  // ---------- quadrant
  const el = document.getElementById("quadrant");
  const tip = tooltip(document.getElementById("quadrant-tip"), el.parentElement);
  document.getElementById("quadrant-legend").innerHTML = Object.entries(LABEL_COLOR).map(([k, c]) =>
    `<span class="key"><span class="sw box" style="background:${c};border-radius:50%"></span>${k} (${byLabel[k]})</span>`).join("");
  let tapped = null;
  function draw() {
    el.innerHTML = "";
    const W = el.clientWidth, narrow = W < 600;
    if (W < 200) return;
    const H = narrow ? 420 : 520, mg = { t: 24, r: 18, b: 44, l: 50 };
    const xs = rows.map((r) => r.longrun), ys = rows.map((r) => r.recent);
    const x = d3.scaleLinear().domain([Math.min(...xs, R.longrun_all) - 1, Math.max(...xs, R.longrun_all) + 1]).nice().range([mg.l, W - mg.r]);
    const y = d3.scaleLinear().domain([Math.min(...ys, R.recent_all) - 1, Math.max(...ys, R.recent_all) + 1]).nice().range([H - mg.b, mg.t]);
    const r = d3.scaleSqrt().domain([0, d3.max(rows, (d) => d.persons)]).range([4, narrow ? 20 : 28]);
    const svg = d3.select(el).append("svg").attr("width", W).attr("height", H).attr("role", "img")
      .attr("aria-label", "Quadrant chart: long-run growth (old index) against recent growth (new index) for 23 industries");
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(6).tickSize(-(W - mg.l - mg.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat((v) => `${v}%`));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(narrow ? 5 : 8).tickFormat((v) => `${v}%`));
    svg.append("text").attr("class", "quad").attr("x", W - mg.r).attr("y", H - 8).attr("text-anchor", "end").text(narrow ? "Long-run growth (old index) →" : `Long-run growth a year, ${R.longrun_window.join(" to ")} (old index) →`);
    svg.append("text").attr("class", "quad").attr("transform", `translate(14,${mg.t}) rotate(-90)`).attr("text-anchor", "end").text(narrow ? "← Recent growth (new index)" : `← Recent growth a year, ${R.recent_window.join(" to ")} (new index)`);
    svg.append("line").attr("class", "diag").attr("x1", x(R.longrun_all)).attr("x2", x(R.longrun_all)).attr("y1", mg.t).attr("y2", H - mg.b);
    svg.append("line").attr("class", "diag").attr("x1", mg.l).attr("x2", W - mg.r).attr("y1", y(R.recent_all)).attr("y2", y(R.recent_all));
    const qn = [["New risers", mg.l + 6, mg.t + 12, "start"], ["Steady leaders", W - mg.r - 6, mg.t + 12, "end"],
      ["Laggards", mg.l + 6, H - mg.b - 8, "start"], ["Fading", W - mg.r - 6, H - mg.b - 8, "end"]];
    qn.forEach(([t, qx, qy, a]) => svg.append("text").attr("class", "q-name").attr("x", qx).attr("y", qy).attr("text-anchor", a).text(t));
    svg.append("text").attr("class", "q-label").attr("x", x(R.longrun_all) + 4).attr("y", H - mg.b - 22).text("all manufacturing");
    const sorted = [...rows].sort((a, b) => b.persons - a.persons);
    svg.append("g").selectAll("circle").data(sorted).join("circle").attr("class", "dot")
      .attr("cx", (d) => x(d.longrun)).attr("cy", (d) => y(d.recent)).attr("r", (d) => r(d.persons))
      .attr("fill", (d) => LABEL_COLOR[d.label]).attr("fill-opacity", 0.85)
      .attr("stroke", (d) => (d.nic === tapped ? C.ink : C.paper)).attr("stroke-width", (d) => (d.nic === tapped ? 2.5 : 1.5))
      .on("pointermove", (ev, d) => { if (ev.pointerType !== "touch") show(ev, d); })
      .on("pointerdown", (ev, d) => { tapped = d.nic; show(ev, d); if (narrow) draw(); })
      .on("pointerleave", () => tip.hide());
    // labels: all on desktop (pushed apart), only the tapped one on phones
    const lab = narrow ? rows.filter((d) => d.nic === tapped) : rows;
    const placed = [];
    for (const d of [...lab].sort((a, b) => y(a.recent) - y(b.recent))) {
      const cx = x(d.longrun) + r(d.persons) + 3; let cy = y(d.recent) + 4;
      const w = d.name.length * 6.6;
      const right = cx + w < W - mg.r;
      const lx = right ? cx : x(d.longrun) - r(d.persons) - 3;
      for (let k = 0; k < 8 && placed.some((p) => Math.abs(p.y - cy) < 12 && Math.abs(p.x - lx) < w); k++) cy += 12;
      placed.push({ x: lx, y: cy });
      svg.append("text").attr("class", "q-label").attr("x", lx).attr("y", cy).attr("text-anchor", right ? "start" : "end").text(d.name);
    }
    function show(ev, d) {
      const [px, py] = rel(ev, el.parentElement);
      tip.show(`<b>${esc(d.name)}</b><div class="row"><span>Label</span><span>${esc(d.label)}</span></div>` +
        `<div class="row"><span>Long-run (old index)</span><span>${pct(d.longrun)} a yr</span></div>` +
        `<div class="row"><span>Recent (new index)</span><span>${pct(d.recent)} a yr</span></div>` +
        `<div class="row"><span>Momentum vs manufacturing</span><span>${d.relative > 0 ? "+" : ""}${d.relative} pts</span></div>` +
        `<div class="row"><span>Signals ✓ / with data</span><span>${d.checks} / ${d.available}</span></div>` +
        `<div class="row"><span>People employed (ASI)</span><span>${lakh(d.persons)}</span></div>`, px, py);
    }
  }
  draw();
  onResize(el, draw);
  document.getElementById("quadrant-caption").innerHTML =
    `Dashed lines: all manufacturing on each index. Circle size: people employed in the industry's registered factories (ASI). ` +
    `Quadrant names describe position only; the colour is the label from the rule above. ${"ontouchstart" in window ? "Tap a circle to name it." : ""}`;

  // ---------- signal grid
  document.getElementById("grid-lede").innerHTML =
    `Each cell is ✓, – or ✗ by the thresholds below the table; "·" means no data. Tap or hover a cell for its numbers. Click a column to sort.`;
  const G = document.getElementById("signal-grid");
  const gtip = tooltip(document.getElementById("grid-tip"), G.parentElement);
  const cols = [
    { k: "name", t: "Industry", v: (r) => r.name },
    { k: "label", t: "Label", v: (r) => ["Rising + backed", "Rising, unconfirmed", "Steady", "Fading"].indexOf(r.label) },
    { k: "relative", t: "Momentum", v: (r) => r.relative },
    { k: "consistency", t: "Consistency", v: (r) => r.consistency ?? -1 },
    ...SIGNALS.map(([k, t]) => ({ k, t, v: (r) => ({ check: 2, dash: 1, cross: 0 })[r.signals[k].score] ?? -1, sig: true })),
  ];
  let sortK = "label", dir = 1;
  function render() {
    const c = cols.find((c) => c.k === sortK);
    const data = [...rows].sort((a, b) => {
      const va = c.v(a), vb = c.v(b);
      const d = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return d * dir || b.relative - a.relative;
    });
    G.innerHTML = `<table><thead><tr>${cols.map((c) => `<th scope="col" aria-sort="${c.k === sortK ? (dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-k="${c.k}">${c.t}</button></th>`).join("")}</tr></thead><tbody>` +
      data.map((r) => `<tr><td>${esc(r.name)}</td><td><span class="lbl"><i style="background:${LABEL_COLOR[r.label]}"></i>${esc(r.label)}</span></td>` +
        `<td>${r.relative > 0 ? "+" : ""}${r.relative.toFixed(1)} pts</td><td>${r.consistency == null ? "·" : `${r.consistency}%`}</td>` +
        SIGNALS.map(([k]) => { const s = r.signals[k]; return `<td style="text-align:center"><button type="button" class="sig ${s.score ?? "nd"}" data-n="${r.nic}" data-s="${k}" aria-label="${esc(r.name)}, ${k}: ${s.score ?? "no data"}">${s.score ? MARK[s.score] : "·"}</button></td>`; }).join("") +
        `</tr>`).join("") + `</tbody></table>`;
  }
  G.addEventListener("click", (ev) => {
    const b = ev.target.closest("th button");
    if (b) { dir = b.dataset.k === sortK ? -dir : b.dataset.k === "relative" || b.dataset.k === "consistency" ? -1 : 1; sortK = b.dataset.k; render(); track("grid-sort"); return; }
  });
  const showSig = (ev) => {
    const b = ev.target.closest(".sig");
    if (!b) return;
    const r = rows.find((x) => x.nic === b.dataset.n);
    const label = b.dataset.s, long = SIGNALS.find((s) => s[0] === label)[2];
    const br = b.getBoundingClientRect(), pr = G.parentElement.getBoundingClientRect();
    gtip.show(`<b>${esc(r.name)}</b><div class="dim">${esc(long)}</div><div>${esc(signalText(label, r.signals[label], T))}</div>`, br.left - pr.left + br.width / 2, br.top - pr.top);
  };
  G.addEventListener("pointerover", (ev) => { if (ev.pointerType !== "touch") showSig(ev); });
  G.addEventListener("focusin", showSig);
  G.addEventListener("pointerdown", showSig);
  G.addEventListener("pointerleave", () => gtip.hide());
  render();
  const thr = document.createElement("p");
  thr.className = "note";
  thr.innerHTML = `Thresholds: Credit ✓ if at least ${T.credit_pts} pts above all-industry credit growth, ✗ if ${T.credit_pts} pts below. ` +
    `Imports ✓ / ✗ at ±${T.imports_pts} pts against all capital-goods imports. FDI ✓ / ✗ at ±${T.fdi_pct}% (latest 3 FYs vs previous 3). ` +
    `Factories (ASI, ${rows[0].signals.asi.from} to ${rows[0].signals.asi.to}): ✓ if real fixed capital per worker grew faster than India's and the number of factories grew; – if one; ✗ if neither. ` +
    `PLI ✓ at ${T.pli_hi}%+ of committed investment, ✗ below ${T.pli_lo}%. Consistency: share of the last 12 months (${R.last12[0]} to ${R.last12.at(-1)}) in which the industry's year-on-year growth beat its own long-run rate. ` +
    `Signals come from industry groups (sources are coarser than the 23 industries), so industries in one group share them; see the mapping in the method notes.`;
  G.after(thr);

  // ---------- watchlist
  const W = document.getElementById("watchlist");
  const watch = scr.watchlist.map((n) => rows.find((r) => r.nic === n));
  if (!watch.length) {
    W.innerHTML = `<div class="nodata-panel"><b>No industry meets "Rising + backed" yet</b><br>With the current data, none passes both tests.</div>`;
    return;
  }
  W.innerHTML = watch.map((r) => {
    const ok = SIGNALS.filter(([k]) => r.signals[k].score === "check").map(([k]) => evidence(k, r.signals[k]));
    return `<article class="watch"><h4>${esc(r.name)}</h4>
      <p>Recent growth of ${pct(r.recent)} a year on the new index (${R.recent_window.join(" to ")}), against ${pct(r.longrun)} long-run on the old one: ${r.relative > 0 ? "+" : ""}${r.relative} pts ahead of manufacturing's own shift. ` +
      `It beat its long-run pace in ${r.consistency}% of the last 12 months.</p>
      <p>Backed by ${r.checks} of ${r.available} signals with data: ${ok.map(esc).join("; ")}.</p>
      <p class="risk"><b>What could go wrong:</b> ${esc(r.risks[0])}${r.risks[1] ? ` ${esc(r.risks[1])}` : ""}</p></article>`;
  }).join("");
}
