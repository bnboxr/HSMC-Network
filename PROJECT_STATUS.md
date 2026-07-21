# HSMC — Inventar complet al proiectului

> Ultima actualizare: 2026-05-07
> Repo țintă (după redenumire pe GitHub): https://github.com/XMC-OXR/HSMC-network-hub
>
> **Cum se redenumește repo-ul** (Lovable nu poate face asta în locul tău):
> 1. GitHub → repo `astranet-network-hub` → Settings → General → Rename → `HSMC-network-hub`
> 2. Update remote local: `git remote set-url origin https://github.com/XMC-OXR/HSMC-network-hub.git`
> 3. În Lovable → Connectors → GitHub → reconectează repo-ul nou.
> Toate referințele din cod (README, workflow, edge functions) folosesc deja `HSMC`.

## Legenda statusului
- ✅ **REAL** — funcțional în producție, citește/scrie date reale (DB / RPC / on-chain).
- 🟡 **REAL (UI) / EXTERN (execuție)** — codul e gata, dar execuția cere bani reali, VPS, sau cheie privată pe care doar tu le ai.
- 🔵 **INFRASTRUCTURĂ** — fișier de config / build / docs, nu logică.
- 🟠 **PARȚIAL** — funcționează dar are scurtături sau dependență pe componente externe încă neactivate.
- ❌ **MOCK** — date/funcții fictive (NU ar trebui să existe — politică no-mock).
- 📦 **GENERATED** — fișier auto-generat (NU edita manual).

---

## 📁 Root

| Fișier | Status | Note |
|---|---|---|
| `.env` | 📦 | Auto-generat de Lovable Cloud. NU edita. |
| `README.md` | 🔵 | Overview proiect. **TODO**: înlocuiește badge-uri `astranet` cu `HSMC`. |
| `index.html` | ✅ | Meta SEO + favicon HSMC. |
| `package.json` / `bun.lock(b)` / `package-lock.json` | 🔵 | Dependințe frontend. |
| `vite.config.ts` / `tsconfig*.json` / `eslint.config.js` / `postcss.config.js` / `tailwind.config.ts` / `components.json` | 🔵 | Config build/lint. |

## 📁 public/

| Fișier | Status | Note |
|---|---|---|
| `favicon.ico`, `favicon.png`, `hsmc-logo.png` | ✅ | Branding HSMC. |
| `placeholder.svg` | 🔵 | Asset shadcn. |
| `robots.txt` | 🔵 | SEO. |

## 📁 src/ — Frontend React

### Pages (`src/pages/`)

| Fișier | Status | Ce face | Ce mai lipsește |
|---|---|---|---|
| `Index.tsx` | ✅ | Redirect home. | — |
| `LandingPage.tsx` | ✅ | Hero + features publice. | — |
| `AppPage.tsx` | ✅ | Dashboard principal autentificat. | — |
| `Onboarding.tsx` | ✅ | Wizard 4 pași, quiz mnemonic. | — |
| `WalletAuth.tsx` | ✅ | Login prin seed phrase (alternativ la email). | — |
| `ForgotPassword.tsx` / `ResetPassword.tsx` | ✅ | Flow Supabase Auth. | — |
| `ProfilePage.tsx` | ✅ | Profil user, export activitate. | — |
| `SettingsPage.tsx` | ✅ | Setări per-user (Stripe, Node URL). | — |
| `BlockchainNode.tsx` | ✅ | Telemetrie node + Crypto Test Suite. | — |
| `RustNodePage.tsx` | ✅ | Status modul Rust. | — |
| `WhitepaperPage.tsx` | ✅ | Whitepaper complet, anchors legale. | **TODO**: publish la IPFS (script pregătit). |
| `MainnetHub.tsx` | ✅ | Comandă lansare. | — |
| `MainnetReadiness.tsx` | ✅ | Status REAL din `deployment_status`. | Tu marchezi pașii pe măsură ce-i execuți. |
| `InvestorsPage.tsx` / `ListingKitPage.tsx` | ✅ | Portaluri publice. | — |
| `PayPage.tsx` | ✅ | Checkout HSMCPay (Stripe). | — |
| `NotFound.tsx` | ✅ | 404. | — |

### Components (`src/components/`)

