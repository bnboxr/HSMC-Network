/**
 * Polygon Bridge Connector
 * ========================
 *
 * EVM-compatible connector for Polygon (Matic) mainnet.
 * Extends EvmConnector with Polygon-specific defaults.
 *
 * Chain ID: 137
 * Confirmations: 256 (Polygon has fast block times but can reorg more than Ethereum)
 * RPC: https://polygon-rpc.com (public)
 *
 * Env vars:
 *   POLYGON_RPC_URL             — Override default RPC
 *   POLYGON_BRIDGE_MINTER_ADDR  — BridgeMinter contract
 *   POLYGON_WHSMC_ADDR          — wHSMC token address
 */

import { EvmConnector } from "./ethereum";
import type { ChainConfig } from "../types";

const DEFAULT_RPC = "https://polygon-rpc.com";
const DEFAULT_MIN_CONF = 256;

export class PolygonConnector extends EvmConnector {
  constructor(config: Partial<ChainConfig> = {}) {
    const rpcUrl =
      config.rpcUrl || process.env.POLYGON_RPC_URL || DEFAULT_RPC;
    const bridgeMinterAddress =
      config.bridgeMinterAddress || process.env.POLYGON_BRIDGE_MINTER_ADDR;
    const whsmcAddress =
      config.whsmcAddress || process.env.POLYGON_WHSMC_ADDR;
    const minConfirmations =
      config.minConfirmations ?? DEFAULT_MIN_CONF;

    super({
      chain: "polygon",
      rpcUrl,
      minConfirmations,
      pollIntervalMs: config.pollIntervalMs ?? 15_000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 2_000,
      chainId: 137,
      bridgeMinterAddress,
      whsmcAddress,
      fallbackRpcUrls: config.fallbackRpcUrls ?? [
        "https://rpc-mainnet.maticvigil.com",
        "https://rpc-mainnet.matic.quiknode.pro",
      ],
    });
  }
}

export function createPolygonConnector(
  config?: Partial<ChainConfig>,
): PolygonConnector {
  return new PolygonConnector(config);
}
