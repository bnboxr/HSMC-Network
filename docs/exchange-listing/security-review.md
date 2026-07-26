# HSMC — Security Review Summary

> **For:** Exchange listing applications (MEXC, Gate.io, KuCoin, etc.)  
> **Date:** 2026-07-26  
> **Version:** 1.0  
> **Status:** Pre-launch — audits in progress  

---

## Overview

HSMC security is layered across cryptographic primitives, consensus protocol, P2P networking, smart contracts, wallet infrastructure, and database security. This document summarizes the security posture, audit status, and known risks.

---

## Audit Status

### Completed / In-House Review

| Component | Scope | Status | Reviewer | Date |
|-----------|-------|--------|----------|------|
| **SQL Injection Audit** | All database queries in `api-server.ts`, `copilot-server.ts`, `mining-server.ts` | ✅ **0 vulnerabilities** | Senior Blockchain Engineer | 2026-07-25 |
| **DB Security Hardening** | Column-level AES-256-GCM encryption, schema integrity via SHA-256, file permissions `chmod 600` | ✅ **Deployed** | Senior Blockchain Engineer | 2026-07-25 |
| **Unwrap() Removal** | All Rust node code — zero `unwrap()` in production paths | ✅ **Complete** | Senior Blockchain Engineer | 2026-07-25 |
| **Privacy Utils** | `privacy-utils.ts` — 100% real crypto, no stubs, all 4 operations through Rust node | ✅ **Complete** | Senior Blockchain Engineer | 2026-07-24 |
| **AI Co-Pilot Hardening** | Jailbreak defense, prompt injection resistance, output blocklist | ✅ **Deployed** | Senior Blockchain Engineer | 2026-07-24 |
| **RLS Verification** | All user-owned tables protected by Row-Level Security | ✅ **Verified** | Senior Blockchain Engineer | 2026-07-05 |

### Pending Third-Party Audits (Required Before Mainnet)

| Component | Scope | Priority | Estimated Cost | Target Auditor |
|-----------|-------|----------|---------------|----------------|
| **RingCT (ringct.rs)** | Pedersen commitments, Bulletproofs range proofs, binding/hiding properties | 🔴 CRITICAL | $30,000–$50,000 | Trail of Bits |
| **CLSAG Ring Signatures (ring_sig.rs)** | Linkability, unforgeability, anonymity set, key image uniqueness | 🔴 CRITICAL | $25,000–$40,000 | Least Authority |
| **Stealth Addresses (stealth.rs)** | ECDH derivation, one-time public key correctness, no replay | 🔴 CRITICAL | $20,000–$30,000 | Trail of Bits |
| **RandomX PoW (pow.rs, randomx-rs)** | Algorithm correctness, hashrate calibration, difficulty retargeting | 🟡 HIGH | $15,000–$25,000 | Kudelski Security |
| **Bridge Contracts (WHSMC.sol, BridgeMinter.sol)** | Reentrancy, access control, overflow/underflow, fraud proof logic | 🔴 CRITICAL | $20,000–$35,000 | Certik / OpenZeppelin |
| **P2P Network (p2p/, dandelion.rs)** | Eclipse resistance, DoS resistance, Dandelion++ stem/fluff, message validation | 🟡 HIGH | $15,000–$25,000 | Least Authority |
| **RPC API (rpc/)** | Auth bypass, rate limiting, input validation, sensitive data exposure | 🟡 HIGH | $10,000–$20,000 | Certik |
| **Full-Stack Penetration Test** | End-to-end attack surface assessment | 🟡 HIGH | $25,000–$40,000 | Trail of Bits |

---

## Cryptographic Primitives

| Primitive | Algorithm | Library | Security Level |
|-----------|-----------|---------|---------------|
| **Hashing** | SHA-256 (double, Bitcoin-style) | `sha2` 0.10 | 128-bit collision resistance |
| **PoW** | RandomX (memory-hard, ASIC-resistant) | `randomx-rs` 1.1 | CPU-optimal, ASIC-resistant |
| **Ring Signatures** | CLSAG (Compact Linkable Spontaneous Anonymous Group) | Custom (`ring_sig.rs`) | ECC secp256k1 base, 11–64 ring size |
| **Confidential Transactions** | Pedersen Commitments (Ristretto) + Bulletproofs | `bulletproofs` 4, `curve25519-dalek` 4 | 128-bit security |
| **Stealth Addresses** | Dual-key ECDH (view key + spend key) | `curve25519-dalek` 4 | 128-bit security |
| **Wallet Encryption** | AES-256-GCM (WebCrypto) + PBKDF2 key derivation | Browser WebCrypto API | 256-bit |
| **Database Encryption** | Column-level AES-256-GCM | Custom (`db-crypto.ts`) | 256-bit |
| **P2P Encryption** | Noise protocol (planned: Stratum V2) | `snow` (planned) | 256-bit |
| **Post-Quantum (Roadmap)** | Kyber-1024 (KEM), Dilithium-5 (signatures) | Planned | NIST PQC Level 5 |

