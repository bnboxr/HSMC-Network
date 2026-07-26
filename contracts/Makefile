# ─────────────────────────────────────────────────────────────────────
#  HSMC contracts — local deploy runner (Feature #22: Bridge Hardening)
#  Usage (de pe laptopul tău, NU în Lovable sandbox):
#    cd contracts
#    cp .env.example .env   # completează DEPLOYER_PRIVATE_KEY etc.
#    npm install
#    make deploy-testnet    # deploy WHSMC + BridgeMinter pe BSC testnet
#    make verify-testnet    # publică sursa pe BscScan
#    make seed-pool-testnet # creează pool wHSMC/tBNB pe PancakeSwap testnet
#
#  Pentru mainnet (BANI REALI):
#    make deploy-<chain>    # deploy pe orice chain EVM
#    make deploy-solana     # deploy SPL token pe Solana
#    make deploy-cosmos     # generează manifest Cosmos IBC
# ─────────────────────────────────────────────────────────────────────

SHELL := /bin/bash

.PHONY: install compile test \
        deploy-testnet verify-testnet seed-pool-testnet \
        deploy-mainnet verify-mainnet seed-pool-mainnet \
        deploy-ethereum deploy-polygon deploy-avalanche deploy-arbitrum deploy-optimism deploy-base \
        deploy-solana deploy-cosmos \
        verify-ethereum verify-polygon verify-avalanche verify-arbitrum verify-optimism verify-base \
        deploy-all-evm faucet-help bridge-status bridge-events

install:
	npm install

compile:
	npx hardhat compile

test:
	npx hardhat test

# ── BSC TESTNET (gratis — folosește testnet BNB de la faucet) ────────
deploy-testnet:
	@echo "▶ Deploying WHSMC + BridgeMinter on BSC TESTNET (chainId 97)..."
	npx hardhat run scripts/deploy.ts --network bscTestnet

verify-testnet:
	@addr=$$(jq -r '.contracts.WHSMC' deployments/bscTestnet.json) ; \
	admin=$$(jq -r '.config.admin' deployments/bscTestnet.json) ; \
	npx hardhat verify --network bscTestnet $$addr $$admin

seed-pool-testnet:
	@echo "▶ Seeding wHSMC/tBNB pool on PancakeSwap TESTNET..."
	WHSMC_ADDRESS=$$(jq -r '.contracts.WHSMC' deployments/bscTestnet.json) \
	  npx hardhat run scripts/createPancakePool.ts --network bscTestnet

# ── BSC MAINNET ──────────────────────────────────────────────────────
deploy-mainnet:
	@read -p "⚠️  Vei deploya pe BSC MAINNET (cost real ~$$50-200 BNB gas). Continui? [y/N] " ans ; \
	[ "$$ans" = "y" ] || exit 1
	npx hardhat run scripts/deploy.ts --network bsc

verify-mainnet:
	@addr=$$(jq -r '.contracts.WHSMC' deployments/bsc.json) ; \
	admin=$$(jq -r '.config.admin' deployments/bsc.json) ; \
	npx hardhat verify --network bsc $$addr $$admin

seed-pool-mainnet:
	@read -p "⚠️  Vei adăuga lichiditate pe MAINNET (cost real în BNB+wHSMC). Continui? [y/N] " ans ; \
	[ "$$ans" = "y" ] || exit 1
	WHSMC_ADDRESS=$$(jq -r '.contracts.WHSMC' deployments/bsc.json) \
	  npx hardhat run scripts/createPancakePool.ts --network bsc

# ── ETHEREUM MAINNET ─────────────────────────────────────────────────
deploy-ethereum:
	@read -p "⚠️  Deploy pe Ethereum MAINNET (cost ~$$20-100 ETH gas). Continui? [y/N] " ans ; \
	[ "$$ans" = "y" ] || exit 1
	npx hardhat run scripts/deploy.ts --network ethereum

verify-ethereum:
	@addr=$$(jq -r '.contracts.WHSMC' deployments/ethereum.json) ; \
	admin=$$(jq -r '.config.admin' deployments/ethereum.json) ; \
	npx hardhat verify --network ethereum $$addr $$admin

# ── POLYGON (Feature #22) ────────────────────────────────────────────
deploy-polygon:
	@read -p "⚠️  Deploy pe Polygon MAINNET (cost ~0.5 MATIC). Continui? [y/N] " ans ; \
	[ "$$ans" = "y" ] || exit 1
	npx hardhat run scripts/deploy-polygon.ts --network polygon

verify-polygon:
	@addr=$$(jq -r '.contracts.WHSMC' deployments/polygon.json) ; \
	admin=$$(jq -r '.config.admin' deployments/polygon.json) ; \
	npx hardhat verify --network polygon $$addr $$admin

