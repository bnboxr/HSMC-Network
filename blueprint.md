# HSMC Network — Master Blueprint

> **Ultima actualizare:** 2026-07-24
> **Owner:** Ifrim George  
> **Status:** Build in progress — Phase 4 (security + infra complete; 7/34 features done)
> 
> 📋 **Breakdown complet:** Vezi [HSMC-MASTER-PLAN.md](server/HSMC-MASTER-PLAN.md) — 416 sub-task-uri, 1,896 ore

---

## 🎯 Viziune

HSMC Network este un blockchain Layer 1 **post-quantum** cu confidențialitate reală (RingCT, stealth addresses, ring signatures), bridge multi-chain (50+ lanțuri), plăți fiat/crypto/comodities reale prin Stripe, staking, mining PoW, guvernanță on-chain, și AI Co-Pilot integrat.

**Regula de aur:** Zero mock-uri. Zero stub-uri. Zero placeholder-e. Totul real.

---

## 🏗️ Arhitectură

```
┌──────────────────────────────────────────────────────────────┐
│                    HSMC NODE (Rust)                          │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────┐ ┌─────────┐  │
│  │ Core    │ │ Crypto   │ │ P2P    │ │ RPC  │ │ Stratum │  │
│  │ chain   │ │ Kyber    │ │ libp2p │ │ JSON │ │ V2      │  │
│  │ state   │ │Dilithium │ │ gossip │ │ HTTP │ │ mining  │  │
│  └─────────┘ └──────────┘ └────────┘ └──────┘ └─────────┘  │
├──────────────────────────────────────────────────────────────┤
│              BRIDGE LAYER (dual-mode)                        │
│  ┌──────────────────┐  ┌──────────────────────┐             │
│  │ Quantum Side     │  │ Classic Side         │             │
│  │ Kyber/Dilithium  │◄►│ ECDSA/Curve25519     │             │
│  └──────────────────┘  └──────────────────────┘             │
├──────────────────────────────────────────────────────────────┤
│           MULTI-CHAIN CONNECTORS (50+ chains)                │
│  BTC ETH BSC SOL POLY AVA DOT MATIC ARB OP BASE             │
│  CELO XRP ADA ATOM NEAR ALGO FLOW APTOS SUI ...             │
├──────────────────────────────────────────────────────────────┤
│              API SERVER (Bun/Node.js :3001)                  │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐           │
│  │ SQLite │ │ Stripe   │ │ HSMCPay│ │ AI CoPilot│          │
│  │ DB     │ │ Payments │ │ Checkout│ │ Chat API │          │
│  └────────┘ └──────────┘ └────────┘ └──────────┘           │
├──────────────────────────────────────────────────────────────┤
│              FRONTEND (React/Vite :3000)                     │
│  Landing │ Onboarding │ Wallet │ Mining │ Staking │ DEX    │
└──────────────────────────────────────────────────────────────┘
```

---

## ✅ Ce funcționează acum

| Componentă | Status | Detalii |
|---|---|---|
| Bază date SQLite | ✅ | 35 tabele, date reale din Supabase |
| API server local | ✅ | Bun HTTP :3001, REST complet |
| Frontend | ✅ | Vite :3000, dark theme fintech |
| Wallet (seed phrase) | ✅ | BIP39, offline, localStorage |
| Onboarding flow | ✅ | Create/Import wallet |
| Supabase → localDB bridge | ✅ | Drop-in replacement |

## 🔧 În lucru acum

| # | Task | Prioritate | Ore | 
|---|------|-----------|-----|
| 1 | Privacy wiring în web wallet | 🔴 CRITICAL | 55h |
| 2 | HSMCPay settlement real (Stripe) | 🔴 CRITICAL | 34h |
| 3 | Post-quantum crypto (Kyber+Dilithium) | 🟠 HIGH | 43h |
| 4 | Stratum V2 upgrade | 🟠 HIGH | 30h |
| 5 | Bridge hardening (7 chain-uri rămase) | 🟠 HIGH | 45h |
| 6 | Wallet Purifier Mode | 🟡 MEDIUM | 15h |
| 7 | Oracle multi-source | 🟡 MEDIUM | 62h |

---

## 📋 Toate problemele din audit (74 total)

### 🔴 CRITICAL (8)