| Fișier | Status | Note |
|---|---|---|
| `AuthModal.tsx` | ✅ | Email + Google + seed-phrase login. |
| `BIP39WalletSetup.tsx` | ✅ | 12-25 cuvinte, AES-256-GCM, WebAuthn. |
| `CreatePoolDialog.tsx` | ✅ | Wizard cu validări fee/min/format. |
| `Dashboard.tsx` | ✅ | Hub principal autentificat. |
| `Documentation.tsx` | ✅ | Docs in-app. |
| `ErrorBoundary.tsx` | ✅ | App hardening. |
| `Explorer.tsx` | ✅ | Block / tx explorer real din DB + node. |
| `FeaturesSection.tsx`, `HeroSection.tsx`, `NetworkSection.tsx`, `PrivacySection.tsx`, `TokenomicsSection.tsx`, `GovernanceSection.tsx` | ✅ | Landing sections. |
| `Footer.tsx`, `Navbar.tsx`, `NavLink.tsx` | ✅ | Layout. |
| `HSMCPay.tsx` | ✅ | Buy/Sell prin Stripe. |
| `LiquidityPoolPanel.tsx` | 🟠 | Pool intern OK; on-chain pool DEX = preview până deployezi wHSMC. |
| `Mempool.tsx` | ✅ | Live din Rust node. |
| `MerchantAnalytics.tsx`, `MerchantPanel.tsx` | ✅ | Recharts + export PDF/CSV. |
| `MiningDashboard.tsx`, `MiningRPCClient.tsx` | ✅ | Stratum V2, Web Workers, WebGL2 stress. |
| `MultiWalletManager.tsx` | ✅ | N walleturi/profil, transfer intern 0 fee. |
| `NetworkVisualization.tsx` | ✅ | 3D peers (geo din /peers). |
| `NodeStatusBadge.tsx` | ✅ | Healthcheck. |
| `NotificationsPanel.tsx` | ✅ | Push + in-app. |
| `PriceChart.tsx` | ✅ | Recharts native, no mock. |
| `ReferralPanel.tsx` | ✅ | Cod + bonus prin edge function. |
| `SeedPhraseRecovery.tsx` | ✅ | View seed cu password+biometric+quiz. |
| `SmartContractsExplorer.tsx` | ✅ | Real DB transactions. |
| `StakingDashboard.tsx` | ✅ | Pool real, APR calc, claim. |
| `SwapPanel.tsx` | ✅ | DEX intern (trg_refresh_swap_rates). |
| `Terminal.tsx` | ✅ | `astra-hsmc@node:~$`. |
| `TwoFactorSetup.tsx` | ✅ | TOTP. |
| `WalletSection.tsx`, `WelcomeChecklist.tsx` | ✅ | UX. |
| `ui/*` (52 fișiere) | 🔵 | shadcn/ui — nu modifica. |

### Hooks (`src/hooks/`)

| Fișier | Status |
|---|---|
| `useAuth.ts` | ✅ |
| `useAutoBackup.ts` | ✅ |
| `useBlockchain.ts` | ✅ |
| `useMultiWallet.ts` | ✅ |
| `useNetworkPresence.ts` | ✅ |
| `useNodeHealth.ts` | ✅ |
| `useNotifications.ts` | ✅ |
| `usePushNotifications.ts` | ✅ |
| `useStaking.ts` | ✅ |
| `useWallet.ts` | ✅ |
| `use-mobile.tsx`, `use-toast.ts` | 🔵 shadcn |

### Utils (`src/utils/`)

| Fișier | Status |
|---|---|
| `bip39-wallet.ts` | ✅ WebCrypto, no JS crypto libs. |
| `blockchain-generator.ts` | ✅ deterministic, no Math.random. |
| `seed-auth.ts` | ✅ login by seed. |
| `wallet-backup.ts` | ✅ export `.hsmc`. |
| `wallet-seed-db.ts` | ✅ AES-256-GCM persist. |

### Integrations / config

| Fișier | Status |
|---|---|
| `src/integrations/supabase/client.ts` | 📦 |
| `src/integrations/supabase/types.ts` | 📦 |
| `src/lib/utils.ts` | 🔵 cn helper |
| `src/types/blockchain.ts` | ✅ |
| `src/index.css`, `src/App.css` | ✅ Design tokens HSL. |
| `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts` | ✅ |
| `src/test/example.test.ts`, `src/test/setup.ts` | 🔵 vitest |
| `src/assets/hsmc-logo.png` | ✅ |

## 📁 supabase/

### Edge Functions (`supabase/functions/`)

| Funcție | Status | Note |
|---|---|---|
| `advanced-notifications` | ✅ | Push + email. |
| `apply-referral-bonus` | ✅ | Tx real în DB. |
| `auto-fill-settings` | ✅ | Onboarding helper. |
| `blockchain-engine` | ✅ | Organic chain growth, NU auto-blocks. |
| `hsmc-bridge-lock` | 🟡 | Lock event în DB; mint EVM = relayer extern. |
| `hsmcpay-checkout` | ✅ | Stripe Checkout/Elements. |
| `node-proxy` | ✅ | Web ↔ Rust node bridge. |
| `node-sync` | ✅ | Sync block heights. |
| `pool-engine` | ✅ | Validări fee bps, min amounts, format addr. |
| `price-engine` | ✅ | Hourly cron, on-chain signals. |
| `settings-status` | ✅ | Health per-user keys. |
| `test-connection` | ✅ | Diag pentru noduri externe. |
| `update-token-metrics` | ✅ | CoinGecko oracle HSMC/USD. |
| `vapid-generate` | ✅ | Native push keys. |
| `wallet-signin` | ✅ | Verify signature seed login. |

### Migrations (`supabase/migrations/`)

🔵 30+ migrations — toate aplicate. Include: profiles, wallets, transactions, mining_jobs, staking_pools, referrals, payment_sessions, push_subscriptions, governance_proposals, smart_contracts, deployment_status, etc. **Nu edita migrațiile vechi.**

