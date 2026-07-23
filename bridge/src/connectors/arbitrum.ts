/**
 * Arbitrum One Bridge Connector
 * ==============================
 *
 * EVM-compatible connector for Arbitrum One (L2 optimistic rollup).
 * Extends EvmConnector with Arbitrum-specific defaults.
 *
 * Chain ID: 42161
 * Confirmations: 12 (Arbitrum finality ~7 days for full settlement, but L2 blocks confirm faster)
 * RPC: https://arb1.arbitrum.io/rpc (public)
 *
 * Env vars:
 *   ARBITRUM_RPC_URL             — Override default RPC
 *   ARBITRUM_BRIDGE_MINTER_ADDR  — BridgeMinter contract
 *   ARBITRUM_WHSMC_ADDR          — wHSMC token address
 */

import { EvmConnector } from "./ethereum";
import type { ChainConfig } from "../types";

const DEFAULT_RPC = "https://arb1.arbitrum.io/rpc";
const DEFAULT_MIN_CONF = 12;

export class ArbitrumConnector extends EvmConnector {
  constructor(config: Partial<ChainConfig> = {}) {
    const rpcUrl =
      config.rpcUrl || process.env.ARBITRUM_RPC_URL || DEFAULT_RPC;
    const bridgeMinterAddress =
      config.bridgeMinterAddress || process.env.ARBITRUM_BRIDGE_MINTER_ADDR;
    const whsmcAddress =
      config.whsmcAddress || process.env.ARBITRUM_WHSMC_ADDR;
    const minConfirmations =
      config.minConfirmations ?? DEFAULT_MIN_CONF;

    super({
      chain: "arbitrum",
      rpcUrl,
      minConfirmations,
      pollIntervalMs: config.pollIntervalMs ?? 15_000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 2_000,
      chainId: 42161,
      bridgeMinterAddress,
      whsmcAddress,
      fallbackRpcUrls: config.fallbackRpcUrls ?? [
        "https://arbitrum-one-rpc.publicnode.com",
        "https://rpc.ankr.com/arbitrum",
      ],
    });
  }
}

export function createArbitrumConnector(
  config?: Partial<ChainConfig>,
): ArbitrumConnector {
  return new ArbitrumConnector(config);
}