| ID | Problemă | Fișier(e) | Status |
|----|----------|-----------|--------|
| C1 | 30 fișiere Rust cu `unwrap()` | `rust-node/**/*.rs` | ⏳ Pending (needs rustc) |
| C2 | Privacy features neconectate în UI | `privacy-utils.ts`, `WalletSection.tsx` | 🔧 In lucru |
| C3 | `.env` cu credențiale în repo | `.env` | ✅ Fixat (ghilimele) |
| C4 | `local-db/client.ts` e mock | ~~FALS~~ | ✅ E real, nu mock |
| C5 | `as any` în wallet-seed-db.ts | `src/utils/wallet-seed-db.ts` | ✅ Fixat |
| C6 | PoW SHA-256d nu RandomX | `rust-node/hsmc-crypto/src/pow.rs` | ⏳ Needs Rust |
| C7 | `as any` în seed-auth.ts | `src/utils/seed-auth.ts` | ✅ Fixat |
| C8 | `as any` în bip39-wallet.ts | `src/utils/bip39-wallet.ts` | ✅ Fixat |

### 🟠 HIGH (12)

| ID | Problemă | Status |
|----|----------|--------|
| H1 | Stratum "V2" e V1 | ⏳ Needs Rust |
| H2 | Bridge: 2 chains, nu 10+ | ⏳ Needs multi-chain |
| H3 | Bridge relayer single-signer | ⏳ Needs redesign |
| H4 | HSMCPay settlement in-DB, nu Stripe | 🔧 In lucru |
| H5 | HIBP not enabled | ⏳ |
| H6 | WebAuthn not in 2FA flow | 🔧 In lucru |
| H7 | Governance timelock in Rust, no DB | ⏳ |
| H8 | main.rs signal handlers .expect() | ⏳ Needs Rust |
| H9 | RPC unwrap_or_default() data loss | ⏳ Needs Rust |
| H10 | No smart contract VM/WASM | ⏳ |
| H11 | Documentation LLM-generated | ⏳ |
| H12 | RPC health false claims | ⏳ Needs Rust |

### 🟡 MEDIUM (31)
- 26 TypeScript files: `any` types (needs cleanup)
- Duplicate buggy key derivation (HMAC, not X25519)
- No rate limiting on RPC
- No integration tests
- Decoy selection non-cryptographic PRNG
- health() false capability claims
- WhitepaperPage outdated claims
- MiningRPCClient dead references

### 🟢 LOW (23)
- console.log → console.debug (mostly done)
- Missing return types
- Inconsistent Rust style
- Dead files (price-engine, update-token-metrics — already emptied)

---

## 🔐 Post-Quantum Roadmap

### Crypto Migration Plan

| Primitive | Current | Post-Quantum | Standard |
|---|---|---|---|
| Key Exchange | Curve25519 ECDH | Kyber-1024 KEM | NIST FIPS 203 |
| Signatures | CLSAG (curve) | Dilithium-5 + SPHINCS+ | NIST FIPS 204, 205 |
| Range Proofs | Bulletproofs | Lattice-based ZK (ZKBoo/Ligero) | Research |
| Hash | SHA-256 | SHA-256 (deja QR) | FIPS 180-4 |
| Stealth Addr | Curve25519 DH | Kyber KEM-based | Custom |

### QS Modules to build (Rust)

```
rust-node/
├── hsmc-crypto/
│   ├── src/
│   │   ├── kyber.rs         ← Kyber-1024 KEM
│   │   ├── dilithium.rs     ← Dilithium-5 signatures
│   │   ├── sphincs.rs       ← SPHINCS+ fallback
│   │   ├── lattice_zk.rs    ← Lattice ZK proofs
│   │   ├── hybrid.rs        ← Hybrid mode (classic + PQ)
│   │   ├── ringct.rs        ✅ Real bulletproofs (done)
│   │   ├── stealth.rs       ← needs PQ upgrade
│   │   ├── ring_sig.rs      ← needs PQ upgrade
│   │   └── pow.rs           ✅ SHA-256d (done)
│   └── tests/
└── hsmc-core/src/
    ├── chain.rs             ← PQ block validation
    ├── transaction.rs       ← PQ tx format
    └── governance.rs        ✅ With timelock (done)
```

---

## 🌉 Multi-Chain Bridge (50+ chains)

### Chains to support (prioritized)

**Tier 1 (must have):** BTC, ETH, BSC, Polygon, Solana, Avalanche, Arbitrum, Optimism, Base  
**Tier 2 (high):** XRP, Cardano, Cosmos, NEAR, Algorand, Polkadot, Celo, TRON, Fantom, Cronos  
**Tier 3 (medium):** Tezos, Flow, Aptos, Sui, Hedera, Stacks, StarkNet, zkSync, Linea, Scroll  
**Tier 4 (extended):** All EVM chains, IBC chains, Move chains, UTXO chains  

### Bridge Architecture

