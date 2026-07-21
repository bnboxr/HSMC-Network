# ─────────────────────────────────────────────────────────────────────
#  HSMC contracts — local deploy runner
#  Usage (de pe laptopul tău, NU în Lovable sandbox):
#    cd contracts
#    cp .env.example .env   # completează DEPLOYER_PRIVATE_KEY etc.
#    npm install
#    make deploy-testnet    # deploy WHSMC + BridgeMinter pe BSC testnet
#    make verify-testnet    # publică sursa pe BscScan
#    make seed-pool-testnet # creează pool wHSMC/tBNB pe PancakeSwap testnet
#
#  Pentru mainnet (BANI REALI):
#    make deploy-mainnet verify-mainnet seed-pool-mainnet
# ─────────────────────────────────────────────────────────────────────

SHELL := /bin/bash

.PHONY: install compile test \
        deploy-testnet verify-testnet seed-pool-testnet \
        deploy-mainnet verify-mainnet seed-pool-mainnet \
        faucet-help

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

# ── BSC MAINNET (BANI REALI — confirmare obligatorie) ────────────────
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

faucet-help:
	@echo "BSC Testnet faucet (BNB gratis pentru gas):"
	@echo "  → https://testnet.bnbchain.org/faucet-smart"
	@echo "  → trimite-ți 0.5 tBNB pe DEPLOYER_PRIVATE_KEY"
