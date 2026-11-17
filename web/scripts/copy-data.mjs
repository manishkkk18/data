// Copy the pipeline's small output files into public/data so Vite serves and bundles them.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const required = [
  "boundaries/districts_web.geojson",
  "boundaries/india_outline.geojson",
  "boundaries/india_outline_detail.geojson",
  "live/index.json",
  "fires_summary_recent.json",
  "meta.json",
];
const optional = ["wind_recent.json", "aq_delhi_recent.json", "upwind_recent.json"]; // missing when that source failed or has no key yet
const out = new URL("../public/data/", import.meta.url);
mkdirSync(out, { recursive: true });
rmSync(new URL("live/", out), { recursive: true, force: true }); // days that left the window
let n = 0;
for (const f of [...required, ...optional]) {
  const src = new URL(`../../data/${f}`, import.meta.url);
  if (!existsSync(src) && optional.includes(f)) continue;
  // Boundaries are flattened into data/; everything else keeps its folder.
  const dest = f.startsWith("boundaries/") ? f.split("/").pop() : f;
  if (dest.includes("/")) mkdirSync(new URL(dest.slice(0, dest.lastIndexOf("/") + 1), out), { recursive: true });
  copyFileSync(src, new URL(dest, out));
  n++;
}
// Live fires: one file per day, listed in live/index.json.
const liveSrc = new URL("../../data/live/", import.meta.url);
for (const f of existsSync(liveSrc) ? readdirSync(liveSrc).filter((x) => x.startsWith("fires_")) : []) {
  copyFileSync(new URL(f, liveSrc), new URL(`live/${f}`, out));
  n++;
}
// Burning seasons: the index and one fires file per season, copied as a folder.
const seasonsSrc = new URL("../../data/seasons/", import.meta.url);
const seasons = existsSync(seasonsSrc) ? readdirSync(seasonsSrc).filter((f) => f.endsWith(".json")) : [];
if (seasons.length) {
  mkdirSync(new URL("seasons/", out), { recursive: true });
  for (const f of seasons) copyFileSync(new URL(f, seasonsSrc), new URL(`seasons/${f}`, out));
  n += seasons.length;
}
// The app reads this to know which optional files exist, instead of fetching and failing.
const present = optional.filter((f) => existsSync(new URL(`../../data/${f}`, import.meta.url)));
if (seasons.includes("index.json")) present.push("seasons/index.json");
writeFileSync(new URL("manifest.json", out), JSON.stringify({ files: present }));
console.log(`copied ${n} data files to public/data (optional: ${present.join(", ") || "none"})`);
