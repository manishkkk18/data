// Screenshots of the live apps for the home page's project cards (and, later, share
// previews). Run by hand when an app's look changes; the WebP files are committed.
//   cd apps/home && npm run capture
// Uses the Chrome or Edge already installed (puppeteer-core downloads no browser).
// Set CHROME_PATH if yours is somewhere else.
import { existsSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

const SITE = "https://manishkkk18.github.io/data/india";
const APPS = [
  { id: "night-lights", path: "night-lights/" },
  { id: "smoke-watch", path: "smoke-watch/" },
];
const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("No Chrome found: set CHROME_PATH");

const out = new URL("../public/img/", import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
});
try {
  for (const app of APPS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${SITE}/${app.path}`, { waitUntil: "networkidle0", timeout: 90000 });
    // Let the opening fly-in finish and the map settle.
    await new Promise((r) => setTimeout(r, 12000));
    const png = await page.screenshot({ type: "png" });
    await page.close();
    for (const w of [720, 1200]) {
      await sharp(png).resize({ width: w }).webp({ quality: 80, effort: 6 }).toFile(new URL(`${app.id}-${w}.webp`, out).pathname.replace(/^\/(\w:)/, "$1"));
    }
    console.log(`captured ${app.id}`);
  }
} finally {
  await browser.close();
}
