/**
 * Health check endpoint tests.
 * Tests: GET /health
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer, getBaseUrl } from "../helpers/api-server";

let BASE_URL: string;

beforeAll(async () => {
  BASE_URL = await startServer();
}, 20000);

afterAll(async () => {
  await stopServer();
});

describe("Health Check API", () => {
  it("GET /health returns status ok", async () => {
    const res = await fetch(`${BASE_URL}/health`, {
      headers: { "User-Agent": "hsmic-test/1.0" },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.tables).toBe("number");
    expect(body.tables).toBeGreaterThan(0);
    expect(body.auth_mode).toBe("dev");
  });

  it("GET / (root) also returns health", async () => {
    const res = await fetch(`${BASE_URL}/`, {
      headers: { "User-Agent": "hsmic-test/1.0" },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("GET /health returns CORS headers", async () => {
    const res = await fetch(`${BASE_URL}/health`, {
      headers: { "User-Agent": "hsmic-test/1.0" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("OPTIONS /health handles CORS preflight", async () => {
    const res = await fetch(`${BASE_URL}/health`, {
      method: "OPTIONS",
      headers: { "User-Agent": "hsmic-test/1.0" },
    });
    expect(res.status).toBe(204);
  });
});
