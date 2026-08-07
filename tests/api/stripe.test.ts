/**
 * Stripe / HSMCPay endpoint tests without Stripe credentials.
 *
 * The integration environment must never enable a simulated payment path:
 * payment creation, payouts, and webhooks fail closed when Stripe is absent.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer } from "../helpers/api-server";

let BASE_URL: string;
const STRIPE_NOT_CONFIGURED = "Stripe not configured — set STRIPE_SECRET_KEY";

async function expectStripeUnavailable(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(`${BASE_URL}${path}`, init);
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({ error: STRIPE_NOT_CONFIGURED });
}

beforeAll(async () => {
  BASE_URL = await startServer();
}, 20000);

afterAll(async () => {
  await stopServer();
});

describe("Stripe / HSMCPay API (fail-closed without Stripe credentials)", () => {
  it("reports Stripe as unavailable without exposing a mock mode", async () => {
    const response = await fetch(`${BASE_URL}/stripe/config`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: "unavailable",
      secret_key_configured: false,
      webhook_secret_configured: false,
    });
  });

  it("rejects payment-intent creation instead of simulating a payment", async () => {
    await expectStripeUnavailable("/stripe/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount_usd: 100 }),
    });
  });

  it("rejects checkout initiation instead of simulating a payment", async () => {
    await expectStripeUnavailable("/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "initiate", amount_usd: 100 }),
    });
  });

  it("rejects payout initiation instead of simulating a payout", async () => {
    await expectStripeUnavailable("/stripe/payout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "initiate", amount_usd: 100, user_wallet: "hsmc_test_wallet_1234567890" }),
    });
  });

  it("rejects an unsigned webhook before it can be processed", async () => {
    await expectStripeUnavailable("/stripe/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "payment_intent.succeeded" }),
    });
  });
});
