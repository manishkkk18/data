import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Production builds are served from GitHub Pages at
// https://manishkkk18.github.io/delhi-smoke-watch/, so asset URLs need that prefix.
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/delhi-smoke-watch/" : "/",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 }, // maplibre-gl alone is ~1 MB
  worker: { format: "es" }, // MapLibre starts its worker as an ES module
}));