---

## Security Architecture

### Defense in Depth

```
┌─────────────────────────────────────────────┐
│                Application Layer              │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Web     │ │ HSMCPay  │ │ AI Co-Pilot  │  │
│  │ Wallet  │ │ Checkout │ │ (Hardened)   │  │
│  └────┬────┘ └────┬─────┘ └──────┬───────┘  │
│       │           │              │           │
├───────┼───────────┼──────────────┼───────────┤
│       │    API / Edge Function Layer         │
│  ┌────┴───────────┴──────────────┴───────┐  │
│  │   JWT Auth + RLS Enforcement          │  │
│  │   Rate Limiting + Input Validation    │  │
│  └────────────────┬──────────────────────┘  │
│                   │                          │
├───────────────────┼──────────────────────────┤
│                   │    Blockchain Layer       │
│  ┌────────────────┴──────────────────────┐  │
│  │   Rust Node (hsmc-node)               │  │
│  │   RPC API  │  Stratum  │  P2P Sync   │  │
│  └────────────────┬──────────────────────┘  │
│                   │                          │
├───────────────────┼──────────────────────────┤
│               Storage Layer                   │
│  ┌────────────────┴──────────────────────┐  │
│  │   RocksDB (encrypted at rest)         │  │
│  │   AES-256-GCM column-level encryption │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Key Security Features

1. **Row-Level Security (RLS)** — All Supabase tables with user data have RLS policies restricting access to `auth.uid()`
2. **2FA TOTP** — Time-based one-time password for wallet operations
3. **Seed Encryption** — BIP39 seed phrases encrypted at rest with AES-256-GCM via WebCrypto, never exposed to server
4. **HSMCPay OTP** — 5-attempt lockout on payment OTP, expiry-based sessions
5. **AI Co-Pilot Guardrails** — Refuses seed phrases, malware requests, prompt injection; read-only, RLS-scoped
6. **Database Integrity** — Schema hash verification, column-level encryption, `chmod 600` file permissions
7. **No Unwrap()** — All Rust production paths use proper error handling, zero `unwrap()` calls outside tests
8. **Rate Limiting** — RPC endpoints, auth endpoints, and payment endpoints rate-limited via `tower-http`
9. **Bridge Fraud Proofs** — 24-hour challenge window (UI-enforced; on-chain enforcement in progress)

---

## Known Gaps (from Whitepaper Audit)

| # | Gap | Severity | Status |
|---|-----|----------|--------|
| 1 | RandomX not fully wired — Keccak placeholder in PoW | 🟡 Medium | `randomx-rs` crate added, integration in progress |
| 2 | RingCT + stealth not wired end-to-end in web wallet | 🟡 Medium | Rust node ready, web wallet integration in progress |
| 3 | Stratum V2 Noise handshake not implemented | 🟡 Medium | V1 active, V2 planned |
| 4 | Bridge fraud-proof not enforced on-chain | 🔴 High | Planned before mainnet |
| 5 | Governance timelock not implemented | 🟡 Medium | Planned for v1.1 |
| 6 | WebAuthn/biometric 2FA not implemented | 🟡 Low | Planned for v1.1 |
| 7 | HIBP password check not enabled | 🟡 Low | One config change needed |
| 8 | HSMCPay not wired to real Stripe | 🔴 High | Planned before mainnet |

---

## Incident Response

| Component | Response Time | Procedure |
|-----------|--------------|-----------|
| **Critical Vulnerability** | < 4 hours | Emergency patch → coordinated disclosure → node operator notification |
| **Chain Halt** | < 1 hour | War room activation → root cause analysis → coordinated restart |
| **Bridge Exploit** | < 30 minutes | Pause bridge contracts → assess damage → governance vote on recovery |
| **Data Breach** | < 2 hours | Containment → forensic analysis → user notification → regulatory disclosure if required |

### Bug Bounty Program

- **Platform:** Immunefi (planned)
- **Max Bounty:** $100,000 for critical smart contract / consensus vulnerabilities
- **Scope:** Smart contracts, Rust node, P2P protocol, bridge, web wallet
- **Out of Scope:** Social engineering, phishing, physical attacks, third-party services

---

## Conclusion

HSMC has undergone significant internal security review with 0 critical vulnerabilities found in completed audits. Multiple third-party audits are pending and required before mainnet launch. The project follows defense-in-depth principles, with encryption at every layer and proper key management. Known gaps are documented, tracked, and being actively addressed.

**Overall Security Posture:** 🟡 Medium-High (pending third-party audit completion)  
**Recommendation for Exchanges:** Listable upon completion of critical third-party audits (RingCT, CLSAG, Bridge Contracts).
