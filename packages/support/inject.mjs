// For static pages without a build (The Monsoon): put the support card into a built copy of
// the page and copy the card's script and styles next to it.
//   node packages/support/inject.mjs <site-folder> <analytics prefix>
// The page needs <!--support:card--> where the card goes; the styles and script are linked here.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { supportCardHtml } from "./card.mjs";

const [dir, track] = process.argv.slice(2);
if (!dir) throw new Error("usage: node inject.mjs <site-folder> <analytics prefix>");
const page = join(dir, "index.html");
const html = readFileSync(page, "utf8");
if (!html.includes("<!--support:card-->")) throw new Error(`${page} has no <!--support:card--> marker`);
const card = await supportCardHtml({ track });
writeFileSync(
  page,
  html
    .replace("<!--support:card-->", card)
    .replace("</head>", card ? '  <link rel="stylesheet" href="support/support.css" />\n</head>' : "</head>")
    .replace("</body>", card ? '  <script type="module" src="support/client.js"></script>\n</body>' : "</body>"),
);
mkdirSync(join(dir, "support"), { recursive: true });
for (const f of ["client.js", "support.css"]) copyFileSync(new URL(f, import.meta.url), join(dir, "support", f));
console.log(`support card added to ${page}`);
