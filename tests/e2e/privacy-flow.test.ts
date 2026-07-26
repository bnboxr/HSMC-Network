/**
 * Privacy flow end-to-end tests.
 * Flow: send transparent → RingCT → stealth → verify privacy features
 *
 * These tests verify the privacy pipeline by creating transactions
 * with different privacy levels and checking the stored metadata.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer, getBaseUrl } from "../helpers/api-server";

let BASE_URL: string;
const USER_ID = "e2e-privacy-user";

beforeAll(async () => {
  BASE_URL = await startServer();

  // Register user
  await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "hsmic-test/1.0",
    },
    body: JSON.stringify({
      email: `e2e-privacy-${Date.now()}@hsmc.network`,
      password: "PrivacyTest123!",
    }),
  });

  // Create source wallet
  await fetch(`${BASE_URL}/rest/v1/wallets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "hsmic-test/1.0",
    },
    body: JSON.stringify({
      user_id: USER_ID,
      address: "0xPrivacyWallet0000000000000000000001",
      balance: 10000.0,
      label: "Privacy Source Wallet",
      is_primary: 1,
    }),
  });
}, 20000);

afterAll(async () => {
  await stopServer();
});

describe("E2E Privacy Flow", () => {
  const txIds: Record<string, string> = {};

  it("Step 1: Create a transparent transaction", async () => {
    const res = await fetch(`${BASE_URL}/rest/v1/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "hsmic-test/1.0",
      },
      body: JSON.stringify({
        hash: "0xTransparentTx00000000000000000000000001",
        from_address: "0xPrivacyWallet0000000000000000000001",
        to_address: "0xReceiver000000000000000000000000001",
        amount: 100.0,
        fee: 0.0001,
        status: "confirmed",
        privacy_level: "transparent",
      }),
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    txIds.transparent = body[0].id;
    expect(body[0].privacy_level).toBe("transparent");
    expect(body[0].ring_signature).toBeFalsy(); // No ring sig for transparent
    expect(body[0].stealth_address).toBeFalsy();
  });

  it("Step 2: Create a RingCT transaction", async () => {
    const res = await fetch(`${BASE_URL}/rest/v1/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "hsmic-test/1.0",
      },
      body: JSON.stringify({
        hash: "0xRingCTTx00000000000000000000000000001",
        from_address: "0xPrivacyWallet0000000000000000000001",
        to_address: "0xReceiver000000000000000000000000002",
        amount: 250.0,
        fee: 0.0002,
        status: "confirmed",
        privacy_level: "ringct",
        decoy_count: 11,
        ring_signature: "0xRingSig0000000000000000000000000001",
        commitment: "0xCommitment0000000000000000000000001",
        range_proof: "0xRangeProof0000000000000000000000001",
      }),
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    txIds.ringct = body[0].id;
    expect(body[0].privacy_level).toBe("ringct");
    expect(body[0].decoy_count).toBe(11);
    expect(body[0].ring_signature).toBeTruthy();
    expect(body[0].commitment).toBeTruthy();
    expect(body[0].range_proof).toBeTruthy();
  });

  it("Step 3: Create a stealth transaction", async () => {
    const res = await fetch(`${BASE_URL}/rest/v1/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "hsmic-test/1.0",
      },
      body: JSON.stringify({
        hash: "0xStealthTx00000000000000000000000000001",
        from_address: "0xPrivacyWallet0000000000000000000001",
        to_address: "0xStealthGenerated000000000000000000001",
        amount: 500.0,
        fee: 0.0003,
        status: "confirmed",
        privacy_level: "stealth",
        stealth_address: "0xStealthAddrGenerated00000000000000001",
        decoy_count: 16,
        ring_signature: "0xRingSigStealth0000000000000000000001",
        commitment: "0xCommitmentStealth0000000000000000001",
        range_proof: "0xRangeProofStealth0000000000000000001",
      }),
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    txIds.stealth = body[0].id;
    expect(body[0].privacy_level).toBe("stealth");
    expect(body[0].stealth_address).toBeTruthy();
    expect(body[0].decoy_count).toBe(16);
  });

  it("Step 4: Verify all transactions are retrievable", async () => {
    const res = await fetch(
      `${BASE_URL}/rest/v1/transactions?select=*&order=created_at.asc`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );

    expect(res.status).toBe(200);

    const body = await res.json();
    const ourTxs = body.filter(
      (tx: any) =>
        tx.id === txIds.transparent ||
        tx.id === txIds.ringct ||
        tx.id === txIds.stealth
    );

    expect(ourTxs.length).toBe(3);
  });

  it("Step 5: Verify privacy levels are correctly stored", async () => {
    // Get transparent tx
    const resT = await fetch(
      `${BASE_URL}/rest/v1/transactions?select=privacy_level,ring_signature,stealth_address,commitment,range_proof,decoy_count&id=eq.${txIds.transparent}`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const t = (await resT.json())[0];
    expect(t.privacy_level).toBe("transparent");
    expect(t.ring_signature).toBeFalsy();
    expect(t.stealth_address).toBeFalsy();

    // Get RingCT tx
    const resR = await fetch(
      `${BASE_URL}/rest/v1/transactions?select=privacy_level,ring_signature,stealth_address,commitment,range_proof,decoy_count&id=eq.${txIds.ringct}`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const r = (await resR.json())[0];
    expect(r.privacy_level).toBe("ringct");
    expect(r.ring_signature).toBeTruthy();
    expect(r.commitment).toBeTruthy();
    expect(r.range_proof).toBeTruthy();
    expect(r.decoy_count).toBe(11);
    // RingCT doesn't necessarily use stealth addresses
    expect(r.stealth_address).toBeFalsy();

    // Get stealth tx
    const resS = await fetch(
      `${BASE_URL}/rest/v1/transactions?select=privacy_level,ring_signature,stealth_address,commitment,range_proof,decoy_count&id=eq.${txIds.stealth}`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const s = (await resS.json())[0];
    expect(s.privacy_level).toBe("stealth");
    expect(s.stealth_address).toBeTruthy();
    expect(s.ring_signature).toBeTruthy();
    expect(s.decoy_count).toBe(16);
  });

  it("Step 6: Verify transaction filtering by privacy_level", async () => {
    // Filter only stealth transactions
    const res = await fetch(
      `${BASE_URL}/rest/v1/transactions?select=id,privacy_level&privacy_level=eq.stealth`,
      { headers: { "User-Agent": "hsmic-test/1.0" } }
    );
    const body = await res.json();
    expect(body.every((tx: any) => tx.privacy_level === "stealth")).toBe(true);
  });
});
