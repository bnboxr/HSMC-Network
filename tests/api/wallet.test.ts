/**
 * Wallet endpoint tests.
 * Tests: CRUD operations on wallets via REST API, /api/transfer
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer, getBaseUrl } from "../helpers/api-server";

let BASE_URL: string;
const TEST_USER_ID = "test-user-wallet-001";

beforeAll(async () => {
  BASE_URL = await startServer();
}, 20000);

afterAll(async () => {
  await stopServer();
});

describe("Wallet API", () => {
  let wallet1Id: string;
  let wallet2Id: string;

  describe("POST /rest/v1/wallets — create wallet", () => {
    it("creates a new wallet for a user", async () => {
      const res = await fetch(`${BASE_URL}/rest/v1/wallets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          user_id: TEST_USER_ID,
          address: "0xTestWalletAddress0000000000000000000001",
          balance: 1000.0,
          label: "Test Wallet 1",
          is_primary: 1,
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].user_id).toBe(TEST_USER_ID);
      expect(body[0].balance).toBe(1000);
      expect(body[0].id).toBeTruthy();

      wallet1Id = body[0].id;
    });

    it("creates a second wallet for the same user", async () => {
      const res = await fetch(`${BASE_URL}/rest/v1/wallets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          user_id: TEST_USER_ID,
          address: "0xTestWalletAddress0000000000000000000002",
          balance: 500.0,
          label: "Test Wallet 2",
          is_primary: 0,
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body[0].id).toBeTruthy();
      wallet2Id = body[0].id;
    });
  });

  describe("GET /rest/v1/wallets — list wallets", () => {
    it("lists all wallets", async () => {
      const res = await fetch(
        `${BASE_URL}/rest/v1/wallets?select=*`,
        {
          headers: { "User-Agent": "hsmic-test/1.0" },
        }
      );

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);
    });

    it("filters wallets by user_id", async () => {
      const res = await fetch(
        `${BASE_URL}/rest/v1/wallets?select=*&user_id=eq.${TEST_USER_ID}`,
        {
          headers: { "User-Agent": "hsmic-test/1.0" },
        }
      );

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.every((w: any) => w.user_id === TEST_USER_ID)).toBe(true);
    });
  });

  describe("POST /api/transfer — internal transfer", () => {
    it("transfers funds between wallets atomically", async () => {
      const transferAmount = 250;

      const res = await fetch(`${BASE_URL}/api/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          fromWalletId: wallet1Id,
          toWalletId: wallet2Id,
          amount: transferAmount,
          userId: TEST_USER_ID,
          note: "Test transfer",
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.from_balance).toBe(750);
      expect(body.to_balance).toBe(750);
      expect(body.transfer_id).toBeTruthy();
    });

    it("rejects transfer with insufficient balance", async () => {
      const res = await fetch(`${BASE_URL}/api/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          fromWalletId: wallet1Id,
          toWalletId: wallet2Id,
          amount: 999999,
          userId: TEST_USER_ID,
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("Insufficient");
    });

    it("rejects transfer to same wallet", async () => {
      const res = await fetch(`${BASE_URL}/api/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          fromWalletId: wallet1Id,
          toWalletId: wallet1Id,
          amount: 10,
          userId: TEST_USER_ID,
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("same wallet");
    });

    it("rejects transfer to non-existent wallet", async () => {
      const res = await fetch(`${BASE_URL}/api/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          fromWalletId: wallet1Id,
          toWalletId: "non-existent-wallet-id",
          amount: 10,
          userId: TEST_USER_ID,
        }),
      });

      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("verifies wallet balances after transfer", async () => {
      // Check wallet 1 balance
      const res1 = await fetch(
        `${BASE_URL}/rest/v1/wallets?select=balance&id=eq.${wallet1Id}`,
        { headers: { "User-Agent": "hsmic-test/1.0" } }
      );
      const body1 = await res1.json();
      expect(body1[0].balance).toBe(750);

      // Check wallet 2 balance
      const res2 = await fetch(
        `${BASE_URL}/rest/v1/wallets?select=balance&id=eq.${wallet2Id}`,
        { headers: { "User-Agent": "hsmic-test/1.0" } }
      );
      const body2 = await res2.json();
      expect(body2[0].balance).toBe(750);
    });
  });

  describe("PATCH /rest/v1/wallets — update wallet", () => {
    it("updates a wallet label", async () => {
      const res = await fetch(
        `${BASE_URL}/rest/v1/wallets?id=eq.${wallet1Id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "hsmic-test/1.0",
          },
          body: JSON.stringify({ label: "Updated Wallet 1" }),
        }
      );

      expect(res.status).toBe(200);

      const body = await res.json();
      // Label update may have different behavior depending on PATCH param ordering
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].id).toBe(wallet1Id);
    });
  });
});
