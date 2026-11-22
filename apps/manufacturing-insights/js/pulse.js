// 1. The output pulse: monthly IIP for Manufacturing, Mining and Electricity, joined across the
// 2011-12 -> 2022-23 base change with MoSPI's official linking factors; or year-on-year growth.
import { C, ym, pct, segmented, tooltip, rel, onResize, track } from "./common.js";

const NAMES = { manufacturing: "Manufacturing", mining: "Mining", electricity: "Electricity" };
const EVENTS = [
  { d: "2014-09", t: "Make in India" },
  { d: "2016-11", t: "Demonetisation" },
  { d: "2017-07", t: "GST" },
  { d: "2020-04", t: "COVID lockdown" },
];
const CLAMP = [-40, 60];

export function pulse(iip) {
  const m = iip.monthly;
  const dates = m.dates.map((s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, 1));
  const el = document.getElementById("pulse");
  const tip = tooltip(document.getElementById("pulse-tip"), el.parentElement);
  const seriesSeg = document.getElementById("pulse-series");
  let view = "level", one = "manufacturing";

  segmented(document.getElementById("pulse-view"), "v", (v) => { view = v; seriesSeg.hidden = v !== "yoy"; draw(); track(`pulse-${v}`); });
  segmented(seriesSeg, "s", (s) => { one = s; draw(); });

  const linkIdx = m.dates.indexOf(m.link_month);
  const lf = m.link_factors;
  document.getElementById("pulse-caption").innerHTML =
    `Index, 2022-23 = 100. Months before ${ym(m.link_month)} are MoSPI's 2011-12 series divided by its official linking factors ` +
    `(Manufacturing ${lf.Manufacturing.toFixed(4)}, Mining ${lf.Mining.toFixed(4)}, Electricity ${lf.Electricity.toFixed(4)}); from ${ym(m.link_month)} the new 2022-23 series. ` +
    `The new Mining series adds minor minerals and Electricity adds gas supply, so those two lines are less comparable across the join than Manufacturing. ` +
    `Growth is MoSPI's own year-on-year rate for whichever series covers the month; bars beyond ${CLAMP[0]}% / +${CLAMP[1]}% (the 2020-21 lockdown and rebound) are cut off and labelled. ` +
    `Latest month: ${ym(m.dates.at(-1))} (quick estimate, revised next month). <a href="${m.link_source}">Linking factors: PIB, 1 June 2026</a>.`;

  function legend() {
    const L = document.getElementById("pulse-legend");
    if (view === "level") {
      L.innerHTML = Object.entries(NAMES).map(([k, n]) => `<span class="key"><span class="sw" style="background:${C.series[k]};height:${k === "manufacturing" ? 4 : 2}px"></span>${n}</span>`).join("");
    } else {
      L.innerHTML = `<span class="key"><span class="sw box" style="background:${C.div[5]}"></span>${NAMES[one]}: growth</span><span class="key"><span class="sw box" style="background:${C.div[1]}"></span>${NAMES[one]}: decline</span>`;
    }
  }

  function draw() {
    legend();
    el.innerHTML = "";
    const W = el.clientWidth, narrow = W < 600;
    const H = narrow ? 300 : 400;
    if (W < 200) return; // not laid out yet
    const mg = { t: 26, r: narrow ? 12 : 96, b: 28, l: 40 };
    const x = d3.scaleTime().domain(d3.extent(dates)).range([mg.l, W - mg.r]);
    const svg = d3.select(el).append("svg").attr("width", W).attr("height", H).attr("role", "img")
      .attr("aria-label", view === "level" ? "Monthly index of industrial production for manufacturing, mining and electricity, 2012 to 2026" : `Year-on-year growth of ${NAMES[one]} output by month`);

    let y;
    if (view === "level") {
      const all = Object.keys(NAMES).flatMap((k) => m.series[k].index).filter((v) => v != null);
      y = d3.scaleLinear().domain([Math.min(30, d3.min(all)), d3.max(all) * 1.04]).nice().range([H - mg.b, mg.t]);
    } else {
      y = d3.scaleLinear().domain(CLAMP).range([H - mg.b, mg.t]);
    }
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${mg.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(W - mg.l - mg.r)).tickFormat("")).call((g) => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => (view === "yoy" ? `${v > 0 ? "+" : ""}${v}%` : v)));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`)
      .call(d3.axisBottom(x).ticks(d3.timeYear.every(narrow ? 3 : 2)).tickFormat(d3.timeFormat("%Y")));

    // events and the series join
    const ev = svg.append("g").attr("class", "annot");
    EVENTS.filter((e) => !narrow || ["Make in India", "COVID lockdown"].includes(e.t)).forEach((e, i) => {
      const xi = x(new Date(Number(e.d.slice(0, 4)), Number(e.d.slice(5, 7)) - 1, 1));
      ev.append("line").attr("x1", xi).attr("x2", xi).attr("y1", mg.t - 4).attr("y2", H - mg.b);
      ev.append("text").attr("x", xi + 4).attr("y", mg.t + 8 + (i % 2) * 14).text(e.t);
    });
    const lx = x(dates[linkIdx]);
    const lk = svg.append("g").attr("class", "link-mark");
    lk.append("line").attr("x1", lx).attr("x2", lx).attr("y1", mg.t - 18).attr("y2", H - mg.b);
    lk.append("text").attr("x", lx - 4).attr("y", mg.t - 8).attr("text-anchor", "end").text(narrow ? "New series →" : "Series joined here · new 2022-23 series →");

    if (view === "level") {
      y.domain()[0] < 100 && svg.append("line").attr("class", "zero").attr("stroke-dasharray", "1 3").attr("x1", mg.l).attr("x2", W - mg.r).attr("y1", y(100)).attr("y2", y(100));
      const labels = [];
      for (const k of ["mining", "electricity", "manufacturing"]) {
        const v = m.series[k].index;
        const line = d3.line().defined((d) => d != null).x((_, i) => x(dates[i])).y((d) => y(d));
        svg.append("path").attr("d", line(v)).attr("fill", "none").attr("stroke", C.series[k])
          .attr("stroke-width", k === "manufacturing" ? 2.5 : 1.6).attr("stroke-linejoin", "round").attr("opacity", k === "manufacturing" ? 1 : 0.9);
        labels.push({ k, y: y(d3.mean(v.slice(-3))) + 4 });
      }
      if (!narrow) { // end labels, pushed apart so they never overlap
        labels.sort((a, b) => a.y - b.y).forEach((l, i, a) => { if (i && l.y - a[i - 1].y < 15) l.y = a[i - 1].y + 15; });
        labels.forEach((l) => svg.append("text").attr("class", "series-label").attr("x", W - mg.r + 6).attr("y", l.y).attr("fill", C.ink).text(NAMES[l.k]));
      }
    } else {
      const v = m.series[one].yoy;
      const bw = Math.max(1, (W - mg.l - mg.r) / dates.length - 1);
      svg.append("g").selectAll("rect").data(v).join("rect")
        .attr("x", (_, i) => x(dates[i]) - bw / 2).attr("width", bw)
        .attr("y", (d) => (d == null ? 0 : y(Math.min(CLAMP[1], Math.max(0, d)))))
        .attr("height", (d) => (d == null ? 0 : Math.abs(y(Math.max(CLAMP[0], Math.min(CLAMP[1], d))) - y(0))))
        .attr("fill", (d) => (d >= 0 ? C.div[5] : C.div[1]));
      svg.append("line").attr("class", "zero").attr("x1", mg.l).attr("x2", W - mg.r).attr("y1", y(0)).attr("y2", y(0));
      v.forEach((d, i) => {
        if (d == null || (d >= CLAMP[0] && d <= CLAMP[1])) return;
        svg.append("text").attr("class", "dot-label").attr("x", x(dates[i]) + (d > 0 ? 4 : -4)).attr("text-anchor", d > 0 ? "start" : "end")
          .attr("y", d > 0 ? mg.t + 22 + (i % 2) * 12 : H - mg.b - 6 - (i % 2) * 12).text(`${ym(m.dates[i])}: ${pct(d)}`);
      });
    }

    // crosshair
    const cross = svg.append("line").attr("stroke", C.ink).attr("stroke-width", 1).attr("y1", mg.t).attr("y2", H - mg.b).style("display", "none");
    const over = svg.append("rect").attr("x", mg.l).attr("y", 0).attr("width", W - mg.l - mg.r).attr("height", H).attr("fill", "transparent");
    const bis = d3.bisector((d) => d).center;
    const move = (ev) => {
      const [px, py] = rel(ev, el);
      const i = bis(dates, x.invert(px));
      cross.attr("x1", x(dates[i])).attr("x2", x(dates[i])).style("display", null);
      const series = m.dates[i] < m.link_month ? "2011-12 series, linked" : "2022-23 series";
      const rows = view === "level"
        ? Object.keys(NAMES).map((k) => `<div class="row"><span><i style="background:${C.series[k]}"></i>${NAMES[k]}</span><span>${m.series[k].index[i]?.toFixed(1) ?? "–"}</span></div>`).join("")
          + `<div class="row"><span>Mfg growth y/y</span><span>${pct(m.series.manufacturing.yoy[i])}</span></div>`
        : `<div class="row"><span>${NAMES[one]} y/y</span><span>${pct(m.series[one].yoy[i])}</span></div><div class="row"><span>Index</span><span>${m.series[one].index[i]?.toFixed(1)}</span></div>`;
      tip.show(`<b>${ym(m.dates[i])}</b>${rows}<div class="dim">${series}</div>`, x(dates[i]), Math.min(py, H - 60));
    };
    over.on("pointermove pointerdown", move).on("pointerleave", () => { cross.style("display", "none"); tip.hide(); });
  }

  draw();
  onResize(el, draw);
}