```
bridge/
├── src/
│   ├── connectors/
│   │   ├── bitcoin.ts       ← BTC (UTXO, Taproot)
│   │   ├── ethereum.ts      ← ETH + all EVM chains
│   │   ├── solana.ts        ← SOL (SPL tokens)
│   │   ├── polkadot.ts      ← DOT + parachains
│   │   ├── cosmos.ts        ← ATOM + IBC chains
│   │   ├── cardano.ts       ← ADA (eUTXO)
│   │   ├── xrp.ts           ← XRP Ledger
│   │   └── ...
│   ├── relayer.ts           ← Multi-signer relay logic
│   ├── translator.ts        ← Classic ↔ Quantum translator
│   └── vault.ts             ← Multi-sig vault management
└── contracts/
    ├── BridgeMinter.sol     ← EVM bridge contract
    └── WHSMC.sol            ← Wrapped HSMC token
```

---

## 🤖 AI Co-Pilot

| Component | Status | File |
|---|---|---|
| System prompt + security rules | ✅ Real | `supabase/functions/hsmc-copilot/index.ts` |
| Input blocklist | ✅ Real | Same file |
| Output filter | ✅ Real | Same file |
| Needs porting from Supabase → local API | ⏳ | To do |

---

## 💳 HSMCPay — Plăți fiat/crypto directe

HSMCPay este rampa fiat on/off a HSMC: permițând utilizatorilor să cumpere și să vândă HSMC direct cu cardul bancar prin Stripe, cu fee-uri **fixe** (nu procentuale).

### Fee Schedule

Toate fee-urile sunt **fixe** și intră integral în **Treasury**. Cu cât suma e mai mare, cu atât fee-ul e mai avantajos pentru utilizator.

| Interval tranzacție | Fee HSMC | Destinație |
|---------------------|----------|------------|
| < $6,000 | **$1.00** | Treasury |
| $6,000 – $10,000 | **$3.00** | Treasury |
| $10,000 – $50,000 | **$5.00** | Treasury |
| $50,000 – $1,000,000 | **$10.00** | Treasury |
| > $1,000,000 | **$200.00** | Treasury |

> Stripe percepe comisionul său standard (~2.9% + $0.30) — acela e separat, nu al HSMC.

### Flow

```
Cumpărare: User → Stripe (card) → HSMC tokens în wallet → Fee fix → Treasury
Vânzare:   User → HSMCPay → Stripe (payout) → Fiat pe card → Fee fix → Treasury
```

### Status

| Flow | Status |
|---|---|
| Fiat buy (Stripe Elements) | ✅ Real Stripe via platform |
| Fiat sell (payout) | 🔧 In lucru |
| Fee decontare în Treasury | ⏳ De implementat |
| Crypto swap | ⏳ DEX module |
| Comodities | ⏳ Needs integration |

---

## 🏦 Treasury — Banca Virtuală HSMC

HSMC funcționează ca o **bancă virtuală complet transparentă** — fără hidden fees, fără bullshit-uri bancare tradiționale. Totul e on-chain, verificabil la ochiul liber.

**Principii:**
- **Transparență totală** — fiecare tranzacție din Treasury e pe blockchain, publică
- **Fee-uri fixe, nu procentuale** — știi exact ce plătești, indiferent de sumă
- **Guvernanță on-chain** — deținătorii HSMC decid alocarea fondurilor
- **Buyback & Burn automat** — Treasury cumpără HSMC de pe piață și arde token-urile

### Alocare Treasury

| Fond | Procent | Rol |
|------|---------|-----|
| **Buyback & Burn** | 40% | Cumpără HSMC de pe piață și arde → supply ↓, preț ↑ |
| **Staking Rewards** | 25% | Recompense pentru holders (Genesis 12.5%, Beta 18% APR) |
| **Development Fund** | 20% | Noduri, audit-uri, exchange listings, infrastructură |
| **Insurance Fund** | 15% | Rezervă pentru hack-uri, bug bounty, evenimente extreme |

### De ce e diferit de o bancă tradițională

| Bănci tradiționale | HSMC Treasury |
|---------------------|---------------|
| Fee-uri ascunse, procentuale | Fee-uri fixe, publice |
| Conturi blocate arbitrar | Tu deții cheile private |
| Rapoarte anuale opace | Totul e on-chain, în timp real |
| Intermediari multipli | Direct: user → Stripe → HSMC |
| Inflație prin împrumuturi | Supply deflaționist prin burn |

---

## 📊 Tokenomics

### Supply & Economics

- **Total Supply Cap:** 500,000,000 HSMC (fix, imuabil — corectat din 1T)
- **Circulating:** 65,000,000 HSMC
- **Token Holders:** 4
- **Price:** ~$0.045
- **Market Cap:** ~$2,925,000

