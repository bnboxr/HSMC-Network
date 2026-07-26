/**
 * Global test setup for integration tests.
 * Starts the API server before all tests and stops it after.
 */

import { beforeAll, afterAll } from "bun:test";
import { startServer, stopServer } from "./helpers/api-server";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startServer();
  console.log(`[test-setup] API server ready at ${baseUrl}`);
}, 20000);

afterAll(async () => {
  await stopServer();
  console.log("[test-setup] API server stopped");
});

export { baseUrl };
