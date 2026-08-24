/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base "./": dieselbe Ausgabe läuft unter moosburg.eu/abstimmung/ und auf
// GitHub Pages unter /council-voting-tool/, ohne zwei Builds zu pflegen.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
  },
});
