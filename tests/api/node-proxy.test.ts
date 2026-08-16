/**
 * /node-proxy route integration tests.
 *
 * The browser cannot reach the Rust node (port 8080) directly — the frontend
 * (privacy-utils.ts / node-tx.ts) POSTs { path, method, data } to /node-proxy
 * and expects the envelope { ok, node_online, data }.
 *
 * These tests verify the proxy plumbing:
 *   - whitelisted node paths forward (or return the graceful offline envelope)
 *   - unknown / un-whitelisted paths are rejected with 400
 *   - malformed bodies are rejected with 400
 *   - the route is NOT reachable via GET
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer } from "../helpers/api-server";

let BASE_URL: string;
beforeAll(async () => {
  BASE_URL = await startServer();
}, 20000);
afterAll(async () => {
  await stopServer();
});

async function postNodeProxy(body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}/node-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "hsmic-test/1.0" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "parse-error" }));
  return { status: res.status, data };
}

describe("POST /node-proxy", () => {
  it("forwards a whitelisted path or returns the graceful offline envelope", async () => {
    const { status, data } = await postNodeProxy({ path: "/health", method: "GET" });
    // Route itself must always answer 200 (offline is a graceful envelope, not a 5xx).
    expect(status).toBe(200);
    // Envelope shape is what privacy-utils.ts:595-615 / node-tx.ts reads.
    expect(data).toHaveProperty("ok");
    expect(data).toHaveProperty("node_online");
    if (data.ok === true) {
      expect(data.node_online).toBe(true);
      expect(data).toHaveProperty("data");
    } else {
      expect(data.node_online).toBe(false);
      expect(typeof data.error).toBe("string");
      expect(data.hint).toBeString();
    }
  });

  it("forwards a POST payload to a whitelisted crypto path", async () => {
    const { status, data } = await postNodeProxy({
      path: "/crypto/stealth/generate",
      method: "POST",
      data: { pubkey: "test" },
    });
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok");
  });

  it("rejects unknown paths with 400", async () => {
    const { status, data } = await postNodeProxy({
      path: "/admin/wipe",
      method: "POST",
      data: {},
    });
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed via /node-proxy");
  });

  it("rejects HTTP methods other than GET/POST with 400", async () => {
    const { status, data } = await postNodeProxy({
      path: "/health",
      method: "DELETE",
    });
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed");
  });

  it("rejects a body missing path/method with 400", async () => {
    const { status, data } = await postNodeProxy({ data: {} });
    expect(status).toBe(400);
    expect(data.error).toContain("path");
  });

  it("rejects invalid JSON with 400", async () => {
    const { status, data } = await postNodeProxy("not-json");
    expect(status).toBe(400);
    expect(data.error).toBe("Invalid JSON body");
  });

  it("is not reachable via GET (404, not in router)", async () => {
    const res = await fetch(`${BASE_URL}/node-proxy`, {
      headers: { "User-Agent": "hsmic-test/1.0" },
    });
    expect(res.status).toBe(404);
  });

  it("returns CORS headers", async () => {
    const res = await fetch(`${BASE_URL}/node-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "hsmic-test/1.0" },
      body: JSON.stringify({ path: "/health", method: "GET" }),
    });
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });
});
