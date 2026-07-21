# HSMC Bridge Contracts — Production-Ready

Real, deployable BEP-20/ERC-20 contracts that turn the HSMC bridge from a
specification into a live on-chain system.

## Contracts

| Contract        | Purpose                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `WHSMC.sol`     | ERC-20 + ERC20Permit + Burnable + Pausable wrapped HSMC, 8 decimals.   |
| `BridgeMinter.sol` | M-of-N validator-attested mint gate. Replay-protected per HSMC tx. |

Both inherit OpenZeppelin v5 audited primitives. **No custom crypto.**

## One-time setup

```bash
cd contracts
cp .env.example .env   # fill in values
npm install
npm run compile
npm test                # runs the 3-of-5 mint flow test
```

## Deployment order (BSC mainnet example)

```bash
# 0. Create a 3-of-5 Gnosis Safe at https://app.safe.global → set ADMIN_MULTISIG_ADDRESS
# 1. Generate 5 validator keys (offline), set VALIDATORS + THRESHOLD=3
# 2. Deploy
npm run deploy:bsc

# 3. From the Safe, call:
#    WHSMC.grantRole(MINTER_ROLE, <BridgeMinter address>)
#    WHSMC.renounceRole(DEFAULT_ADMIN_ROLE, <deployer EOA>)   # only if it has it
#
# 4. Seed PancakeSwap pool (wHSMC / WBNB)
WHSMC_ADDRESS=0x... INITIAL_WHSMC=1000000 INITIAL_BNB=10 npm run create-pancake-pool
```

The deployment writes `deployments/<network>.json` with verified
addresses, validator set, and admin Safe — feed these back into the
HSMC mainnet `bridge_contracts` table and the Settings → Bridge UI.

## Testnet first!

Always deploy to **bscTestnet** / **sepolia** first and run the bridge
relayer end-to-end (lock on HSMC test mainnet → mint on testnet) before
touching mainnet funds.

## Audit checklist

- [ ] Slither static analysis: `slither contracts/`
- [ ] Mythril deep scan: `myth analyze contracts/bridge/WHSMC.sol`
- [ ] Echidna fuzzing on `BridgeMinter.executeMint`
- [ ] Trail of Bits / Certik external audit (REQUIRED before public mint)
