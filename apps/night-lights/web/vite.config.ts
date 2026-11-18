import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Shared design tokens live in packages/theme at the repo root (imported as "@theme/…").
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const theme = fileURLToPath(new URL("../../../packages/theme", import.meta.url));

// Production builds are served from GitHub Pages at
// https://manishkkk18.github.io/data/india/night-lights/ (the India-from-data monorepo), so asset URLs need that prefix.
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/data/india/night-lights/" : "/",
  plugins: [react()],
  resolve: { alias: { "@theme": theme } },
  server: { fs: { allow: [repoRoot] } }, // dev server may read ../../../packages
  build: { chunkSizeWarningLimit: 1500 }, // maplibre-gl alone is ~1 MB
  worker: { format: "es" }, // MapLibre starts its worker as an ES module
}));
