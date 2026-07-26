import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Frontend tests (jsdom)
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],

    // Integration tests (node) — separate project
    // Run with: bun run test:integration
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
