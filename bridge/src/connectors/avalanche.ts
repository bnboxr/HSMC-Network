/**
 * Avalanche C-Chain Bridge Connector
 * ===================================
 *
 * EVM-compatible connector for Avalanche C-Chain mainnet.
 * Extends EvmConnector with Avalanche-specific defaults.
 *
 * Chain ID: 43114
 * Confirmations: 12 (Avalanche has fast finality, 1-2s block times)
 * RPC: https://api.avax.network/ext/bc/C/rpc (public)
 *
 * Env vars:
 *   AVALANCHE_RPC_URL             — Override default RPC
 *   AVALANCHE_BRIDGE_MINTER_ADDR  — BridgeMinter contract
 *   AVALANCHE_WHSMC_ADDR          — wHSMC token address
 */

import { EvmConnector } from "./ethereum";
import type { ChainConfig } from "../types";

const DEFAULT_RPC = "https://api.avax.network/ext/bc/C/rpc";
const DEFAULT_MIN_CONF = 12;

export class AvalancheConnector extends EvmConnector {
  constructor(config: Partial<ChainConfig> = {}) {
    const rpcUrl =
      config.rpcUrl || process.env.AVALANCHE_RPC_URL || DEFAULT_RPC;
    const bridgeMinterAddress =
      config.bridgeMinterAddress || process.env.AVALANCHE_BRIDGE_MINTER_ADDR;
    const whsmcAddress =
      config.whsmcAddress || process.env.AVALANCHE_WHSMC_ADDR;
    const minConfirmations =
      config.minConfirmations ?? DEFAULT_MIN_CONF;

    super({
      chain: "avalanche",
      rpcUrl,
      minConfirmations,
      pollIntervalMs: config.pollIntervalMs ?? 15_000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 2_000,
      chainId: 43114,
      bridgeMinterAddress,
      whsmcAddress,
      fallbackRpcUrls: config.fallbackRpcUrls ?? [
        "https://avalanche-c-chain-rpc.publicnode.com",
        "https://rpc.ankr.com/avalanche",
      ],
    });
  }
}

export function createAvalancheConnector(
  config?: Partial<ChainConfig>,
): AvalancheConnector {
  return new AvalancheConnector(config);
}
