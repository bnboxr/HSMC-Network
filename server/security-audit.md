# 🔐 HSMC Network — Security Audit Report

**Date:** 2026-07-21
**Scope:** Full codebase
**Findings:** 24 total (9 Critical, 7 High, 5 Medium, 3 Low)

---

## 🔴 CRITICAL (9)

| ID | Finding | File | Impact |
|----|---------|------|--------|
| C1 | Cloud backup passphrase = SHA-256(public user ID) — zero entropy | wallet-backup.ts:15-19 | Can decrypt anyone's seed phrase |
| C2 | node-sync auth bypass when RUST_NODE_SECRET not set | node-sync/index.ts:28-36 | Can fabricate fake chain state |
| C3 | advanced-notifications: zero auth, full service_role access | advanced-notifications/index.ts:11-38 | Complete DB takeover |
| C4 | test-connection: unauthenticated SSRF + WebSocket | test-connection/index.ts:76-101 | Internal network scanning |
| C5 | Rust node CORS: allow_origin(Any) | server.rs:45-48 | CSRF on node RPC |
| C6 | wallet-signin: open account creation, no auth | wallet-signin/index.ts:25-81 | Unlimited fake accounts |
| C7 | Wallet password in sessionStorage | WalletSection.tsx:167 | XSS → seed decryption |
| C8 | Seed encrypted with empty password fallback | WalletSection.tsx:167 | No password = no protection |
| C9 | Password via prompt() dialog | WalletSection.tsx:171 | Extension interception |

## 🟠 HIGH (7)

| ID | Finding | Impact |
|----|---------|--------|
| H1 | node-proxy: read endpoints unauthenticated | UTXO/address leakage |
| H2 | pool-engine: race conditions on liquidity | Double-spend HSMC |
| H3 | local-db: passwordless auth in dev mode | If deployed to prod, complete auth bypass |
| H4 | HSMCPay: no Stripe idempotency key | Duplicate charges |
| H5 | apply-referral-bonus: read-modify-write race | Double bonus payout |
| H6 | blockchain-engine: unauthenticated endpoint | Metric pollution |
| H7 | internalTransfer: non-atomic multi-wallet | Permanent fund loss |

## 🟡 MEDIUM (5)

| ID | Finding |
|----|---------|
| M1 | Mining wallet address over plaintext ws:// |
| M2 | Export password minimum only 8 chars |
| M3 | scalarMultBase = SHA-256, not real ECC |
| M4 | No Content-Security-Policy headers |
| M5 | Error messages leak infrastructure details |

## 🟢 LOW (3)

| ID | Finding |
|----|---------|
| L1 | Predictable user IDs in local-db |
| L2 | .env not in .gitignore |
| L3 | No rate limiting on edge functions |
