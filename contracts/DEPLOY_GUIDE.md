# HSMC Mainnet Deploy Guide — pas cu pas

> **De ce nu poate Lovable face asta automat?**
> Deploy-ul on-chain cere o cheie privată cu BNB/ETH real. Niciodată
> nu trimite cheia ta privată într-un chat AI sau în secrets de cloud
> partajate. Rulezi tu, local, de pe mașina ta.

## 0. Prerequisite

- Node.js 20+ și `npm` instalate
- `jq` (`brew install jq` / `apt install jq`)
- Un wallet EVM (MetaMask exportat → cheie privată) cu:
  - **Pentru testnet**: 0.5 tBNB (gratis de la [faucet](https://testnet.bnbchain.org/faucet-smart))
  - **Pentru mainnet**: ~0.5 BNB ($300 la prețul actual) pentru deploy + lichiditate

## 1. Pregătire

```bash
cd contracts
cp .env.example .env
nano .env   # completează DEPLOYER_PRIVATE_KEY, ADMIN_MULTISIG_ADDRESS, VALIDATORS, BSCSCAN_API_KEY
make install
make compile
make test
```

## 2. Deploy pe testnet (recomandat ÎNTÂI — gratis)

```bash
make deploy-testnet      # → scrie deployments/bscTestnet.json
make verify-testnet      # → publică sursa pe testnet.bscscan.com
make seed-pool-testnet   # → creează pool wHSMC/tBNB pe PancakeSwap testnet
```

După fiecare pas, **copiază adresa contractului** din output și
mergi pe `/mainnet/readiness` în app → click "Mark as deployed" →
lipește adresa + tx hash → status devine ✅ verified.

## 3. Deploy pe mainnet (BANI REALI)

Doar după ce testnet funcționează **end-to-end** (deploy + verify + swap test).

```bash
make deploy-mainnet
make verify-mainnet
make seed-pool-mainnet
```

## 4. Pornește relayer-ul (5 instanțe, 1 per validator)

Pe **5 VPS-uri separate** (sau cel puțin 5 procese cu chei diferite):

```bash
cd contracts
EVM_RPC_URL=https://bsc-dataseed.binance.org \
BRIDGE_MINTER_ADDRESS=$(jq -r '.contracts.BridgeMinter' deployments/bsc.json) \
VALIDATOR_PRIVATE_KEY=0xVALIDATOR_N_KEY \
HSMC_NODE_URL=https://your-rust-node.example.com \
SUPABASE_URL=https://xztzynwqikjjpxswgjka.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
npx tsx relayer/relayer.ts
```

Recomandare: `pm2 start relayer/relayer.ts --name hsmc-relayer-1` ca să ruleze 24/7.

## 5. Marchează status în UI

În app, deschide `/mainnet/readiness` și pentru fiecare pas reușit
apasă "Mark as deployed/verified/live" și lipește dovada (adresă +
link BscScan). Pagina arată acum status REAL din DB, nu hardcodat.
