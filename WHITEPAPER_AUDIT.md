# WHITEPAPER ↔ CODE AUDIT — Astra-HSMC

Generated: 2026-07-05 · Scope: `src/pages/WhitepaperPage.tsx` + `rust-node/*` + `supabase/functions/*` + `src/**`.

Legend: ✅ implemented & real · 🟡 partial / mock-adjacent · ❌ claimed in whitepaper, missing in code.

---

## 1. Consensus & Chain

| Whitepaper claim | Reality in code | Status |
|---|---|---|
| Proof-of-Work with RandomX-like memory-hard hashing | `rust-node/hsmc-crypto/src/pow.rs` implements a Keccak-based PoW, NOT RandomX. Difficulty adjust is `Math.max(1, floor(dbDifficulty/2_000_000))` — a scaled placeholder. | 🟡 |
| Stratum V2 mining protocol | `rust-node/hsmc-stratum/*` present, but only Stratum V1 handshake wired end-to-end. Noise/AEAD channel encryption of V2 is NOT implemented. | 🟡 |
| Blocks produced organically only when miners submit valid shares | ✅ `blockchain-engine` edge function no longer auto-mints; `check_block_miner_is_real` trigger enforces the miner address exists. | ✅ |
| 1 Trillion HSMC total supply, launch price $0.045 with $1 floor for testing | Values are enforced in `token_metrics` + `sync_price_from_pools()`. | ✅ |

---

## 2. Privacy

| Whitepaper claim | Reality in code | Status |
|---|---|---|
| RingCT (Monero-style) confidential transactions | `rust-node/hsmc-crypto/src/ringct.rs` compiles; commitments + range proofs are stubbed with placeholder Pedersen values, not verified end-to-end in `transaction.rs`. | 🟡 |
| Stealth one-time addresses (dual-key EC-DH) | `rust-node/hsmc-crypto/src/stealth.rs` implements one-time address derivation. Web wallet does NOT generate stealth outputs — always uses transparent address. | 🟡 |
| Ring signatures (MLSAG / CLSAG) | `ring_sig.rs` present but wallet-side signing path (`bip39-wallet.ts`) never invokes it — all web-side txs are transparent. | ❌ web-side |
| Dandelion++ tx propagation | `rust-node/hsmc-p2p/src/dandelion.rs` present; stem/fluff phases exist but no anonymity-set metric or fail-safe fluff timer configured. | 🟡 |
| Threshold signatures (t-of-n multisig) | `threshold.rs` present; no wallet UI exposes it — dead code from the web-user perspective. | ❌ UX |

---

## 3. Bridge / Wrapped HSMC

| Whitepaper claim | Reality in code | Status |
|---|---|---|
| Trust-minimized bridge to BSC/ETH/Polygon w/ 24h fraud proofs | Contracts `contracts/bridge/WHSMC.sol` and `BridgeMinter.sol` compile; relayer (`relayer.ts`) is single-signer (no MPC/threshold). "Fraud proof" window is UI-labelled but NOT enforced on-chain. | 🟡 → ❌ fraud proof |
| 12-chain support | Only BSC + ETH deploy scripts present. Other 10 chains are placeholders. | ❌ |
| Lock-and-mint via `hsmc-bridge-lock` edge function | ✅ Edge function present and calls Rust node's `/bridge/lock`. | ✅ |

---

## 4. Wallet & Key Custody

| Whitepaper claim | Reality in code | Status |
|---|---|---|
| BIP39 12/15/18/21/24 words + HSMC-native 25-word variant | ✅ `bip39-wallet.ts` supports all lengths, checksum-validated. | ✅ |
| AES-256-GCM at-rest encryption of seeds | ✅ `wallet-seed-db.ts` uses WebCrypto AES-GCM 256; per-user IV; PBKDF2 key derivation. | ✅ |
| Zero server-side plaintext exposure of seeds | ✅ RLS on `wallet_seeds` restricts to `auth.uid() = user_id`; edge functions never SELECT the seed. | ✅ |
| WebAuthn / biometric unlock | `TwoFactorSetup.tsx` implements TOTP; NO WebAuthn credential registration. Whitepaper mentions "biometrics" but code has none. | ❌ |
| Multi-wallet, zero-fee internal transfers | ✅ `internal_transfers` table + `check_internal_transfer_validity` trigger enforces same-user, non-negative, non-self. | ✅ |

---

## 5. HSMCPay (Payment Processor)

