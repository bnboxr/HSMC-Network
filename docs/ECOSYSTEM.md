# HSMC Network — documentul ecosistemului

**Ce este ecosistemul, ce conține, ce trebuie să facă, identitatea lui și funcționalitatea completă.**

Acesta este documentul de referință unic. Fiecare afirmație factuală este trasabilă la cod
(`fișier:linie`) sau este marcată explicit **neconfirmat**. Unde codul și un document spun
lucruri diferite, codul are dreptate și documentul este greșit.

Regula de bază a acestui fișier: **nimic nu este prezentat ca livrat dacă nu este verificabil în
cod sau on-chain.** Un cititor care ia orice rând de aici și deschide fișierul citat trebuie să
găsească exact ce scrie aici.

---

## 1. Identitate

Numai fapte verificabile în cod, fără extinderea acronimului și fără date de lansare.

| Fapt | Valoare | Sursă de adevăr |
|---|---|---|
| Nume produs | HSMC Network | repo `bnboxr/HSMC-Network` |
| Simbol token nativ | **HSMC** | `rust-node/hsmc-core/src/block.rs` (coinbase, reward) |
| Simbol token wrapped | **wHSMC** (contract `wHSMC`, fișier `contracts/bridge/WHSMC.sol`) | `contracts/bridge/WHSMC.sol:4-5` |
| Consens | **Proof of Work SHA-256d** (dublu SHA-256, hash de bloc compatibil Bitcoin) | `rust-node/hsmc-crypto/src/pow.rs:253-280` (`sha256d_hash`), `block.rs` (hash de bloc) |
| Algoritm PoW selectabil | `sha256d` (implicit) sau `randomx` dacă feature-ul e compilat | `rust-node/hsmc-crypto/src/pow.rs:45-52` |
| Block time țintă | **120 secunde** | `rust-node/hsmc-core/src/block.rs:45` (`TARGET_BLOCK_TIME_SECS = 120`) |
| Recompensă de bloc | **50 HSMC** inițial | `rust-node/hsmc-core/src/block.rs:39` (`INITIAL_REWARD = 50.0`) |
| Halving | la fiecare **210.000** de blocuri | `rust-node/hsmc-core/src/block.rs:36` (`HALVING_INTERVAL`) |
| Cap dur de supply | **500.000.000 HSMC** | `rust-node/hsmc-core/src/block.rs:42` (`MAX_SUPPLY = 500_000_000.0`) |
| Supply efectiv minabil | **~21.000.000 HSMC** (asimptota seriei de halving, nu capul) | derivat din `block.rs:36,39` |
| Premine | **0** — lansare prin PoW | `block.rs` (fără alocare de genesis) + `listings/*` |
| Chain ID | **8888** | `rust-node/hsmc-node/src/main.rs:131`, `hsmc-core/src/chain.rs:286` |
| Decimale native | **8** | `rust-node/hsmc-crypto/src/ringct.rs:79` |
| Format adresă | `"HSMC"` + 40 caractere hex = 44 caractere | `rust-node/hsmc-core/src/validator.rs:496-500` |
| Fereastră de ajustare a dificultății | 2016 blocuri, factor maxim 4× | `block.rs:48,51` |
| Limită bloc | 2.097.152 bytes, max 4.000 tx | `block.rs:60,63` |
| Repo sursă | `https://github.com/bnboxr/HSMC-Network` | linked repo |
| Domeniu public | **TBD** — `hsmc.network` nu este înregistrat | `shared/HSMC-CANONICAL-FACTS.md` |
| Explorer public | **TBD** | idem |
| API public / RPC public | **TBD** — nu există endpoint public | idem |

**Ce nu putem afirma despre identitate.** Acronimul „HSMC" nu este extins nicăieri în cod sau în
documentele canonice; expansiunea este **neconfirmat** și nu se inventează. Nu există entitate
legală, licență, echipă sau dată de lansare verificabilă în repo — toate sunt întrebări pentru
owner (secțiunea 6). Singurul host care există azi este cel al platformei de dezvoltare; orice
alt URL din documentele vechi este TBD sau mort.

---

## 2. Ce există azi

Componentă cu componentă, cu un cuvânt de stare onest. Starea este unul dintre: **funcțional**,
**parțial**, **doar cod**, **schelet**, **orfan**.

### 2.1 Nodul Rust — `rust-node/` (15 crates, ~33.700 linii de Rust)

