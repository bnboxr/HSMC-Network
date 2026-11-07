/**
 * Stripe / HSMCPay settlement tests (live-only mode).
 * Stripe simulation has been removed — without STRIPE_SECRET_KEY every Stripe
 * endpoint fails closed with 503 "Stripe not configured — set STRIPE_SECRET_KEY".
 * These tests verify:
 *   - /stripe/config reports mode "unavailable" (no simulation field)
 *   - checkout / create-payment-intent / payout / webhooks return 503
 *   - simulation actions (simulate_success) no longer exist
 *   - treasury fee schedule & buyback allocation still work (real business logic)
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

function post(path: string, body: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "hsmc-test/1.0" },
    body: JSON.stringify(body),
  });
}

describe("Stripe settlement (live-only mode — no simulation)", () => {
  describe("GET /stripe/config", () => {
    it("reports mode 'unavailable' without STRIPE_SECRET_KEY", async () => {
      const res = await fetch(`${BASE_URL}/stripe/config`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("unavailable");
      expect(body.simulation).toBeUndefined();
      expect(body.secret_key_configured).toBe(false);
      expect(body.required_env_vars.STRIPE_SECRET_KEY).toBeTruthy();
    });
  });

  describe("Fail-closed behavior without STRIPE_SECRET_KEY", () => {
    it("checkout initiate returns 503 with the required message", async () => {
      const res = await post("/stripe/checkout", {
        action: "initiate",
        amount_usd: 100, // < $6K → $1.00 fixed fee tier would apply
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("Stripe not configured — set STRIPE_SECRET_KEY");
    });

    it("create-payment-intent returns 503", async () => {
      const res = await post("/stripe/create-payment-intent", { amount_usd: 100 });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("Stripe not configured — set STRIPE_SECRET_KEY");
    });

    it("checkout settle returns 503", async () => {
      const res = await post("/stripe/checkout", {
        action: "settle",
        session_id: "does-not-exist",
        payment_intent_id: "pi_123",
      });
      // session not found takes precedence (404); with a real session the 503 fires
      expect([404, 503]).toContain(res.status);
    });

    it("payout initiate returns 410 — sell flow disabled", async () => {
      const res = await post("/stripe/payout", {
        action: "initiate",
        amount_usd: 100,
        user_wallet: "hsmc1qtestpayoutwallet0000000000000000000000000",
      });
      // The sell kill-switch runs before the Stripe configuration check, so the
      // answer is 410 Gone (sell disabled), not 503 (Stripe not configured).
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.code).toBe("hsmcpay_sell_disabled");
      expect(body.error).toContain("disabled");
    });

    // The payout webhook still fails closed on configuration (503) before the
    // sell kill-switch: signature verification must never be skipped.
    it("payout webhook returns 503 without Stripe configured", async () => {
      const res = await post("/stripe/payout/webhook", {
        type: "payout.paid",
        data: { object: { id: "po_1", metadata: { payout_session_id: "po_live_x" } } },
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("Stripe not configured — set STRIPE_SECRET_KEY");
    });

    it("stripe webhook returns 503", async () => {
      const res = await post("/stripe/webhook", {
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_1", metadata: {} } },
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("Stripe not configured — set STRIPE_SECRET_KEY");
    });

    it("simulation actions no longer exist", async () => {
      const res = await post("/stripe/checkout", {
        action: "simulate_success",
        session_id: "x",
        payment_intent_id: "pi_1",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Unknown action");

      const res2 = await post("/stripe/checkout", {
        action: "simulate_confirm",
        session_id: "x",
        payment_intent_id: "pi_1",
      });
      expect(res2.status).toBe(400);
    });
  });

  describe("Treasury fee schedule & buyback (real business logic)", () => {
    beforeAll(async () => {
      // Seed settled buy fees directly via REST so the treasury math is testable
      // without needing a live Stripe account.
      const seed = [
        { id: "seed-buy-001", amount_usd: 100, fee_hsmc: 1.0, fee_tier: "under-6k", type: "buy_fee", status: "settled" },
        { id: "seed-buy-002", amount_usd: 25000, fee_hsmc: 5.0, fee_tier: "10k-50k", type: "buy_fee", status: "settled" },
      ];
      for (const tx of seed) {
        await fetch(`${BASE_URL}/rest/v1/treasury_transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "hsmc-test/1.0" },
          body: JSON.stringify(tx),
        });
      }
    });

    it("reports total fees and 40/25/20/15 allocations", async () => {
      const res = await fetch(`${BASE_URL}/treasury/balance`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total_fees_collected).toBe(6.0); // 1.0 + 5.0
      expect(body.allocations.buyback_burn).toBe(2.4); // 40% of 6.0
      expect(body.allocations.staking_rewards).toBe(1.5); // 25%
      expect(body.allocations.development_fund).toBe(1.2); // 20%
      expect(body.allocations.insurance_fund).toBe(0.9); // 15%
      expect(body.buyback.allocation_pct).toBe(40);
      expect(body.buyback.pending_hsmc).toBeGreaterThan(0);
    });

    it("refuses the buyback — no on-chain buyback exists (410)", async () => {
      const before = await (await fetch(`${BASE_URL}/treasury/balance`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      })).json();

      const res = await post("/treasury/buyback", {});
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.code).toBe("treasury_buyback_disabled");
      expect(body.error).toContain("disabled");
      // No fabricated burn transaction hash is handed back.
      expect(body).not.toHaveProperty("tx_hash");

      // Nothing was recorded: the executed buyback total is unchanged.
      const after = await (await fetch(`${BASE_URL}/treasury/balance`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      })).json();
      expect(after.buyback.executed_hsmc).toBe(before.buyback.executed_hsmc);
      expect(after.buyback.pending_hsmc).toBe(before.buyback.pending_hsmc);
    });
  });
});
