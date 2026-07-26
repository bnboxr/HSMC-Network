/**
 * API Server helper for integration tests.
 * Spawns the HSMC API server as a subprocess (bun) and waits for it to be ready.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const API_SERVER_PATH = resolve(PROJECT_ROOT, "server/api-server.ts");

// Use a unique port and DB for each test run
const TEST_PORT = parseInt(process.env.HSMC_TEST_PORT || "13337", 10);
const TEST_DB_PATH = process.env.HSMC_TEST_DB_PATH || "/tmp/hsmc-test.db";

let serverProcess: ChildProcess | null = null;
let baseUrl = `http://localhost:${TEST_PORT}`;

/**
 * Start the API server as a subprocess and wait until it's healthy.
 */
export async function startServer(): Promise<string> {
  if (serverProcess) {
    return baseUrl;
  }

  // Clean up any previous test DB
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(TEST_DB_PATH).catch(() => {});
    // Also remove WAL/SHM files
    await unlink(TEST_DB_PATH + "-wal").catch(() => {});
    await unlink(TEST_DB_PATH + "-shm").catch(() => {});
  } catch { /* ignore */ }

  return new Promise((resolvePromise, reject) => {
    const env = {
      ...process.env,
      HSMC_PORT: String(TEST_PORT),
      HSMC_DB_PATH: TEST_DB_PATH,
      JWT_SECRET: "test-jwt-secret-for-integration-tests",
      // Leave HSMC_API_KEY empty so IS_DEV_MODE = true
    };

    serverProcess = spawn("bun", ["run", API_SERVER_PATH], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        reject(new Error("API server failed to start within 15 seconds"));
      }
    }, 15000);

    serverProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      if (!started && output.includes("HSMC Local API server running")) {
        started = true;
        clearTimeout(timeout);
        // Give the server a brief moment to fully start
        setTimeout(() => resolvePromise(baseUrl), 500);
      }
    });

    serverProcess.stderr?.on("data", (data: Buffer) => {
      // Log stderr for debugging but don't fail — warnings are normal
      const msg = data.toString();
      if (!msg.includes("WARNING") && !msg.includes("⚠️")) {
        console.error("[api-server stderr]", msg);
      }
    });

    serverProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn API server: ${err.message}`));
    });

    serverProcess.on("exit", (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`API server exited early with code ${code}`));
      }
    });
  });
}

/**
 * Stop the API server subprocess.
 */
export async function stopServer(): Promise<void> {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    // Give it a moment to clean up
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // Force kill if still running
    if (serverProcess.exitCode === null) {
      serverProcess.kill("SIGKILL");
    }
    serverProcess = null;
  }

  // Clean up test DB files
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(TEST_DB_PATH).catch(() => {});
    await unlink(TEST_DB_PATH + "-wal").catch(() => {});
    await unlink(TEST_DB_PATH + "-shm").catch(() => {});
  } catch { /* ignore */ }
}

export function getBaseUrl(): string {
  return baseUrl;
}
