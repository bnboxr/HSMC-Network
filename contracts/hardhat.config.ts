import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const PK = process.env.DEPLOYER_PRIVATE_KEY ?? "0x" + "11".repeat(32);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    // ── Deployable (3) ───────────────────────────────────────────────
    bsc:        { url: process.env.BSC_RPC_URL        ?? "https://bsc-dataseed.binance.org",               accounts: [PK], chainId: 56 },
    bscTestnet: { url: process.env.BSC_TESTNET_RPC    ?? "https://data-seed-prebsc-1-s1.binance.org:8545", accounts: [PK], chainId: 97 },
    ethereum:   { url: process.env.ETH_RPC_URL        ?? "https://ethereum.publicnode.com",                accounts: [PK], chainId: 1 },
    sepolia:    { url: process.env.SEPOLIA_RPC_URL    ?? "https://ethereum-sepolia.publicnode.com",        accounts: [PK], chainId: 11155111 },

    // ── New deployable (Feature #22): 5 additional EVM chains ──────────
    polygon:    { url: process.env.POLYGON_RPC_URL    ?? "https://polygon-rpc.com",                        accounts: [PK], chainId: 137 },
    avalanche:  { url: process.env.AVALANCHE_RPC_URL  ?? "https://api.avax.network/ext/bc/C/rpc",         accounts: [PK], chainId: 43114 },
    arbitrum:   { url: process.env.ARBITRUM_RPC_URL   ?? "https://arb1.arbitrum.io/rpc",                  accounts: [PK], chainId: 42161 },
    optimism:   { url: process.env.OPTIMISM_RPC_URL   ?? "https://mainnet.optimism.io",                   accounts: [PK], chainId: 10 },
    base:       { url: process.env.BASE_RPC_URL       ?? "https://mainnet.base.org",                      accounts: [PK], chainId: 8453 },
  },
  etherscan: {
    apiKey: {
      bsc:        process.env.BSCSCAN_API_KEY        ?? "",
      bscTestnet: process.env.BSCSCAN_API_KEY        ?? "",
      mainnet:    process.env.ETHERSCAN_API_KEY      ?? "",
      sepolia:    process.env.ETHERSCAN_API_KEY      ?? "",
      polygon:    process.env.POLYGONSCAN_API_KEY    ?? "",
      avalanche:  process.env.SNOWTRACE_API_KEY      ?? "",
      arbitrum:   process.env.ARBISCAN_API_KEY       ?? "",
      optimism:   process.env.OPTIMISTIC_ETHERSCAN_API_KEY ?? "",
      base:       process.env.BASESCAN_API_KEY       ?? "",
    },
  },
};

export default config;
