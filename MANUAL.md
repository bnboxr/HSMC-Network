# HSMC Network — Manual Complet de Rulare
> **Ultima actualizare:** 2026-07-21

---

## 📋 Cuprins

1. [Cerințe minime de sistem](#1-cerințe-minime-de-sistem)
2. [Instalare tooling](#2-instalare-tooling)
3. [Cum să rulezi frontend-ul (Web App)](#3-cum-să-rulezi-frontend-ul-web-app)
4. [Cum să rulezi Rust node-ul (Blockchain)](#4-cum-să-rulezi-rust-node-ul-blockchain)
5. [Cum să rulezi backend-ul Supabase](#5-cum-să-rulezi-backend-ul-supabase)
6. [Cum să deploy-ezi smart contracts (EVM)](#6-cum-să-deploy-ezi-smart-contracts-evm)
7. [Cum să conectezi totul — End-to-End](#7-cum-să-conectezi-totul--end-to-end)
8. [Cum să testezi fiecare componentă](#8-cum-să-testezi-fiecare-componentă)
9. [Cum să faci deploy pe mainnet](#9-cum-să-faci-deploy-pe-mainnet)
10. [Depanare (Troubleshooting)](#10-depanare-troubleshooting)
11. [Comenzi rapide (Quick Reference)](#11-comenzi-rapide-quick-reference)

---

## 1. Cerințe minime de sistem

### Pentru development (local)

| Componentă | Minim | Recomandat |
|-----------|-------|-----------|
| **OS** | Linux (Ubuntu 22.04+), macOS 12+, Windows cu WSL2 | Ubuntu 22.04 |
| **RAM** | 8 GB | 16 GB |
| **CPU** | 4 core | 8 core |
| **Disk** | 20 GB free | 50 GB SSD |
| **Internet** | 10 Mbps | 100 Mbps |

### Pentru production (mainnet VPS)

| Resursă | Minim per nod |
|---------|-------------|
| **vCPU** | 4 core |
| **RAM** | 8 GB |
| **SSD** | 200 GB |
| **Bandwidth** | 1 TB/lună |
| **Cost estimat** | ~$25-32/lună (Hetzner, Vultr, OVH) |

---

## 2. Instalare tooling

### 2.1 Rust (pentru blockchain node)

```bash
# Instalează Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# După instalare, reîncarcă shell-ul
source "$HOME/.cargo/env"

# Verifică
rustc --version    # ≥ 1.75.0
cargo --version    # ≥ 1.75.0

# Adaugă target-uri utile
rustup target add wasm32-unknown-unknown
```

### 2.2 Bun (pentru frontend)

```bash
# Instalează Bun
curl -fsSL https://bun.sh/install | bash

# Reîncarcă shell-ul
source ~/.bashrc

# Verifică
bun --version      # ≥ 1.0.0
```

### 2.3 Node.js + npm (alternativă pentru Bun)

```bash
# Via nvm (recomandat)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Verifică
node --version     # ≥ 20.0.0
npm --version      # ≥ 10.0.0
```

### 2.4 Git

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install git -y

# macOS
brew install git

# Verifică
git --version
```

### 2.5 Docker (opțional, pentru deployment)

```bash
# Ubuntu
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER

# Verifică (după re-login)
docker --version
docker compose version
```

### 2.6 Supabase CLI (opțional, pentru edge functions locale)

```bash
# Via npm
npm install -g supabase

# Via brew (macOS)
brew install supabase/tap/supabase

# Verifică
supabase --version
```

---

## 3. Cum să rulezi frontend-ul (Web App)

### 3.1 Clonează proiectul

```bash
git clone https://github.com/bnboxr/HSMC-Network.git
cd HSMC-Network
```

### 3.2 Instalează dependințele

```bash
# Cu Bun (recomandat)
bun install

# SAU cu npm (alternativ)
npm install
```

### 3.3 Configurează variabilele de mediu

```bash
# Creează fișierul .env din șablon (dacă există)
cp .env.example .env 2>/dev/null || true

# Editează .env și setează:
nano .env
```

Conținut minim pentru `.env`:
```env
# Supabase (backend cloud)
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

# Rust node (opțional pentru dev local)
VITE_RUST_NODE_URL=http://localhost:8080
```

### 3.4 Pornește serverul de development

```bash
# Cu Bun (port 3000)
bun run dev

# SAU cu npm
npm run dev
```

**Output așteptat:**
```
  VITE v5.4.19  ready in 1046 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.x.x:3000/
```

### 3.5 Verifică

```bash
# În browser:
# Deschide http://localhost:3000/
# Ar trebui să vezi landing page-ul HSMC

# Din terminal:
curl -s http://localhost:3000/ | head -5
# Output: <!doctype html><html lang="en" class="dark">...
```

### 3.6 Build pentru producție

```bash
# Build cu Bun
bun run build

# Build cu npm
npm run build

# Output-ul e în folderul dist/
ls -la dist/
```

**⚠️ Problemă cunoscută:** Build-ul de producție poate necesita >4GB RAM din cauza Three.js (3D network visualization). Dacă build-ul se blochează la "transforming...":

```bash
# Soluție 1: Mărește memoria Node
NODE_OPTIONS="--max-old-space-size=4096" bun run build

# Soluție 2: Build în mod development (mai ușor)
bun run build:dev
```

### 3.7 Servește build-ul local

```bash
# După build, servește folderul dist/
cd dist
python3 -m http.server 3000   # Python
# SAU
npx serve . -p 3000           # Node
```

---

## 4. Cum să rulezi Rust node-ul (Blockchain)

### 4.1 Intră în folderul rust

```bash
cd rust-node
```

### 4.2 Verifică că totul compilează

```bash
# Verifică compilarea (fără să construiască)
cargo check

# Ar trebui să vezi:
# Checking hsmc-core v0.1.0
# Checking hsmc-crypto v0.1.0
# ...
# Finished dev [unoptimized + debuginfo]
```

### 4.3 Rulează testele

```bash
# Toate testele
cargo test

# Doar un crate specific
cargo test -p hsmc-core
cargo test -p hsmc-crypto
```

### 4.4 Pornește nodul în development

```bash
# Metoda 1 — Scriptul de start rapid (recomandat)
chmod +x start.sh
MINER_ADDRESS="HSMC_DEV_WALLET_000000000000000000000000" ./start.sh

# Metoda 2 — Manual cu cargo
MINER_ADDRESS="HSMC_DEV_WALLET_000000000000000000000000" \
RUST_LOG=info \
cargo run -p hsmc-node
```

**Output așteptat:**
```
╔══════════════════════════════════════════════════════════╗
║       HSMC Node v2.0 — Production Edition               ║
╠══════════════════════════════════════════════════════════╣
║  Chain ID  : 8888    │  Network : mainnet                ║
║  RPC port  : 8080    │  Stratum : :3333  Metrics: :9090 ║
║  Data dir  : ./hsmc-data                                 ║
╠══════════════════════════════════════════════════════════╣
║  Services  : RPC · Stratum · P2P · Miner · Governance   ║
║              Staking · FeeMarket · UTXO · Metrics       ║
╚══════════════════════════════════════════════════════════╝
```

### 4.5 Configurează variabilele de mediu

```bash
# Copiază șablonul
cp .env.example .env

# Editează
nano .env
```

Variabile esențiale:
```env
# Data directory pentru RocksDB
HSMC_DATA_DIR=./hsmc-data

# Porturi
RPC_PORT=8080
STRATUM_PORT=3333
METRICS_PORT=9090

# Mining
MINER_ADDRESS=HSMC_YOUR_ADDRESS_HERE
CHAIN_ID=8888

# Network
HSMC_NETWORK=mainnet
MAX_PEERS=64
BLOCK_TIME_MS=60000

# Bridge
WHSMC_BSC_ADDRESS=0x...
WHSMC_ETH_ADDRESS=0x...
WHSMC_POLYGON_ADDRESS=0x...
WHSMC_AVALANCHE_ADDRESS=0x...
WHSMC_ARBITRUM_ADDRESS=0x...

# Logging
RUST_LOG=info
```

### 4.6 Verifică funcționarea

```bash
# Health check
curl http://localhost:8080/health
# Output: {"status":"ok","uptime_secs":42}

# Chain info
curl http://localhost:8080/info
# Output: {"chain_height":0,"peer_count":0,"network":"mainnet"}

# Mining info
curl http://localhost:8080/mining/info
# Output: {"job_id":"...","header":"...","target":"...","difficulty":1}

# Metrics (Prometheus)
curl http://localhost:9090/metrics
```

### 4.7 Conectează un miner (Stratum)

```bash
# Test cu websocat (instalează: cargo install websocat)
echo '{"id":1,"method":"mining.subscribe","params":["miner1","2.0"]}' | websocat ws://localhost:3333

# Sau din frontend:
# Mergi la http://localhost:3000/node
# Configurează Stratum URL: ws://localhost:3333
# Adaugă adresa ta de wallet
```

---

## 5. Cum să rulezi backend-ul Supabase

### 5.1 Creează un proiect Supabase

1. Mergi la https://supabase.com
2. Creează cont (free tier: 500MB DB, 2GB bandwidth)
3. Creează proiect nou → notează numele și parola DB
4. Din dashboard, copiază:
   - **Project URL** (ex: `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public key** (ex: `eyJhbGciOi...`)
   - **service_role key** (secret — nu o împărtăși)

### 5.2 Conectează local la Supabase

```bash
# Instalează Supabase CLI
npm install -g supabase

# Autentifică-te
supabase login

# Link-uiește proiectul
supabase link --project-ref <project-ref-id>

# Verifică
supabase status
```

### 5.3 Rulează migrațiile

```bash
# Din folderul proiectului
cd HSMC-Network

# Aplică toate migrațiile pe proiectul Supabase
supabase db push

# SAU rulează-le manual în SQL Editor din dashboard:
# Copiază conținutul din supabase/migrations/ și execută în ordine
```

**Ordinea migrațiilor** (cele mai importante):
```
20260120025730...sql  → Structura de bază
20260120025835...sql  → Profiles + wallets
20260218101113...sql  → Transactions
...
20260720210000...sql  → Security RLS bundle (ultima)
```

### 5.4 Configurează Edge Functions

```bash
# Din folderul proiectului
cd HSMC-Network

# Setează variabilele de mediu pentru edge functions
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set RUST_NODE_URL=http://YOUR_VPS_IP:8080
supabase secrets set SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJh...

# Deploy-ează edge functions
supabase functions deploy hsmcpay-checkout
supabase functions deploy node-proxy
supabase functions deploy blockchain-engine
# ... etc pentru fiecare funcție
```

### 5.5 Testează edge functions local

```bash
# Pornește serverul local de edge functions
supabase functions serve

# Testează o funcție
curl -X POST http://localhost:54321/functions/v1/hsmcpay-checkout \
  -H "Content-Type: application/json" \
  -d '{"action":"health"}'
```

### 5.6 Configurează CORS și politici

Din Supabase Dashboard → Authentication → Settings:
- **Site URL**: `http://localhost:3000` (development) sau `https://hsmc.network` (production)
- **Redirect URLs**: adaugă `http://localhost:3000/**`

Din Supabase Dashboard → SQL Editor, rulează:
```sql
-- Verifică că RLS e activ pe toate tabelele
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = false;
-- Dacă returnează rânduri, activează RLS:
-- ALTER TABLE public.nume_tabel ENABLE ROW LEVEL SECURITY;
```

---

## 6. Cum să deploy-ezi smart contracts (EVM)

### 6.1 Instalează dependințele

```bash
cd contracts
npm install
```

### 6.2 Configurează variabilele

```bash
# Copiază șablonul
cp .env.example .env

# Editează .env
nano .env
```

Conținut `.env`:
```env
# Cheia privată a deployer-ului (nu o împărtăși niciodată!)
PRIVATE_KEY=0xabcdef1234567890...

# RPC URLs
BSC_RPC_URL=https://bsc-dataseed.binance.org
ETH_RPC_URL=https://eth.llamarpc.com

# API keys pentru verificare contracte
BSCSCAN_API_KEY=your_bscscan_api_key
ETHERSCAN_API_KEY=your_etherscan_api_key
```

### 6.3 Compilează contractele

```bash
npx hardhat compile

# Output:
# Compiling 2 files with 0.8.24
# Compilation finished successfully
```

### 6.4 Rulează testele

```bash
npx hardhat test

# Output:
#   WHSMC Token
#     ✓ Should deploy with correct name and symbol
#     ✓ Should enforce MAX_SUPPLY cap
#     ...
#   23 passing (5s)
```

### 6.5 Deploy pe testnet

```bash
# BSC Testnet
npx hardhat run scripts/deploy.ts --network bscTestnet

# Sepolia (Ethereum Testnet)
npx hardhat run scripts/deploy.ts --network sepolia

# Output salvat în contracts/deployments/<network>.json
```

### 6.6 Deploy pe mainnet

```bash
# ATENȚIE: Costă bani reali!

# BSC Mainnet (~$50-200 în BNB pentru gas)
npx hardhat run scripts/deploy.ts --network bsc

# Ethereum Mainnet (~$200-500 în ETH pentru gas)
npx hardhat run scripts/deploy.ts --network mainnet
```

### 6.7 Verifică contractele pe explorer

```bash
# BscScan
npx hardhat verify --network bsc <WHSMC_ADDRESS> <ADMIN_ADDRESS>
npx hardhat verify --network bsc <BRIDGEMINTER_ADDRESS> <WHSMC_ADDRESS> <ADMIN_ADDRESS> "[validator1,validator2,...]" 3

# Etherscan
npx hardhat verify --network mainnet <WHSMC_ADDRESS> <ADMIN_ADDRESS>
```

### 6.8 Configurează Gnosis Safe (multisig admin)

1. Mergi la https://app.safe.global
2. Creează Safe pe BSC/Ethereum cu 3-of-5 signers
3. Transferă ownership-ul contractelor către Safe:
   - `WHSMC.grantRole(DEFAULT_ADMIN_ROLE, safeAddress)`
   - `BridgeMinter.grantRole(DEFAULT_ADMIN_ROLE, safeAddress)`

---

## 7. Cum să conectezi totul — End-to-End

### 7.1 Arhitectura completă

```
[Browser] → Frontend (Vite + React) → Port 3000
     ↓ API calls
[Supabase] → Edge Functions (Deno)
     ↓ RPC calls
[Rust Node] → Blockchain Node → Port 8080 (RPC) / 3333 (Stratum)
     ↓
[RocksDB] → Persistent Storage
     ↓ Bridge events
[EVM Chain] → Smart Contracts (WHSMC + BridgeMinter)
```

### 7.2 Pași pentru integrare completă

```bash
# Terminal 1: Pornește Rust node-ul
cd rust-node
MINER_ADDRESS="HSMC_YOUR_ADDRESS" ./start.sh

# Terminal 2: Pornește frontend-ul
cd HSMC-Network
bun run dev

# Terminal 3: Deploy-ează edge functions (o singură dată)
supabase functions deploy hsmcpay-checkout node-proxy blockchain-engine

# Acum accesează:
# Frontend: http://localhost:3000
# RPC API: http://localhost:8080
# Stratum: ws://localhost:3333
# Metrics: http://localhost:9090/metrics
```

### 7.3 Verifică integrarea

```bash
# 1. Verifică că frontend-ul vede backend-ul
curl http://localhost:3000/

# 2. Verifică că frontend-ul poate apela edge functions
# (necesită autentificare Supabase)

# 3. Verifică că edge functions pot apela Rust node-ul
# Setează RUST_NODE_URL în Supabase Dashboard → Edge Functions → node-proxy

# 4. Testează tranzacția end-to-end:
# Din browser: http://localhost:3000/onboarding
# Creează wallet → Intră în app → Send 1 HSMC
# Verifică în terminal: apare tranzacția în log-ul Rust node-ului
```

---

## 8. Cum să testezi fiecare componentă

### 8.1 Teste Rust

```bash
cd rust-node

# Toate testele
cargo test

# Doar testele de unitate
cargo test --lib

# Doar testele de integrare
cargo test --test '*'

# Cu output mai detaliat
cargo test -- --nocapture

# Benchmark PoW
cargo bench -p hsmc-crypto
```

### 8.2 Teste Smart Contracts

```bash
cd contracts

# Toate testele
npx hardhat test

# Un test specific
npx hardhat test test/WHSMC.test.ts

# Cu gas reporting
REPORT_GAS=true npx hardhat test

# Coverage
npx hardhat coverage
```

### 8.3 Teste Frontend

```bash
cd HSMC-Network

# Toate testele
bun run test

# Sau cu npm
npm test

# În watch mode
bun run test:watch

# Lint
bun run lint
```

### 8.4 Teste End-to-End (manuale)

| Ce să testezi | Cum | Ce ar trebui să vezi |
|-------------|-----|---------------------|
| **Creare wallet** | Mergi la `/onboarding` → "Create New Wallet" | 12 cuvinte generate, checkbox confirmare |
| **Import wallet** | Mergi la `/onboarding` → "Import Existing Wallet" → introdu seed | Balance pe HSMC/BSC/ETH |
| **Send tranzacție** | Din Dashboard → Send → introdu adresă + amount | Tranzacția apare în istoric |
| **Private transaction** | Din Wallet → selectează "Private" → Full mode | Amount hidden, badge 🔒 |
| **Mining** | Din Node → configurează Stratum URL → Start Mining | Hashrate, shares submise |
| **Staking** | Din Dashboard → Staking → stake HSMC | Pool stats, APR, rewards |
| **HSMCPay Buy** | Din Dashboard → HSMCPay → introdu sumă → plătește cu cardul | HSMC creditat în wallet |
| **HSMCPay Sell** | Din Dashboard → HSMCPay → Sell → introdu sumă | HSMC debitat, tranzacție la treasury |
| **Explorer** | Din Dashboard → Explorer | Blocuri și tranzacții vizibile |
| **Bridge lock** | Din Dashboard → Bridge → lock HSMC | Lock event creat |
| **Governance** | Din Dashboard → Governance → creează propunere | Propunerea apare, se poate vota |

### 8.5 Teste de securitate

```bash
# Verifică RLS pe toate tabelele
# Din Supabase SQL Editor:
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = false;
# Trebuie să returneze 0 rânduri

# Verifică storage policies
# Din Supabase Dashboard → Storage → Policies

# Verifică console.log în producție
grep -r "console\.log" src/ --include="*.ts" --include="*.tsx"
# Trebuie să returneze 0 rezultate

# Verifică Math.random (doar în UI)
grep -r "Math\.random" src/components/ui/ --include="*.tsx"
# Acceptabil doar în shadcn/ui

# Verifică unwrap în Rust
grep -r "\.unwrap()" rust-node/hsmc-core/src/ --include="*.rs"
# Trebuie să returneze 0 rezultate
```

---

## 9. Cum să faci deploy pe mainnet

### 9.1 Pregătire

```bash
# 1. Asigură-te că toate testele trec
cd rust-node && cargo test && cd ..
cd contracts && npx hardhat test && cd ..
cd HSMC-Network && bun run test && cd ..

# 2. Build production
cd HSMC-Network && bun run build && cd ..

# 3. Tag release
git tag v1.0.0
git push --tags
```

### 9.2 Deploy noduri (5 VPS-uri în regiuni diferite)

```bash
# Pe fiecare VPS (Ubuntu 22.04, root):
# Copiază scriptul de bootstrap
scp rust-node/seed-bootstrap.sh root@<VPS_IP>:/root/

# SSH în VPS și rulează
ssh root@<VPS_IP>
chmod +x seed-bootstrap.sh
./seed-bootstrap.sh

# Verifică
systemctl status hsmc-node
curl http://localhost:8080/health
```

**VPS-uri recomandate:**

| Regiune | Provider | Tip | Cost/lună |
|---------|----------|-----|-----------|
| Frankfurt (EU) | Hetzner | CX42 | ~€25 |
| Amsterdam (EU) | TransIP | S6 | ~€30 |
| New York (US-E) | Vultr | Cloud Compute | ~$24 |
| Singapore (APAC) | OVH | Public Cloud | ~$28 |
| São Paulo (LATAM) | DigitalOcean | Droplet | ~$32 |

### 9.3 Deploy smart contracts

```bash
cd contracts

# Deploy pe BSC mainnet
npx hardhat run scripts/deploy.ts --network bsc

# Verifică pe BscScan
npx hardhat verify --network bsc <WHSMC_ADDRESS> <ADMIN_ADDRESS>

# Salvează adresele
echo "WHSMC_BSC_ADDRESS=<address>" >> ../rust-node/.env
```

### 9.4 Deploy frontend

```bash
cd HSMC-Network

# Build
NODE_OPTIONS="--max-old-space-size=4096" bun run build

# Opțiunea 1: Servește static
cd dist
python3 -m http.server 3000 &

# Opțiunea 2: Vercel
npx vercel --prod

# Opțiunea 3: Cloudflare Pages
npx wrangler pages deploy dist/

# Opțiunea 4: GitHub Pages
git checkout -b gh-pages
cp -r dist/* .
git add . && git commit -m "deploy" && git push origin gh-pages
```

### 9.5 Configurare DNS + SSL

```bash
# Configurează domeniul hsmc.network
# DNS: A record → IP-ul VPS-ului de frontend

# Cloudflare Tunnel (gratuit, cu SSL)
cloudflared tunnel create hsmc-network
cloudflared tunnel route dns hsmc-network hsmc.network
cloudflared tunnel run hsmc-network
```

### 9.6 Post-deployment

```bash
# 1. Creează conturi sociale
# Twitter: @HSMC_Network
# Telegram: t.me/HSMC_Community
# Discord: discord.gg/HSMC

# 2. Listează pe CoinGecko (gratis)
# Mergi la https://www.coingecko.com/en/coins/new
# Folosește datele din listings/coingecko.json

# 3. Configurează monitoring
# Prometheus + Grafana pe un VPS separat
# Adaugă alerting pentru: node down, chain stall, disk full

# 4. Anunță lansarea
# Postează pe toate canalele sociale
# Trimite press release la crypto media
```

---

## 10. Depanare (Troubleshooting)

### Frontend

| Problemă | Cauză probabilă | Soluție |
|---------|----------------|---------|
| `bun run dev` → "command not found" | Bun nu e în PATH | `source ~/.bashrc` sau reinstalează |
| `vite: command not found` | node_modules incomplete | `bun install` |
| Port 3000 already in use | Alt proces ocupă portul | `sudo kill $(lsof -t -i:3000)` |
| Blank page alb | Eroare JavaScript | Deschide DevTools (F12) → Console |
| "Supabase not configured" | .env lipsă | Creează .env cu VITE_SUPABASE_URL |
| Build hangs la "transforming..." | Memorie insuficientă | `NODE_OPTIONS="--max-old-space-size=4096" bun run build` |
| Three.js 404 | Modulul nu e încărcat | `bun install` — verifică node_modules/three |
| HMR nu funcționează | Cache problem | Șterge `node_modules/.vite` |

### Rust Node

| Problemă | Cauză probabilă | Soluție |
|---------|----------------|---------|
| `cargo: command not found` | Rust nu e instalat | Rulează `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `error: linking with cc failed` | Build dependencies lipsă | `sudo apt install build-essential clang librocksdb-dev` |
| RocksDB compile error | Versiune veche de gcc | `sudo apt install gcc-12 g++-12` |
| Port 8080 already in use | Alt nod rulează deja | `sudo kill $(lsof -t -i:8080)` |
| Node pornește dar nu acceptă conexiuni | Firewall | `sudo ufw allow 8080/tcp` |
| Mining nu produce blocuri | Dificultate prea mare | Verifică `curl localhost:8080/mining/info` |
| "RocksDB corruption" | Oprire forțată | Șterge `./hsmc-data/` și repornește |
| Stratum connections dropped | WebSocket timeout | Verifică firewall-ul pe port 3333 |

### Supabase

| Problemă | Cauză probabilă | Soluție |
|---------|----------------|---------|
| Edge function timeout | Procesare lentă | Mărește timeout în config.toml |
| RLS blocking queries | Politici incorecte | Verifică din SQL Editor: `SELECT * FROM nume_tabel` |
| Storage upload fails | Bucket privat | Verifică politicile din Dashboard → Storage |
| Auth not working | Site URL greșit | Setează corect în Dashboard → Auth → Settings |
| "Invalid API key" | Cheie greșită | Verifică VITE_SUPABASE_ANON_KEY |
| Migrations fail | Ordine greșită | Rulează migrațiile cronologic |

### Smart Contracts

| Problemă | Cauză probabilă | Soluție |
|---------|----------------|---------|
| Hardhat compile error | Solidity version mismatch | Verifică `pragma solidity ^0.8.24` |
| "Insufficient funds" la deploy | Fără ETH/BNB în wallet | Adaugă fonduri la adresa deployer-ului |
| Verification fails | Constructor arguments greșite | Verifică ordinea argumentelor |
| "Already processed" tx | Replay | Verifică `processed[hsmcTxHash]` |

### General

| Problemă | Cauză probabilă | Soluție |
|---------|----------------|---------|
| Nimic nu funcționează | Altceva ocupă resursele | `htop` — verifică CPU/RAM |
| Porturi blocate | Firewall | `sudo ufw status` |
| DNS nu rezolvă | Configurare greșită | `ping hsmc.network` |
| SSL error | Certificat expirat | Reînnoiește certificatul |
| "Out of memory" | Memory leak sau prea multe procese | `free -h`, oprește procese, mărește swap |

---

## 11. Comenzi rapide (Quick Reference)

### Development rapid (totul pornit)

```bash
# Terminal 1 — Rust node
cd HSMC-Network/rust-node && MINER_ADDRESS="DEV" ./start.sh

# Terminal 2 — Frontend
cd HSMC-Network && bun run dev

# Terminal 3 — Edge functions (dacă ai Supabase CLI)
cd HSMC-Network && supabase functions serve
```

### Verificări rapide

```bash
# E totul pornit?
curl -s http://localhost:3000/ > /dev/null && echo "✅ Frontend" || echo "❌ Frontend"
curl -s http://localhost:8080/health > /dev/null && echo "✅ Rust Node" || echo "❌ Rust Node"
curl -s http://localhost:9090/metrics > /dev/null && echo "✅ Metrics" || echo "❌ Metrics"

# Verifică porturile
lsof -i :3000 -i :8080 -i :3333 -i :9090

# Vezi log-urile
tail -f /tmp/hsmc-dev.log                    # Frontend
tail -f rust-node/logs/hsmc-node.log         # Rust node
```

### Build & Deploy rapid

```bash
# Build tot
cd HSMC-Network && bun run build
cd rust-node && cargo build --release

# Deploy edge functions
supabase functions deploy hsmcpay-checkout node-proxy blockchain-engine

# Deploy contracts (testnet)
cd contracts && npx hardhat run scripts/deploy.ts --network bscTestnet
```

### Database rapid

```bash
# Conectează-te la Supabase DB
supabase db connect

# Vezi toate tabelele
psql -h db.xxxxxxxxxxxx.supabase.co -U postgres -d postgres -c "\dt public.*"

# Backup DB
supabase db dump --data-only > backup.sql

# Restore DB
supabase db restore backup.sql
```

### Git workflow rapid

```bash
# Status
git status

# Commit all changes
git add -A && git commit -m "descriere" && git push

# Pull latest
git pull origin main

# New release
git tag v1.0.0 && git push --tags
```

---

## 📞 Suport

Dacă întâmpini probleme care nu sunt acoperite aici:

1. **GitHub Issues**: https://github.com/bnboxr/HSMC-Network/issues
2. **Discord** (după lansare): https://discord.gg/HSMC
3. **Telegram** (după lansare): https://t.me/HSMC_Community

---

*Acest manual acoperă TOT ce ai nevoie pentru a rula, testa și deploya HSMC Network. De la development local până la mainnet production.*
