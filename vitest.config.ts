import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Tauri plugin packages not installed as JS deps yet (bundled via Cargo).
      // These stubs let Vite resolve the imports; vi.mock() replaces them in tests.
      "@tauri-apps/plugin-updater": path.resolve(
        __dirname,
        "src/test/stubs/tauri-plugin-updater.ts",
      ),
      "@tauri-apps/plugin-process": path.resolve(
        __dirname,
        "src/test/stubs/tauri-plugin-process.ts",
      ),
    },
  },
});
