import { defineConfig } from "vitest/config";

/**
 * Vitest config for integration tests (API + E2E).
 * Uses Node environment (not jsdom) since we're testing the API server.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.{test,spec}.{ts,js}"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run tests sequentially to avoid port conflicts
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
