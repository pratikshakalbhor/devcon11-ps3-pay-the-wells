import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(uiRoot, "..");

export default defineConfig({
  root: uiRoot,
  plugins: [react()],
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    outDir: resolve(repoRoot, "dist-ui"),
    emptyOutDir: true,
  },
});
