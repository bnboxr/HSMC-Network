/**
 * Treasury endpoint tests.
 * Tests: GET /treasury/balance, GET /treasury/transactions
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer, getBaseUrl } from "../helpers/api-server";

let BASE_URL: string;

beforeAll(async () => {
  BASE_URL = await startServer();

  // Seed some treasury transactions for testing
  const txData = [
    {
      id: "test-tx-001",
      amount_usd: 100,
      fee_hsmc: 1.0,
      fee_tier: "under_6000",
      type: "buy_fee",
      status: "settled",
    },
    {
      id: "test-tx-002",
      amount_usd: 25000,
      fee_hsmc: 5.0,
      fee_tier: "10000_50000",
      type: "buy_fee",
      status: "settled",
    },
    {
      id: "test-tx-003",
      amount_usd: 0,
      fee_hsmc: 2.5,
      fee_tier: "n/a",
      type: "staking_reward",
      status: "settled",
    },
    {
      id: "test-tx-004",
      amount_usd: 0,
      fee_hsmc: 10.0,
      fee_tier: "n/a",
      type: "buyback",
      status: "pending",
    },
  ];

  for (const tx of txData) {
    await fetch(`${BASE_URL}/rest/v1/treasury_transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "hsmic-test/1.0",
      },
      body: JSON.stringify(tx),
    });
  }
}, 20000);

afterAll(async () => {
  await stopServer();
});

describe("Treasury API", () => {
  describe("GET /treasury/balance", () => {
    it("returns total fees and breakdown", async () => {
      const res = await fetch(`${BASE_URL}/treasury/balance`, {
        headers: { "User-Agent": "hsmic-test/1.0" },
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(typeof body.total_fees_collected).toBe("number");
      expect(body.total_fees_collected).toBeGreaterThanOrEqual(0);
      expect(body.breakdown).toBeTruthy();
      expect(typeof body.breakdown).toBe("object");
      expect(typeof body.transactions_count).toBe("number");
    });

    it("includes buy_fee in breakdown", async () => {
      const res = await fetch(`${BASE_URL}/treasury/balance`, {
        headers: { "User-Agent": "hsmic-test/1.0" },
      });

      const body = await res.json();
      expect(body.breakdown.buy_fee).toBe(6.0); // 1.0 + 5.0
    });

    it("includes staking_reward in breakdown", async () => {
      const res = await fetch(`${BASE_URL}/treasury/balance`, {
        headers: { "User-Agent": "hsmic-test/1.0" },
      });

      const body = await res.json();
      expect(body.breakdown.staking_reward).toBe(2.5);
    });

    it("only counts settled transactions", async () => {
      const res = await fetch(`${BASE_URL}/treasury/balance`, {
        headers: { "User-Agent": "hsmic-test/1.0" },
      });

      const body = await res.json();
      // buyback of 10.0 is pending - should NOT be in total
      expect(body.breakdown.buyback || 0).toBe(0);
      expect(body.transactions_count).toBe(3); // 3 settled tx
    });
  });

  describe("GET /treasury/transactions", () => {
    it("returns list of treasury transactions", async () => {
      const res = await fetch(`${BASE_URL}/treasury/transactions`, {
        headers: { "User-Agent": "hsmic-test/1.0" },
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(3);
    });

    it("filters transactions by type", async () => {
      const res = await fetch(
        `${BASE_URL}/treasury/transactions?type=buy_fee`,
        {
          headers: { "User-Agent": "hsmic-test/1.0" },
        }
      );

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.every((tx: any) => tx.type === "buy_fee")).toBe(true);
    });

    it("respects limit and offset", async () => {
      const res = await fetch(
        `${BASE_URL}/treasury/transactions?limit=1&offset=0`,
        {
          headers: { "User-Agent": "hsmic-test/1.0" },
        }
      );

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.length).toBeLessThanOrEqual(1);
    });

    it("rejects invalid type filter", async () => {
      const res = await fetch(
        `${BASE_URL}/treasury/transactions?type=invalid_type`,
        {
          headers: { "User-Agent": "hsmic-test/1.0" },
        }
      );

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("Invalid type filter");
    });
  });

  describe("Treasury via REST API", () => {
    it("can query treasury_transactions table directly", async () => {
      const res = await fetch(
        `${BASE_URL}/rest/v1/treasury_transactions?select=*&status=eq.settled`,
        {
          headers: { "User-Agent": "hsmic-test/1.0" },
        }
      );

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.every((tx: any) => tx.status === "settled")).toBe(true);
    });
  });
});
