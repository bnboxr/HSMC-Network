/**
 * Optimism Bridge Connector
 * ==========================
 *
 * EVM-compatible connector for Optimism mainnet (L2 optimistic rollup).
 * Extends EvmConnector with Optimism-specific defaults.
 *
 * Chain ID: 10
 * Confirmations: 12
 * RPC: https://mainnet.optimism.io (public)
 *
 * Env vars:
 *   OPTIMISM_RPC_URL             — Override default RPC
 *   OPTIMISM_BRIDGE_MINTER_ADDR  — BridgeMinter contract
 *   OPTIMISM_WHSMC_ADDR          — wHSMC token address
 */

import { EvmConnector } from "./ethereum";
import type { ChainConfig } from "../types";

const DEFAULT_RPC = "https://mainnet.optimism.io";
const DEFAULT_MIN_CONF = 12;

export class OptimismConnector extends EvmConnector {
  constructor(config: Partial<ChainConfig> = {}) {
    const rpcUrl =
      config.rpcUrl || process.env.OPTIMISM_RPC_URL || DEFAULT_RPC;
    const bridgeMinterAddress =
      config.bridgeMinterAddress || process.env.OPTIMISM_BRIDGE_MINTER_ADDR;
    const whsmcAddress =
      config.whsmcAddress || process.env.OPTIMISM_WHSMC_ADDR;
    const minConfirmations =
      config.minConfirmations ?? DEFAULT_MIN_CONF;

    super({
      chain: "optimism",
      rpcUrl,
      minConfirmations,
      pollIntervalMs: config.pollIntervalMs ?? 15_000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 2_000,
      chainId: 10,
      bridgeMinterAddress,
      whsmcAddress,
      fallbackRpcUrls: config.fallbackRpcUrls ?? [
        "https://optimism-rpc.publicnode.com",
        "https://rpc.ankr.com/optimism",
      ],
    });
  }
}

export function createOptimismConnector(
  config?: Partial<ChainConfig>,
): OptimismConnector {
  return new OptimismConnector(config);
}
