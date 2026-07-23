/**
 * HSMC Bridge Index — Multi-chain connector registry
 * ==================================================
 *
 * Single entry-point for the HSMC bridge layer. Consumers import
 * `getConnector("btc")` to get a Bitcoin connector, `getConnector("eth")`
 * for Ethereum, etc. All connectors satisfy the `ChainConnector` interface
 * so bridge logic can be chain-agnostic.
 *
 * Supported chains (10 total):
 *   BTC, ETH, BSC, Solana, Polygon, Avalanche, Arbitrum, Optimism, Base, Cosmos
 *
 * Usage:
 *   import { getConnector, listConnectors } from "./bridge/src/index";
 *
 *   const btc = getConnector("btc");
 *   const bal = await btc.getBalance("bc1q…");
 *
 *   for await (const deposit of btc.watchForDeposit("bc1q…")) {
 *     // relay deposit → mint wHSMC
 *   }
 *
 * Configuration is passed once via `configureChain()` or read from environment
 * variables. Connectors are lazily instantiated on first access.
 */

import type { ChainConnector, ChainConfig } from "./types";
import type { ChainId } from "./types";

export type { ChainId, ChainConnector, DepositEvent, WithdrawalRequest, ChainConfig, BridgeEvent, MintProposedEvent, MintFinalizedEvent, MintedEvent, MintChallengedEvent } from "./types";

// ─── Lazy connector cache ──────────────────────────────────────────────

const connectorCache = new Map<ChainId, ChainConnector>();
const chainConfigs = new Map<ChainId, ChainConfig>();

// ─── Default chain configs (env-driven) ─────────────────────────────────