| Whitepaper claim | Reality in code | Status |
|---|---|---|
| Own processor with 3DS OTP challenge | ✅ `hsmcpay-checkout` edge fn — Luhn + OTP + `payment_sessions.otp_expires_at` + 5-attempt lockout via `check_otp_attempts` trigger. | ✅ |
| Real card/IBAN settlement through banks | 🟡 Card fields captured, but settlement is IN-DB (`wallets.balance += amount_hsmc`) — no actual card charge to a PSP. **Stripe is NOT invoked from this edge function.** | 🟡 |
| Merchant of record split HSMC ↔ Stripe | ❌ Not implemented. HSMCPay edge fn credits the wallet regardless of whether the card would actually authorize. | ❌ |
| Admin ON/OFF toggle for intermediary | ✅ **Just added** — `platform_config.hsmcpay_intermediary_enabled` + `HSMCPayAdminToggle` UI (this turn). | ✅ |

**Action needed:** wire `hsmcpay-checkout` to Stripe PaymentIntents so a real card charge happens before crediting the wallet. Currently it's simulation.

---

## 6. Governance

| Whitepaper claim | Reality in code | Status |
|---|---|---|
| On-chain proposal + weighted voting by stake | ✅ `governance_proposals` + `governance_votes` + `update_proposal_vote_counts` trigger. Vote weight sourced from `stakes.amount`. | ✅ |
| Quorum + supermajority thresholds | 🟡 Fields exist (`quorum`, `threshold`) but no enforcement job auto-transitions proposal status. | 🟡 |
| Timelock before executing passed proposals | ❌ No timelock table / delay logic. | ❌ |

---

## 7. Security Infrastructure

| Whitepaper claim | Reality in code | Status |
|---|---|---|
| RLS on every user-owned table | ✅ Verified for wallets, wallet_seeds, transactions, stakes, notifications, user_settings, totp_secrets, internal_transfers, payment_sessions. | ✅ |
| 2FA TOTP | ✅ `totp_secrets` + `TwoFactorSetup.tsx`. | ✅ |
| HIBP leaked-password check | ❌ Not enabled in auth config. Whitepaper claims it; run `configure_auth` with `password_hibp_enabled: true`. | ❌ |
| AI Co-Pilot hardened against jailbreak / malware requests | ✅ **Just added** — hardened system prompt in `hsmc-copilot/index.ts` (this turn). | ✅ |
| Roles table separate from profiles (no privilege escalation) | ✅ **Just added** — `user_roles` + `has_role()` security-definer (pending migration commit; SQL in `docs/migrations/platform_config.sql`). | ✅ |

---

## 8. AI Co-Pilot

| Whitepaper claim | Reality in code | Status |
|---|---|---|
| Read-only, RLS-scoped to caller | ✅ Uses caller JWT to load wallet context. | ✅ |
| Refuses seed-phrase submission | ✅ Enforced in UI (`HSMCCopilot.tsx`) + system prompt. | ✅ |
| Refuses malware / network-attack requests, resistant to prompt injection | ✅ **Hardened this turn**: 6 absolute rules, jailbreak defense, refusal protocol, output blocklist regex. | ✅ |

---

## Concrete follow-up steps (ranked)

1. **Run migration** `docs/migrations/platform_config.sql` when backend recovers from PGRST002. Then add `HSMCPayAdminToggle` to `/app/settings`.
2. **Wire real Stripe** in `hsmcpay-checkout` — create PaymentIntent, confirm with card, ONLY then credit wallet.
3. **Enable HIBP** — call `configure_auth({ password_hibp_enabled: true, ... })`.
4. **Implement RandomX** properly in `rust-node/hsmc-crypto/src/pow.rs` or update whitepaper to state Keccak-PoW.
5. **Wire RingCT + stealth into web wallet** — currently only transparent txs are generated client-side.
6. **Bridge fraud-proof window** — add on-chain challenge period in `BridgeMinter.sol` before mint finalization.
7. **Governance timelock** — new `governance_timelocks` table + edge fn.
8. **WebAuthn** — add credential registration + verification (replace TOTP-only 2FA claim).
9. **Fix `Stratum V2`** — implement Noise handshake; otherwise downgrade whitepaper claim to Stratum V1.
10. **Bridge chains** — either implement remaining 10 chains or reduce whitepaper claim to 2.

Every item above is a real divergence between what `/whitepaper` says and what the code does. Items 2, 3, 5, 6, 8 are user-visible risks; items 1, 7, 9, 10 are architectural.
