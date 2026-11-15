// Copy the pipeline's small output files into public/ so Vite serves and bundles them.
import { copyFileSync, mkdirSync } from "node:fs";

const files = ["districts.geojson", "india_outline.geojson", "monthly.json"];
const out = new URL("../public/data/", import.meta.url);
mkdirSync(out, { recursive: true });
for (const f of files) copyFileSync(new URL(`../../data/${f}`, import.meta.url), new URL(f, out));
console.log(`copied ${files.length} data files to public/data`);
