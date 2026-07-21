/**
 * HSMC Bridge Index — Multi-chain connector registry
 * ==================================================
 *
 * Single entry-point for the HSMC bridge layer. Consumers import
 * `getConnector("btc")` to get a Bitcoin connector, `getConnector("eth")`
 * for Ethereum, etc. All connectors satisfy the `ChainConnector` interface
 * so bridge logic can be chain-agnostic.
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
 * configureChain("bsc", {
 *   rpcUrl: "https://bsc-dataseed2.binance.org",
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
 * @param chain  "btc" | "eth" | "bsc"
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
      // Dynamic import to keep dependencies optional
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
    default: {
      const _exhaustive: never = config.chain;
      throw new Error(`Unknown chain: ${_exhaustive}`);
    }
  }
}
