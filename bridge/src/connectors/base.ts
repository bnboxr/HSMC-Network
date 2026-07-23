/**
 * Base Bridge Connector
 * =====================
 *
 * EVM-compatible connector for Base mainnet (Coinbase L2, OP Stack).
 * Extends EvmConnector with Base-specific defaults.
 *
 * Chain ID: 8453
 * Confirmations: 12
 * RPC: https://mainnet.base.org (public)
 *
 * Env vars:
 *   BASE_RPC_URL             — Override default RPC
 *   BASE_BRIDGE_MINTER_ADDR  — BridgeMinter contract
 *   BASE_WHSMC_ADDR          — wHSMC token address
 */

import { EvmConnector } from "./ethereum";
import type { ChainConfig } from "../types";

const DEFAULT_RPC = "https://mainnet.base.org";
const DEFAULT_MIN_CONF = 12;

export class BaseConnector extends EvmConnector {
  constructor(config: Partial<ChainConfig> = {}) {
    const rpcUrl =
      config.rpcUrl || process.env.BASE_RPC_URL || DEFAULT_RPC;
    const bridgeMinterAddress =
      config.bridgeMinterAddress || process.env.BASE_BRIDGE_MINTER_ADDR;
    const whsmcAddress =
      config.whsmcAddress || process.env.BASE_WHSMC_ADDR;
    const minConfirmations =
      config.minConfirmations ?? DEFAULT_MIN_CONF;

    super({
      chain: "base",
      rpcUrl,
      minConfirmations,
      pollIntervalMs: config.pollIntervalMs ?? 15_000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 2_000,
      chainId: 8453,
      bridgeMinterAddress,
      whsmcAddress,
      fallbackRpcUrls: config.fallbackRpcUrls ?? [
        "https://base-rpc.publicnode.com",
        "https://base.blockpi.network/v1/rpc/public",
      ],
    });
  }
}

export function createBaseConnector(
  config?: Partial<ChainConfig>,
): BaseConnector {
  return new BaseConnector(config);
}
