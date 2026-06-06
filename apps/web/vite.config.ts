import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@ai-music-companion/shared": path.resolve(
        currentDir,
        "../../packages/shared/src/index.ts"
      )
    }
  },
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(currentDir, "../..")]
    }
  }
});
