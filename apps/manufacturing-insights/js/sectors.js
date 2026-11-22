// 2. Sector small multiples: IIP by NIC 2-digit industry, each on one base year only (no splicing).
//   "Since 2013-14": the 2011-12 series, FY2013-14 -> latest full year, rebased to 2013-14 = 100.
//   "Since 2022-23": the new 2022-23 series (a newer item basket), FY2022-23 = 100 -> latest.
import { C, pct, esc, segmented, tooltip, rel, track } from "./common.js";

// Why the two baskets disagree, for the PLI focus industries.
const BASKET_NOTE = {
  "26": "The old 2011-12 basket under-counts smartphone and electronics assembly; the new basket captures it better.",
  "21": "Old basket fixed in 2011-12, so newer products may be under-counted; compare with the new basket.",
};

export function sectors(iip) {
  const fys = iip.annual.fys;
  const from = fys.indexOf(iip.sector_years[0]);
  const host = document.getElementById("multiples");
  const tip = tooltip(document.getElementById("multi-tip"), host.parentElement);
  const elec = iip.sectors.find((s) => s.nic === "26");
  let basket = "old";
  const newFys = ["2022-23", ...Object.keys(iip.annual.manufacturing_2022)];

  document.getElementById("basket-old").textContent = `Since ${iip.sector_years[0]}`;
  document.getElementById("basket-new").textContent = `Since 2022-23 (new basket)`;
  segmented(document.getElementById("basket"), "b", (b) => { basket = b; draw(); track(`sectors-${b}`); });

  const rankNew = [...iip.sectors].sort((a, b) => b.new.change_pct - a.new.change_pct);
  document.getElementById("sectors-lede").innerHTML =
    `Production indices for 23 manufacturing industries. Since ${iip.sector_years[0]}, manufacturing as a whole is up <b>${pct(iip.headline.mfg_change_pct)}</b> on the 2011-12 index. ` +
    `Pharmaceuticals doubled, but most of that jump came in 2015-16 to 2017-18, before the Production Linked Incentive (PLI) schemes began in 2020-21. ` +
    `Electronics shows only ${pct(elec.change_pct)} on the old index, whose item basket was fixed in 2011-12 and barely counts smartphones. ` +
    `On MoSPI's new basket it is up ${pct(elec.new.change_pct)} in three years, the ${ordinal(rankNew.indexOf(elec) + 1)} fastest of 23.`;
  document.getElementById("sectors-caption").innerHTML =
    `Each card shows both measures: the big number and line follow the selected view, and the line below gives the other one. They are never joined into one series, because MoSPI publishes no linking factor below the sector level. ` +
    `Old view: 2011-12 series, financial years ${fys[from]} to ${fys.at(-1)}, rebased so ${fys[from]} = 100. New view: 2022-23 series (2022-23 = 100) to ${newFys.at(-1)}. ` +
    `PLI tags show which industry group each scheme mostly falls in (a scheme can be a small part of its group).`;

  function draw() {
    const rows = [...iip.sectors].map((s) => {
      const vals = basket === "old" ? s.index.slice(from).map((v) => (v / s.index[from]) * 100) : s.new.index;
      const yrs = basket === "old" ? fys.slice(from) : newFys;
      return { s, vals, yrs, chg: basket === "old" ? s.change_pct : s.new.change_pct };
    }).sort((a, b) => b.chg - a.chg);
    const all = rows.flatMap((r) => r.vals);
    const lo = Math.min(...all), hi = Math.max(...all);
    host.innerHTML = rows.map((r, i) => {
      const lead = r.s.pli === "lead";
      return `<div class="mini${lead ? " lead" : ""}" data-i="${i}">
        <h3>${esc(r.s.name)}${r.s.pli ? `<span class="badge" title="${esc(r.s.pli_note)}">PLI</span>` : ""}</h3>
        <p class="chg${r.chg < 0 ? " neg" : ""}">${pct(r.chg, 0)}</p>
        <p class="sub">${r.yrs[0]} → ${r.yrs.at(-1)}</p>
        <p class="sub2">${basket === "old" ? `New basket, 2022-23 → ${newFys.at(-1)}: ${pct(r.s.new.change_pct, 0)}` : `Old series, ${fys[from]} → ${fys.at(-1)}: ${pct(r.s.change_pct, 0)}`}</p>
        <svg viewBox="0 0 140 46" width="100%" height="46" role="img" aria-label="${esc(r.s.name)}: ${pct(r.chg)} from ${r.yrs[0]} to ${r.yrs.at(-1)}"></svg>
        ${BASKET_NOTE[r.s.nic] ? `<p class="basket-note">${BASKET_NOTE[r.s.nic]}</p>` : ""}
      </div>`;
    }).join("");
    host.querySelectorAll(".mini").forEach((card) => {
      const r = rows[Number(card.dataset.i)];
      const svg = d3.select(card.querySelector("svg"));
      const x = d3.scaleLinear().domain([0, r.vals.length - 1]).range([3, 137]);
      const y = d3.scaleLinear().domain([lo, hi]).range([43, 3]);
      svg.append("line").attr("x1", 3).attr("x2", 137).attr("y1", y(100)).attr("y2", y(100)).attr("stroke", C.rule).attr("stroke-dasharray", "2 2");
      const col = r.s.pli === "lead" ? C.accent : C.ink2;
      svg.append("path").attr("d", d3.line().x((_, i) => x(i)).y((d) => y(d))(r.vals)).attr("fill", "none").attr("stroke", col).attr("stroke-width", 2).attr("stroke-linejoin", "round");
      svg.append("circle").attr("cx", x(r.vals.length - 1)).attr("cy", y(r.vals.at(-1))).attr("r", 3).attr("fill", col);
      const show = (ev) => {
        const b = card.getBoundingClientRect();
        const i = Math.max(0, Math.min(r.vals.length - 1, Math.round(((ev.clientX - b.left) / b.width) * (r.vals.length - 1))));
        const [px, py] = rel(ev, host.parentElement);
        tip.show(`<b>${esc(r.s.name)}</b><div class="row"><span>${r.yrs[i]}</span><span>${r.vals[i].toFixed(1)}</span></div>` +
          `<div class="dim">${basket === "old" ? `${r.yrs[0]} = 100 (2011-12 series)` : "2022-23 = 100 (new series)"}</div>` +
          (r.s.pli_note ? `<div class="dim">PLI: ${esc(r.s.pli_note)}</div>` : ""), px, py);
      };
      card.addEventListener("pointermove", show);
      card.addEventListener("pointerdown", show);
      card.addEventListener("pointerleave", () => tip.hide());
    });
  }
  draw();

  const t = document.getElementById("sectors-table");
  t.innerHTML = `<table><thead><tr><th>Industry (NIC)</th><th>${fys[from]}</th><th>${fys.at(-1)}</th><th>Change</th><th>A year</th><th>New basket ${newFys.at(-1)}</th><th>PLI</th></tr></thead><tbody>` +
    iip.sectors.map((s) => `<tr><td>${esc(s.name)} (${s.nic})</td><td>${s.from}</td><td>${s.to}</td><td>${pct(s.change_pct)}</td><td>${pct(s.cagr)}</td><td>${pct(s.new.change_pct)}</td><td>${s.pli ? esc(s.pli_note) : ""}</td></tr>`).join("") +
    `</tbody></table><p class="note">Old-series values are MoSPI's financial-year indices (2011-12 = 100).</p>`;
}

function ordinal(n) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
