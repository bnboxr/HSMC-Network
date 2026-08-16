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

/**
 * Read-only GET routes whitelisted for the native Android wallet v1
 * (security review G6): balance + transaction history + chain info.
 * Mirrors rust-node/hsmc-rpc/src/server.rs routes exactly.
 */
describe("POST /node-proxy — whitelisted read-only GET routes (mobile wallet v1)", () => {
  const READ_ONLY_PATHS: string[] = [
    "/health",
    "/info",
    "/stats",
    "/fee/estimate",
    "/utxo/0x0123456789abcdef0123456789abcdef01234567",
    "/address/0x0123456789abcdef0123456789abcdef01234567/txs",
    "/tx/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ];

  for (const path of READ_ONLY_PATHS) {
    it(`forwards or gracefully reports offline for GET ${path}`, async () => {
      const { status, data } = await postNodeProxy({ path, method: "GET" });
      // Route itself must always answer 200 (offline is a graceful envelope).
      expect(status).toBe(200);
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
  }

  it("accepts GET /address/:address/txs with pagination query params (node route shape)", async () => {
    const { status, data } = await postNodeProxy({
      path: "/address/0x0123456789abcdef0123456789abcdef01234567/txs?limit=25&offset=50",
      method: "GET",
    });
    // Whitelist must accept the node's real route shape (query string included);
    // offline still yields the graceful envelope, not a 400.
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok");
    expect(data).toHaveProperty("node_online");
    if (data.ok === true) {
      expect(data).toHaveProperty("data");
    }
  });

  it("forwards GET /tx/:hash (existing whitelist entry preserved)", async () => {
    const { status, data } = await postNodeProxy({
      path: "/tx/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      method: "GET",
    });
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok");
  });
});

/**
 * Method-checking: whitelist entries are method-exact. A GET-only route must
 * reject POST (and vice versa) with the existing 400 envelope.
 */
describe("POST /node-proxy — method enforcement", () => {
  it("rejects POST to a GET-only route (/info) with 400", async () => {
    const { status, data } = await postNodeProxy({ path: "/info", method: "POST", data: {} });
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed via /node-proxy");
  });

  it("rejects POST to a GET-only route (/stats) with 400", async () => {
    const { status, data } = await postNodeProxy({ path: "/stats", method: "POST", data: {} });
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed via /node-proxy");
  });

  it("rejects POST to a GET-only route (/fee/estimate) with 400", async () => {
    const { status, data } = await postNodeProxy({ path: "/fee/estimate", method: "POST", data: {} });
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed via /node-proxy");
  });

  it("rejects POST to /utxo/:address (GET-only) with 400", async () => {
    const { status, data } = await postNodeProxy({
      path: "/utxo/0x0123456789abcdef0123456789abcdef01234567",
      method: "POST",
      data: {},
    });
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed via /node-proxy");
  });

  it("rejects POST to /address/:address/txs (GET-only) with 400", async () => {
    const { status, data } = await postNodeProxy({
      path: "/address/0x0123456789abcdef0123456789abcdef01234567/txs",
      method: "POST",
      data: {},
    });
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed via /node-proxy");
  });

  it("rejects GET to a POST-only route (/crypto/ring-sign) with 400", async () => {
    const { status, data } = await postNodeProxy({ path: "/crypto/ring-sign", method: "GET" });
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed via /node-proxy");
  });

  it("rejects GET to a POST-only route (/crypto/stealth/generate) with 400", async () => {
    const { status, data } = await postNodeProxy({ path: "/crypto/stealth/generate", method: "GET" });
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed via /node-proxy");
  });

  // NOTE: GET /tx/submit is intentionally NOT in this list — the pre-existing
  // GET /tx/:hash regex legitimately matches it as a tx-hash lookup (hash
  // "submit"), which is harmless and read-only. The POST route /tx/submit is
  // what actually submits transactions, and POST is what the clients use.
});

/**
 * Non-whitelisted node routes must stay closed through /node-proxy
 * (security review G6 — never whitelist secret-accepting routes).
 */
describe("POST /node-proxy — non-whitelisted routes stay rejected", () => {
  const BLOCKED: Array<{ path: string; method: string; data?: unknown }> = [
    { path: "/shielded/withdraw", method: "POST", data: { amount: 1, proof: "x" } },
    { path: "/shielded/deposit", method: "POST", data: { amount: 1 } },
    { path: "/shielded/state", method: "GET" },
    { path: "/vm/execute", method: "POST", data: { code: "x" } },
    { path: "/vm/deploy", method: "POST", data: { code: "x" } },
    { path: "/rollup/commit", method: "POST", data: { batch: "x" } },
    { path: "/rollup/verify", method: "POST", data: { batch: "x" } },
    { path: "/stablecoin/create", method: "POST", data: { collateral: 1 } },
    { path: "/stablecoin/mint", method: "POST", data: { amount: 1 } },
    { path: "/staking/stake", method: "POST", data: { amount: 1 } },
    { path: "/bridge/lock", method: "POST", data: { amount: 1 } },
    { path: "/mining/submit", method: "POST", data: { block: "x" } },
    { path: "/admin/wipe", method: "GET" },
    { path: "/arbitrary/path", method: "GET" },
  ];

  for (const { path, method, data } of BLOCKED) {
    it(`rejects ${method} ${path} with 400`, async () => {
      const { status, data: body } = await postNodeProxy({ path, method, data });
      expect(status).toBe(400);
      expect(body.error).toContain("not allowed via /node-proxy");
    });
  }
});
