import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 }, // maplibre-gl alone is ~1 MB
  worker: { format: "es" }, // MapLibre starts its worker as an ES module
});