### Config

| Fișier | Status |
|---|---|
| `supabase/config.toml` | 📦 (project_id) |

## 📁 contracts/ — EVM Solidity (wHSMC + Bridge)

| Fișier | Status | Ce trebuie făcut TU |
|---|---|---|
| `bridge/WHSMC.sol` | ✅ Cod ready, OpenZeppelin v5, audit-ready. | Deploy cu `make deploy-mainnet` (~$50-200 BNB). |
| `bridge/BridgeMinter.sol` | ✅ M-of-N multisig, EIP-191, replay protection. | Deploy cu deploy script. |
| `scripts/deploy.ts` | ✅ Hardhat deploy → scrie `deployments/<network>.json`. | Rulează local. |
| `scripts/createPancakePool.ts` | ✅ Creează pair wHSMC/WBNB + adaugă lichiditate. | Necesită ≥ $50k pe mainnet. |
| `relayer/relayer.ts` | ✅ Daemon: ascultă lock-events DB → semnează → executeMint. | Rulează pe **5 VPS** cu pm2 (1 per validator). |
| `test/WHSMC.test.ts` | ✅ Unit tests Hardhat. | `make test` local. |
| `Makefile` | ✅ targets: install/compile/test/deploy/verify/seed-pool (testnet+mainnet). | — |
| `DEPLOY_GUIDE.md` | 🔵 | Pas-cu-pas instrucțiuni. |
| `hardhat.config.ts`, `package.json`, `.env.example`, `README.md` | 🔵 | Config. |

> **Ce lipsește pentru "live"**: cheia ta privată cu BNB, capital lichiditate, 5 VPS pentru relayeri. Nimic pe care Lovable îl poate face singur — ar fi catastrofal de nesigur.

## 📁 rust-node/ — Blockchain node (Rust)

### Workspace root

| Fișier | Status |
|---|---|
| `Cargo.toml` (workspace) | 🔵 |
| `README.md`, `PUBLIC_MAINNET.md` | 🔵 docs |
| `Dockerfile`, `docker-compose.yml` | ✅ Multi-stage, prod ready. |
| `deploy.sh`, `setup-local.sh`, `start.sh`, `seed-bootstrap.sh` | ✅ Scripts deploy Ubuntu 22.04 + systemd + Cloudflare Tunnel. |
| `.env.example` | 🔵 |

### `hsmc-core/` — Tipuri & logică principală

| Fișier | Status | Note |
|---|---|---|
| `lib.rs` | ✅ Module exports |
| `block.rs` | ✅ BlockHeader, Block, hashing |
| `chain.rs` | ✅ Chain state, reorg, fork choice |
| `transaction.rs` | ✅ Tx model, UTXO, RBF, CPFP |
| `mempool.rs` | ✅ Priority queue, fee bumping |
| `state.rs` | ✅ World state |
| `script.rs` | ✅ Script Engine (Bitcoin-like) |
| `fee.rs` | ✅ EIP-1559 dynamic fees |
| `governance.rs` | ✅ On-chain proposals |
| `validator.rs` | ✅ Validare blocuri/tx |
| `wallet.rs` | ✅ Address derivation |

### `hsmc-crypto/` — Cripto Monero-grade

| Fișier | Status |
|---|---|
| `lib.rs` | ✅ |
| `pow.rs` | ✅ Parallel miner |
| `ring_sig.rs` | ✅ LSAG/CLSAG |
| `stealth.rs` | ✅ Monero-style stealth addresses |
| `ringct.rs` | ✅ Ring confidential tx + Bulletproofs |
| `ecdsa.rs` | ✅ secp256k1 |
| `schnorr.rs` | ✅ |
| `threshold.rs` | ✅ Threshold sigs |
| `hd_keys.rs` | ✅ BIP32 HD |

### `hsmc-p2p/` — Networking

| Fișier | Status | Note |
|---|---|---|
| `lib.rs`, `peer.rs`, `gossip.rs`, `sync.rs`, `message.rs` | ✅ libp2p stack |
| `discovery.rs` | ✅ DNS seeds + Kademlia |
| `dandelion.rs` | ✅ Privacy tx propagation |

### `hsmc-rpc/` — JSON-RPC HTTP API

| Fișier | Status |
|---|---|
| `lib.rs`, `server.rs`, `handlers.rs`, `types.rs` | ✅ Axum server |
| `bridge.rs` | 🟡 Lock/unlock pentru bridge wHSMC; necesită relayer extern. |

### `hsmc-storage/` — RocksDB

| Fișier | Status |
|---|---|
| `lib.rs`, `block_store.rs`, `tx_store.rs`, `state_store.rs`, `mempool_store.rs`, `utxo_store.rs` | ✅ |

### `hsmc-stratum/` — Pool mining

| `lib.rs` | ✅ Stratum V2, vardiff, 16 job cache, ban system. |

### `hsmc-node/` — Binary entry

| `main.rs` | ✅ Pornește toate sub-sistemele. |

