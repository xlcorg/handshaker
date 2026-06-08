import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;

// Bake the package.json version in so the corner badge has something to show even in a
// plain browser `pnpm dev` (no Tauri IPC). It mirrors Cargo.toml via `pnpm version:bump`.
const appVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
).version as string;

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  // Dev-only: pre-bundle Monaco eagerly at server start so Vite doesn't
  // "discover" these heavy deps mid-load and trigger a full-page reload
  // (the long white screen on a cold cache after install/branch-switch).
  // No effect on the production build.
  optimizeDeps: {
    include: ["monaco-editor", "@monaco-editor/react", "@monaco-editor/loader"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
