import { defineConfig } from "vite";

// Vite (https://vitejs.dev) replaces jspsych-builder:
//  - `pnpm dev`       -> dev server (http://localhost:5173)
//  - `pnpm build`     -> production bundle in `dist/`
//  - `pnpm preview`   -> serve the production build locally
// The output is a static site: host `dist/` anywhere (or bundle it into JATOS).
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
