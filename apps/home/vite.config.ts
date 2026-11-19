import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { readFacts, type Fact } from "./scripts/facts";

// Served from GitHub Pages at https://manishkkk18.github.io/data/india/.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const theme = fileURLToPath(new URL("../../packages/theme", import.meta.url));
const apps = fileURLToPath(new URL("..", import.meta.url));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const factList = (fs: Fact[]) =>
  fs.map((f) => `<li><span class="fact-value">${esc(f.value)}</span> <span class="fact-label">${esc(f.label)}</span></li>`).join("\n          ");

/** Fills the project cards' facts from the apps' published data at build (and dev) time. */
function facts(): Plugin {
  return {
    name: "project-facts",
    transformIndexHtml(html) {
      const f = readFacts(apps, (m) => console.warn(m));
      return html
        .replace("<!--facts:nl-->", factList(f.nl))
        .replace("<!--facts:sw-->", factList(f.sw))
        .replace("<!--asof:nl-->", f.nlAsOf ? `Latest month: ${esc(f.nlAsOf)}` : "")
        .replace("<!--asof:sw-->", f.swAsOf ? `Figures as of ${esc(f.swAsOf)}` : "")
        .replace("<!--facts:mn-->", factList(f.mn))
        .replace("<!--asof:mn-->", f.mnAsOf ? esc(f.mnAsOf) : "");
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/data/india/" : "/",
  plugins: [facts()],
  resolve: { alias: { "@theme": theme } },
  server: { fs: { allow: [repoRoot] } },
}));