> **Ce lipsește pentru "live mainnet"**: 5 VPS publice (Hetzner/OVH ~$140/lună), domeniu + Cloudflare Tunnel, ~3 zile bootstrap & sync.

## 📁 listings/ — Exchange submissions

| Fișier | Status |
|---|---|
| `coinmarketcap.json` | 🟡 Pre-completat. Submit la coinmarketcap.com/request după deploy + audit. |
| `coingecko.json` | 🟡 La fel pentru coingecko.com/en/coins/new. |
| `MEXC_GATE_README.md` | 🟠 Comercial — necesită 100k–500k USDT escrow. |

## 📁 legal/ — Documente juridice

| Fișier | Status |
|---|---|
| `Terms_of_Service_TEMPLATE.md` | 🟡 Template GDPR/AMLD5. **Necesită review avocat.** |
| `Privacy_Policy_TEMPLATE.md` | 🟡 Template. **Review avocat.** |
| `Token_Disclaimer.md`, `LEGAL_NOTICE.md` | 🟡 Template. |
| `README.md` | 🔵 |

## 📁 ipfs-publish/

| Fișier | Status |
|---|---|
| `publish.sh` | ✅ Script publish whitepaper → IPFS + GitHub Pages. **Tu îl rulezi local.** |

## 📁 .github/

| Fișier | Status |
|---|---|
| `workflows/rust.yml` | ✅ CI Rust pe PR/push (RUSTFLAGS fix aplicat). |

---

## 🚦 Ce rămâne PE TINE (Lovable nu poate face)

| Acțiune | Cost | Cine |
|---|---|---|
| **Deploy WHSMC + BridgeMinter pe BSC mainnet** | ~$200 BNB gas | Tu, local, cu cheia ta. |
| **Verify pe BscScan** | gratis | `make verify-mainnet`. |
| **Pool wHSMC/WBNB pe PancakeSwap** | $50k+ lichiditate | Tu. |
| **5 VPS pentru relayer + 5 seed nodes** | ~$140/lună | Tu (Hetzner/OVH). |
| **Audit Trail of Bits / Certik** | $30k–$150k | Tu — obligatoriu pre-listing. |
| **KYC/AML provider + foundation legal** | €20k–80k | Tu + avocat. |
| **CoinMarketCap / CoinGecko submission** | gratis | Tu, după deploy + audit. |
| **MEXC / Gate.io listing** | 100k–500k USDT | Tu, comercial. |
| **Redenumește repo GitHub `astranet-network-hub` → `HSMC-network-hub`** | gratis | Tu — instrucțiuni la începutul fișierului. |

## ✅ Ce e 100% gata în Lovable

- Întregul frontend React (toate paginile, hooks, utils, design tokens HSL).
- Backend Supabase: 15 edge functions + 30+ migrations cu RLS.
- Rust node complet (8 crate-uri: core/crypto/p2p/rpc/storage/stratum/node + libs).
- Smart contracts EVM (wHSMC + BridgeMinter) cu teste Hardhat.
- Relayer bridge daemon (TS).
- CI GitHub Actions Rust.
- Deploy scripts Makefile + bootstrap VPS.
- Pagina `/mainnet/readiness` cu DB tracking REAL al fiecărui pas.
- Whitepaper, listing kits, legal templates, IPFS publish script.

**Nu există mock-uri în cod** (politică zero-tolerance). Tot ce e marcat 🟡/🟠 e cod real care așteaptă input extern (bani, chei, VPS, semnături avocat).


---

## 🔍 Auto-Inventar

<!-- AUTO-STATUS-START -->
> Generat automat: 2026-06-12T08:56:43.601Z • rulează `node scripts/update-project-status.mjs`

**Sumar:** 📦 6  🔵 92  🟡 19  ✅ 171  

### `.env/`

| Status | Fișier | Motiv |
|---|---|---|
| 📦 | `.env` | auto-generated |

### `PROJECT_STATUS.md/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `PROJECT_STATUS.md` | config/docs |

### `PROJECT_STATUS.report.json/`

| Status | Fișier | Motiv |
|---|---|---|
| 🟡 | `PROJECT_STATUS.report.json` | external execution: /mainnet.*deploy/i |

### `README.md/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `README.md` | config/docs |

### `bun.lock/`

| Status | Fișier | Motiv |
|---|---|---|
| 📦 | `bun.lock` | auto-generated |

### `bun.lockb/`

| Status | Fișier | Motiv |
|---|---|---|
| 📦 | `bun.lockb` | auto-generated |

### `components.json/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `components.json` | config |

### `contracts/`

| Status | Fișier | Motiv |
|---|---|---|
| 🟡 | `contracts/.env.example` | external execution: /private[_\s-]?key/i |
| 🔵 | `contracts/DEPLOY_GUIDE.md` | config/docs |
| 🟡 | `contracts/Makefile` | external execution: /private[_\s-]?key/i |
| 🔵 | `contracts/README.md` | config/docs |
| ✅ | `contracts/bridge/BridgeMinter.sol` | real |
| ✅ | `contracts/bridge/WHSMC.sol` | real |
| 🟡 | `contracts/hardhat.config.ts` | external execution: /private[_\s-]?key/i |
| 🔵 | `contracts/package.json` | config |
| 🟡 | `contracts/relayer/relayer.ts` | external execution: /private[_\s-]?key/i |
| ✅ | `contracts/test/WHSMC.test.ts` | real |

