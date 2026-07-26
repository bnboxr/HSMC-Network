# HSMC — Project Overview

> **For:** Exchange listing applications (MEXC, Gate.io, KuCoin, etc.)  
> **Date:** 2026-07-26  
> **Version:** 1.0  

---

## Executive Summary

**HSMC** is a privacy-first Layer 1 blockchain that combines Monero-grade confidentiality (RingCT, CLSAG ring signatures, stealth addresses) with cross-chain interoperability via wrapped tokens (wHSMC) on BSC, Ethereum, and Polygon. Built from scratch in Rust with a full-stack ecosystem — native web wallet, Stratum mining protocol, HSMCPay payment processor, on-chain governance, and staking — HSMC offers real transactional privacy without sacrificing DeFi composability.

---

## Problem

Most blockchain transactions are fully public. Bitcoin, Ethereum, and nearly all smart-contract platforms expose sender, receiver, and amount to global surveillance. Privacy coins like Monero offer strong confidentiality but remain isolated — no DeFi, no cross-chain bridges, limited exchange support. Users must choose between privacy and utility.

---

## Solution

HSMC delivers **Monero-grade privacy with cross-chain interoperability**:

| Feature | Description |
|---------|-------------|
| **RingCT** | Confidential transaction amounts via Pedersen commitments + Bulletproofs range proofs |
| **CLSAG Ring Signatures** | Untraceable sender anonymity with compact linkable spontaneous anonymous group signatures |
| **Stealth Addresses** | One-time destination addresses via dual-key ECDH — no address reuse |
| **Dandelion++** | Transaction propagation obfuscation at the network layer |
| **wHSMC** | Wrapped HSMC tokens on BSC, Ethereum, and Polygon for DeFi access |
| **HSMCPay** | Native payment processor with Stripe integration, fixed fees, fiat on/off ramp |
| **PoW (RandomX)** | ASIC-resistant CPU-friendly mining via RandomX algorithm |
| **On-Chain Governance** | Token-weighted proposal creation, voting, and execution |
| **Post-Quantum Ready** | Kyber-1024 and Dilithium-5 integration roadmap |

---

## Market Position

| | HSMC | Monero | Zcash | Dash |
|---|---|---|---|---|
| **Privacy Model** | RingCT + Stealth | RingCT + Stealth | zk-SNARKs | CoinJoin (opt-in) |
| **Cross-Chain** | ✅ Native bridge (3+ chains) | ❌ | ❌ | ❌ |
| **DeFi** | ✅ wHSMC + DEX | ❌ | ❌ | ❌ |
| **Payment Processor** | ✅ HSMCPay (Stripe) | ❌ | ❌ | ❌ |
| **On-Chain Governance** | ✅ | ❌ | ✅ (partially) | ✅ |
| **Staking** | ✅ | ❌ | ❌ | ❌ |
| **ASIC-Resistant PoW** | ✅ (RandomX) | ✅ (RandomX) | ❌ (ASIC-friendly) | ❌ |

---

## Team

HSMC is developed by a distributed team of blockchain engineers, cryptographers, and security researchers with deep expertise in privacy-preserving protocols and L1 blockchain infrastructure.

---

## Key Metrics

| Metric | Value |
|--------|-------|
| **Mainnet Launch** | TBD (pre-launch phase) |
| **Chain ID** | `hsmc-mainnet-1` |
| **Consensus** | Proof-of-Work (RandomX) |
| **Block Time** | 120 seconds |
| **Max Supply** | 500,000,000 HSMC |
| **Premine** | 0 (fair launch) |
| **Initial Reward** | 50 HSMC |
| **Halving** | Every 210,000 blocks |
| **Privacy Protocol** | RingCT v2 + CLSAG + Stealth Addresses |
| **Smart Contract VM** | Planned (WASM-based) |

---

## Links

| Resource | URL |
|----------|-----|
| Website | https://hsmc.network |
| GitHub | https://github.com/bnboxr/HSMC-Network |
| Whitepaper | https://hsmc.network/whitepaper |
| Explorer | https://hsmc.network/explorer |
| Documentation | https://hsmc.network/docs |

---

## Contact

For listing inquiries, please contact: **listings@hsmc.network**
