/**
 * Stripe / HSMCPay settlement cycle tests (simulation mode).
 * Exercises the FULL flow without Stripe keys:
 *   checkout → payment confirm → HSMC credit → treasury fee
 *   payout → HSMC burn → Stripe payout → payout.paid webhook
 *   treasury buyback calculation & execution
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

describe("Stripe settlement cycle (simulation mode)", () => {
  describe("GET /stripe/config", () => {
    it("returns simulation mode config without Stripe keys", async () => {
      const res = await fetch(`${BASE_URL}/stripe/config`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("simulation");
      expect(body.simulation).toBe(true);
      expect(body.required_env_vars.STRIPE_SECRET_KEY).toBeTruthy();
    });
  });

  describe("Checkout → payment → HSMC credit (buy flow)", () => {
    let sessionId = "";
    let paymentIntentId = "";

    it("initiates a simulated checkout", async () => {
      const res = await post("/stripe/checkout", {
        action: "initiate",
        amount_usd: 100, // < $6K → $1.00 fixed fee
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.simulation).toBe(true);
      expect(body.session_id).toBeTruthy();
      expect(body.payment_intent_id).toStartWith("pi_sim_");
      expect(body.amount_hsmc).toBeTruthy();
      sessionId = body.session_id;
      paymentIntentId = body.payment_intent_id;
    });

    it("rejects settle before the payment is confirmed", async () => {
      const res = await post("/stripe/checkout", {
        action: "settle",
        session_id: sessionId,
        payment_intent_id: paymentIntentId,
      });
      expect([402, 400]).toContain(res.status);
    });

    it("settles after simulated payment success and credits HSMC", async () => {
      const res = await post("/stripe/checkout", {
        action: "simulate_success",
        session_id: sessionId,
        payment_intent_id: paymentIntentId,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.tx_hash).toStartWith("0x");
      expect(Number(body.fee_hsmc)).toBeGreaterThan(0);
      expect(body.fee_tier).toBe("under-6k");
      expect(body.treasury_tx_id).toBeTruthy();
    });

    it("records the buy fee in treasury", async () => {
      const res = await fetch(`${BASE_URL}/treasury/transactions?type=buy_fee&limit=10`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as any[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].status).toBe("settled");
    });

    it("credits a wallet for the user", async () => {
      const res = await fetch(`${BASE_URL}/rest/v1/wallets?user_id=eq.local-user`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as any[];
      expect(rows.length).toBeGreaterThan(0);
      expect(Number(rows[0].balance)).toBeGreaterThan(0);
    });
  });

  describe("Payout → HSMC burn → Stripe payout (sell flow)", () => {
    const walletAddress = "hsmc1qtestpayoutwallet0000000000000000000000000";
    let payoutSessionId = "";
    let balanceBefore = 0;

    it("creates a funded wallet for the seller", async () => {
      const res = await fetch(`${BASE_URL}/rest/v1/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "hsmc-test/1.0" },
        body: JSON.stringify({
          id: "wal_payout_test",
          user_id: walletAddress,
          address: walletAddress,
          balance: 1000,
          staked_balance: 0,
          label: "Payout Test Wallet",
          is_primary: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      expect([200, 201]).toContain(res.status);
      balanceBefore = 1000;
    });

    it("initiates a payout with balance verification", async () => {
      const res = await post("/stripe/payout", {
        action: "initiate",
        amount_usd: 100,
        user_wallet: walletAddress,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.payout_session_id).toBeTruthy();
      expect(Number(body.amount_hsmc_required)).toBeGreaterThan(0);
      expect(body.deposit_address).toBeTruthy();
      payoutSessionId = body.payout_session_id;
    });

    it("rejects payout initiate with insufficient balance", async () => {
      const res = await post("/stripe/payout", {
        action: "initiate",
        amount_usd: 1000000, // needs >> 1000 HSMC
        user_wallet: walletAddress,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Insufficient HSMC balance");
    });

    it("settles the payout: burns HSMC and records the fee", async () => {
      const res = await post("/stripe/payout", {
        action: "settle",
        payout_session_id: payoutSessionId,
        tx_hash: "0x" + "ab".repeat(32),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stripe_payout_id).toStartWith("po_sim_");
      expect(Number(body.hsmc_burned)).toBeGreaterThan(0);
      expect(body.treasury_tx_id).toBeTruthy();

      // wallet balance reduced by the burned amount
      const wres = await fetch(`${BASE_URL}/rest/v1/wallets?address=eq.${walletAddress}`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      const rows = (await wres.json()) as any[];
      expect(Number(rows[0].balance)).toBeLessThan(balanceBefore);
    });

    it("records sell_fee in treasury", async () => {
      const res = await fetch(`${BASE_URL}/treasury/transactions?type=sell_fee&limit=10`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as any[];
      expect(rows.length).toBeGreaterThan(0);
    });

    it("confirms the payout via payout.paid webhook", async () => {
      const res = await post("/stripe/payout/webhook", {
        type: "payout.paid",
        data: { object: { id: "po_sim_1", metadata: { payout_session_id: payoutSessionId } } },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("completed");

      // session should now be completed
      const sres = await fetch(`${BASE_URL}/rest/v1/payment_sessions?session_id=eq.${payoutSessionId}`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      const rows = (await sres.json()) as any[];
      expect(rows[0].status).toBe("completed");
    });
  });

  describe("Treasury buyback", () => {
    it("reports allocation percentages and pending buyback", async () => {
      const res = await fetch(`${BASE_URL}/treasury/balance`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.allocations.buyback_burn).toBeGreaterThan(0);
      expect(body.buyback.allocation_pct).toBe(40);
      expect(typeof body.buyback.pending_hsmc).toBe("number");
    });

    it("executes the pending buyback", async () => {
      const res = await post("/treasury/buyback", {});
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Number(body.buyback_hsmc)).toBeGreaterThan(0);

      // after execution, pending drops to ~0
      const res2 = await fetch(`${BASE_URL}/treasury/balance`, {
        headers: { "User-Agent": "hsmc-test/1.0" },
      });
      const body2 = await res2.json();
      expect(body2.buyback.executed_hsmc).toBeGreaterThan(0);
    });
  });
});
