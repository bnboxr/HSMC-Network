/**
 * Full end-to-end flow test.
 * Flow: create wallet → receive funds → send funds → verify balance
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer, getBaseUrl } from "../helpers/api-server";

let BASE_URL: string;
const USER_ID = "e2e-fullflow-user";

beforeAll(async () => {
  BASE_URL = await startServer();

  // Register a user for the flow
  await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "hsmic-test/1.0",
    },
    body: JSON.stringify({
      email: `e2e-fullflow-${Date.now()}@hsmc.network`,
      password: "E2ETestPass123!",
    }),
  });
}, 20000);

afterAll(async () => {
  await stopServer();
});

describe("E2E Full Flow", () => {
  let walletA: any;
  let walletB: any;
  let txId: string;

  it("Step 1: Create two wallets", async () => {
    // Create wallet A (primary, with initial balance)
    const resA = await fetch(`${BASE_URL}/rest/v1/wallets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "hsmic-test/1.0",
      },
      body: JSON.stringify({
        user_id: USER_ID,
        address: "0xE2EWalletA00000000000000000000000001",
        balance: 5000.0,
        label: "E2E Wallet A",
        is_primary: 1,
      }),
    });
    const bodyA = await resA.json();
    expect(resA.status).toBe(201);
    walletA = bodyA[0];
    expect(walletA.balance).toBe(5000);

    // Create wallet B (secondary, zero balance)
    const resB = await fetch(`${BASE_URL}/rest/v1/wallets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "hsmic-test/1.0",
      },
      body: JSON.stringify({
        user_id: USER_ID,
        address: "0xE2EWalletB00000000000000000000000002",
        balance: 0.0,
        label: "E2E Wallet B",
        is_primary: 0,
      }),
    });
    const bodyB = await resB.json();
    expect(resB.status).toBe(201);
    walletB = bodyB[0];
    expect(walletB.balance).toBe(0);
  });

  it("Step 2: Receive — verify Wallet A has initial balance", async () => {
    const res = await fetch(
      `${BASE_URL}/rest/v1/wallets?select=balance,address&id=eq.${walletA.id}`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const body = await res.json();
    expect(body[0].balance).toBe(5000);
    expect(body[0].address).toBe(walletA.address);
  });

  it("Step 3: Send — transfer from Wallet A to Wallet B", async () => {
    const sendAmount = 1234.56;

    const res = await fetch(`${BASE_URL}/api/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "hsmic-test/1.0",
      },
      body: JSON.stringify({
        fromWalletId: walletA.id,
        toWalletId: walletB.id,
        amount: sendAmount,
        userId: USER_ID,
        note: "E2E test transfer",
      }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.from_balance).toBe(3765.44); // 5000 - 1234.56
    expect(body.to_balance).toBe(1234.56);
    txId = body.transfer_id;
  });

  it("Step 4: Verify — confirm both wallet balances are correct", async () => {
    // Verify Wallet A
    const resA = await fetch(
      `${BASE_URL}/rest/v1/wallets?select=balance&id=eq.${walletA.id}`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const bodyA = await resA.json();
    expect(bodyA[0].balance).toBe(3765.44);

    // Verify Wallet B
    const resB = await fetch(
      `${BASE_URL}/rest/v1/wallets?select=balance&id=eq.${walletB.id}`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const bodyB = await resB.json();
    expect(bodyB[0].balance).toBe(1234.56);
  });

  it("Step 5: Verify transfer was recorded in internal_transfers", async () => {
    const res = await fetch(
      `${BASE_URL}/rest/v1/internal_transfers?select=*&id=eq.${txId}`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].amount).toBe(1234.56);
    expect(body[0].from_wallet_id).toBe(walletA.id);
    expect(body[0].to_wallet_id).toBe(walletB.id);
    expect(body[0].user_id).toBe(USER_ID);
    expect(body[0].note).toBe("E2E test transfer");
  });

  it("Step 6: Round-trip — transfer back from B to A", async () => {
    const res = await fetch(`${BASE_URL}/api/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "hsmic-test/1.0",
      },
      body: JSON.stringify({
        fromWalletId: walletB.id,
        toWalletId: walletA.id,
        amount: 234.56,
        userId: USER_ID,
        note: "E2E round-trip",
      }),
    });

    expect(res.status).toBe(200);

    // Verify final balances
    const resA = await fetch(
      `${BASE_URL}/rest/v1/wallets?select=balance&id=eq.${walletA.id}`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const bodyA = await resA.json();
    expect(bodyA[0].balance).toBe(4000.0); // 3765.44 + 234.56

    const resB = await fetch(
      `${BASE_URL}/rest/v1/wallets?select=balance&id=eq.${walletB.id}`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const bodyB = await resB.json();
    expect(bodyB[0].balance).toBe(1000.0); // 1234.56 - 234.56
  });
});
