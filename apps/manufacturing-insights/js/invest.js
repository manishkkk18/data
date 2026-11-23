// 5. Follow the money: the investment pipeline (announced -> financed -> spent -> installed -> output),
// capital-goods imports, bank credit, capacity in use and the PLI tracker. Reads data/invest.json.
// Missing sources show "no data", never a zero.
import { C, pct, esc, int, tooltip, rel, onResize, ym } from "./common.js";

const fmtCr = (v) => (v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} lakh crore` : `₹${Math.round(v).toLocaleString("en-IN")} crore`);
const isFY = (p) => /^\d{4}-\d{2}$/.test(p) && Number(p.slice(5)) === (Number(p.slice(2, 4)) + 1) % 100; // "2025-26"
const period = (p) => (isFY(p) ? p : /^\d{4}-\d{2}$/.test(p) ? ym(p) : /^\d{4}-\d{2}-\d{2}$/.test(p) ? new Date(p).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : p);

function noData(el, what, why) {
  el.innerHTML = `<div class="nodata-panel"><b>No data yet</b><br>${esc(what)}: ${esc(why)}</div>`;
}

function spark(svgEl, xs, ys, col) {
  const svg = d3.select(svgEl), w = 160, h = 34;
  const pts = ys.map((v, i) => [i, v]).filter((d) => d[1] != null);
  if (pts.length < 2) return;
  const x = d3.scaleLinear().domain([0, ys.length - 1]).range([2, w - 4]);
  const y = d3.scaleLinear().domain(d3.extent(pts, (d) => d[1])).nice().range([h - 3, 3]);
  svg.append("path").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(pts)).attr("fill", "none").attr("stroke", col).attr("stroke-width", 2);
  svg.append("circle").attr("cx", x(pts.at(-1)[0])).attr("cy", y(pts.at(-1)[1])).attr("r", 2.6).attr("fill", col);
}

export function invest(inv, screen) {
  const im = inv.imports;
  const n = im.fys.length;
  const bn = (v) => (v / 1000).toFixed(1);
  const capG = (im.capital_all.at(-1) / im.capital_all.at(-3) - 1) * 100;
  const share = (v, i = n - 1) => ((v[i] / (im.ch84[i] + im.ch85[i])) * 100).toFixed(0);
  const missing = Object.values(inv).filter((v) => v && v.status === "no_data").map((v) => v.label);

  document.getElementById("money-lede").innerHTML =
    `Before factories produce more, money has to be committed, financed, spent on machines and installed. ` +
    `This section follows those steps with official data. It is a screen for where activity is building now, not a forecast. ` +
    `Capital-goods imports reached US$${bn(im.capital_all.at(-1))} billion in ${im.fys.at(-1)}, up ${pct(capG, 0)} in two years, ` +
    `and PLI firms report ${fmtCr(inv.pli.total.investment)} invested by ${period(inv.pli.as_of)}.` +
    (missing.length ? ` Still to come: ${missing.join(", ")}.` : "");

  // ---------- pipeline strip
  const P = document.getElementById("pipeline");
  P.innerHTML = inv.pipeline.map((st, si) => `
    <div class="stage" role="listitem"><h3>${esc(st.stage)}</h3>
      ${st.items.map((it, ii) => it.status !== "ok"
        ? `<div class="item nodata"><div class="k">${esc(it.label)}</div><div class="v">No data yet</div><div class="p">Awaiting the official files</div></div>`
        : `<div class="item"><div class="k">${esc(it.label)}</div>
             <div class="v">${it.unit === "Rs crore" ? fmtCr(it.value) : it.unit.startsWith("Rs crore,") ? fmtCr(it.value) : `${it.unit.startsWith("US$") ? "US$" : ""}${it.value}${it.unit.startsWith("US$") ? " bn" : ""}`}</div>
             <div class="p">${esc(period(it.period))}${it.growth != null ? ` · ${pct(it.growth)} on a year earlier` : ""}${it.unit.includes("=") ? ` · index, ${esc(it.unit)}` : ""}</div>
             ${it.trend ? `<svg class="sp" data-s="${si}" data-i="${ii}" viewBox="0 0 160 34" width="160" height="34" aria-hidden="true"></svg>` : ""}
             <div class="p">${esc(it.source)}</div></div>`).join("")}
    </div>`).join("");
  P.querySelectorAll("svg.sp").forEach((s) => {
    const it = inv.pipeline[s.dataset.s].items[s.dataset.i];
    spark(s, it.trend.x, it.trend.y, C.ink);
  });
  document.getElementById("pipeline-note").textContent =
    `Each step uses a different source, unit and date, so read them as signs of activity, not one flow of money. ` +
    `"New fixed capital" is ASI gross fixed capital formation in all registered factories, at 2011-12 prices (deflated with WPI manufactured products).`;

  // ---------- capital-goods imports
  document.getElementById("imports-lede").innerHTML =
    `India imports most of its factory machinery. But chapters 84 and 85 of the trade data also hold phones, chips and laptops: ` +
    `in ${im.fys.at(-1)} only ${(im.capital_all.at(-1) / (im.ch84.at(-1) + im.ch85.at(-1)) * 100).toFixed(0)}% of their value was capital goods. ` +
    `The capital-goods line below counts only machinery, using the reviewed mapping (see the method notes).`;
  const SER = [
    { k: "ch84", name: "Chapter 84 (machinery), all", col: C.series.mining, w: 1.6 },
    { k: "ch85", name: "Chapter 85 (electrical), all", col: C.series.electricity, w: 1.6 },
    { k: "capital_all", name: "Capital goods within 84-85", col: C.accent, w: 2.8 },
  ];
  document.getElementById("imports-legend").innerHTML = SER.map((s) => `<span class="key"><span class="sw" style="background:${s.col};height:${s.w > 2 ? 4 : 2}px"></span>${s.name}</span>`).join("");
  const el = document.getElementById("imports-chart");
  const tip = tooltip(document.getElementById("imports-tip"), el.parentElement);
  function drawImports() {
    el.innerHTML = "";
    const W = el.clientWidth, narrow = W < 600;
    if (W < 200) return;
    const H = narrow ? 260 : 320, mg = { t: 18, r: narrow ? 10 : 150, b: 28, l: 44 };
    const x = d3.scalePoint().domain(im.fys).range([mg.l, W - mg.r]);
    const y = d3.scaleLinear().domain([0, d3.max([...im.ch84, ...im.ch85]) / 1000 * 1.08]).nice().range([H - mg.b, mg.t]);
    const svg = d3.select(el).append("svg").attr("width", W).attr("height", H).attr("role", "img").attr("aria-label", "Imports of chapters 84 and 85, and capital goods within them, US$ billion by financial year");
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - mg.l - mg.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => `$${v}bn`));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).tickValues(im.fys.filter((_, i) => !narrow || i % 2 === 0)));
    const pli = "2020-21";
    if (im.fys.includes(pli)) {
      const a = svg.append("g").attr("class", "annot");
      a.append("line").attr("x1", x(pli)).attr("x2", x(pli)).attr("y1", mg.t).attr("y2", H - mg.b);
      a.append("text").attr("x", x(pli) + 4).attr("y", mg.t + 10).text("PLI schemes begin; COVID year");
    }
    const labels = [];
    for (const s of SER) {
      svg.append("path").attr("d", d3.line().x((_, i) => x(im.fys[i])).y((v) => y(v / 1000))(im[s.k])).attr("fill", "none").attr("stroke", s.col).attr("stroke-width", s.w);
      svg.append("g").selectAll("circle").data(im[s.k]).join("circle").attr("cx", (_, i) => x(im.fys[i])).attr("cy", (v) => y(v / 1000)).attr("r", 2.5).attr("fill", s.col);
      labels.push({ s, y: y(im[s.k].at(-1) / 1000) + 4 });
    }
    if (!narrow) {
      labels.sort((a, b) => a.y - b.y).forEach((l, i, a) => { if (i && l.y - a[i - 1].y < 15) l.y = a[i - 1].y + 15; });
      labels.forEach((l) => svg.append("text").attr("class", "series-label").attr("x", W - mg.r + 6).attr("y", l.y).attr("fill", C.ink).text(l.s.k === "capital_all" ? "Capital goods" : l.s.k === "ch84" ? "Ch. 84" : "Ch. 85"));
    }
    const cross = svg.append("line").attr("stroke", C.ink).attr("y1", mg.t).attr("y2", H - mg.b).style("display", "none");
    svg.append("rect").attr("x", mg.l).attr("width", W - mg.l - mg.r).attr("height", H).attr("fill", "transparent")
      .on("pointermove pointerdown", (ev) => {
        const [px, py] = rel(ev, el);
        const i = d3.minIndex(im.fys, (f) => Math.abs(x(f) - px));
        cross.attr("x1", x(im.fys[i])).attr("x2", x(im.fys[i])).style("display", null);
        tip.show(`<b>${im.fys[i]}</b>` + SER.map((s) => `<div class="row"><span><i style="background:${s.col}"></i>${s.name}</span><span>$${bn(im[s.k][i])}bn</span></div>`).join("") +
          `<div class="row"><span>Chip/display-making machines (HS 8486)</span><span>$${(im.hs8486[i] / 1000).toFixed(2)}bn</span></div>`, x(im.fys[i]), Math.min(py, H - 80));
      })
      .on("pointerleave", () => { cross.style("display", "none"); tip.hide(); });
  }
  drawImports();
  onResize(el, drawImports);
  const e86 = im.hs8486, i0 = n - 3;
  document.getElementById("imports-caption").innerHTML =
    `US$ billion, financial years, from TradeStat (Department of Commerce, data by DGCI&amp;S). ` +
    `Machines that make chips, displays and circuit boards (HS 8486) went from $${(e86[i0] / 1000).toFixed(2)}bn in ${im.fys[i0]} to $${(e86.at(-1) / 1000).toFixed(2)}bn in ${im.fys.at(-1)}. ` +
    `Phone and electronics assembly lines are filed under a general code (8479) and can't be split out. ` +
    `Not capital goods and left out: phones, chips, laptops, engines and appliances, ${share(im.not_capital)}% of 84-85 in ${im.fys.at(-1)}. <a href="${im.source}">Source</a>.`;

  // ---------- credit and capacity (manual downloads)
  if (inv.credit.status === "ok") noData(document.getElementById("credit-panel"), "Bank credit", "files received; parsing to be added");
  else noData(document.getElementById("credit-panel"), "RBI Sectoral Deployment of Bank Credit",
    "RBI's file server blocks automated downloads, so these files are added by hand. Until then credit growth is not used in the screen.");
  if (inv.obicus.status === "ok") noData(document.getElementById("obicus-panel"), "Capacity utilisation", "files received; parsing to be added");
  else noData(document.getElementById("obicus-panel"), "RBI OBICUS capacity utilisation",
    "Same RBI file server. When added, the line will show the share of capacity in use, with about 75% marked as a common reference level (not a rule).");

  // ---------- PLI tracker
  const sch = inv.pli.schemes;
  const withC = sch.filter((s) => s.committed != null);
  document.getElementById("pli-lede").innerHTML =
    `Investment reported by firms under each Production Linked Incentive scheme, to ${period(inv.pli.as_of)}. ` +
    `An official committed or target figure is published for only ${withC.length} of ${sch.length} schemes (${withC.map((s) => esc(s.scheme.split(" (")[0])).join(", ")}), ` +
    `so actual versus committed can be compared only for those.`;
  document.getElementById("pli-legend").innerHTML =
    `<span class="key"><span class="sw box" style="background:${C.accent}"></span>Actual investment</span>` +
    `<span class="key"><span class="sw box" style="background:none;border:2px solid ${C.ink}"></span>Committed / target (where published)</span>`;
  const pel = document.getElementById("pli-chart");
  const ptip = tooltip(document.getElementById("pli-tip"), pel.parentElement);
  function drawPli() {
    pel.innerHTML = "";
    const W = pel.clientWidth, narrow = W < 600;
    if (W < 200) return;
    const rowH = narrow ? 40 : 28, lab = narrow ? 0 : 250, mg = { t: 6, r: 90, b: 24, l: 8 + lab };
    const H = mg.t + mg.b + rowH * sch.length;
    const x = d3.scaleLinear().domain([0, d3.max(sch, (s) => Math.max(s.actual, s.committed ?? 0))]).nice().range([mg.l, W - mg.r]);
    const svg = d3.select(pel).append("svg").attr("width", W).attr("height", H).attr("role", "img").attr("aria-label", "PLI investment by scheme, rupees crore");
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(narrow ? 3 : 6).tickFormat((v) => `₹${v / 1000}k cr`));
    sch.forEach((s, i) => {
      const y0 = mg.t + i * rowH;
      const barY = narrow ? y0 + 16 : y0 + 6, bh = narrow ? 14 : 14;
      svg.append("text").attr("class", "dot-label").attr("x", narrow ? mg.l : mg.l - 8).attr("y", narrow ? y0 + 11 : barY + 11).attr("text-anchor", narrow ? "start" : "end").text(s.scheme.length > 38 ? s.scheme.slice(0, 36) + "…" : s.scheme);
      svg.append("rect").attr("x", x(0)).attr("y", barY).attr("width", Math.max(1, x(s.actual) - x(0))).attr("height", bh).attr("rx", 2).attr("fill", C.accent);
      if (s.committed != null) svg.append("rect").attr("x", x(0)).attr("y", barY - 2).attr("width", x(s.committed) - x(0)).attr("height", bh + 4).attr("fill", "none").attr("stroke", C.ink).attr("stroke-width", 1.6);
      const note = s.committed != null ? `${Math.round((s.actual / s.committed) * 100)}% of target` : "no target published";
      const end = x(Math.max(s.actual, s.committed ?? 0));
      const inside = end + note.length * 7 + 6 > W;   // long bar: put the note inside it
      svg.append("text").attr("class", "dot-label").attr("x", inside ? end - 6 : end + 6).attr("y", barY + 11)
        .attr("text-anchor", inside ? "end" : "start").style("fill", inside ? C.paper : null).text(note);
      svg.append("rect").attr("x", 0).attr("y", y0).attr("width", W).attr("height", rowH).attr("fill", "transparent")
        .on("pointermove pointerdown", (ev) => {
          const [px, py] = rel(ev, pel.parentElement);
          ptip.show(`<b>${esc(s.scheme)}</b><div class="row"><span>Actual investment</span><span>${fmtCr(s.actual)}</span></div>` +
            (s.committed != null ? `<div class="row"><span>Committed / target</span><span>${fmtCr(s.committed)}</span></div>` : `<div class="dim">No official committed figure published</div>`) +
            (s.production != null ? `<div class="row"><span>Production / sales</span><span>${fmtCr(s.production)}</span></div>` : "") +
            (s.employment != null ? `<div class="row"><span>Jobs</span><span>${int(s.employment)}</span></div>` : "") +
            `<div class="dim">To ${esc(period(s.as_of))}; ${esc(s.source)} (${esc(s.source_date)}), ${esc(s.page ?? "")}</div>`, px, py);
        })
        .on("pointerleave", () => ptip.hide());
    });
  }
  drawPli();
  onResize(pel, drawPli);
  const cm = withC.map((s) => `${esc(s.scheme.split(" (")[0])}: ${esc(s.committed_note ?? "")}`).join("; ");
  document.getElementById("pli-caption").innerHTML =
    `Actual figures: <a href="${inv.pli.link}">${esc(inv.pli.source)}</a> (released ${esc(sch[0].source_date)}), cumulative to ${period(inv.pli.as_of)}; the 14 schemes add up to the report's total of ${fmtCr(inv.pli.total.investment)}. ` +
    `Committed / target: ${cm}. A target can be a minimum threshold rather than a full plan, so "% of target" above 100 does not mean the scheme is finished.`;
}
