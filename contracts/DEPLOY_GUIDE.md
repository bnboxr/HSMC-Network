# HSMC Bridge Deployment Guide — All 10 Chains

> **⚠️  Security**: Deploy-ul on-chain cere o cheie privată cu gas token real.
> Nu trimite niciodată cheia ta privată într-un chat AI sau în secrets de cloud
> partajate. Rulezi TU, local, de pe mașina ta.

## Supported Chains

| # | Chain | Type | Chain ID | Gas Token | Explorer |
|---|-------|------|----------|-----------|----------|
| 1 | BSC | EVM | 56 | BNB | [BscScan](https://bscscan.com) |
| 2 | Ethereum | EVM | 1 | ETH | [Etherscan](https://etherscan.io) |
| 3 | Polygon | EVM | 137 | MATIC | [Polygonscan](https://polygonscan.com) |
| 4 | Avalanche | EVM | 43114 | AVAX | [Snowtrace](https://snowtrace.io) |
| 5 | Arbitrum | EVM | 42161 | ETH | [Arbiscan](https://arbiscan.io) |
| 6 | Optimism | EVM | 10 | ETH | [Optimistic Etherscan](https://optimistic.etherscan.io) |
| 7 | Base | EVM | 8453 | ETH | [Basescan](https://basescan.org) |
| 8 | Bitcoin | UTXO | — | BTC | [Blockstream](https://blockstream.info) |
| 9 | Solana | Non-EVM | — | SOL | [Solscan](https://solscan.io) |
| 10 | Cosmos | IBC | cosmoshub-4 | ATOM | [Mintscan](https://mintscan.io) |

## 0. Prerequisites

- Node.js 20+ și `npm` instalate
- `jq` (`brew install jq` / `apt install jq`)
- Un wallet EVM (MetaMask exportat → cheie privată)
- **Pentru Solana**: Solana CLI (`solana-keygen`, `spl-token`)
- **Pentru Cosmos**: Cosmos SDK CLI (`cosmosd`)

## 1. Pregătire

```bash
cd contracts
cp .env.example .env
nano .env   # Completează toate variabilele: DEPLOYER_PRIVATE_KEY, ADMIN_MULTISIG_ADDRESS, VALIDATORS, etc.
make install
make compile
make test
```

## 2. Deploy EVM Chains (7 chains)

Toate chain-urile EVM folosesc același contract WHSMC + BridgeMinter (Solidity).
Scriptul generic `scripts/deploy.ts` merge pe orice network din `hardhat.config.ts`.
Pentru chain-specific logging & output, folosește scripturile dedicate.

### 2.1 BSC (BNB Chain)

```bash
# Testnet first
npx hardhat run scripts/deploy.ts --network bscTestnet
# Mainnet
npx hardhat run scripts/deploy-bsc.ts --network bsc
```

### 2.2 Ethereum

```bash
# Testnet (Sepolia)
npx hardhat run scripts/deploy.ts --network sepolia
# Mainnet
npx hardhat run scripts/deploy-ethereum.ts --network ethereum
```

### 2.3 Polygon

```bash
npx hardhat run scripts/deploy-polygon.ts --network polygon
# Verify: npx hardhat verify --network polygon <WHSMC_ADDR> <ADMIN>
```
- Gas: ~0.5 MATIC ($0.25)
- Confirmations: 256 (Polygon has occasional reorgs)

### 2.4 Avalanche C-Chain

```bash
npx hardhat run scripts/deploy-avalanche.ts --network avalanche
# Verify: npx hardhat verify --network avalanche <WHSMC_ADDR> <ADMIN>
```
- Gas: ~0.05 AVAX ($1.50)
- Confirmations: 12

### 2.5 Arbitrum One

```bash
npx hardhat run scripts/deploy-arbitrum.ts --network arbitrum
# Verify: npx hardhat verify --network arbitrum <WHSMC_ADDR> <ADMIN>
```
- Gas: ~$2–5 in ETH
- Confirmations: 12 (L2 finality via Ethereum)

### 2.6 Optimism

```bash
npx hardhat run scripts/deploy-optimism.ts --network optimism
# Verify: npx hardhat verify --network optimism <WHSMC_ADDR> <ADMIN>
```
- Gas: ~$1–3 in ETH
- Explorer API: Optimistic Etherscan (separate API key)

### 2.7 Base

```bash
npx hardhat run scripts/deploy-base.ts --network base
# Verify: npx hardhat verify --network base <WHSMC_ADDR> <ADMIN>
```
- Gas: ~$0.50–2 in ETH
- Explorer API: Basescan (separate API key)

## 3. Deploy Non-EVM Chains

### 3.1 Solana (SPL Token)

```bash
# Ensure Solana CLI is installed & funded
solana-keygen new -o ~/.config/solana/id.json
solana airdrop 1  # testnet/devnet only

# Set env vars
export SOLANA_DEPLOYER_KEYPAIR_PATH=~/.config/solana/id.json
export ADMIN_MULTISIG_ADDRESS=<base58_admin_address>
export VALIDATORS=<base58_v1>,<base58_v2>,<base58_v3>,<base58_v4>,<base58_v5>

# Deploy
npx tsx scripts/deploy-solana.ts
```
- Creates SPL mint with 8 decimals
- Mints 100 wHSMC initial supply
- Transfers mint authority to admin multisig
- Output: `deployments/solana.json` + `deployments/solana-mint-keypair.json`
- ⚠️ **PĂSTREAZĂ `deployments/solana-mint-keypair.json` ÎN SIGURANȚĂ!**

### 3.2 Cosmos Hub (IBC)

Cosmos Hub nu are TokenFactory nativ. Token-ul wHSMC ajunge pe Cosmos prin IBC:

1. **Deploy pe un chain cu TokenFactory** (Osmosis, Juno):
   ```bash
   osmosisd tx tokenfactory create-denom whsmc --from <key> --gas auto
   ```

2. **Sau submit governance proposal** pe Cosmos Hub:
   ```bash
   npx tsx scripts/deploy-cosmos.ts
   # Scriptul generează deployments/cosmos.json cu proposal JSON și nextSteps
   ```

3. **IBC Relayer setup** (Hermes):
   ```bash
   hermes create connection --a-chain hsmc --b-chain cosmoshub-4
   hermes create channel --a-chain hsmc --a-connection connection-0 --a-port transfer --b-port transfer
   ```

Vezi `deployments/cosmos.json` → `nextSteps` pentru procedura completă.

## 4. Verificare Contracte pe Explorer

Fiecare chain are propriul explorer și API key. După deploy:

| Chain | Explorer API | Comandă |
|-------|-------------|---------|
| BSC | BscScan | `npx hardhat verify --network bsc <addr> <args>` |
| Ethereum | Etherscan | `npx hardhat verify --network ethereum <addr> <args>` |
| Polygon | Polygonscan | `npx hardhat verify --network polygon <addr> <args>` |
| Avalanche | Snowtrace | `npx hardhat verify --network avalanche <addr> <args>` |
| Arbitrum | Arbiscan | `npx hardhat verify --network arbitrum <addr> <args>` |
| Optimism | Optimistic Etherscan | `npx hardhat verify --network optimism <addr> <args>` |
| Base | Basescan | `npx hardhat verify --network base <addr> <args>` |

## 5. Multi-sig Relayer Setup

Rulează **5 instanțe** (una per validator) pe VPS-uri separate:

```bash
# Validator #1
EVM_RPC_URL=https://bsc-dataseed.binance.org \
BRIDGE_MINTER_ADDRESS_BSC=$(jq -r '.contracts.BridgeMinter' deployments/bsc.json) \
WHSMC_ADDRESS_BSC=$(jq -r '.contracts.WHSMC' deployments/bsc.json) \
BRIDGE_MINTER_ADDRESS_ETH=$(jq -r '.contracts.BridgeMinter' deployments/ethereum.json) \
WHSMC_ADDRESS_ETH=$(jq -r '.contracts.WHSMC' deployments/ethereum.json) \
# ... (repeat for each chain you want to relay) \
VALIDATOR_PRIVATE_KEY=0xVALIDATOR_1_KEY \
HSMC_NODE_URL=https://your-rust-node.example.com \
SUPABASE_URL=https://xztzynwqikjjpxswgjka.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
npx tsx relayer/relayer.ts
```

**DB setup** (Supabase tables required for relayer):
```sql
-- Signature gossip
CREATE TABLE bridge_signatures (
  hsmc_tx_hash TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  dest_address TEXT,
  amount TEXT,
  signer TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (hsmc_tx_hash, chain_id, signer)
);

-- Pending proposals (for challenge period tracking)
CREATE TABLE bridge_proposals (
  hsmc_tx_hash TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  proposal_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  finalized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (hsmc_tx_hash, chain_id)
);

-- Event log
CREATE TABLE bridge_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,  -- Lock, Mint, Burn, Unlock
  hsmc_tx_hash TEXT,
  chain_id INTEGER,
  chain_name TEXT,
  dest_address TEXT,
  amount TEXT,
  tx_hash TEXT,
  block_number INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relayer health
CREATE TABLE relayer_health (
  validator_address TEXT NOT NULL,
  chain_name TEXT NOT NULL,
  chain_id INTEGER,
  last_block INTEGER,
  native_balance TEXT,
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (validator_address, chain_name)
);
```

## 6. Bridge Monitoring

Pornește monitorul ca serviciu separat:

```bash
cd bridge
npx tsx src/monitor.ts
# Ascultă pe port 3100 (configurabil via BRIDGE_MONITOR_PORT)
```

Endpoints:
- `GET /health` — Liveness probe
- `GET /bridge/status` — Status pentru toate chain-urile
- `GET /bridge/status/eth` — Status pentru un singur chain
- `GET /bridge/events` — Evenimente recente (Lock, Mint, Burn, Unlock)
- `GET /bridge/events?chain=bsc&limit=10` — Evenimente filtrate per chain

Exemplu `GET /bridge/status`:
```json
{
  "timestamp": "2026-07-26T14:30:00Z",
  "nodeVersion": "1.0.0",
  "chains": [
    {
      "chain": "bsc",
      "healthy": true,
      "blockHeight": 41234000,
      "latencyMs": 234,
      "bridgeContract": "0x...",
      "whsmcContract": "0x..."
    }
  ],
  "totalChains": 7,
  "healthyChains": 7
}
```

## 7. Post-Deploy Checklist

După fiecare deploy, urmează acești pași:

- [ ] **Grant MINTER_ROLE**: `WHSMC.grantRole(MINTER_ROLE, BridgeMinter)` din admin Safe
- [ ] **Renunță la admin role** de pe deployer EOA (dacă l-a primit accidental)
- [ ] **Verify contracts** pe explorer (vezi secțiunea 4)
- [ ] **Salvează manifestul** în `deployments/<chain>.json` în repo
- [ ] **Adaugă adresele** în tabela `bridge_contracts` din DB-ul principal HSMC
- [ ] **Pornește relayer-ul** pentru noul chain (vezi secțiunea 5)
- [ ] **Testează flow-ul end-to-end**: Lock pe HSMC → Mint pe dest chain → Burn → Unlock
- [ ] **Monitor**: Verifică că noul chain apare în `/bridge/status`

## 8. Makefile (comenzi rapide)

Adaugă în `contracts/Makefile`:

```makefile
# Deploy pe toate EVM chains (atenție: cost real!)
deploy-all-evm:
	@for chain in bsc ethereum polygon avalanche arbitrum optimism base; do \
		echo "▶ Deploying $$chain..."; \
		npx hardhat run scripts/deploy-$$chain.ts --network $$chain || exit 1; \
	done

deploy-polygon:
	npx hardhat run scripts/deploy-polygon.ts --network polygon

deploy-avalanche:
	npx hardhat run scripts/deploy-avalanche.ts --network avalanche

deploy-arbitrum:
	npx hardhat run scripts/deploy-arbitrum.ts --network arbitrum

deploy-optimism:
	npx hardhat run scripts/deploy-optimism.ts --network optimism

deploy-base:
	npx hardhat run scripts/deploy-base.ts --network base

deploy-solana:
	npx tsx scripts/deploy-solana.ts

deploy-cosmos:
	npx tsx scripts/deploy-cosmos.ts

# Verifică toate chain-urile
bridge-status:
	curl -s http://localhost:3100/bridge/status | jq .

bridge-events:
	curl -s http://localhost:3100/bridge/events | jq .
```
