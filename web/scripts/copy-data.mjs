// Copy the pipeline's small output files into public/ so Vite serves and bundles them.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

const required = ["districts.geojson", "india_outline.geojson", "india_outline_detail.geojson", "monthly.json"];
const optional = ["yearly.json", "crosscheck.json", "diwali.json", "diwali_districts.json", "corridors.json", "corridors.geojson", "corridor_segments.geojson"]; // appear once the annual run / cross-check have been done
const out = new URL("../public/data/", import.meta.url);
mkdirSync(out, { recursive: true });
let n = 0;
for (const f of [...required, ...optional]) {
  const src = new URL(`../../data/${f}`, import.meta.url);
  if (!existsSync(src) && optional.includes(f)) continue;
  copyFileSync(src, new URL(f, out));
  n++;
}
// The app reads this to know which optional files exist, instead of fetching and failing.
const present = optional.filter((f) => existsSync(new URL(`../../data/${f}`, import.meta.url)));
writeFileSync(new URL("manifest.json", out), JSON.stringify({ files: present }));
console.log(`copied ${n} data files to public/data (optional: ${present.join(", ") || "none"})`);