function defaultConfig(chain: ChainId): ChainConfig {
  switch (chain) {
    case "btc":
      return {
        chain: "btc",
        rpcUrl: process.env.BTC_RPC_URL || "https://blockstream.info/api",
        minConfirmations: Number(process.env.BTC_MIN_CONF || "6"),
        pollIntervalMs: Number(process.env.BTC_POLL_MS || "30000"),
        maxRetries: 3,
        retryBaseDelayMs: 2000,
      };
    case "eth":
      return {
        chain: "eth",
        rpcUrl: process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com",
        minConfirmations: 12,
        pollIntervalMs: 15000,
        maxRetries: 3,
        retryBaseDelayMs: 2000,
        chainId: 1,
        bridgeMinterAddress: process.env.BRIDGE_MINTER_ADDRESS_ETH,
        whsmcAddress: process.env.WHSMC_ADDRESS_ETH,
      };
    case "bsc":
      return {
        chain: "bsc",
        rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org",
        minConfirmations: 15,
        pollIntervalMs: 15000,
        maxRetries: 3,
        retryBaseDelayMs: 2000,
        chainId: 56,
        bridgeMinterAddress: process.env.BRIDGE_MINTER_ADDRESS_BSC,
        whsmcAddress: process.env.WHSMC_ADDRESS_BSC,
      };
    case "sol":
      return {
        chain: "sol",
        rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
        minConfirmations: Number(process.env.SOLANA_MIN_CONF || "32"),
        pollIntervalMs: Number(process.env.SOLANA_POLL_MS || "30000"),
        maxRetries: 3,
        retryBaseDelayMs: 2000,
      };
    case "polygon":
      return {
        chain: "polygon",
        rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
        minConfirmations: 256,
        pollIntervalMs: 15000,
        maxRetries: 3,
        retryBaseDelayMs: 2000,
        chainId: 137,
        bridgeMinterAddress: process.env.BRIDGE_MINTER_ADDRESS_POLYGON,
        whsmcAddress: process.env.WHSMC_ADDRESS_POLYGON,
      };
    case "avalanche":
      return {
        chain: "avalanche",
        rpcUrl: process.env.AVALANCHE_RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
        minConfirmations: 12,
        pollIntervalMs: 15000,
        maxRetries: 3,
        retryBaseDelayMs: 2000,
        chainId: 43114,
        bridgeMinterAddress: process.env.BRIDGE_MINTER_ADDRESS_AVALANCHE,
        whsmcAddress: process.env.WHSMC_ADDRESS_AVALANCHE,
      };
    case "arbitrum":
      return {
        chain: "arbitrum",
        rpcUrl: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
        minConfirmations: 12,
        pollIntervalMs: 15000,
        maxRetries: 3,
        retryBaseDelayMs: 2000,
        chainId: 42161,
        bridgeMinterAddress: process.env.BRIDGE_MINTER_ADDRESS_ARBITRUM,
        whsmcAddress: process.env.WHSMC_ADDRESS_ARBITRUM,
      };
    case "optimism":
      return {
        chain: "optimism",
        rpcUrl: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
        minConfirmations: 12,
        pollIntervalMs: 15000,
        maxRetries: 3,
        retryBaseDelayMs: 2000,
        chainId: 10,
        bridgeMinterAddress: process.env.BRIDGE_MINTER_ADDRESS_OPTIMISM,
        whsmcAddress: process.env.WHSMC_ADDRESS_OPTIMISM,
      };
    case "base":
      return {
        chain: "base",
        rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
        minConfirmations: 12,
        pollIntervalMs: 15000,
        maxRetries: 3,
        retryBaseDelayMs: 2000,
        chainId: 8453,
        bridgeMinterAddress: process.env.BRIDGE_MINTER_ADDRESS_BASE,
        whsmcAddress: process.env.WHSMC_ADDRESS_BASE,
      };
    case "cosmos":
      return {
        chain: "cosmos",
        rpcUrl: process.env.COSMOS_RPC_URL || "https://cosmos-rest.publicnode.com",
        minConfirmations: Number(process.env.COSMOS_MIN_CONF || "6"),
        pollIntervalMs: Number(process.env.COSMOS_POLL_MS || "30000"),
        maxRetries: 3,
        retryBaseDelayMs: 2000,
      };
    default: {
      // Exhaustiveness check
      const _exhaustive: never = chain;
      throw new Error(`Unknown chain: ${_exhaustive}`);
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Pre-configure a chain before first use.
 *
 * Call this early in the application lifecycle if you need to override
 * default RPC URLs or contract addresses.
 *
 * @example
 * ```ts
 * configureChain("polygon", {
 *   rpcUrl: "https://rpc-mainnet.maticvigil.com",
 *   bridgeMinterAddress: "0x1234…",
 *   whsmcAddress: "0xabcd…",
 * });
 * ```
 */
export function configureChain(chain: ChainId, config: Partial<ChainConfig>): void {
  const existing = chainConfigs.get(chain) ?? defaultConfig(chain);
  chainConfigs.set(chain, { ...existing, ...config });

  // Invalidate cached connector so next getConnector picks up new config
  connectorCache.delete(chain);
}

/**
 * Get (or lazily create) a chain connector.
 *
 * @param chain  Any supported ChainId
 * @returns A ChainConnector instance for the requested chain.
 * @throws If the chain config is missing required fields (e.g. contract addresses for EVM).
 */
export function getConnector(chain: ChainId): ChainConnector {
  const cached = connectorCache.get(chain);
  if (cached) return cached;

  const config = chainConfigs.get(chain) ?? defaultConfig(chain);
  const connector = createConnector(config);
  connectorCache.set(chain, connector);
  return connector;
}

/**
 * Return all currently available chain connectors.
 *
 * Only includes chains that have been configured (via `configureChain()`
 * or environment variables for their required fields).
 */
export function listConnectors(): ChainConnector[] {
  // Ensure all configured chains are instantiated
  for (const chain of chainConfigs.keys()) {
    if (!connectorCache.has(chain)) {
      getConnector(chain);
    }
  }
  return [...connectorCache.values()];
}

/**
 * Check whether a connector has been initialized for `chain`.
 * Does not trigger instantiation — just checks the cache.
 */
export function hasConnector(chain: ChainId): boolean {
  return connectorCache.has(chain);
}

/**
 * Remove a connector from the cache (e.g. for testing or reconfiguration).
 */
export function evictConnector(chain: ChainId): void {
  connectorCache.delete(chain);
}

// ─── Internal factory ──────────────────────────────────────────────────

function createConnector(config: ChainConfig): ChainConnector {
  switch (config.chain) {
    case "btc": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BitcoinConnector } = require("./connectors/bitcoin");
      return new BitcoinConnector(config);
    }
    case "eth":
    case "bsc": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { EvmConnector } = require("./connectors/ethereum");
      if (!config.bridgeMinterAddress || !config.whsmcAddress) {
        throw new Error(
          `bridgeMinterAddress and whsmcAddress are required for ${config.chain}. ` +
          `Set them via configureChain() or ${config.chain.toUpperCase()}_BRIDGE_MINTER_ADDRESS / WHSMC_ADDRESS env vars.`,
        );
      }
      return new EvmConnector(config as ChainConfig & { chain: "eth" | "bsc" });
    }
    case "sol": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SolanaConnector } = require("./connectors/solana");
      return new SolanaConnector(config);
    }
    case "polygon": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PolygonConnector } = require("./connectors/polygon");
      return new PolygonConnector(config);
    }
    case "avalanche": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AvalancheConnector } = require("./connectors/avalanche");
      return new AvalancheConnector(config);
    }
    case "arbitrum": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ArbitrumConnector } = require("./connectors/arbitrum");
      return new ArbitrumConnector(config);
    }
    case "optimism": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { OptimismConnector } = require("./connectors/optimism");
      return new OptimismConnector(config);
    }
    case "base": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BaseConnector } = require("./connectors/base");
      return new BaseConnector(config);
    }
    case "cosmos": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CosmosConnector } = require("./connectors/cosmos");
      return new CosmosConnector(config);
    }
    default: {
      const _exhaustive: never = config.chain;
      throw new Error(`Unknown chain: ${_exhaustive}`);
    }
  }
}
