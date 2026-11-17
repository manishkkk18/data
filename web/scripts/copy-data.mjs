// Copy the pipeline's small output files into public/data so Vite serves and bundles them.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

const required = [
  "boundaries/districts_web.geojson",
  "boundaries/india_outline.geojson",
  "boundaries/india_outline_detail.geojson",
  "fires_recent.json",
  "fires_summary_recent.json",
  "meta.json",
];
const optional = ["wind_recent.json", "aq_delhi_recent.json", "upwind_recent.json"]; // missing when that source failed or has no key yet
const out = new URL("../public/data/", import.meta.url);
mkdirSync(out, { recursive: true });
let n = 0;
for (const f of [...required, ...optional]) {
  const src = new URL(`../../data/${f}`, import.meta.url);
  if (!existsSync(src) && optional.includes(f)) continue;
  copyFileSync(src, new URL(f.split("/").pop(), out));
  n++;
}
// The app reads this to know which optional files exist, instead of fetching and failing.
const present = optional.filter((f) => existsSync(new URL(`../../data/${f}`, import.meta.url)));
writeFileSync(new URL("manifest.json", out), JSON.stringify({ files: present }));
console.log(`copied ${n} data files to public/data (optional: ${present.join(", ") || "none"})`);
