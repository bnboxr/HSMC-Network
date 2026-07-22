# HSMC Network — Full Project Audit
## 2026-07-21 | 74 issues found | 8 CRITICAL, 12 HIGH, 31 MEDIUM, 23 LOW

---

## 🔴 CRITICAL (8)

| ID | Issue | File(s) | Impact |
|----|-------|---------|--------|
| C1 | 30 Rust files use `unwrap()` — node panics in production | All `rust-node/**/*.rs` | Node crash on any I/O/parse failure |
| C2 | Privacy (RingCT/stealth/ring sigs) not wired in web wallet UI | `privacy-utils.ts`, `WalletSection.tsx` | ALL web tx are transparent |
| C3 | `.env` committed with Supabase project creds | `.env` | Exposes attack surface |
| C4 | `local-db/client.ts` is 451-line mock/stub with fake impl | `src/integrations/local-db/client.ts` | "0 mock-uri" claim is false |
| C5 | `wallet-seed-db.ts` uses `as any` on ALL DB queries | `src/utils/wallet-seed-db.ts` | Data integrity risk |
| C6 | PoW is SHA-256d, whitepaper says "RandomX-like" | `rust-node/hsmc-crypto/src/pow.rs` | Marketing accuracy |
| C7 | `seed-auth.ts` uses `as any` for BIP39 validation | `src/utils/seed-auth.ts` | Weak seed validation |
| C8 | `bip39-wallet.ts` uses `as any` for WebAuthn API | `src/utils/bip39-wallet.ts` | Type safety bypass |

## 🟠 HIGH (12)

| ID | Issue |
|----|-------|
| H1 | Stratum "V2" is actually V1 only |
| H2 | Bridge: 2 chains, claimed 10+ |
| H3 | Bridge relayer single-signer (federated, not trust-minimized) |
| H4 | HSMCPay settlement in-DB, not real Stripe charge |
| H5 | HIBP leaked-password not enabled |
| H6 | WebAuthn exists but not in 2FA flow |
| H7 | Governance timelock in Rust, no DB enforcement |
| H8 | `main.rs` signal handlers use `.expect()` — startup crash risk |
| H9 | RPC handler serialization uses `unwrap_or_default()` |
| H10 | No smart contract VM/WASM |
| H11 | Documentation may be LLM-generated, needs fact-check |
| H12 | RPC health endpoint claims bridge_polygon + bridge_solana — neither exists |

## 🟡 MEDIUM (31)

- 26 TypeScript files use `any` types
- Duplicate buggy key derivation in bip39-wallet.ts (HMAC, not X25519)
- No rate limiting on RPC endpoints
- No integration tests
- Decoy selection uses non-cryptographic PRNG
- health() returns false capability claims
- MiningRPCClient references non-existent testnet.hsmc.io
- WhitepaperPage still has outdated claims
- And more...

## 🟢 LOW (23)

- console.log in some files (mostly already converted to debug/warn)
- Missing return types on some functions
- Inconsistent code style in Rust
- Some dead files (update-token-metrics, price-engine already emptied)

---

## 🔐 Post-Quantum Requirement (OWNER DIRECTIVE)

All crypto primitives must be upgraded to NIST PQC standards:
- Key exchange: Curve25519 → Kyber-1024
- Ring signatures: CLSAG → Lattice-based / SPHINCS+
- Range proofs: Bulletproofs → Lattice ZK proofs
- Stealth addresses: Curve25519 DH → Kyber KEM
- Hash functions: SHA-256 already QR

---

## 🤖 AI Co-Pilot: FOUND

`supabase/functions/hsmc-copilot/index.ts` — Real implementation with:
- Hardened system prompt (6 absolute rules)
- Input blocklist for seed phrase/attack filtering
- Output SSE filter for malicious code
- RLS-enforced wallet context