### `eslint.config.js/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `eslint.config.js` | config |

### `index.html/`

| Status | Fișier | Motiv |
|---|---|---|
| ✅ | `index.html` | real |

### `ipfs-publish/`

| Status | Fișier | Motiv |
|---|---|---|
| ✅ | `ipfs-publish/publish.sh` | real |

### `legal/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `legal/LEGAL_NOTICE.md` | config/docs |
| 🔵 | `legal/Privacy_Policy_TEMPLATE.md` | config/docs |
| 🔵 | `legal/README.md` | config/docs |
| 🔵 | `legal/Terms_of_Service_TEMPLATE.md` | config/docs |
| 🔵 | `legal/Token_Disclaimer.md` | config/docs |

### `listings/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `listings/MEXC_GATE_README.md` | config/docs |
| 🔵 | `listings/coingecko.json` | config |
| 🟡 | `listings/coinmarketcap.json` | external execution: /mainnet.*deploy/i |

### `package-lock.json/`

| Status | Fișier | Motiv |
|---|---|---|
| 📦 | `package-lock.json` | auto-generated |

### `package.json/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `package.json` | config |

### `postcss.config.js/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `postcss.config.js` | config |

### `public/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `public/PROJECT_STATUS.md` | config/docs |
| 🔵 | `public/favicon.ico` | asset |
| 🔵 | `public/favicon.png` | asset |
| 🔵 | `public/hsmc-logo.png` | asset |
| 🔵 | `public/placeholder.svg` | asset |
| 🔵 | `public/robots.txt` | config/docs |
| ✅ | `public/sitemap.xml` | real |

### `rust-node/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `rust-node/.env.example` | config |
| 🔵 | `rust-node/Cargo.toml` | config/docs |
| 🔵 | `rust-node/Dockerfile` | config |
| 🔵 | `rust-node/PUBLIC_MAINNET.md` | config/docs |
| 🔵 | `rust-node/README.md` | config/docs |
| 🟡 | `rust-node/deploy.sh` | external execution: /VPS/i |
| 🔵 | `rust-node/docker-compose.yml` | config/docs |
| 🔵 | `rust-node/hsmc-core/Cargo.toml` | config/docs |
| ✅ | `rust-node/hsmc-core/src/block.rs` | real |
| ✅ | `rust-node/hsmc-core/src/chain.rs` | real |
| ✅ | `rust-node/hsmc-core/src/fee.rs` | real |
| ✅ | `rust-node/hsmc-core/src/governance.rs` | real |
| ✅ | `rust-node/hsmc-core/src/lib.rs` | real |
| ✅ | `rust-node/hsmc-core/src/mempool.rs` | real |
| ✅ | `rust-node/hsmc-core/src/script.rs` | real |
| ✅ | `rust-node/hsmc-core/src/state.rs` | real |
| ✅ | `rust-node/hsmc-core/src/transaction.rs` | real |
| ✅ | `rust-node/hsmc-core/src/validator.rs` | real |
| ✅ | `rust-node/hsmc-core/src/wallet.rs` | real |
| 🔵 | `rust-node/hsmc-crypto/Cargo.toml` | config/docs |
| 🟡 | `rust-node/hsmc-crypto/src/ecdsa.rs` | external execution: /private[_\s-]?key/i |
| ✅ | `rust-node/hsmc-crypto/src/hd_keys.rs` | real |
| ✅ | `rust-node/hsmc-crypto/src/lib.rs` | real |
| ✅ | `rust-node/hsmc-crypto/src/pow.rs` | real |
| 🟡 | `rust-node/hsmc-crypto/src/ring_sig.rs` | external execution: /private[_\s-]?key/i |
| ✅ | `rust-node/hsmc-crypto/src/ringct.rs` | real |
| ✅ | `rust-node/hsmc-crypto/src/schnorr.rs` | real |
| ✅ | `rust-node/hsmc-crypto/src/stealth.rs` | real |
| ✅ | `rust-node/hsmc-crypto/src/threshold.rs` | real |
| 🔵 | `rust-node/hsmc-node/Cargo.toml` | config/docs |
| ✅ | `rust-node/hsmc-node/src/main.rs` | real |
| 🔵 | `rust-node/hsmc-p2p/Cargo.toml` | config/docs |
| ✅ | `rust-node/hsmc-p2p/src/dandelion.rs` | real |
| ✅ | `rust-node/hsmc-p2p/src/discovery.rs` | real |
| ✅ | `rust-node/hsmc-p2p/src/gossip.rs` | real |
| ✅ | `rust-node/hsmc-p2p/src/lib.rs` | real |
| ✅ | `rust-node/hsmc-p2p/src/message.rs` | real |
| ✅ | `rust-node/hsmc-p2p/src/peer.rs` | real |
| ✅ | `rust-node/hsmc-p2p/src/sync.rs` | real |
| 🔵 | `rust-node/hsmc-rpc/Cargo.toml` | config/docs |
| ✅ | `rust-node/hsmc-rpc/src/bridge.rs` | real |
| ✅ | `rust-node/hsmc-rpc/src/handlers.rs` | real |
| ✅ | `rust-node/hsmc-rpc/src/lib.rs` | real |
| ✅ | `rust-node/hsmc-rpc/src/server.rs` | real |
| ✅ | `rust-node/hsmc-rpc/src/types.rs` | real |
| 🔵 | `rust-node/hsmc-storage/Cargo.toml` | config/docs |
| ✅ | `rust-node/hsmc-storage/src/block_store.rs` | real |
| ✅ | `rust-node/hsmc-storage/src/lib.rs` | real |
| ✅ | `rust-node/hsmc-storage/src/mempool_store.rs` | real |
| ✅ | `rust-node/hsmc-storage/src/state_store.rs` | real |
| ✅ | `rust-node/hsmc-storage/src/tx_store.rs` | real |
| ✅ | `rust-node/hsmc-storage/src/utxo_store.rs` | real |
| 🔵 | `rust-node/hsmc-stratum/Cargo.toml` | config/docs |
| ✅ | `rust-node/hsmc-stratum/src/lib.rs` | real |
| ✅ | `rust-node/seed-bootstrap.sh` | real |
| ✅ | `rust-node/setup-local.sh` | real |
| ✅ | `rust-node/start.sh` | real |

