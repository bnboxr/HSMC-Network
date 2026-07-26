# HSMC — Token Details

> **For:** Exchange listing applications (MEXC, Gate.io, KuCoin, etc.)  
> **Date:** 2026-07-26  
> **Version:** 1.0  

---

## Token Summary

| Field | Value |
|-------|-------|
| **Token Name** | HSMC |
| **Token Symbol** | HSMC |
| **Blockchain** | HSMC Native Layer 1 |
| **Chain ID** | `hsmc-mainnet-1` |
| **Token Type** | Native coin (gas + staking + governance) |
| **Decimals** | 8 |
| **Smallest Unit** | 1 satoshi = 0.00000001 HSMC = 10 nHSMC (nano-HSMC) |

---

## Supply

| Metric | Value |
|--------|-------|
| **Maximum Supply** | 500,000,000 HSMC (fixed, hard-cap) |
| **Circulating Supply at Genesis** | 0 HSMC |
| **Premine / Pre-allocation** | 0 HSMC (ZERO — fair launch) |
| **Initial Block Reward** | 50 HSMC per block |
| **Halving Schedule** | Every 210,000 blocks (≈ 16 months at 120s block time) |
| **Block Time Target** | 120 seconds |

---

## Supply Emission Schedule

| Period | Blocks | Block Reward | New Supply | Cumulative Supply |
|--------|--------|-------------|------------|-------------------|
| Era 1 | 0 – 209,999 | 50.00 HSMC | 10,500,000 | 10,500,000 |
| Era 2 | 210,000 – 419,999 | 25.00 HSMC | 5,250,000 | 15,750,000 |
| Era 3 | 420,000 – 629,999 | 12.50 HSMC | 2,625,000 | 18,375,000 |
| Era 4 | 630,000 – 839,999 | 6.25 HSMC | 1,312,500 | 19,687,500 |
| Era 5 | 840,000 – 1,049,999 | 3.125 HSMC | 656,250 | 20,343,750 |
| ... | ... | Halving continues | ... | → 500,000,000 max |

> Supply asymptotically approaches 500,000,000 HSMC over approximately 33 halving eras (~44 years from genesis).

---

## Token Allocation (Post-Genesis)

| Category | % of Supply | Amount | Vesting | Notes |
|----------|------------|--------|---------|-------|
| **Mining Rewards** | ~80% | ~400M HSMC | Emitted over time | PoW block rewards |
| **Team & Advisors** | 10% | 50M HSMC | 4-year linear vesting, 1-year cliff | Multi-sig controlled |
| **Treasury / Ecosystem Fund** | 5% | 25M HSMC | Governance-controlled | Grants, liquidity, buyback & burn |
| **Community & Airdrops** | 3% | 15M HSMC | Distributed in phases | Early miners, testnet participants, community |
| **Staking Rewards Reserve** | 2% | 10M HSMC | Emitted as staking APY | First 4 years of staking |

> **Note:** All non-mining allocations are emitted **post-genesis** via on-chain governance-approved distributions. There is zero premine at block 0.

---

## Token Utility

### 1. Gas & Transaction Fees
HSMC is used to pay all transaction fees on the network. Fee model is EIP-1559 style with dynamic base fee + optional priority tip. Privacy-enhanced transactions (RingCT, stealth) have higher fee multipliers.

### 2. Staking
HSMC holders can stake tokens to earn rewards and participate in network security. Staking pools operate on-chain with slashing conditions for misbehavior.

### 3. Governance
1 HSMC = 1 vote. Token holders can create proposals, vote on protocol parameters, treasury allocations, and ecosystem grants.

### 4. Mining Rewards
Miners receive HSMC block rewards + transaction fees for securing the network via RandomX PoW.

### 5. HSMCPay Settlement
Merchants and users transact in HSMC through the HSMCPay payment processor with Stripe fiat integration.

### 6. Bridge Collateral
HSMC is locked as collateral in bridge contracts to mint wHSMC on external chains.

---

## Wrapped Token (wHSMC)

| Field | BSC | Ethereum | Polygon |
|-------|-----|----------|---------|
| **Contract Type** | BEP-20 | ERC-20 | ERC-20 |
| **Decimals** | 18 | 18 | 18 |
| **Bridge Model** | Lock-and-mint | Lock-and-mint | Lock-and-mint |
| **Fraud Proof Window** | 24 hours (720 blocks) | 24 hours | 24 hours |
| **Bridge Fee** | 0.1% | 0.1% | 0.1% |
| **Min Bridge Amount** | 10 HSMC | 10 HSMC | 10 HSMC |
| **Contract Address** | TBD | TBD | TBD |

---

## Smart Contract Addresses

> **Note:** Contract addresses will be populated at mainnet launch.

### HSMC Native (L1)
- **Native Coin:** No contract — HSMC is the native gas token
- **Genesis Block Hash:** TBD (computed at launch)

### BSC (wHSMC BEP-20)
- **Contract:** `0x...` (TBD)
- **BscScan:** `https://bscscan.com/token/0x...`

### Ethereum (wHSMC ERC-20)
- **Contract:** `0x...` (TBD)
- **Etherscan:** `https://etherscan.io/token/0x...`

### Polygon (wHSMC ERC-20)
- **Contract:** `0x...` (TBD)
- **Polygonscan:** `https://polygonscan.com/token/0x...`

---

## Deflationary Mechanisms

1. **EIP-1559 Fee Burn** — A percentage of base fees are burned, reducing circulating supply
2. **Treasury Buyback & Burn** — 40% of HSMCPay treasury fees allocated to periodic market buybacks and burns
3. **Staking Slashing** — Malicious validators have staked tokens burned

---

## Compliance Notes

- HSMC is a utility token for the HSMC Network. It is not an investment contract.
- No ICO, IEO, or token sale was conducted.
- Tokens are earned through mining (PoW) or purchased on secondary markets.
- Team tokens are subject to 4-year vesting with 1-year cliff.
- A legal opinion from a crypto-specialized law firm is available upon request.
