// Screenshots of the live site: the home page's project-card images (WebP) and the share
// previews for LinkedIn and others (1200×630 JPEG). Run by hand when a page's look changes;
// the images are committed.
//   cd apps/home && npm run capture
// Uses the Chrome or Edge already installed (puppeteer-core downloads no browser).
// Set CHROME_PATH if yours is somewhere else.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

// SITE can point at a local preview of the built site (e.g. before a new app is deployed).
const SITE = (process.env.SITE || "https://manishkkk18.github.io/data/india").replace(/\/$/, "");
const APPS = [
  { id: "night-lights", path: "night-lights/" },
  { id: "smoke-watch", path: "smoke-watch/" },
  // The Monsoon opens on a text hero: its card shows the district map section instead.
  { id: "monsoon", path: "monsoon/", anchor: "#map", settle: 3000 },
  // Manufacturing opens on its headline figures: the card and share image show that hero.
  { id: "manufacturing-insights", path: "manufacturing-insights/", settle: 3000 },
];
// Only some apps: ONLY=monsoon npm run capture (add "home" to ONLY to also redo home.jpg)
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("No Chrome found: set CHROME_PATH");

const dir = (rel) => {
  const p = fileURLToPath(new URL(rel, import.meta.url));
  mkdirSync(p, { recursive: true });
  return p;
};
const img = dir("../public/img/");
const og = dir("../public/og/");
const OG = { width: 1200, height: 630 };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
});
const shoot = async (url, viewport, settleMs, anchor) => {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
  if (anchor) await page.evaluate((sel) => { document.documentElement.style.scrollBehavior = "auto"; document.querySelector(sel)?.scrollIntoView(); }, anchor);
  await new Promise((r) => setTimeout(r, settleMs)); // let the opening fly-in finish and the map settle
  const png = await page.screenshot({ type: "png" });
  await page.close();
  return png;
};
try {
  for (const app of APPS.filter((a) => !ONLY || ONLY.includes(a.id))) {
    const png = await shoot(`${SITE}/${app.path}`, { width: 1440, height: 900, deviceScaleFactor: 1 }, app.settle ?? 12000, app.anchor);
    for (const w of [720, 1200]) {
      await sharp(png).resize({ width: w }).webp({ quality: 80, effort: 6 }).toFile(`${img}/${app.id}-${w}.webp`);
    }
    // Share preview: the top of the app (header, headline figures, map), cropped to 1200×630.
    await sharp(png).resize({ ...OG, fit: "cover", position: "top" }).jpeg({ quality: 85, mozjpeg: true }).toFile(`${og}/${app.id}.jpg`);
    console.log(`captured ${app.id}`);
  }
  // The home page itself, at the share size (rendered at 2× for sharp text, then scaled down).
  if (!ONLY || ONLY.includes("home")) {
    const home = await shoot(`${SITE}/`, { ...OG, deviceScaleFactor: 2 }, 1500);
    await sharp(home).resize(OG).jpeg({ quality: 85, mozjpeg: true }).toFile(`${og}/home.jpg`);
    console.log("captured home");
  }
} finally {
  await browser.close();
}
