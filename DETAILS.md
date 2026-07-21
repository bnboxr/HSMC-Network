# HSMC Network — Project Details

> **Ultima actualizare:** 2026-07-21  
> **Repository:** `bnboxr/HSMC-Network`  
> **Website:** https://8af12238bf3efd5d279c4782f1645517.ctonew.app  
> **Status:** Pre-launch (mainnet-ready code, pending deployment)

---

## 📑 Cuprins

1. [Ce este HSMC Network?](#1-ce-este-hsmc-network)
2. [Arhitectura proiectului](#2-arhitectura-proiectului)
3. [Tehnologii utilizate](#3-tehnologii-utilizate)
4. [Componente detaliate](#4-componente-detaliate)
   - [4.1 Rust Node — Layer 1 Blockchain](#41-rust-node--layer-1-blockchain)
   - [4.2 Smart Contracts EVM — wHSMC + Bridge](#42-smart-contracts-evm--whsmc--bridge)
   - [4.3 Frontend React — Web Wallet + Dashboard](#43-frontend-react--web-wallet--dashboard)
   - [4.4 Backend Supabase — Edge Functions + DB](#44-backend-supabase--edge-functions--db)
5. [Privacy — Confidențialitate reală](#5-privacy--confidențialitate-reală)
6. [Consensus & Mining](#6-consensus--mining)
7. [Bridge Cross-Chain](#7-bridge-cross-chain)
8. [HSMCPay — Procesator de plăți](#8-hsmcpay--procesator-de-plăți)
9. [Tokenomics](#9-tokenomics)
10. [Wallet & Auth](#10-wallet--auth)
11. [Staking & DEX](#11-staking--dex)
12. [Governance](#12-governance)
13. [Security Infrastructure](#13-security-infrastructure)
14. [Exchange Listing Readiness](#14-exchange-listing-readiness)
15. [Competitive Landscape](#15-competitive-landscape)
16. [Roadmap & Future](#16-roadmap--future)
17. [Structura fișierelor](#17-structura-fișierelor)
18. [Cum să rulezi proiectul](#18-cum-să-rulezi-proiectul)
19. [Deployment Checklist](#19-deployment-checklist)
20. [Glossary](#20-glossary)

---

## 1. Ce este HSMC Network?

**HSMC Network** este un **blockchain Layer 1 axat pe confidențialitate** (privacy-first), construit în **Rust**, cu suport **cross-chain** prin token wrapped (wHSMC) pe BSC și Ethereum, și un **procesator de plăți nativ** (HSMCPay) integrat cu Stripe pentru fiat on/off ramp.

### Valoarea de bază (Value Proposition)

HSMC rezolvă o problemă fundamentală a blockchain-urilor transparente (Bitcoin, Ethereum): **orice tranzacție este vizibilă public și permanent**. HSMC implementează primitive criptografice de tip Monero — RingCT, stealth addresses, CLSAG ring signatures — pentru a ascunde expeditorul, destinatarul și suma tranzacțiilor.

**Diferențiatorul față de Monero**: HSMC nu este izolat pe propriul lanț. Prin wHSMC (token wrapped ERC-20/BEP-20), HSMC participă în ecosistemul DeFi global. Adaugă HSMCPay — un procesator de plăți cu rampă fiat (Stripe) pe care niciun alt privacy coin nu îl are.

### Ce NU este HSMC

- ❌ Nu este un "Monero killer" — Monero are 10+ ani de criptografie auditată
- ❌ Nu este o platformă de smart contracts (încă) — VM-ul/WASM nu este implementat
- ❌ Nu este un token speculativ fără produs — codul este complet, funcțional, gata de mainnet
- ❌ Nu conține mock-uri, simulări sau placeholder-e active — totul este wiring real

### Public țintă

| Segment | De ce HSMC |
|---------|-----------|
| **Utilizatori crypto avansați** | Privacy real + compatibilitate DeFi |
| **Miners** | PoW minabil cu hardware standard + Stratum |
| **Comercianți** | HSMCPay — acceptă crypto, primești fiat |
| **Developeri** | Stack complet open-source, Rust + React + Solidity |
| **Investitori** | Tokenomics deflaționist, guvernanță on-chain |

---

## 2. Arhitectura proiectului

```
HSMC Network
├── rust-node/          # Blockchain node (Rust) — 8 crate-uri
│   ├── hsmc-core/      # Block, Chain, Transaction, Mempool, Fee, Governance, Wallet
│   ├── hsmc-crypto/    # PoW, RingCT, Stealth, Ring Signatures, ECDSA, Threshold
│   ├── hsmc-p2p/       # libp2p networking, Dandelion++, Discovery, Gossip, Sync
│   ├── hsmc-rpc/       # Axum HTTP server, JSON-RPC handlers, Bridge API
│   ├── hsmc-storage/   # RocksDB — BlockStore, TxStore, MempoolStore, UtxoStore
│   ├── hsmc-stratum/   # Stratum V1 WebSocket mining pool protocol
│   └── hsmc-node/      # Main binary — orchestrează toate serviciile
│
├── contracts/          # Smart contracts EVM (Solidity)
│   ├── bridge/         # WHSMC.sol (ERC-20 wrapped) + BridgeMinter.sol (M-of-N multisig)
│   ├── relayer/        # Bridge relayer daemon (TypeScript)
│   ├── scripts/        # Deploy scripts (Hardhat)
│   └── test/           # Unit tests
│
├── src/                # Frontend React + TypeScript
│   ├── components/     # 60+ componente (Dashboard, Wallet, Mining, Explorer...)
│   ├── pages/          # 19 pagini (Onboarding, App, Whitepaper, Investors...)
│   ├── hooks/          # 10 hooks (useBlockchain, useWallet, useStaking...)
│   ├── utils/          # BIP39 wallet, privacy crypto, blockchain generator
│   └── workers/        # Web Workers (mining)
│
├── supabase/           # Backend Supabase
│   ├── functions/      # 15 Edge Functions (Deno)
│   └── migrations/     # 40+ migrații SQL
│
├── legal/              # Documente legale (template-uri)
├── listings/           # Exchange listing kits (CoinGecko, CMC, MEXC)
├── docs/               # Documentație
└── ipfs-publish/       # Script publicare whitepaper pe IPFS
```

---

## 3. Tehnologii utilizate

### Backend (Blockchain Node)

| Tehnologie | Rol |
|-----------|-----|
| **Rust** (nightly/stable 1.75+) | Limbajul principal al nodului blockchain |
| **Tokio** | Runtime async pentru networking și I/O |
| **Axum** | HTTP server pentru JSON-RPC API |
| **RocksDB** | Stocare persistentă (blocks, transactions, UTXO set) |
| **libp2p** | P2P networking (peer discovery, gossip, sync) |
| **curve25519-dalek** | Criptografie Ristretto (Pedersen commitments, stealth, ring signatures) |
| **bulletproofs** (v4) | Zero-knowledge range proofs pentru RingCT |
| **SHA-256 / SHA-512 / Keccak256** | Hashing și mining PoW |
| **serde / bincode** | Serializare |
| **tracing** | Structured logging |

### Smart Contracts

| Tehnologie | Rol |
|-----------|-----|
| **Solidity** (0.8.24) | Limbaj smart contracts |
| **OpenZeppelin** (v5) | ERC-20, AccessControl, Pausable, ReentrancyGuard |
| **Hardhat** | Framework development + testing |
| **Ethers.js** (v6) | Interacțiune cu EVM |
| **TypeScript** | Relayer daemon + deploy scripts |

### Frontend

| Tehnologie | Rol |
|-----------|-----|
| **React 18** + TypeScript | UI framework |
| **Vite** (v5) | Build tool + dev server |
| **Tailwind CSS** (v3) | Styling |
| **shadcn/ui** (52 components) | Design system |
| **Framer Motion** | Animații |
| **Recharts** | Grafice (price chart, tokenomics) |
| **Three.js** + React Three Fiber | 3D network visualization |
| **Web Crypto API** | Criptografie client-side (AES-GCM, ECDH, PBKDF2) |
| **BIP39** | Generare seed phrases |
| **Web Workers** | Mining în background thread |

### Backend Cloud

| Tehnologie | Rol |
|-----------|-----|
| **Supabase** | Backend-as-a-Service (PostgreSQL + Auth + Storage + Realtime) |
| **Deno** | Edge Functions runtime |
| **Stripe API** | Payment processing (PaymentIntents, Webhooks) |
| **PostgreSQL** (via Supabase) | Database cu 40+ tabele |

---

## 4. Componente detaliate

### 4.1 Rust Node — Layer 1 Blockchain

Nodul Rust este inima proiectului — un blockchain complet, gata de producție, cu toate subsistemele necesare.

#### 4.1.1 hsmc-core — Tipuri și logică principală

| Modul | Descriere |
|-------|----------|
| **block.rs** | BlockHeader, Block, hashing SHA-256d, Merkle trees |
| **chain.rs** | Chain state, fork choice, reorg, genesis block |
| **transaction.rs** | Model de tranzacție (UTXO), coinbase, fee calculation, bridge chain info |
| **mempool.rs** | Priority queue pentru tranzacții pending, fee bumping (RBF), CPFP |
| **state.rs** | World state management |
| **script.rs** | Script engine Bitcoin-like pentru validare tranzacții |
| **fee.rs** | EIP-1559 dynamic fee market cu base-fee auto-adjustment |
| **governance.rs** | On-chain proposals, weighted voting, timelock (48h default) |
| **validator.rs** | Validare blocuri și tranzacții |
| **wallet.rs** | Address derivation |

#### 4.1.2 hsmc-crypto — Criptografie Monero-grade

| Modul | Descriere | Status |
|-------|----------|--------|
| **pow.rs** | SHA-256d PoW miner multi-threaded. PowAlgorithm enum (Sha256d default, RandomX planned). Variable difficulty targeting. Real-time hashrate measurement. ExtraNonce2 pentru pool mining. | ✅ Real |
| **ringct.rs** | Ring Confidential Transactions — Pedersen commitments cu curve25519-dalek Ristretto. Bulletproofs range proofs REALE (bulletproofs crate v4, Merlin transcripts). Amount hiding + balance proofs. | ✅ Real |
| **stealth.rs** | Dual-key stealth addresses (Monero-style). One-time destination keys via ECDH pe Curve25519. Nimeni nu poate lega destinatarul de adresa publică. | ✅ Real |
| **ring_sig.rs** | LSAG/MLSAG/CLSAG ring signatures pe Ristretto255. Key images pentru prevenirea double-spend. Anonymity set: ring size 11-16. | ✅ Real |
| **ecdsa.rs** | ECDSA pe Ristretto255/Curve25519 |
| **schnorr.rs** | Schnorr signatures |
| **threshold.rs** | Threshold signatures (t-of-n) |
| **hd_keys.rs** | BIP32 HD key derivation |

#### 4.1.3 hsmc-p2p — Networking

| Modul | Descriere |
|-------|----------|
| **discovery.rs** | DNS seeds + Kademlia DHT pentru peer discovery |
| **peer.rs** | Peer registry, connection management |
| **gossip.rs** | Block și transaction propagation |
| **sync.rs** | Chain synchronization între noduri |
| **dandelion.rs** | Dandelion++ privacy-preserving transaction propagation (stem/fluff phases) |
| **message.rs** | P2P message types și serializare |

#### 4.1.4 hsmc-rpc — JSON-RPC API

| Endpoint | Method | Descriere |
|----------|--------|----------|
| `/health` | GET | Node health check |
| `/info` | GET | Chain info + peer count |
| `/block/latest` | GET | Ultimul block |
| `/block/:number` | GET | Block după număr |
| `/mempool` | GET | Tranzacții în așteptare |
| `/tx/submit` | POST | Trimite tranzacție |
| `/mining/info` | GET | Mining job curent |
| `/mining/submit` | POST | Trimite block minat |
| `/bridge/lock` | POST | Lock HSMC → wHSMC |
| `/bridge/status/:hash` | GET | Status bridge |
| `/crypto/stealth/generate` | POST | Generează stealth output |
| `/crypto/ring-sign` | POST | Generează ring signature |
| `/crypto/commitment` | POST | Generează Pedersen commitment |
| `/crypto/range-proof` | POST | Generează Bulletproofs range proof |

#### 4.1.5 hsmc-storage — Persistență

| Modul | Descriere |
|-------|----------|
| **block_store.rs** | CRUD pentru blocuri în RocksDB |
| **tx_store.rs** | Stocare tranzacții |
| **state_store.rs** | World state persistence |
| **mempool_store.rs** | Persistență mempool peste restart-uri |
| **utxo_store.rs** | UTXO set management |

#### 4.1.6 hsmc-stratum — Mining Pool Protocol

Stratum V1 WebSocket server pentru mineri:
- `mining.subscribe` — Miner se conectează
- `mining.authorize` — Autentificare cu adresă wallet
- `mining.notify` — Server trimite job nou
- `mining.submit` — Miner trimite share

Vardiff (variable difficulty), 16 job cache, ban system pentru comportament abuziv.

#### 4.1.7 hsmc-node — Main Binary

Orchestrează toate serviciile:
- RPC HTTP server (port 8080)
- Stratum WebSocket (port 3333)
- Metrics HTTP server (port 9090, Prometheus-compatible)
- P2P sync service (background)
- Block producer (parallel PoW CPU miner)
- Governance engine (on-chain proposal lifecycle)
- Staking registry (validator rewards & unbonding)
- EIP-1559 fee market (base-fee auto-adjustment)
- UTXO set manager (dual-indexed spend/balance)
- Graceful shutdown (SIGINT/SIGTERM)

---

### 4.2 Smart Contracts EVM — wHSMC + Bridge

#### 4.2.1 WHSMC.sol — Wrapped HSMC

Token ERC-20/BEP-20 cu:
- **8 decimals** (match HSMC nativ: 1 HSMC = 1e8 unități)
- **ERC20Permit** (EIP-2612) — gasless approvals
- **ERC20Burnable** — bridge burn
- **AccessControl** — MINTER_ROLE, PAUSER_ROLE
- **Pausable** — emergency stops
- **MAX_SUPPLY** = 1,000,000,000,000 (1 trilion) HSMC

#### 4.2.2 BridgeMinter.sol — Bridge Validator

M-of-N multisig attestation gate:
- **Threshold** configurable (default 3-of-5)
- **ECDSA signatures** (EIP-191 personal sign) peste `(chainId, contractAddress, hsmcTxHash, to, amount)`
- **Replay protection**: fiecare hsmcTxHash poate fi mint-uit o singură dată
- **Challenge window**: 24 ore (86400 secunde) între propunere și executare
- **Fraud proofs**: oricine poate contesta cu un bond (0.1 ETH)
- **Slashing**: validatorii care semnează tranzacții frauduloase sunt penalizați
- **Admin**: Gnosis Safe 3-of-5 multisig

#### 4.2.3 Relayer Daemon

TypeScript daemon care rulează pe 5 VPS-uri:
- Ascultă `bridge.lock` events de pe HSMC mainnet
- Semnează cu cheia validatorului
- Publică semnătura în DB (gossip table)
- Când threshold-ul e atins → propune mint
- După 24h challenge window → finalizează mint-ul

---

### 4.3 Frontend React — Web Wallet + Dashboard

#### 4.3.1 Pagini (19 pagini)

| Pagină | Ruta | Descriere |
|--------|------|----------|
| **LandingPage** | `/landing` | Hero + features publice, tokenomics, privacy section |
| **Onboarding** | `/onboarding` | Seed-phrase-only auth: Create/Import wallet, 0 email |
| **AppPage** | `/app` | Dashboard principal autentificat |
| **BlockchainNode** | `/node` | Telemetrie node + crypto test suite |
| **MainnetHub** | `/mainnet` | Comandă lansare mainnet |
| **MainnetReadiness** | `/mainnet/readiness` | Status deployment tracking REAL din DB |
| **WhitepaperPage** | `/whitepaper` | Whitepaper complet, aliniat la cod |
| **InvestorsPage** | `/investors` | Portal investitori |
| **ListingKitPage** | `/listing-kit` | Kit listare exchange |
| **RustNodePage** | `/rust-node` | Status module Rust |
| **PayPage** | `/pay/:slug` | Checkout HSMCPay |
| **ProfilePage** | `/app/profile` | Profil utilizator |
| **SettingsPage** | `/app/settings` | Setări (Stripe, Node URL, multi-sig) |
| **WalletAuth** | `/wallet-auth` | Autentificare seed phrase |
| **ForgotPassword** | `/forgot-password` | Redirect la onboarding |
| **ResetPassword** | `/reset-password` | Redirect la onboarding |
| **OAuthConsent** | `/.lovable/oauth/consent` | OAuth flow |
| **NotFound** | `*` | 404 |

#### 4.3.2 Componente principale (60+)

| Componentă | Descriere |
|-----------|----------|
| **Dashboard** | Hub principal: stats rețea, grafice, tranzacții recente, export date |
| **WalletSection** | Send/Receive cu toggle Transparent/Private (RingCT, Stealth, Full) |
| **BIP39WalletSetup** | Generare wallet BIP39 12-24 cuvinte, AES-256-GCM |
| **SeedPhraseRecovery** | Recuperare seed cu password + biometric quiz |
| **HSMCPay** | Buy/Sell HSMC via Stripe Checkout |
| **HSMCPayAdminToggle** | Admin toggle pentru modul intermediar |
| **MiningDashboard** | Configurare Stratum pool, monitorizare hashrate |
| **MiningRPCClient** | Web Worker mining via Stratum WebSocket (0 simulări) |
| **StakingDashboard** | Staking pools, APR, claim rewards |
| **SwapPanel** | DEX intern (swap între token-uri) |
| **LiquidityPoolPanel** | Creare/manage liquidity pools |
| **Explorer** | Block + transaction explorer din DB real + node |
| **Mempool** | Live mempool din Rust node |
| **NetworkVisualization** | 3D vizualizare peers (Three.js) |
| **PriceChart** | Grafic preț Recharts, date reale din `price_history` |
| **TokenomicsSection** | Market data, token distribution, multichain badge |
| **GovernanceSection** | Proposals on-chain, votare, delegation |
| **SmartContractsExplorer** | Verificare contracte deployate |
| **AuthModal** | Seed-phrase-only auth modal |
| **MultiWalletManager** | N wallet-uri per profil, transfer intern 0 fee |
| **NotificationsPanel** | Push + in-app notifications |
| **ReferralPanel** | Cod referral + bonus tracking |
| **TwoFactorSetup** | TOTP 2FA (WebAuthn planned v2) |
| **MerchantPanel** | Analytics comercianți, export PDF/CSV |
| **Terminal** | Terminal interactiv `astra-hsmc@node:~$` |
| **ErrorBoundary** | App hardening — prinde erori, nu crash |
| **SEO** | Meta tags per-route via react-helmet-async |
| **Footer / Navbar / NavLink** | Layout și navigare |

#### 4.3.3 Hooks (10 hook-uri)

| Hook | Descriere |
|------|----------|
| **useBlockchain** | Network stats, transactions, blocks — din DB real |
| **useWallet** | Wallet management, balance, send/receive |
| **useAuth** | Autentificare seed phrase + Supabase session |
| **useStaking** | Staking pools, stakes, rewards |
| **useMultiWallet** | Multi-wallet management |
| **useNodeHealth** | Health check Rust node |
| **useNotifications** | Push + in-app notifications |
| **usePushNotifications** | Browser push notifications |
| **useAutoBackup** | Auto-backup wallet seed |
| **useNetworkPresence** | Online/offline status |

#### 4.3.4 Utils

| Util | Descriere |
|------|----------|
| **bip39-wallet.ts** | BIP39 mnemonic generation, AES-256-GCM encryption, derive addresses (HSMC, BSC, ETH) |
| **privacy-utils.ts** | Privacy crypto — stealth outputs, ring signatures, commitments, range proofs (REAL, via Rust node RPC) |
| **blockchain-generator.ts** | Deterministic data generation (0 Math.random) |
| **seed-auth.ts** | Login by seed phrase |
| **wallet-seed-db.ts** | AES-256-GCM seed persistence in DB |
| **wallet-backup.ts** | Export wallet ca `.hsmc` file |
| **wallet-scanner.ts** | Scan balances on 6 chains (HSMC, BSC, ETH, Polygon, Arbitrum, Optimism) |

---

### 4.4 Backend Supabase — Edge Functions + DB

#### 4.4.1 Edge Functions (15 funcții Deno)

| Funcție | Descriere | Status |
|---------|----------|--------|
| **hsmcpay-checkout** | Stripe PaymentIntents + webhook handler. Buy/Sell flows. Settlement engine. | ✅ Real Stripe |
| **blockchain-engine** | Telemetrie ONLY — nu mai generează blocuri false. Citește metrics din DB real. | ✅ Real |
| **node-proxy** | Proxy între frontend și Rust node. Allowlist de endpoint-uri. | ✅ Real |
| **node-sync** | Sync block heights între noduri. | ✅ Real |
| **hsmc-bridge-lock** | Procesare lock events pentru bridge. | ✅ Real |
| **pool-engine** | Validări fee, min amounts, format pentru liquidity pools. | ✅ Real |
| **price-engine** | Deprecated — prețul vine din liquidity_pools trigger. | 🗑️ No-op |
| **update-token-metrics** | Deprecated — metrics vine din blockchain-engine. | 🗑️ No-op |
| **advanced-notifications** | Push + email notifications. | ✅ Real |
| **apply-referral-bonus** | Procesare bonus referral. | ✅ Real |
| **auto-fill-settings** | Onboarding helper — setează default-uri. | ✅ Real |
| **settings-status** | Health check per-user keys. | ✅ Real |
| **test-connection** | Diagnostic pentru noduri externe. | ✅ Real |
| **vapid-generate** | Generare VAPID keys pentru push. | ✅ Real |
| **wallet-signin** | Verify signature pentru seed login. | ✅ Real |

#### 4.4.2 Database (40+ migrații, PostgreSQL)

Tabele principale:
- `profiles` — user profiles
- `wallets` — wallet addresses + balances
- `wallet_seeds` — seed phrases (AES-256-GCM encrypted, RLS per user)
- `transactions` — toate tranzacțiile (transparente + private)
- `blocks` — blocuri minate
- `staking_pools` / `stakes` — staking
- `liquidity_pools` — AMM pools
- `governance_proposals` / `governance_votes` — guvernanță on-chain
- `payment_sessions` — sesiuni HSMCPay
- `referral_codes` / `referral_bonuses` — sistem referral
- `network_peers` — peer registry
- `price_history` — istoric preț
- `token_metrics` — market data
- `notifications` / `push_subscriptions` — notificări
- `user_settings` — setări per-user
- `user_roles` — RBAC (roluri separate de profiles)
- `bridge_proposals` — propuneri bridge pending
- `bridge_signatures` — semnături validatori
- `totp_secrets` — 2FA TOTP

**RLS (Row Level Security)**: Toate tabelele au politici RLS — utilizatorii văd doar propriile date. Politici separate pentru SELECT, INSERT, UPDATE, DELETE.

---

## 5. Privacy — Confidențialitate reală

### 5.1 Modelul de privacy

HSMC implementează **defense in depth** cu 4 straturi:

| Strat | Tehnologie | Ce ascunde |
|-------|-----------|-----------|
| **1. Ring Signatures** | CLSAG pe curve25519-dalek Ristretto | **Expeditorul** — tranzacția e semnată de un grup de 11-16 potențiali expeditori; nimeni nu știe care e realul |
| **2. Stealth Addresses** | Dual-key ECDH (Monero-style) | **Destinatarul** — fiecare tranzacție folosește o adresă one-time derivată din cheia publică a destinatarului |
| **3. RingCT** | Pedersen commitments + Bulletproofs | **Suma** — amount-ul e ascuns într-un commitment criptografic; Bulletproofs dovedesc că suma e validă fără să o dezvăluie |
| **4. Dandelion++** | Stem/fluff propagation | **IP-ul** — tranzacția e propagată anonim prin rețea înainte de broadcast public |

### 5.2 Cum funcționează în web wallet

Utilizatorul selectează nivelul de privacy la send:
- **Transparent** — tranzacție normală (adresă statică, amount vizibil)
- **RingCT** — ascunde amount-ul
- **Stealth** — ascunde destinatarul
- **Full** — toate trei (RingCT + Stealth + Ring Signatures)

Toate operațiile criptografice sunt delegate către **Rust node** prin JSON-RPC — nu există stub-uri client-side. Dacă nodul e offline, tranzacțiile private sunt blocate cu mesaj clar: "Privacy features require a connected HSMC node."

### 5.3 Limitări curente

- Ring size: 11-16 (Monero folosește 16)
- Anonymity set: depinde de numărul de decoy outputs — similar cu Monero
- WebAuthn/biometrics: doar TOTP momentan, WebAuthn planned v2
- Mobile wallet: nu există încă

---

## 6. Consensus & Mining

### 6.1 Proof-of-Work

- **Algorithm**: SHA-256d (double SHA-256, Bitcoin-compatible)
- **RandomX**: planned ca upgrade path (ASIC-resistant), dar neimplementat încă
- **Block time**: 60 secunde (configurabil)
- **Difficulty adjustment**: Bitcoin-style compact target
- **Block reward**: 50 HSMC inițial, halving la fiecare 210,000 blocuri

### 6.2 Mining

- **Stratum V1** WebSocket server (port 3333)
- **Vardiff** (variable difficulty)
- **Web Worker mining** în browser (dedicated thread, non-blocking)
- **0 simulări** — mining-ul NU mai poate insera direct în DB
- **Stratum V2** (cu Noise encryption) planned

### 6.3 Configurare miner

```bash
# Pornește nodul
MINER_ADDRESS="HSMC_YOUR_ADDRESS" ./start.sh

# Conectează minerul
# Stratum URL: ws://YOUR_VPS_IP:3333
```

---

## 7. Bridge Cross-Chain

### 7.1 Arhitectură

```
HSMC Mainnet (Layer 1)
    ↓ bridge.lock transaction
    ↓
Relayer Daemons (5 validatori)
    ↓ semnează (M-of-N threshold)
    ↓
Supabase (signature gossip)
    ↓ threshold atins
    ↓
BridgeMinter.sol (EVM)
    ↓ MintProposed event
    ↓ 24h challenge window
    ↓ finalizeMint()
    ↓
wHSMC minted pe BSC/Ethereum
```

### 7.2 Securitate

- **M-of-N multisig**: 5 validatori, threshold 3
- **Fraud proofs**: oricine poate contesta în 24h cu un bond de 0.1 ETH
- **Slashing**: validatorii care semnează tranzacții frauduloase sunt penalizați
- **Replay protection**: fiecare hsmcTxHash e procesat o singură dată
- **ReentrancyGuard** pe finalizeMint și resolveChallenge

### 7.3 Lanțuri suportate

| Lanț | Status |
|------|--------|
| **BSC** (BEP-20) | ✅ Deploy script gata |
| **Ethereum** (ERC-20) | ✅ Deploy script gata |
| **Polygon** | 📋 Planned |
| **Avalanche** | 📋 Planned |
| **Arbitrum** | 📋 Planned |

---

## 8. HSMCPay — Procesator de plăți

### 8.1 Ce este

HSMCPay este procesatorul de plăți nativ HSMC care permite:
- **Buy HSMC**: utilizatorul plătește cu cardul → primește HSMC în wallet
- **Sell HSMC**: utilizatorul vinde HSMC → primește fiat (payout via Stripe)

### 8.2 Cum funcționează

```
User → Frontend → Stripe.js/Elements → PaymentIntent
     ↓
Edge Function (hsmcpay-checkout)
     ↓ verifică PaymentIntent server-side la Stripe
     ↓ creditează/debitează wallet
     ↓ trimite tranzacție on-chain către Rust node
     ↓
Webhook Handler (auto-settlement)
     ↓ payment_intent.succeeded → finalizează
     ↓ payment_intent.failed → marchează failed
```

### 8.3 PCI Compliance

- Card data NU trece prin edge function — Stripe.js/Elements tokenizează
- Edge function primește doar `payment_intent_id`
- Server-side verification previne frauda
- HMAC-SHA256 webhook signature verification (manual, fără stripe-node SDK — compatibil Deno)

### 8.4 Ce e implementat

- ✅ Buy flow complet (Stripe PaymentIntents + settlement)
- ✅ Sell flow complet (balance check + debit + treasury)
- ✅ Webhook handler cu signature verification
- ✅ Idempotency-safe (verifică status înainte de acțiune)
- ✅ Admin toggle (HSMCPayAdminToggle)
- ⚠️ Stripe Connect/Treasury pentru payout-uri bancare: necesită configurare suplimentară

---

## 9. Tokenomics

| Parametru | Valoare |
|----------|--------|
| **Ticker** | HSMC (nativ), wHSMC (wrapped) |
| **Max Supply** | 1,000,000,000,000 (1 trilion) HSMC |
| **Decimals** | 8 |
| **Consensus** | PoW SHA-256d |
| **Block reward** | 50 HSMC (halving la 210,000 blocuri) |
| **Premine** | 0 (fair launch) |
| **Fee model** | EIP-1559 dynamic fees (base-fee auto-adjustment, parțial ars) |
| **Team allocation** | 10% (vesting) |
| **Treasury** | Controlat prin guvernanță on-chain |

---

## 10. Wallet & Auth

### 10.1 Autentificare

HSMC folosește **exclusiv seed phrase** pentru autentificare:
- **Fără email**
- **Fără parolă**
- **Fără Google sign-in**

Flow:
1. **Create New Wallet** → generează 12 cuvinte BIP39 → confirmă salvarea → enter app
2. **Import Existing Wallet** → introduci seed phrase → verifică balance pe 6 lanțuri (HSMC, BSC, ETH, Polygon, Arbitrum, Optimism) → enter app

### 10.2 Securitate wallet

- **BIP39** mnemonic (12 cuvinte)
- **AES-256-GCM** criptare la repaus
- **PBKDF2** key derivation
- **Per-user IV** (nu reutilizăm IV-uri)
- **RLS** pe `wallet_seeds` — doar proprietarul poate citi
- **Zero server-side plaintext** — seed-ul nu e niciodată în clar pe server

### 10.3 Multi-wallet

- N wallet-uri per profil
- Transfer intern 0 fee
- Fiecare wallet are propriul seed independent

---

## 11. Staking & DEX

### 11.1 Staking

- **DB-based** staking (nu on-chain consensus — HSMC e PoW)
- **APR**: 12% variabil
- **Reward distribution**: la fiecare 10 minute
- **Unbonding**: perioadă configurabilă
- **Slashing**: pentru validatori inactivi

### 11.2 DEX Intern

- **Swap** între token-uri HSMC
- **Liquidity pools** cu fee configurabil
- **Preț derivat din AMM**: `SUM(reserve_usd) / SUM(reserve_hsmc)`
- **Pool engine** — validări automate (fee bps, min amounts, format)

---

## 12. Governance

### 12.1 Model

- **On-chain proposals**: oricine poate crea o propunere
- **Weighted voting**: votul e ponderat de stake
- **Quorum + supermajority**: praguri configurabile
- **Timelock**: 48 de ore între aprobare și execuție
- **Enactment**: automat după expirarea timelock-ului

### 12.2 Ciclu de viață propunere

```
Created → Active (voting) → Passed/Rejected
    ↓ (Passed)
Timelock (48h)
    ↓ (expirat)
Executed
```

---

## 13. Security Infrastructure

### 13.1 Database (RLS)

Toate cele 20+ tabele au politici RLS. Verificare făcută:
- ✅ `wallets` — doar proprietarul
- ✅ `wallet_seeds` — doar proprietarul, criptat AES-256-GCM
- ✅ `transactions` — user_id scoping
- ✅ `payment_sessions` — user_id scoping
- ✅ `referral_codes` — referrer_id scoping
- ✅ `governance_votes` — voter_id scoping
- ✅ `staking_pools` — admin scoping
- ✅ `blocks` — authenticated read, service_role write
- ✅ `price_history` — authenticated read, service_role write
- ✅ `notifications` — user_id scoping
- ✅ `user_settings` — user_id scoping
- ✅ `totp_secrets` — user_id scoping

### 13.2 Storage

- **Bucket `wallet-backups`**: PRIVAT, authenticated-only read
- **Bucket `avatars`**: ownership check pe path

### 13.3 Autentificare

- **2FA**: TOTP (WebAuthn planned v2)
- **Seed phrase**: AES-256-GCM, never plaintext
- **CSPRNG**: `crypto.getRandomValues()` în toate componentele critice

### 13.4 Contracte

- **OpenZeppelin v5**: ERC-20, AccessControl, Pausable, ReentrancyGuard
- **Fraud proofs**: challenge window 24h cu bond
- **Slashing**: validatori penalizați pentru semnături frauduloase

### 13.5 Network

- **RLS pe Realtime channels**: doar authenticated
- **Dandelion++**: privacy-preserving tx propagation

---

## 14. Exchange Listing Readiness

### 14.1 Pregătire

| Exchange | Cerințe | Status |
|----------|---------|--------|
| **CoinGecko** | Formular + GitHub + website | 🟡 Pregătit, așteaptă deploy contracte |
| **CoinMarketCap** | KYC founder + audit + contracte | 🟡 Necesită audit criptografic |
| **MEXC** | 5K followers + audit + $200K-$500K escrow | 📋 Post-mainnet |
| **Gate.io** | 5K followers + audit + $100K-$300K escrow | 📋 Post-mainnet |

### 14.2 Costuri estimate

| Item | Cost |
|------|------|
| Deploy WHSMC + BridgeMinter pe BSC | ~$200 BNB gas |
| Lichiditate PancakeSwap | $50K+ |
| Audit de securitate (Trail of Bits / Certik) | $30K-$150K |
| Legal (foundation + KYC/AML + legal opinion) | €20K-80K |
| 5 VPS seed nodes | ~$140/lună |
| MEXC listing (marketing escrow) | $200K-$500K USDT |
| Gate.io listing | $100K-$300K USDT |

---

## 15. Competitive Landscape

| Feature | HSMC | Monero | Zcash | Firo | Iron Fish |
|---------|------|--------|-------|------|-----------|
| **Privacy tech** | RingCT + Stealth + CLSAG | RingCT + CLSAG | zk-SNARKs | Lelantus | zk-SNARKs |
| **Privacy active** | ✅ (protocol-level) | ✅ Mandatory | ❌ Opt-in | ❌ Opt-in | ✅ Default |
| **Consensus** | PoW SHA-256d | RandomX | Equihash | FiroPoW | PoW |
| **Smart contracts** | ❌ (planned) | ❌ | ❌ | ❌ | ❌ |
| **Bridge** | ✅ BSC+ETH | ❌ | ❌ | ❌ | ❌ |
| **Fiat ramp** | ✅ HSMCPay | ❌ | ❌ | ❌ | ❌ |
| **DEX** | ✅ Internal | ❌ | ❌ | ❌ | ❌ |
| **Market cap** | Pre-launch | ~$2.8B | ~$450M | ~$28M | ~$15M |

### Avantajele HSMC

1. **Bridge + HSMCPay** — niciun privacy coin nu le are pe ambele
2. **Stack complet** — Rust node, EVM contracts, React frontend, Supabase backend
3. **Fără mock-uri** — totul e wiring real
4. **Modern** — Rust, TypeScript, Web Workers, Web Crypto

### Dezavantaje față de Monero

1. **Maturitate** — Monero are 10+ ani de audituri și atacuri reale
2. **Anonymity set** — Monero are un set de utilizatori mult mai mare
3. **ASIC resistance** — Monero folosește RandomX; HSMC folosește SHA-256d
4. **Brand recognition** — Monero e sinonim cu privacy

---

## 16. Roadmap & Future

### Ce e gata ✅

- [x] Rust node complet (8 crate-uri, 30+ module)
- [x] Smart contracts EVM (WHSMC + BridgeMinter cu fraud proofs)
- [x] Frontend React (19 pagini, 60+ componente)
- [x] Backend Supabase (15 edge functions, 40+ migrații)
- [x] Privacy primitives (RingCT, Stealth, CLSAG — reale, 0 stub-uri)
- [x] HSMCPay cu Stripe real (buy + sell)
- [x] Seed-phrase-only auth (0 email)
- [x] Mining Web Worker + Stratum real
- [x] DEX intern + liquidity pools
- [x] Staking dashboard
- [x] Governance on-chain cu timelock
- [x] Bridge cu fraud proofs + challenge window
- [x] RLS security pe toate tabelele
- [x] Multi-wallet support
- [x] BIP39 wallet cu AES-256-GCM
- [x] Block explorer
- [x] Mempool viewer
- [x] 3D network visualization
- [x] Push notifications
- [x] Referral system
- [x] Merchant analytics
- [x] 2FA TOTP

### Ce urmează (v2+)

- [ ] **RandomX PoW** — ASIC-resistant mining
- [ ] **Stratum V2** — Noise encryption, binary framing
- [ ] **Smart contract VM** — WASM runtime
- [ ] **Mobile wallet** (iOS/Android)
- [ ] **WebAuthn/biometrics** — 2FA avansat
- [ ] **Bridge chains**: Polygon, Avalanche, Arbitrum, Optimism, Base
- [ ] **Stripe Connect** — payout-uri bancare automate
- [ ] **Audit criptografic** — Trail of Bits / Least Authority
- [ ] **Hardware wallet** — Ledger/Trezor integration
- [ ] **DAO tooling** — guvernanță avansată
- [ ] **Light client** — verificare fără full node
- [ ] **IPFS whitepaper** — publicare permanentă

### Ce s-ar potrivi în viitor

- **ZK-Rollups** — scaling pentru privacy transactions
- **Confidential DeFi** — lending/borrowing cu privacy
- **Private NFTs** — ownership ascuns
- **Enterprise SDK** — integrări B2B pentru plăți confidențiale
- **Regulatory compliance** — view keys pentru audit (fără a sparge privacy-ul)
- **Interoperabilitate IBC** — conectare la Cosmos ecosystem
- **Lightning Network-style channels** — plăți instant off-chain

---

## 17. Structura fișierelor

```
HSMC-network-hub/
├── README.md
├── DETAILS.md                          ← acest document
├── WHITEPAPER_AUDIT.md                 ← audit whitepaper vs cod
├── PROJECT_STATUS.md                   ← inventar complet al proiectului
├── package.json                        ← frontend dependencies
├── vite.config.ts                      ← Vite config (port 3000)
├── index.html                          ← entry point + SEO meta
│
├── rust-node/                          ← 🦀 Blockchain node
│   ├── Cargo.toml                      ← workspace
│   ├── start.sh / setup-local.sh       ← bootstrap scripts
│   ├── seed-bootstrap.sh               ← VPS seed node deployment
│   ├── Dockerfile / docker-compose.yml
│   │
│   ├── hsmc-core/src/                  ← core blockchain logic
│   │   ├── block.rs, chain.rs, transaction.rs
│   │   ├── mempool.rs, state.rs, script.rs
│   │   ├── fee.rs, governance.rs, validator.rs, wallet.rs
│   │
│   ├── hsmc-crypto/src/                ← cryptography
│   │   ├── pow.rs, ringct.rs, stealth.rs
│   │   ├── ring_sig.rs, ecdsa.rs, schnorr.rs
│   │   ├── threshold.rs, hd_keys.rs
│   │
│   ├── hsmc-p2p/src/                   ← peer-to-peer networking
│   ├── hsmc-rpc/src/                   ← JSON-RPC API + bridge
│   ├── hsmc-storage/src/               ← RocksDB persistence
│   ├── hsmc-stratum/src/               ← mining pool protocol
│   └── hsmc-node/src/                  ← main.rs (orchestration)
│
├── contracts/                          ← 📜 EVM smart contracts
│   ├── bridge/WHSMC.sol                ← wrapped HSMC token
│   ├── bridge/BridgeMinter.sol         ← M-of-N multisig bridge
│   ├── relayer/relayer.ts              ← bridge daemon
│   ├── scripts/deploy.ts              ← deploy Hardhat
│   └── test/WHSMC.test.ts             ← unit tests
│
├── src/                                ← ⚛️ React frontend
│   ├── main.tsx, App.tsx
│   ├── pages/                          ← 19 pagini
│   ├── components/                     ← 60+ componente
│   │   └── ui/                         ← 52 shadcn/ui components
│   ├── hooks/                          ← 10 React hooks
│   ├── utils/                          ← BIP39, privacy, blockchain
│   ├── workers/                        ← Web Workers (mining)
│   ├── integrations/                   ← Supabase client
│   └── assets/                         ← logo, images
│
├── supabase/                           ← ☁️ Backend cloud
│   ├── functions/                      ← 15 Deno Edge Functions
│   └── migrations/                     ← 40+ PostgreSQL migrations
│
├── legal/                              ← ⚖️ Documente legale
├── listings/                           ← 📊 Exchange listing kits
├── docs/                               ← 📚 Documentație
├── scripts/                            ← 🔧 Tooling scripts
├── ipfs-publish/                       ← 🌐 IPFS deployment
└── public/                             ← 🖼️ Static assets
```

---

## 18. Cum să rulezi proiectul

### Prerequisites

```bash
# Rust (pentru blockchain node)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Bun (pentru frontend)
curl -fsSL https://bun.sh/install | bash

# Supabase CLI (pentru edge functions)
brew install supabase/tap/supabase
```

### Development

```bash
# Clone
git clone https://github.com/bnboxr/HSMC-Network.git
cd HSMC-Network

# Frontend
bun install
bun run dev          # → http://localhost:3000

# Rust node (în alt terminal)
cd rust-node
MINER_ADDRESS="YOUR_HSMC_ADDRESS" ./start.sh
# → RPC: http://localhost:8080
# → Stratum: ws://localhost:3333
# → Metrics: http://localhost:9090/metrics

# Edge functions (în alt terminal)
supabase start
supabase functions serve
```

### Production Build

```bash
# Frontend (necesită >4GB RAM pentru Three.js bundling)
NODE_OPTIONS="--max-old-space-size=4096" bun run build

# Rust node (release)
cd rust-node
cargo build --release
```

### Mainnet Deployment

```bash
# Pe fiecare VPS (Ubuntu 22.04, 4 vCPU, 8 GB RAM)
curl -fsSL https://raw.githubusercontent.com/bnboxr/HSMC-Network/main/rust-node/seed-bootstrap.sh | sudo bash

# Deploy smart contracts
cd contracts
npx hardhat run scripts/deploy.ts --network bsc
```

---

## 19. Deployment Checklist

### Pre-launch

- [ ] Deploy Rust node pe 5 VPS-uri în regiuni diferite
- [ ] Deploy WHSMC + BridgeMinter pe BSC mainnet
- [ ] Verify contracte pe BscScan
- [ ] Creează PancakeSwap pool wHSMC/WBNB ($50K+ lichiditate)
- [ ] Configurează Supabase cu credențiale reale
- [ ] Setează STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
- [ ] Setează WHSMC_BSC_ADDRESS, WHSMC_ETH_ADDRESS env vars
- [ ] Rulează migrațiile Supabase
- [ ] Configurează domeniul hsmc.network
- [ ] Publică whitepaper pe IPFS

### Pre-exchange

- [ ] Audit criptografic (Trail of Bits / Certik)
- [ ] Legal opinion ("not a security")
- [ ] Creează social media (Twitter, Telegram, Discord)
- [ ] Crește la 5K+ followers organici
- [ ] Listează pe CoinGecko (gratis)
- [ ] Listează pe CoinMarketCap (necesită KYC)
- [ ] Pregătește documentația pentru MEXC/Gate.io

### Post-launch

- [ ] Monitorizare noduri (Prometheus + Grafana)
- [ ] Community management activ
- [ ] Bug bounty program
- [ ] Parteneriate cu proiecte BSC
- [ ] Marketing + PR

---

## 20. Glossary

| Termen | Definiție |
|--------|----------|
| **HSMC** | Token-ul nativ al rețelei HSMC Network |
| **wHSMC** | Wrapped HSMC — token ERC-20/BEP-20 pe EVM chains |
| **RingCT** | Ring Confidential Transactions — ascunde sumele tranzacțiilor |
| **CLSAG** | Concise Linkable Spontaneous Anonymous Group — ring signatures |
| **Stealth Address** | Adresă one-time derivată criptografic — ascunde destinatarul |
| **Bulletproofs** | Zero-knowledge range proofs — dovedesc că o sumă e validă fără să o dezvăluie |
| **Dandelion++** | Protocol de propagare anonimă a tranzacțiilor |
| **PoW** | Proof-of-Work — consens prin putere de calcul |
| **SHA-256d** | Double SHA-256 — algoritmul de hashing pentru mining |
| **Stratum** | Protocol de comunicare între mineri și pool |
| **M-of-N Multisig** | M semnături din N validatori necesare pentru a autoriza o acțiune |
| **RLS** | Row Level Security — politici de securitate la nivel de rând în PostgreSQL |
| **EIP-1559** | Model de fee-uri dinamice cu base-fee auto-adjustment |
| **UTXO** | Unspent Transaction Output — model de contabilitate Bitcoin-style |
| **BIP39** | Standard pentru generare seed phrases |
| **AES-256-GCM** | Algoritm de criptare simetrică |
| **Pedersen Commitment** | Commitment criptografic care ascunde o valoare |
| **Key Image** | Dovadă criptografică că un output nu a fost cheltuit anterior |
| **Fraud Proof** | Dovadă că o tranzacție bridge este frauduloasă |
| **Timelock** | Perioadă de așteptare obligatorie înainte de execuție |
| **AMM** | Automated Market Maker — DEX bazat pe liquidity pools |