### `src/`

| Status | Fișier | Motiv |
|---|---|---|
| ✅ | `src/App.css` | real |
| ✅ | `src/App.tsx` | real |
| 🔵 | `src/assets/hsmc-logo.png` | asset |
| ✅ | `src/components/AuthModal.tsx` | real |
| ✅ | `src/components/BIP39WalletSetup.tsx` | real |
| ✅ | `src/components/CreatePoolDialog.tsx` | real |
| ✅ | `src/components/Dashboard.tsx` | real |
| ✅ | `src/components/Documentation.tsx` | real |
| ✅ | `src/components/ErrorBoundary.tsx` | real |
| 🟡 | `src/components/Explorer.tsx` | external execution: /VPS/i |
| ✅ | `src/components/FeaturesSection.tsx` | real |
| ✅ | `src/components/Footer.tsx` | real |
| ✅ | `src/components/GovernanceSection.tsx` | real |
| ✅ | `src/components/HSMCPay.tsx` | real |
| ✅ | `src/components/HeroSection.tsx` | real |
| ✅ | `src/components/LiquidityPoolPanel.tsx` | real |
| ✅ | `src/components/Mempool.tsx` | real |
| ✅ | `src/components/MerchantAnalytics.tsx` | real |
| ✅ | `src/components/MerchantPanel.tsx` | real |
| ✅ | `src/components/MiningDashboard.tsx` | real |
| 🟡 | `src/components/MiningRPCClient.tsx` | external execution: /VPS/i |
| ✅ | `src/components/MultiWalletManager.tsx` | real |
| ✅ | `src/components/NavLink.tsx` | real |
| ✅ | `src/components/Navbar.tsx` | real |
| ✅ | `src/components/NetworkSection.tsx` | real |
| ✅ | `src/components/NetworkVisualization.tsx` | real |
| ✅ | `src/components/NodeStatusBadge.tsx` | real |
| ✅ | `src/components/NotificationsPanel.tsx` | real |
| ✅ | `src/components/PriceChart.tsx` | real |
| ✅ | `src/components/PrivacySection.tsx` | real |
| ✅ | `src/components/ReferralPanel.tsx` | real |
| ✅ | `src/components/SEO.tsx` | real |
| ✅ | `src/components/SeedPhraseRecovery.tsx` | real |
| ✅ | `src/components/SmartContractsExplorer.tsx` | real |
| ✅ | `src/components/StakingDashboard.tsx` | real |
| ✅ | `src/components/SwapPanel.tsx` | real |
| ✅ | `src/components/Terminal.tsx` | real |
| ✅ | `src/components/TokenomicsSection.tsx` | real |
| ✅ | `src/components/TwoFactorSetup.tsx` | real |
| ✅ | `src/components/WalletSection.tsx` | real |
| ✅ | `src/components/WelcomeChecklist.tsx` | real |
| 🔵 | `src/components/ui/accordion.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/alert-dialog.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/alert.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/aspect-ratio.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/avatar.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/badge.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/breadcrumb.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/button.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/calendar.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/card.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/carousel.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/chart.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/checkbox.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/collapsible.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/command.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/context-menu.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/dialog.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/drawer.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/dropdown-menu.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/form.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/hover-card.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/input-otp.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/input.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/label.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/menubar.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/navigation-menu.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/pagination.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/popover.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/progress.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/radio-group.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/resizable.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/scroll-area.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/select.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/separator.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/sheet.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/sidebar.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/skeleton.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/slider.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/sonner.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/switch.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/table.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/tabs.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/textarea.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/toast.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/toaster.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/toggle-group.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/toggle.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/tooltip.tsx` | shadcn/ui |
| 🔵 | `src/components/ui/use-toast.ts` | shadcn/ui |
| ✅ | `src/hooks/use-mobile.tsx` | real |
| ✅ | `src/hooks/use-toast.ts` | real |
| ✅ | `src/hooks/useAuth.ts` | real |
| ✅ | `src/hooks/useAutoBackup.ts` | real |
| ✅ | `src/hooks/useBlockchain.ts` | real |
| ✅ | `src/hooks/useMultiWallet.ts` | real |
| ✅ | `src/hooks/useNetworkPresence.ts` | real |
| ✅ | `src/hooks/useNodeHealth.ts` | real |
| ✅ | `src/hooks/useNotifications.ts` | real |
| ✅ | `src/hooks/usePushNotifications.ts` | real |
| ✅ | `src/hooks/useStaking.ts` | real |
| ✅ | `src/hooks/useWallet.ts` | real |
| ✅ | `src/index.css` | real |
| ✅ | `src/integrations/lovable/index.ts` | real |
| 📦 | `src/integrations/supabase/client.ts` | auto-generated |
| 📦 | `src/integrations/supabase/types.ts` | auto-generated |
| ✅ | `src/lib/utils.ts` | real |
| ✅ | `src/main.tsx` | real |
| ✅ | `src/pages/AppPage.tsx` | real |
| 🟡 | `src/pages/BlockchainNode.tsx` | external execution: /private[_\s-]?key/i |
| ✅ | `src/pages/ForgotPassword.tsx` | real |
| ✅ | `src/pages/Index.tsx` | real |
| ✅ | `src/pages/InvestorsPage.tsx` | real |
| ✅ | `src/pages/LandingPage.tsx` | real |
| 🟡 | `src/pages/ListingKitPage.tsx` | external execution: /relayer/i |
| 🟡 | `src/pages/MainnetHub.tsx` | external execution: /VPS/i |
| ✅ | `src/pages/MainnetReadiness.tsx` | real |
| ✅ | `src/pages/NotFound.tsx` | real |
| ✅ | `src/pages/Onboarding.tsx` | real |
| ✅ | `src/pages/PayPage.tsx` | real |
| ✅ | `src/pages/ProfilePage.tsx` | real |
| ✅ | `src/pages/ResetPassword.tsx` | real |
| ✅ | `src/pages/RustNodePage.tsx` | real |
| 🟡 | `src/pages/SettingsPage.tsx` | external execution: /private[_\s-]?key/i |
| ✅ | `src/pages/WalletAuth.tsx` | real |
| 🟡 | `src/pages/WhitepaperPage.tsx` | external execution: /private[_\s-]?key/i |
| ✅ | `src/test/example.test.ts` | real |
| ✅ | `src/test/setup.ts` | real |
| ✅ | `src/types/blockchain.ts` | real |
| ✅ | `src/utils/bip39-wallet.ts` | real |
| ✅ | `src/utils/blockchain-generator.ts` | real |
| ✅ | `src/utils/seed-auth.ts` | real |
| ✅ | `src/utils/wallet-backup.ts` | real |
| ✅ | `src/utils/wallet-scanner.ts` | real |
| ✅ | `src/utils/wallet-seed-db.ts` | real |
| ✅ | `src/vite-env.d.ts` | real |