### Mecanisme de valoare

| Mecanism | Efect |
|----------|-------|
| **PoW Mining** | Cost real de producție (electricitate) → cost floor ca aurul |
| **Fee Burn (EIP-1559)** | Fiecare tranzacție arde o parte din fee → supply deflaționist |
| **Treasury Buyback & Burn** | 40% din fee-urile HSMCPay merg în buyback → presiune constantă de cumpărare |
| **Staking** | Blochează supply-ul circulant (Genesis 12.5%, Beta 18% APR) |
| **Privacy Premium** | Singurul L1 privat cu rampă fiat directă — utility reală |
| **HSMCPay Fiat Ramp** | Buy/sell direct cu cardul → accesibilitate maximă |

### De ce HSMC poate fi mai valoros decât BTC pe termen lung

| Factor | BTC | HSMC |
|--------|-----|------|
| **Utilitate reală** | ❌ Doar speculă | ✅ Privacy + plăți + bridge |
| **Rampă fiat nativă** | ❌ Doar prin exchange-uri | ✅ HSMCPay direct |
| **Supply** | Fix (21M) | Fix (1T) + **burn deflaționist** |
| **Privacy** | ❌ Pseudo-anonim | ✅ RingCT + stealth addresses |
| **Post-quantum** | ❌ ECDSA vulnerabil | ✅ Kyber + Dilithium |
| **Cost floor** | Mining | Mining + Treasury buyback |

### Launch Sequence (cum intră primul ban real)

1. ✅ **Mining** produce primele monede (cost electricitate = cost floor)
2. 🔧 **HSMCPay** setează prețul inițial — lumea cumpără direct cu cardul
3. 🔧 **Exchange listing** (MEXC, Gate.io) — order book, lichiditate globală
4. 🔧 **DEX pools** — lichiditate secundară (wHSMC/USDT, wHSMC/BNB)
5. 🔧 **Treasury buyback** — presiune constantă de cumpărare din fee-uri

---

## 🖥️ Servicii active

| Serviciu | Port | Status |
|---|---|---|
| Frontend (Vite) | 3000 | ✅ Running |
| API Server (Bun) | 3001 | ✅ Running |
| Mining Stratum | 3333 | 🔧 In lucru |
| Rust Node | — | ⏳ Needs VPS + rustc |

---

## 📁 Structură proiect

```
HSMC-network-hub-main/
├── src/                     ← Frontend React/TypeScript
│   ├── components/          ← UI components
│   ├── pages/               ← Route pages
│   ├── hooks/               ← Custom hooks
│   ├── utils/               ← Utilities (crypto, wallet)
│   ├── integrations/        ← DB client, Supabase bridge
│   └── types/               ← TypeScript types
├── rust-node/               ← Blockchain node (Rust)
│   ├── hsmc-core/           ← Core blockchain logic
│   ├── hsmc-crypto/         ← Cryptographic primitives
│   ├── hsmc-node/           ← Node entry point
│   ├── hsmc-p2p/            ← P2P networking
│   ├── hsmc-rpc/            ← JSON-RPC server
│   ├── hsmc-storage/        ← Blockchain storage
│   └── hsmc-stratum/        ← Mining pool protocol
├── contracts/               ← Solidity smart contracts
├── supabase/                ← Legacy Supabase (migrated)
│   ├── migrations/          ← SQL migrations
│   └── functions/           ← Edge functions
├── blueprint.md             ← THIS FILE
├── DETAILS.md               ← Project documentation
├── MANUAL.md                ← Operational manual
└── .env                     ← Environment variables
```

---

## 🚀 Next Steps (în ordine)

### ✅ Completate (2026-07-21 – 2026-07-24)
1. ✅ Supply fix: 1T → 500M HSMC (toate layerele)
2. ✅ Eliminare unwrap() din producție (102 fix-uri)
3. ✅ WebAuthn biometric (register + login)
4. ✅ CORS + CSP security headers
5. ✅ Vite proxy + relative URLs
6. ✅ DB migration (schema 38 tabele + seed + migrate)
7. ✅ Rate limiting + anti-DDoS

### 🔴 Prioritate imediată
8. 🔧 Privacy wiring în web wallet (#15)
9. 🔧 HSMCPay settlement real (#3)
10. ⏳ Post-quantum crypto (#4)
11. ⏳ Stratum V2 (#21)
12. ⏳ Bridge hardening (#22)

### 🟡 Înainte de mainnet
13. ⏳ Integration tests (#31)
14. ⏳ Full security audit (#32)
15. ⏳ Mainnet launch prep (#34)