| Crate | Linii | Stare | Ce este de fapt |
|---|---|---|---|
| `hsmc-core` | blocuri, tranzacții, mempool, validator, script, fee, governance, staking | **parțial** | Regulile de consens pentru tranzacții transparente există (`validator.rs`, 723 linii), dar **nu verifică nicio semnătură criptografică** — doar formatul hex (`validator.rs:502-512`). Nu depinde de `hsmc-crypto` (vezi 5.a). |
| `hsmc-crypto` | 12 module: `ringct`, `ring_sig`, `stealth`, `ecdsa`, `schnorr`, `hd_keys`, `pq_dilithium`, `pq_kyber`, `hybrid`, `threshold`, `pow` | **doar bibliotecă** | RingCT/CLSAG/stealth/PQ există ca implementări apelabile prin RPC, dar consensul nu le cheamă niciodată. |
| `hsmc-p2p` | 8 module (noise, gossip, dandelion, discovery, sync, peer, message) | **doar cod** | Nodul pornește `spawn_p2p_sync` (`hsmc-node/src/main.rs:618-639`) peste un `PeerRegistry` care pornește **gol** (`main.rs:355`); în `main.rs` nu există niciun bootstrap, niciun `add_peer`, niciun listen/dial. Nu există rețea. |
| `hsmc-rpc` | 65 de rute (`server.rs`), 2.261 linii de handlere | **funcțional local** | Server HTTP complet pe portul 8080, dar accesibil doar pe localhost/în rețeaua de dezvoltare. |
| `hsmc-storage` | RocksDB: blocuri, tx, mempool, state, UTXO | **funcțional** | Persistență reală pe disc (`main.rs:338-346`). |
| `hsmc-node` | 1.102 linii, binar `hsmc-node` | **schelet funcțional** | Pornește RPC + Stratum + metrics + block producer. Generează lanț **genesis-only** (5.b). |
| `hsmc-stratum` | 691 linii | **parțial** | Este **Stratum V1** (WebSocket JSON), nu V2. Upgrade-ul la V2 este un TODO explicit: `hsmc-stratum/src/lib.rs:3-6`. |
| `hsmc-oracle` | 790 linii | **funcțional (off-chain)** | Prețuri trase la runtime din 6 API-uri de exchange: Binance (`:138`), Kraken (`:176`), Coinbase (`:227`), Bybit (`:264`), Gate.io (`:306`), CoinGecko (`:349`). Nu există oracle on-chain. |
| `hsmc-starks` | 1 modul, shielded pool | **parțial** | Pool-ul shielded (Merkle + note + nullifiers) rulează prin CLI (`main.rs:157-297`) și prin RPC; starea se salvează într-un **fișier JSON** (`shielded_pool.json`), nu în lanț. |
| `hsmc-stablecoin`, `hsmc-vm`, `hsmc-rollup` | — | **doar cod** | Sunt legate doar de `hsmc-rpc` (`hsmc-rpc/Cargo.toml`), expuse ca rute `/stablecoin/*`, `/vm/*`, `/rollup/*` cu stare în memorie. Nimic din ele nu e în consens. |
| `hsmc-amm`, `hsmc-pos`, `hsmc-mpc` | — | **orfan** | Niciun alt crate nu depinde de ele (verificat prin toate `path = "../…"` din workspace). Cod mort în workspace. |