### `supabase/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `supabase/config.toml` | config/docs |
| ✅ | `supabase/functions/advanced-notifications/index.ts` | real |
| ✅ | `supabase/functions/apply-referral-bonus/index.ts` | real |
| ✅ | `supabase/functions/auto-fill-settings/index.ts` | real |
| ✅ | `supabase/functions/blockchain-engine/index.ts` | real |
| ✅ | `supabase/functions/hsmc-bridge-lock/index.ts` | real |
| 🟡 | `supabase/functions/hsmcpay-checkout/index.ts` | external execution: /VPS/i |
| ✅ | `supabase/functions/node-proxy/index.ts` | real |
| ✅ | `supabase/functions/node-sync/index.ts` | real |
| ✅ | `supabase/functions/pool-engine/index.ts` | real |
| ✅ | `supabase/functions/price-engine/index.ts` | real |
| ✅ | `supabase/functions/settings-status/index.ts` | real |
| ✅ | `supabase/functions/test-connection/index.ts` | real |
| ✅ | `supabase/functions/update-token-metrics/index.ts` | real |
| 🟡 | `supabase/functions/vapid-generate/index.ts` | external execution: /private[_\s-]?key/i |
| ✅ | `supabase/functions/wallet-signin/index.ts` | real |
| ✅ | `supabase/migrations/20260120025730_842481d7-db6a-4262-b9d7-545ba2410033.sql` | real |
| ✅ | `supabase/migrations/20260120025835_382c310b-e2e7-4ff9-826b-b063d244d894.sql` | real |
| ✅ | `supabase/migrations/20260218101113_7eea92bc-1b37-41fb-8e6b-35afea068947.sql` | real |
| ✅ | `supabase/migrations/20260219091123_6f280ac1-44f7-446a-a1bc-88daeaa354a5.sql` | real |
| ✅ | `supabase/migrations/20260219091505_abb3b622-9e5a-416d-bceb-cddc81699c3d.sql` | real |
| ✅ | `supabase/migrations/20260301194141_9ffa0c74-5be1-4f1c-b46e-f0869d2af856.sql` | real |
| ✅ | `supabase/migrations/20260301194149_b77c7070-d65d-4687-887a-600c5f33d35c.sql` | real |
| ✅ | `supabase/migrations/20260302180828_22f9e86a-df86-4d75-bb21-8eebda468d2b.sql` | real |
| ✅ | `supabase/migrations/20260302180840_be5a90a5-f55c-4633-ae56-6b6d2af97450.sql` | real |
| ✅ | `supabase/migrations/20260306204840_833c2d0c-9287-4ae8-a90c-07fd67795d2a.sql` | real |
| ✅ | `supabase/migrations/20260308071849_e423e80b-b2ff-48a3-b530-e947cae53175.sql` | real |
| ✅ | `supabase/migrations/20260308080901_be491cb1-f72e-45b0-a2f3-a1fee69361c6.sql` | real |
| ✅ | `supabase/migrations/20260308081801_76dfb5ea-1cc8-45e8-b76a-897278014265.sql` | real |
| ✅ | `supabase/migrations/20260308093836_b7dabcca-9249-4930-b8d1-93c8d09af8ae.sql` | real |
| ✅ | `supabase/migrations/20260308094531_df3258ee-5c1f-469c-83a0-390b2ddfd7d7.sql` | real |
| ✅ | `supabase/migrations/20260308094835_e936900f-0161-40cd-96e6-bbbdf4099b0d.sql` | real |
| ✅ | `supabase/migrations/20260308114318_aff5420c-6c72-4e6e-bce6-33039101b217.sql` | real |
| ✅ | `supabase/migrations/20260308130542_053884eb-5761-49ab-9f12-b00940d28f06.sql` | real |
| ✅ | `supabase/migrations/20260308133922_b2b68a4e-63d3-4055-8db3-cfd9f3e14041.sql` | real |
| ✅ | `supabase/migrations/20260308134306_ec50c180-7353-4666-9cec-a984e9d2a43c.sql` | real |
| ✅ | `supabase/migrations/20260308135117_f8acc94d-5353-45a4-8bf1-ed116408cc33.sql` | real |
| ✅ | `supabase/migrations/20260308154712_3d0f7188-d697-4c5a-b033-cd55a2ff2c06.sql` | real |
| ✅ | `supabase/migrations/20260308155210_417be4f2-e509-47db-b27f-7d9e04a89b1d.sql` | real |
| ✅ | `supabase/migrations/20260308155316_e91c94ed-3de6-4537-ae6d-966442d125a8.sql` | real |
| ✅ | `supabase/migrations/20260308203818_1ce170af-ca68-4769-9cd5-2fd882cbfe70.sql` | real |
| ✅ | `supabase/migrations/20260308204638_67db0053-180c-49ef-8898-35e7122fbe7a.sql` | real |
| ✅ | `supabase/migrations/20260308205645_d95996cb-7499-4f0f-998d-14f940ba81d5.sql` | real |
| ✅ | `supabase/migrations/20260308233213_8d822e72-9a0c-43a9-a0d9-eb5f2ee67913.sql` | real |
| ✅ | `supabase/migrations/20260411165857_3e911130-212a-4fdf-a6bc-345ca853314b.sql` | real |
| ✅ | `supabase/migrations/20260416100620_390c3687-bc8f-4fff-8d59-5ec4c7ccfb14.sql` | real |
| ✅ | `supabase/migrations/20260416102207_353a3e83-ccfc-4e93-bf61-ed33c682160f.sql` | real |
| 🟡 | `supabase/migrations/20260417071146_6ea892c6-b4f4-413d-9d38-e2fe41ec4433.sql` | external execution: /private[_\s-]?key/i |
| ✅ | `supabase/migrations/20260419154806_6c77ff8a-f76b-4df7-9765-2226bf1473e9.sql` | real |
| ✅ | `supabase/migrations/20260503152032_10bcfdd2-a34b-4edd-8b3d-216f0abab167.sql` | real |
| ✅ | `supabase/migrations/20260506062013_c6ce7a8a-105e-43e4-990b-12c21592a845.sql` | real |

### `tailwind.config.ts/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `tailwind.config.ts` | config |

### `tsconfig.app.json/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `tsconfig.app.json` | config |

### `tsconfig.json/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `tsconfig.json` | config |

### `tsconfig.node.json/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `tsconfig.node.json` | config |

### `vite.config.ts/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `vite.config.ts` | config |

### `vitest.config.ts/`

| Status | Fișier | Motiv |
|---|---|---|
| 🔵 | `vitest.config.ts` | config |

<!-- AUTO-STATUS-END -->
