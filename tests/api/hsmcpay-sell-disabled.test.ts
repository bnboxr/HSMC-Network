/**
 * HSMCPay containment tests — SELL flow OFF, no fabricated on-chain hashes.
 *
 * Owner decision 2026-11-07: the sell (payout) flow is switched off until the
 * on-chain HSMC deposit is actually verified and a real payout rail to the user
 * exists. These tests pin that behaviour down:
 *   - POST /stripe/payout { action: "initiate" | "settle" } → 410 Gone,
 *     with no Stripe call, no payout session and no balance change
 *   - POST /treasury/buyback → 410 Gone, nothing written
 *   - no buy-path response carries a `tx_hash`-shaped random value, and the
 *     server source no longer fabricates `"0x" + randomUUID()` references
 *
 * Run with: bun test tests/api/hsmcpay-sell-disabled.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startServer, stopServer, getBaseUrl } from "../helpers/api-server";

let BASE_URL: string;

const REST = (path: string) => `${BASE_URL}${path}`;

function post(path: string, body: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "hsmc-test/1.0" },
    body: JSON.stringify(body),
  });
}

function get(path: string) {
  return fetch(`${BASE_URL}${path}`, {
    headers: { "User-Agent": "hsmc-test/1.0" },
  });
}

/** The shape of a fabricated hash: `0x` + 32 hex chars (randomUUID minus dashes). */
const FABRICATED_HASH = /0x[0-9a-f]{32}/i;

/** Collect every string in a JSON value (deep) so we can scan for fake hashes. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) allStrings(v, out);
  }
  return out;
}

let authToken = "";
let userId = "";
let walletAddress = "";

function authed(path: string, init: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "hsmc-test/1.0",
      Authorization: `Bearer ${authToken}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

beforeAll(async () => {
  BASE_URL = await startServer();

  // A real user + a real wallet row with a real balance, so we can prove the
  // sell path touches neither the wallet nor the payment session table while
  // the flow is disabled.
  const reg = await post("/auth/register", {
    email: `sell-disabled-${Date.now()}@hsmc.network`,
    password: "testPassword123!",
  });
  expect(reg.status).toBe(201);
  const regBody = await reg.json();
  authToken = String(regBody.token);
  userId = String(regBody.user.id);
  walletAddress = `hsmc1q${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}sell`;

  const seed = await authed("/rest/v1/wallets", {
    method: "POST",
    body: JSON.stringify({
      id: "wallet-sell-disabled-001",
      user_id: userId,
      address: walletAddress,
      balance: 500,
      staked_balance: 0,
      is_primary: 1,
      label: "sell-disabled test wallet",
    }),
  });
  expect([200, 201]).toContain(seed.status);
}, 30000);

afterAll(async () => {
  await stopServer();
});

describe("POST /stripe/payout — sell flow disabled", () => {
  it("initiate returns 410 Gone and creates no payout session", async () => {
    const res = await post("/stripe/payout", {
      action: "initiate",
      amount_usd: 100,
      user_wallet: walletAddress,
    });

    expect(res.status).toBe(410);
    const body = await res.json();

    expect(body.code).toBe("hsmcpay_sell_disabled");
    expect(body.status).toBe("sell_disabled");
    // The message says why, honestly.
    expect(body.error).toContain("deposit");
    expect(body.error).toContain("payout rail");
    // No session was created and no deposit address was handed out.
    expect(body).not.toHaveProperty("payout_session_id");
    expect(body).not.toHaveProperty("deposit_address");

    // No payout session id of the `po_live_…` shape is returned anywhere, i.e.
    // the request was refused before any session row was created.
    for (const value of allStrings(body)) {
      expect(value).not.toMatch(/po_live_[0-9a-f]{24}/i);
    }
  });

  it("settle returns 410 Gone even with a well-formed tx_hash", async () => {
    const res = await post("/stripe/payout", {
      action: "settle",
      payout_session_id: "po_live_does_not_matter",
      tx_hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    });

    expect(res.status).toBe(410);
    const body = await res.json();

    expect(body.code).toBe("hsmcpay_sell_disabled");
    // Nothing that looks like a completed settlement is returned.
    expect(body).not.toHaveProperty("stripe_payout_id");
    expect(body).not.toHaveProperty("hsmc_burned");
    expect(body).not.toHaveProperty("tx_hash");
  });

  it("leaves the user's balance untouched", async () => {
    const rows = await (await authed(`/rest/v1/wallets?select=*`)).json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    expect(Number(rows[0].balance)).toBe(500);
  });
});

describe("POST /treasury/buyback — disabled while no on-chain buyback exists", () => {
  it("returns 410 Gone and writes nothing", async () => {
    const before = await (await get("/treasury/balance")).json();

    const res = await post("/treasury/buyback", {});
    expect(res.status).toBe(410);

    const body = await res.json();
    expect(body.code).toBe("treasury_buyback_disabled");
    expect(body.error).toContain("disabled");
    expect(body).not.toHaveProperty("tx_hash");
    expect(body).not.toHaveProperty("buyback_hsmc");

    const after = await (await get("/treasury/balance")).json();
    expect(after.buyback.executed_hsmc).toBe(before.buyback.executed_hsmc);
    expect(after.transactions_count).toBe(before.transactions_count);
  });
});

describe("no fabricated on-chain references", () => {
  it("buy path returns no tx_hash-shaped value", async () => {
    // Settling a session that does not exist must not invent a hash.
    const res = await post("/stripe/checkout", {
      action: "settle",
      session_id: "sess_does_not_exist",
      payment_intent_id: "pi_does_not_exist",
    });

    const body = await res.json();
    expect(body).not.toHaveProperty("tx_hash");
    for (const s of allStrings(body)) {
      expect(s).not.toMatch(FABRICATED_HASH);
    }
  });

  it("treasury ledger exposes no fabricated hash", async () => {
    const rows = await (await get("/treasury/transactions?limit=100")).json();
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows as Array<Record<string, unknown>>) {
      // A card purchase has no on-chain transaction, so tx_hash must stay empty.
      expect(row.tx_hash ?? null).toBeNull();
    }
  });

  it("server source no longer fabricates `\"0x\" + randomUUID()` references", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../server/api-server.ts"), "utf-8");

    // No hash is built out of a random UUID anywhere in the API server.
    expect(source).not.toMatch(/["'`]0x["'`]\s*\+\s*randomUUID/);
    expect(source).not.toMatch(/tx_hash:\s*["'`]0x/);
    // The buy settlement reports a real Stripe reference instead.
    expect(source).toMatch(/reference:\s*settled\.reference/);
    expect(source).toMatch(/const HSMCPAY_SELL_ENABLED = config\.hsmcpaySellEnabled;/);
  });
});
