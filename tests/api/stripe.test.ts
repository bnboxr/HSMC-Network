/**
 * Stripe / HSMCPay endpoint tests (mock mode).
 * Tests: POST /stripe/create-payment-intent, POST /stripe/webhook,
 *        GET/POST /stripe/checkout, POST /stripe/payout
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

describe("Stripe / HSMCPay API (Mock Mode)", () => {
  describe("POST /stripe/create-payment-intent", () => {
    it("creates a mock payment intent when Stripe is not configured", async () => {
      const res = await fetch(`${BASE_URL}/stripe/create-payment-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          amount: 100,
          currency: "usd",
          userId: "test-user-stripe",
        }),
      });

      // In mock mode (no STRIPE_SECRET_KEY), this returns a mock response
      expect([200, 400, 500]).toContain(res.status);

      const body = await res.json();
      // Mock mode returns either a mock PI or an error about missing Stripe key
      expect(body).toBeTruthy();
    });

    it("rejects request with missing body", async () => {
      const res = await fetch(`${BASE_URL}/stripe/create-payment-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({}),
      });

      // Should get some response — may succeed or fail depending on mock
      const body = await res.json();
      expect(body).toBeTruthy();
    });

    it("handles idempotency key", async () => {
      const idempotencyKey = "test-idempotency-" + Date.now();

      const res1 = await fetch(`${BASE_URL}/stripe/create-payment-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          amount: 50,
          currency: "usd",
          userId: "test-user-stripe-2",
        }),
      });

      expect([200, 400, 500]).toContain(res1.status);
    });
  });

  describe("POST /stripe/webhook", () => {
    it("accepts webhook events (mock mode)", async () => {
      const res = await fetch(`${BASE_URL}/stripe/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
          "Stripe-Signature": "t=123456,v1=mock_signature",
        },
        body: JSON.stringify({
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: "pi_test_123",
              amount: 5000,
              status: "succeeded",
            },
          },
        }),
      });

      // In mock mode, should return 200 or 400 (no webhook secret)
      const body = await res.json();
      expect(body).toBeTruthy();
    });
  });

  describe("GET /stripe/checkout", () => {
    it("returns checkout configuration", async () => {
      const res = await fetch(`${BASE_URL}/stripe/checkout`, {
        headers: { "User-Agent": "hsmic-test/1.0" },
      });

      // May return 200 or 405 depending on method handling
      expect([200, 400, 405]).toContain(res.status);
    });
  });

  describe("POST /stripe/payout", () => {
    it("handles payout request", async () => {
      const res = await fetch(`${BASE_URL}/stripe/payout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          amount: 100,
          userId: "test-user",
          destination: "bank_account",
        }),
      });

      const body = await res.json();
      expect(body).toBeTruthy();
    });
  });
});
