// Copy the pipeline's small output files into public/ so Vite serves and bundles them.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const required = ["districts.geojson", "india_outline.geojson", "monthly.json"];
const optional = ["yearly.json"]; // appears once the annual (VNP46A4) run has been done
const out = new URL("../public/data/", import.meta.url);
mkdirSync(out, { recursive: true });
let n = 0;
for (const f of [...required, ...optional]) {
  const src = new URL(`../../data/${f}`, import.meta.url);
  if (!existsSync(src) && optional.includes(f)) continue;
  copyFileSync(src, new URL(f, out));
  n++;
}
console.log(`copied ${n} data files to public/data`);