Binarul se construiește și trece prin CI (`node-binary` job, PR #22), dar un binar care compilează
nu este o rețea.

### 2.2 Contractele — `contracts/` (scrise, **nedeployate**)

| Fișier | Linii | Stare |
|---|---|---|
| `contracts/bridge/WHSMC.sol` | 135 | **doar cod** — ERC-20 + Permit + Burnable + Pausable + AccessControl, 8 decimale |
| `contracts/bridge/BridgeMinter.sol` | 411 | **doar cod** — poartă M-of-N cu semnături ECDSA, fereastră de challenge, slash pe validatori |
| `contracts/relayer/relayer.ts` | 417 | **doar cod** |
| `contracts/test/WHSMC.test.ts` | 620 | teste Hardhat, rulează local |
| `contracts/scripts/deploy*.ts` | 9 scripturi (BSC, ETH, Polygon, Avalanche, Arbitrum, Optimism, Base, Solana, Cosmos) | **doar cod** |

Directorul `contracts/deployments/` **nu există** — nu s-a scris niciodată un fișier de deployment.
Nu există adresă de contract wHSMC pe nicio rețea. Orice adresă de contract este **TBD**.

### 2.3 API server — `server/api-server.ts` (4.264 linii)

- **Stare: funcțional local, neexpus public.**
- 38 de rute distincte (`path === "…"` / `path.startsWith("…")`), plus un REST generic `/rest/v1/*`.
- Bază de date SQLite cu **44 de tabele** (numărate la runtime pe o copie a bazei, 2026-11-07 — vezi secțiunea 4).
- Autentificare: JWT + WebAuthn; API key pentru rutele de operator.
- `checkApiKey` **returnează `true` dacă serverul e în mod dev** (`api-server.ts:612-616`), iar modul dev este implicit când `NODE_ENV != production` și nu există `HSMC_API_KEY` setat de operator (`config.ts:140-149`). Vezi 5.e.

### 2.4 Frontend web — `src/` (React + Vite)

- **Stare: parțial funcțional** (rulează, dar depinde de un API și de un nod care nu sunt expuse public).
- 20 de pagini în `src/pages/`, 18 rute în `src/App.tsx:39-59`: `/`, `/landing`, `/onboarding`,
  `/app`, `/app/profile`, `/app/settings`, `/node`, `/whitepaper`, `/mainnet`, `/mainnet/readiness`,
  `/rust-node`, `/investors`, `/listing-kit`, `/explorer`, `/forgot-password`, `/wallet-auth`,
  `/reset-password`, `/pay/:slug`.
- Pagina `/whitepaper` publică azi valorile corecte: 500.000.000 cap dur, ~21.000.000 supply efectiv,
  SHA-256d, ~120s (`src/pages/WhitepaperPage.tsx:13-16,49-56,145-162`).

### 2.5 Android nativ — `android-native/` (Kotlin, Jetpack Compose)

- **Stare: schelet avansat, nesemnat, nepublicabil încă.**
- 40 de fișiere `.kt`; 15 ecrane în `ui/screens/`; toate 15 sunt legate în navigație
  (`navigation/AppNavGraph.kt:115-208`): Welcome, Login, CreateWallet, ImportWallet,
  SeedPhraseConfirmation, BiometricSetup, Dashboard, Send, Receive, TransactionHistory,
  TransactionDetail, Staking, Privacy, HardwareWallet, Settings.
- Chei și mnemonic: `core/Bip39Mnemonic.kt`, `core/HdKeys.kt`, `core/AndroidKeyStoreWrapper.kt`,
  `core/SecurePrefs.kt`, `core/WalletStorage.kt`.
- Rețea: un singur client, `network/NodeClient.kt`, care merge **exclusiv** prin `/node-proxy` al
  API server-ului și declară explicit că nu fabrică solduri/hash-uri (`NodeClient.kt:17-24`).
- Blocaje Play Store, verificabile în cod: `targetSdk = 34` (`app/build.gradle.kts:25`; cerința
  curentă a Play Store este 35) și **nicio `signingConfig` de release** în `app/build.gradle.kts`
  (există doar `applicationIdSuffix = ".debug"` la `:49`).

### 2.6 Desktop și mobil

| Componentă | Stare | Detaliu |
|---|---|---|
| `desktop/` (Electron) | **doar cod** | `main.ts` 453 linii, `preload.ts` 153 linii, `package.json` cu `electron-builder`; nu există build publicat. |
| `mobile/` (React Native 0.76.5) | **doar cod** | `App.tsx` 109 linii, directoare `src/{components,hooks,navigation,screens,services,store,utils}`; nu există build publicat. |

### 2.7 HSMCPay (procesatorul de plăți)

- **Stare: fluxul de cumpărare = cod, niciodată rulat împotriva Stripe; fluxul de vânzare = OPRIT.**
- Grila de fee-uri este implementată **corect**, la toate pragurile, în
  `server/api-server.ts:970-987`: <$6.000 → $1,00; $6.000–10.000 → $3,00; $10.000–50.000 → $5,00;
  $50.000–1.000.000 → $10,00; >$1.000.000 → $200,00. Fee-ul este **fix**, nu procentual.
- **Vânzare (sell / payout):** refuzată cu **410 Gone** înainte de orice apel Stripe, orice scriere
  în DB și orice modificare de balanță, dacă `HSMCPAY_SELL_ENABLED` nu este exact `"true"`
  (`api-server.ts:1328-1341`); flagul e `false` implicit (`config.ts:168`). Webhook-ul de payout
  verifică semnătura Stripe, apoi **nu creditează, nu debitează și nu settlează nimic** — doar
  loghează și răspunde 200 ca Stripe să nu reîncerce (`api-server.ts:1604-1620`).
- **Buyback:** `/treasury/buyback` returnează **410** și nu scrie nimic cât timp
  `TREASURY_BUYBACK_ENABLED` este `false` (`api-server.ts:2593-2603`, `config.ts:173`).
- Fără chei Stripe în mediu, rutele Stripe răspund 503 (`config.ts:151-156`); nu există fallback de
  simulare. Nu există rambursări, dispute sau chargeback implementate.

### 2.8 Bridge (HSMC ↔ wHSMC)

- **Stare: parțial în cod, zero on-chain.**
- Trei implementări paralele: contractele Solidity (2.2), un serviciu TypeScript `bridge/src/`
  (880 linii: `connectors/`, `monitor.ts`, `types.ts`) și un modul Rust în RPC
  (`rust-node/hsmc-rpc/src/bridge.rs`, 722 linii, rute `/bridge/lock`, `/bridge/status/:id`,
  `/bridge/stats`, `/bridge/verify-proof`, `/bridge/relay-queue`).
- `bridge_lock` **nu verifică nicio depunere on-chain**: calculează un „mainnet_tx_hash" determinist
  din inputurile cererii (`bridge.rs:288-293`) și întoarce calldata de mint. Vezi 5.c.

---

## 3. Matricea de funcționalitate

Legendă: **Da** = funcționează și este verificabil azi; **Parțial** = există și rulează, dar
incomplet sau într-un singur mediu; **Nu** = nu există; **Doar bibliotecă** = cod apelabil, dar
neconectat la fluxul real.

| # | Capabilitate | Stare | Dovadă în cod | Ce lipsește |
|---|---|---|---|---|
| 1 | Minat PoW pe un nod local | **Da** | `hsmc-node/src/main.rs:825-958` | — |
| 2 | Block time țintă de 120s respectat | **Nu** | `main.rs:833` — parametrul e `_target_block_time_ms`, nefolosit; pauză de 50ms între blocuri (`:954`) | Producătorul minează cât poate de repede; nu există pacing |
| 3 | Rețea P2P (bootstrap, peers, gossip) | **Nu** | `main.rs:355` (registru gol), `:618-639` (sync peste zero peers) | Bootstrap/seed nodes, listen, dial, handshake Noise pornit |
| 4 | Sincronizare blocuri între noduri | **Nu** | `hsmc-p2p/src/sync.rs` există, dar nu e alimentat | Orice al doilea nod |
| 5 | Verificare de semnături în consens | **Nu** | `validator.rs:502-512` (doar hex/format); `hsmc-core` nu depinde de `hsmc-crypto` | Verificarea criptografică reală a fiecărei tranzacții |
| 6 | Confidențialitate on-chain (RingCT/CLSAG/stealth) | **Doar bibliotecă** | `hsmc-crypto/src/{ringct,ring_sig,stealth}.rs`; niciun apel din `hsmc-core` | Consens care să verifice proof-urile; portofel care să trimită tx confidențiale |
| 7 | Shielded pool (STARK) | **Parțial** | `hsmc-starks/src/lib.rs`, CLI `main.rs:157-297`, rute `/shielded/*` | Stare în lanț (azi e un JSON pe disc), verificare în consens |
| 8 | Stratum V1 (mining pool protocol) | **Parțial** | `hsmc-stratum/src/lib.rs` (vardiff, job cache, ban system) | Mineri reali conectați; expunere publică |
| 9 | Stratum V2 | **Nu** | `hsmc-stratum/src/lib.rs:3-6` — TODO explicit | Noise_NX, framing binar, job negotiation |
| 10 | RPC JSON/HTTP | **Da (local)** | `hsmc-rpc/src/server.rs` — 65 rute | Expunere publică, autentificare, rate limit |
| 11 | Metrics Prometheus | **Da (local)** | `main.rs:77-102,962+` (port 9090) | Scrape extern, alerte |
| 12 | Explorer | **Parțial** | `src/pages/Explorer.tsx` + `/explorer/*` în API | Lanț real de afișat; URL public |
| 13 | Portofel web | **Parțial** | `src/pages/AppPage.tsx`, `WalletAuth.tsx` | Nod public; privacy reală |
| 14 | Portofel Android | **Parțial** | `android-native/` — 15 ecrane, `NodeClient.kt` | Semnare release, `targetSdk 35`, publicare |
| 15 | Portofel desktop (Electron) | **Doar cod** | `desktop/main.ts`, `desktop/preload.ts` | Build semnat, distribuție |
| 16 | Portofel mobil (React Native) | **Doar cod** | `mobile/App.tsx` + `mobile/src/` | Build, testare, distribuție |
| 17 | Staking | **Parțial** | `hsmc-core/src/state.rs` (`StakingRegistry`), rute `/staking/*`, tabele `stakes` | Recompense reale; legare la consens |
| 18 | Guvernanță on-chain | **Parțial** | `hsmc-core/src/governance.rs`, rute `/governance/*`, `main.rs:643-689` | Vot ponderat real; execuție on-chain |
| 19 | DEX / AMM intern | **Orfan** | `rust-node/hsmc-amm/` — niciun crate nu îl folosește | Integrare; nu e în RPC, nu e în nod |
| 20 | Stablecoin (CDP) | **Doar cod** | `hsmc-stablecoin/` + rute `/stablecoin/*` | Consens, colateral real, oracle on-chain |
| 21 | VM WASM (contracte) | **Doar cod** | `hsmc-vm/` (wasmtime), rute `/vm/*` | Stare persistentă în lanț; gaz real |
| 22 | Rollup L2 | **Doar cod** | `hsmc-rollup/`, rute `/rollup/*` | Bridge L1↔L2, DA real |
| 23 | MPC / threshold custody | **Orfan** | `hsmc-mpc/` — niciun crate nu îl folosește | Integrare |
| 24 | Oracle de preț | **Parțial** | `hsmc-oracle/src/lib.rs` — 6 API-uri CEX | Oracle on-chain; semnare; agregare verificabilă |
| 25 | Bridge lock (HSMC → extern) | **Nu (fabricat)** | `hsmc-rpc/src/bridge.rs:288-293` — hash calculat, nu observat | Verificarea reală a depunerii |
| 26 | wHSMC mint pe BSC/ETH/Polygon | **Nu** | `contracts/bridge/*.sol` nedeployate; `contracts/deployments/` absent | Deployment + multisig + relayer real |
| 27 | HSMCPay — cumpărare | **Parțial** | `api-server.ts` Stripe Elements + webhook semnat + idempotență | Rulare reală împotriva Stripe (nu s-a întâmplat niciodată) |
| 28 | HSMCPay — vânzare | **Nu (oprit)** | `api-server.ts:1328-1341` → 410; `config.ts:168` | Verificare depunere on-chain + cale reală de payout |
| 29 | Rambursări / dispute / chargeback | **Nu** | — | Tot |
| 30 | Treasury on-chain | **Nu** | `handleTreasuryBalance` sumă în SQLite (`api-server.ts:2535-2557`) | Contract de treasury |
| 31 | Buyback & burn | **Nu (oprit)** | `api-server.ts:2593-2603` → 410 | Mecanism on-chain |
| 32 | WebAuthn (register/login) | **Da** | `api-server.ts:265,3131,3654-3662`; PR #24 | Politici de producție, revocare dispozitive |
| 33 | REST generic `/rest/v1/*` | **Da (restricționat)** | allow-list `api-server.ts:748-779`, owner-scope `:784-800`, denylist coloane `:806-814` | Închiderea P0-urilor rămase (5.e) |
| 34 | Audit extern | **Nu** | — | Orice raport de audit; nu se publică URL-uri de audit |

---

## 4. Date și custodie

### 4.1 Modelul de date

- O singură bază **SQLite**, un fișier (`hsmc.db`), accesat sincron din `server/api-server.ts`.
- **44 de tabele** — numărat la runtime pe o copie a bazei de lucru, 2026-11-07:
  `SELECT count(*) FROM sqlite_master WHERE type='table'` → **44**.
- Fișierul `server/schema.sqlite.sql` (439 linii) declară doar **36** de tabele. Diferența
  (`users`, `webauthn_credentials`, `webhook_events`, `cards`, `cardholders`, `card_transactions`,
  `card_funding_events`, `pool_events` și altele) este creată inline în `api-server.ts` la pornire
  (ex. `webauthn_credentials` la `:265`, `webhook_events` la `:274`, `cardholders` la `:282`).
  **Consecință:** schema din git nu descrie baza reală. Orice migrare viitoare pornește de la o
  schiță incompletă.

### 4.2 Unde stă materialul criptografic

| Tabelă | Coloane critice | Definiție | De ce contează |
|---|---|---|---|
| `wallet_seeds` | `encrypted_seed`, `wallet_address`, `user_id` | `schema.sqlite.sql:396-403` | Sămânța portofelului. Dacă `encrypted_seed` nu e criptat efectiv, un dump = fonduri furate. |
| `totp_secrets` | `secret`, `backup_codes` | `schema.sqlite.sql:351-358` | Al doilea factor; `backup_codes` sunt coduri de recuperare în clar. |
| `webauthn_credentials` | `public_key`, `user_id`, `device_name` | `api-server.ts:265` | Doar chei publice — corect prin design, dar leagă identitatea de dispozitiv. |
| `profiles` | credențiale de cont | `schema.sqlite.sql:228` | Date de cont; `password_hash` este în denylist-ul REST (`api-server.ts:806-814`). |
| `payment_sessions` | `card_holder`, `card_last4`, `otp_code`, `stripe_client_secret`, `settlement_tx_hash` | `schema.sqlite.sql:171-189` | Date de card + coduri OTP + secrete Stripe într-un singur rând. |

### 4.3 Unde stau banii (sau ce ține locul banilor)

| Tabelă | Ce reprezintă | Sursă |
|---|---|---|
| `wallets` | `balance`, `staked_balance` — solduri **în tokeni**, nu în USD | `schema.sqlite.sql:405-415` |
| `stakes`, `staking_pools` | poziții de staking | `schema.sqlite.sql:284-307` |
| `lp_positions`, `liquidity_pools` | poziții de lichiditate | `schema.sqlite.sql:85-111` |
| `internal_transfers` | transferuri interne între conturi | `schema.sqlite.sql:75` |
| `transactions`, `blocks` | oglinda lanțului în SQLite | `schema.sqlite.sql:7,361` |
| `treasury_transactions` | fee-uri încasate, „settled" | `schema.sqlite.sql` + `api-server.ts:2535-2557` |
| `payment_sessions` | sesiuni Stripe (cumpărare/vânzare) | `schema.sqlite.sql:171` |

**Realitatea custodiei:** fee-urile sunt încasate în **USD în contul Stripe**, dar sunt
contabilizate în `treasury_transactions` în **tokeni**. Nu există reconciliere automată între cele
două, nu există contract de treasury, nu există buyback on-chain și nu există burn. Treasury-ul
este o **însumare într-un tabel local**.

### 4.4 Date de card și KYC

| Tabelă | Conținut | Definiție |
|---|---|---|
| `cardholders` | nume, email, telefon, stare KYC, id Stripe | `api-server.ts:282` |
| `cards` | carduri emise, limite | `api-server.ts` (rute `/cards/*`) |
| `card_transactions` | tranzacții pe card | în allow-list-ul REST (`api-server.ts:750`) |
| `card_funding_events` | alimentări de card | `api-server.ts:331` |
| `payment_sessions` | brand card, ultimele 4 cifre, titular | `schema.sqlite.sql:171-189` |

**P0 deschis, verificabil:** `GET /cardholders/:id` este servit de `handleCardholderGet(chId)`
(`api-server.ts:1864-1869`), care **nu apelează `requireJWTUser`** — spre deosebire de
`handleCardCreate` (`:1874-1876`). Orice client care cunoaște un id primește rândul complet de
cardholder (nume, email, telefon, KYC). API-ul nu este expus public azi; se activează la expunere.

### 4.5 Prețuri și oracle

| Sursă | Ce este | Risc |
|---|---|---|
| `swap_rates` (`schema.sqlite.sql:309-316`) | rata from/to token, `REAL` | Este în **allow-list-ul REST** (`api-server.ts:770`) și **nu** este în lista de tabele cu owner (`:784-800`) → orice utilizator autentificat poate scrie cursul. |
| `price_history` (`:221-227`) | istoric preț + volum | Idem: scriibil prin REST, fără owner. |
| `token_metrics` (`:317`) | metrici de token | Idem. |
| `hsmc-oracle` (Rust) | 6 API-uri CEX, trase la runtime | Fără semnătură, fără agregare verificabilă; un singur punct de adevăr off-chain. |

### 4.6 Criptarea la nivel de câmp

- `server/db-crypto.ts` (180 linii) oferă criptare simetrică pentru coloane sensibile, condusă de
  `DB_ENCRYPTION_KEY`.
- Criptarea este **opțională**: `encryptSensitiveColumns` iese imediat dacă
  `isEncryptionAvailable()` este fals (`api-server.ts:843-849`), iar valorile prefixate cu
  `PLAINTEXT:` trec necriptate. Fără cheie configurată, coloanele stau în clar în fișierul SQLite.
- Decriptarea pe GET prin REST a fost **eliminată** în PR #23 (`api-server.ts:852-855`), iar tabelele
  cu material sensibil sunt excluse complet din allow-list.

**De ce contează totul mai sus:** într-un singur fișier SQLite stau, împreună, chei de portofel,
secrete TOTP, date de card, KYC și cursuri de schimb. Cine obține fișierul obține toate cele patru.
Până când P0-urile din secțiunea 5.e nu sunt închise și verificate prin teste runtime, API-ul nu se
expune public și nu se mută bani reali.

---

## 5. Ce NU este încă adevărat

Toate punctele din această secțiune sunt **roadmap, nu livrat**. Fiecare are dovada în cod.

### (a) Confidențialitatea este structural imposibilă în consens azi

`rust-node/hsmc-core/Cargo.toml` **nu are nicio dependență de `hsmc-crypto`**. Singurele referiri la
`hsmc-crypto` în `hsmc-core` sunt două comentarii care recunosc lipsa:
`hsmc-core/src/script.rs:545` („full impl in hsmc-crypto") și `:638` („in production use full
ECDSA/Schnorr verification from hsmc-crypto").

Consecințe directe, verificabile:
1. Validatorul verifică doar **formatul hex** al semnăturilor, nu criptografia:
   `validate_ring_sig_format` (`validator.rs:503-512`), `validate_commitment_format` (`:515-522`),
   `validate_range_proof_format` (`:524-533`).
2. Nu există nicio verificare de semnătură pentru tranzacțiile transparente în `hsmc-core`
   (grep pe `verify_signature|ecdsa|schnorr|public_key` în `hsmc-core/src/*.rs` → doar câmpuri de
   stare în `state.rs`, nicio verificare).
3. Bibliotecile RingCT/CLSAG/stealth sunt reale și apelabile prin RPC (`/crypto/ring-sign`,
   `/crypto/commitment`, `/crypto/range-proof`, `/crypto/stealth/generate`), dar **consensul nu le
   cheamă niciodată**. Un proof valid și unul inventat trec la fel.
4. Portofelul trimite tranzacții transparente. Confidențialitatea este **roadmap**, nu funcționalitate.

### (b) Nodul este genesis-only; nu există rețea

- La pornire, lanțul se încarcă din RocksDB; dacă nu există blocuri, pornește „from genesis"
  (`main.rs:481-491`). Nu există un genesis public distribuit, nici un snapshot de rețea.
- P2P: registrul de peers pornește gol (`main.rs:355`), iar `spawn_p2p_sync` (`:618-639`) întreabă
  `sync.blocks_behind()` pe un set vid. În `main.rs` nu există bootstrap, `add_peer`, listen sau
  dial. **Nu există rețea publică, nici testnet.**
- Block producer-ul **ignoră ținta de 120s**: parametrul se numește `_target_block_time_ms`
  (`main.rs:833`) și nu e folosit nicăieri în funcție; bucla minează continuu cu o pauză de 50ms
  (`:954`). Ajustarea de dificultate există în `hsmc-core` (`block.rs:852`) dar nu este cuplată la
  producător.
- Stratum: doar **V1**; V2 este TODO (`hsmc-stratum/src/lib.rs:3-6`).
- Formal verification: `hsmc-core/src/verification.rs` este integral în `#[cfg(kani)]`
  (`verification.rs:15`) — nu rulează în build-ul normal și nu a rulat în CI.

### (c) wHSMC / BridgeMinter sunt scrise, dar niciodată deployate

- `contracts/deployments/` nu există; nu există adresă publicată, nici măcar pe testnet.
- **Adrese hardcodate, care nu sunt ale proiectului.** `hsmc-rpc/src/bridge.rs:44-51` returnează
  ca „contract wHSMC":
  - BSC → `0xA193E42526F1FEA8C99AF609dcEabf30C1c29fAA`
  - Ethereum → `0x4d224452801ACEd8B2F0aebE155379bb5D594381`
  - Polygon → `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270`
  - Solana → `wHSMCTokenMintAddressXXXXXXXXXXXXXXXXXXXXXXXX` (literal, placeholder)
  - XMR → `atomic_swap_contract_xmr` (literal), BTC → `htlc_contract_btc` (literal)

  Ultimele două sunt evident placeholder-e. Primele trei sunt adrese în format valid care **nu
  corespund niciunui contract al proiectului**; valoarea de pe Polygon este adresa publică bine
  cunoscută a WMATIC, iar cea de pe Ethereum a unui token ERC-20 existent (APE) — verificabil pe un
  explorer public, de confirmat de owner. Tratarea lor ca
  adrese wHSMC este o eroare gravă de prezentare: un client care le folosește trimite fonduri către
  alt contract. **Trebuie înlocuite cu TBD până la un deployment real.**
- `bridge_lock` fabrică dovada: `mainnet_tx_hash` este calculat din `(from, to, amount, now)`
  (`bridge.rs:288-290`), nu observat pe lanț. Nu există verificare a unei depuneri reale, deci nu
  există bridge.

### (d) `hsmc-mpc`, `hsmc-amm` și `hsmc-pos` sunt crate-uri orfane

Sunt declarate în `rust-node/Cargo.toml:3-19`, dar **niciun alt crate nu depinde de ele** (verificat
prin toate dependențele `path = "../…"` din workspace: `hsmc-crypto`, `hsmc-node`, `hsmc-p2p`,
`hsmc-rpc`, `hsmc-storage`, `hsmc-stratum`, `hsmc-amm`, `hsmc-pos`). Cod care compilează și nu
rulează niciodată. Prezența lor în workspace nu este o funcționalitate.

### (e) Securitate: P0-uri deschise care se activează la expunere

API-ul nu rulează public azi. Următoarele se activează în momentul expunerii:

1. **Mod dev = ocolire completă a autentificării.** `checkApiKey` returnează `true` când
   `IS_DEV_MODE` (`api-server.ts:612-616`), iar modul dev este implicit fără `HSMC_API_KEY` setat de
   operator (`config.ts:140-149`). Un deployment „de producție" care uită variabila pornește fără
   autentificare.
2. **Date de card/KYC fără autentificare:** `handleCardholderGet` (`api-server.ts:1864-1869`).
3. **Tabele de preț scriibile:** `swap_rates`, `price_history`, `token_metrics` sunt în allow-list
   (`:748-779`) și în afara owner-scope (`:784-800`).
4. **Payout fără verificare on-chain** — parțial adresat: fluxul e oprit cu 410 (2.7), dar
   implementarea din spate rămâne nefolosită până la o cale reală de plată.
5. Fabricarea de balanță prin REST, creditarea într-un cont hardcodat și cursa de dublu payout,
   documentate în analiza HSMCPay (`shared/payments/hsmcpay-gap-analysis-2026-11-07.md`).

**Regulă:** API-ul nu se expune public și nu se mută bani reali până când aceste puncte nu sunt
închise și verificate prin teste runtime.

### (f) Alte afirmații care nu sunt adevărate azi

| Afirmație | Adevărul |
|---|---|
| „Preț HSMC / market cap / TVL / APR" | Nu există piață, nu există listare, nu există preț. Orice cifră ar fi inventată. |
| „Treasury public, verificabil on-chain" | Treasury = sumă într-un tabel SQLite; fee-urile sunt custodied off-chain în Stripe. |
| „Buyback & burn automat" | Oprit prin 410 (`api-server.ts:2593-2603`); niciun mecanism on-chain. |
| „Auditat de o terță parte" | Niciun audit extern. Nu se publică URL de audit până nu există. |
| „Secured by RingCT / privacy by default" | Bibliotecile există; consensul nu le verifică (5.a). |
| „Bridge live pe 10 reținouri" | Zero deployment-uri; vezi 5.c. |
| „Stratum V2" | Doar V1; V2 e TODO (5.b). |
| „Mainnet live" | Genesis-only, fără rețea (5.b). |

---

## 6. Întrebări deschise pentru owner

Fapte pe care **numai owner-ul** le poate furniza. Nu se inventează și nu se completează prin
analogie. Fiecare răspuns deblochează o parte din documentele publice.

1. **Domeniu:** se înregistrează `hsmc.network`? Cine este registrantul și pe ce nume/entitate?
   Până atunci, toate URL-urile publice rămân **TBD**.
2. **Entitate legală:** ce entitate (dacă există) emite tokenul, semnează contractele cu procesatorii
   de plăți și răspunde față de utilizatori? Jurisdicție?
3. **Licență / regim:** HSMCPay procesează plăți în USD prin Stripe — sub ce licență/regim se
   desfășoară activitatea și cine este responsabilul de conformitate?
4. **Echipă:** cine sunt oamenii reali din spate (nume, roluri, entitate)? Fără bio-uri inventate.
5. **Audit:** se comandă un audit extern? La ce firmă, cu ce buget și în ce ordine (contracte,
   consens, API)? Până la raport, nu există audit.
6. **Dată de lansare:** există o dată țintă pentru mainnet? Nu se publică niciuna până nu e reală.
7. **Treasury:** se acceptă poziția publică „fee-uri custodied off-chain, contabilizate în ledger
   intern; treasury on-chain = roadmap"? Cine deține cheile contului Stripe?
8. **Expansiunea acronimului HSMC:** care este, dacă există? Nu este extins nicăieri în cod.
9. **Deploy wHSMC:** pe ce rețea se face primul deployment (BSC, ETH, Polygon) și cu ce multisig?
   Cine sunt cei 5 validatori ai bridge-ului?
10. **Date de card existente:** ce se întâmplă cu rândurile din `cardholders`/`cards`/
    `payment_sessions` adunate până acum — se șterg, se migrează, se păstrează? Cine e
    operatorul de date (GDPR)?
11. **Strategie de listare:** ce exchange se vizează primul și ce documente se pregătesc
    (listing pack-ul există, dar fără URL-uri și fără cifre de piață).
12. **Prioritate de produs:** se repară mai întâi consensul (semnături + privacy + P2P) sau produsul
    de plăți (HSMCPay)? Cele două cer echipe diferite.
13. **Staking/governanță:** se lansează cu recompense reale sau rămân parametri de test?
14. **Buget și termen** pentru infrastructura de seed nodes (5+ regiuni) necesară la mainnet.

---

## 7. Anexă — corecții aplicate

Registrul de contradicții, redus la ce era greșit și ce este adevărul acum.

### 7.1 Corectat în PR #25 (`4cf846c`, „fix(listings): correct PoW, supply, block time, GitHub org and dead URLs")

| Ce era greșit | Adevărul de azi | Unde s-a corectat |
|---|---|---|
| Supply total **1.000.000.000.000 (1T)** | **500.000.000 HSMC** cap dur; **~21.000.000** supply efectiv minat | `listings/coingecko.json`, `listings/coinmarketcap.json`, `src/pages/WhitepaperPage.tsx:13-16,49-56,145-162`, `src/pages/ListingKitPage.tsx`, `src/pages/MainnetHub.tsx`, `PROJECT_STATUS.md`, `docs/exchange-listing/project-overview.md` |
| Consens „SHA3 + Bulletproofs aggregation" | **SHA-256d (dublu SHA-256)** | documentele de listare, `WhitepaperPage.tsx:49,56,145,154` |
| Block time **60s** | **120s** (`TARGET_BLOCK_TIME_SECS`) | listing-uri, whitepaper, `rust-node/hsmc-node` default `BLOCK_TIME_MS` 60000 → 120000, calculul de dificultate din frontend |
| Organizație GitHub **XMC-OXR** | **`bnboxr`** | `src/components/Footer.tsx`, `HeroSection.tsx`, `Documentation.tsx`, `index.html`, `legal/LEGAL_NOTICE.md`, `ipfs-publish/publish.sh` |
| URL-uri `hsmc.network`, explorer, API de supply/market | **TBD** (domeniul nu e înregistrat) | ambele fișiere de listing, paginile publice |
| RPC `get_supply()` raporta 1e12 hardcodat | derivă din `MAX_SUPPLY` + seria de halving, cu teste unitare | `rust-node/hsmc-rpc/src/handlers.rs` |

### 7.2 Corectat în PR #26 (`f5914f7`, „payments(hsmcpay): switch the sell flow off, remove fabricated on-chain hashes")

| Ce era greșit | Adevărul de azi | Unde s-a corectat |
|---|---|---|
| Fluxul de vânzare HSMCPay rula fără verificarea depunerii on-chain | **Oprit**: `/stripe/payout` → **410**, înainte de orice apel Stripe/DB | `server/api-server.ts:1328-1341`, `server/config.ts:168` |
| Webhook-ul de payout settlea înainte de a ști ce s-a întâmplat | Verifică semnătura, apoi **nu mișcă nimic**; doar loghează și răspunde 200 | `server/api-server.ts:1604-1620` |
| Buyback-ul scria un `0x…` aleatoriu ca „tx hash" de burn | **Oprit**: `/treasury/buyback` → **410**, nu scrie nimic | `server/api-server.ts:2593-2603`, `config.ts:173` |
| Hash-uri `"0x" + randomUUID()` în `treasury_transactions.tx_hash` și `payment_sessions.settlement_tx_hash` | Eliminate; câmpurile rămân `NULL`; cumpărarea întoarce referința reală Stripe (PaymentIntent id) | `server/api-server.ts`, `src/components/HSMCPay.tsx` |
| UI afișa „Tx Ref" fabricat | Rândul a dispărut; panoul de succes arată referința Stripe reală | `src/components/HSMCPay.tsx`, `src/components/Dashboard.tsx` |

### 7.3 Contradicții încă deschise (nu au fost corectate)

Acestea sunt verificabile în `main` azi și trebuie tratate înainte de orice comunicare publică:

| Afirmație rămasă în repo | Adevărul | Unde |
|---|---|---|
| Adrese „contract wHSMC" pe BSC/ETH/Polygon | Nu există niciun contract deployat; adresele nu sunt ale proiectului (una este WMATIC pe Polygon) | `rust-node/hsmc-rpc/src/bridge.rs:44-51` |
| „Production-Ready" în titlul contractelor | Scrise și testate local, **nedeployate** | `contracts/README.md:1-4` |
| „All 10 Chains" în ghidul de deployment | 9 scripturi, zero deployment-uri executate | `contracts/DEPLOY_GUIDE.md:1-20` |
| Header „HSMC Node v2.0 — Full Production Orchestration" | Nod genesis-only, fără P2P, fără verificare criptografică | `rust-node/hsmc-node/src/main.rs:1-13` |
| `contracts/README.md` listează audit extern ca bifă de checklist | Niciun audit nu a fost făcut | `contracts/README.md` (secțiunea Audit) |
| `server/schema.sqlite.sql` descrie 36 de tabele | Baza reală are 44; restul sunt create inline | `server/schema.sqlite.sql` vs `server/api-server.ts:265-331` |

---

## Referințe interne

- Fapte canonice ale lanțului: `shared/HSMC-CANONICAL-FACTS.md`
- Audit whitepaper ↔ cod: `WHITEPAPER_AUDIT.md`
- Review de securitate API: `shared/security/api-security-review-2026-11-07.md`
- Analiză money-safety HSMCPay: `shared/payments/hsmcpay-gap-analysis-2026-11-07.md`
- Grila de fee-uri: `shared/HSMCPay-Fee-Schedule.md`

**Verificat pe `main` la `4cf846c`.** Numărul de tabele (44) a fost măsurat la runtime pe o copie a
bazei de lucru, 2026-11-07, fără a modifica baza partajată.