# ── AVALANCHE (Feature #22) ──────────────────────────────────────────
deploy-avalanche:
	@read -p "⚠️  Deploy pe Avalanche C-Chain (cost ~0.05 AVAX). Continui? [y/N] " ans ; \
	[ "$$ans" = "y" ] || exit 1
	npx hardhat run scripts/deploy-avalanche.ts --network avalanche

verify-avalanche:
	@addr=$$(jq -r '.contracts.WHSMC' deployments/avalanche.json) ; \
	admin=$$(jq -r '.config.admin' deployments/avalanche.json) ; \
	npx hardhat verify --network avalanche $$addr $$admin

# ── ARBITRUM (Feature #22) ───────────────────────────────────────────
deploy-arbitrum:
	@read -p "⚠️  Deploy pe Arbitrum One (cost ~$$2-5 ETH). Continui? [y/N] " ans ; \
	[ "$$ans" = "y" ] || exit 1
	npx hardhat run scripts/deploy-arbitrum.ts --network arbitrum

verify-arbitrum:
	@addr=$$(jq -r '.contracts.WHSMC' deployments/arbitrum.json) ; \
	admin=$$(jq -r '.config.admin' deployments/arbitrum.json) ; \
	npx hardhat verify --network arbitrum $$addr $$admin

# ── OPTIMISM (Feature #22) ───────────────────────────────────────────
deploy-optimism:
	@read -p "⚠️  Deploy pe Optimism (cost ~$$1-3 ETH). Continui? [y/N] " ans ; \
	[ "$$ans" = "y" ] || exit 1
	npx hardhat run scripts/deploy-optimism.ts --network optimism

verify-optimism:
	@addr=$$(jq -r '.contracts.WHSMC' deployments/optimism.json) ; \
	admin=$$(jq -r '.config.admin' deployments/optimism.json) ; \
	npx hardhat verify --network optimism $$addr $$admin

# ── BASE (Feature #22) ───────────────────────────────────────────────
deploy-base:
	@read -p "⚠️  Deploy pe Base (cost ~$$0.50-2 ETH). Continui? [y/N] " ans ; \
	[ "$$ans" = "y" ] || exit 1
	npx hardhat run scripts/deploy-base.ts --network base

verify-base:
	@addr=$$(jq -r '.contracts.WHSMC' deployments/base.json) ; \
	admin=$$(jq -r '.config.admin' deployments/base.json) ; \
	npx hardhat verify --network base $$addr $$admin

# ── SOLANA (Feature #22) ─────────────────────────────────────────────
deploy-solana:
	@read -p "⚠️  Deploy SPL token pe Solana mainnet (cost ~0.01 SOL). Continui? [y/N] " ans ; \
	[ "$$ans" = "y" ] || exit 1
	npx tsx scripts/deploy-solana.ts

# ── COSMOS (Feature #22) ─────────────────────────────────────────────
deploy-cosmos:
	npx tsx scripts/deploy-cosmos.ts
	@echo ""
	@echo "✅ Cosmos manifest generat. Vezi deployments/cosmos.json → nextSteps"

# ── Deploy ALL EVM (⚠️  cost total ~$$30-300) ────────────────────────
deploy-all-evm:
	@echo "⚠️  ATENȚIE: Vei deploya pe TOATE cele 7 chain-uri EVM. Cost total estimat ~$$30-300."
	@read -p "Continui? [y/N] " ans ; [ "$$ans" = "y" ] || exit 1
	@for chain in bsc ethereum polygon avalanche arbitrum optimism base; do \
		echo ""; \
		echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
		echo "▶ Deploying $$chain..."; \
		echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
		npx hardhat run scripts/deploy-$$chain.ts --network $$chain || exit 1; \
	done
	@echo ""
	@echo "✅ All 7 EVM chains deployed!"

# ── Bridge Monitoring ────────────────────────────────────────────────
bridge-status:
	@curl -s http://localhost:3100/bridge/status | jq .

bridge-events:
	@curl -s http://localhost:3100/bridge/events | jq .

# ── Help ─────────────────────────────────────────────────────────────
faucet-help:
	@echo "BSC Testnet faucet (BNB gratis pentru gas):"
	@echo "  → https://testnet.bnbchain.org/faucet-smart"
	@echo "  → trimite-ți 0.5 tBNB pe DEPLOYER_PRIVATE_KEY"
	@echo ""
	@echo "Chain RPC providers (pentru mainnet gas tokens):"
	@echo "  Polygon:    https://polygon-rpc.com"
	@echo "  Avalanche:  https://api.avax.network/ext/bc/C/rpc"
	@echo "  Arbitrum:   https://arb1.arbitrum.io/rpc"
	@echo "  Optimism:   https://mainnet.optimism.io"
	@echo "  Base:       https://mainnet.base.org"
	@echo "  Solana:     https://api.mainnet-beta.solana.com"
	@echo "  Cosmos:     https://cosmos-rest.publicnode.com"
