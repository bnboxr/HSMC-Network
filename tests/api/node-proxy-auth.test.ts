/**
 * /node-proxy auth gating in production mode (security review G6).
 *
 * In dev mode (no operator HSMC_API_KEY) /node-proxy is reachable anonymously —
 * that is unchanged, existing behaviour. In production mode (NODE_ENV=production
 * + operator-provided HSMC_API_KEY) /node-proxy must NOT be reachable without
 * x-api-key. This is enforced by removing /node-proxy from PUBLIC_PATHS so the
 * generic auth gate (checkApiKey) covers it, exactly like every other
 * non-public route.
 *
 * This file spawns its OWN prod-mode server (tests/helpers/api-server-prod.ts)
 * on a separate port so it can run alongside the dev-mode server used by the
 * other tests.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startProdServer,
  stopProdServer,
  getProdBaseUrl,
  PROD_API_KEY,
} from "../helpers/api-server-prod";

let BASE_URL: string;
beforeAll(async () => {
  BASE_URL = await startProdServer();
}, 20000);
afterAll(async () => {
  await stopProdServer();
});

async function postNodeProxy(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${url}/node-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "hsmic-test/1.0", ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "parse-error" }));
  return { status: res.status, data };
}

describe("POST /node-proxy in production mode (NODE_ENV=production + HSMC_API_KEY)", () => {
  it("rejects anonymous requests without x-api-key with 401", async () => {
    const { status, data } = await postNodeProxy(BASE_URL, { path: "/health", method: "GET" });
    expect(status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("rejects requests with a wrong x-api-key with 401", async () => {
    const { status } = await postNodeProxy(
      BASE_URL,
      { path: "/health", method: "GET" },
      { "x-api-key": "wrong-key-wrong-key-wrong-key-0000" },
    );
    expect(status).toBe(401);
  });

  it("accepts a whitelisted request with a valid x-api-key", async () => {
    const { status, data } = await postNodeProxy(
      BASE_URL,
      { path: "/health", method: "GET" },
      { "x-api-key": PROD_API_KEY },
    );
    expect(status).toBe(200);
    // Envelope shape identical to dev mode: { ok, node_online, data }.
    expect(data).toHaveProperty("ok");
    expect(data).toHaveProperty("node_online");
  });

  it("still rejects non-whitelisted paths even with a valid x-api-key", async () => {
    const { status, data } = await postNodeProxy(
      BASE_URL,
      { path: "/shielded/withdraw", method: "POST", data: { amount: 1 } },
      { "x-api-key": PROD_API_KEY },
    );
    expect(status).toBe(400);
    expect(data.error).toContain("not allowed via /node-proxy");
  });

  it("keeps /health public (no auth) in production", async () => {
    const res = await fetch(`${BASE_URL}/health`, {
      headers: { "User-Agent": "hsmic-test/1.0" },
    });
    expect(res.status).toBe(200);
  });
});
