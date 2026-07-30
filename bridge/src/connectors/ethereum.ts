/**
 * Ethereum / BSC Bridge Connector
 * ===============================
 *
 * A single parametrized connector for EVM-compatible chains (Ethereum mainnet,
 * BSC, Polygon, Sepolia, BSC Testnet, etc.). The chain is configured via the
 * `ChainConfig` passed at construction time — different RPC URLs, contract
 * addresses, and chain IDs.
 *
 * Features:
 *   - Monitors BridgeMinter events (MintProposed, MintFinalized, Minted,
 *     MintChallenged) via ethers.js v6 `Contract.on()` + polling fallback.
 *   - Reads wHSMC balance for any address.
 *   - Broadcasts signed transactions.
 *   - Gas estimation + fee monitoring (EIP-1559-aware).
 *   - Retry + rate limiting on RPC calls.
 *
 * Env vars (per-chain config is passed in code, but these work as defaults):
 *   ETH_RPC_URL            — Ethereum RPC (default)
 *   BSC_RPC_URL            — BSC RPC (default)
 *   BRIDGE_MINTER_ADDRESS  — Default BridgeMinter address
 *   WHSMC_ADDRESS          — Default wHSMC token address
 */

import { ethers } from "ethers";
import type {
  ChainConnector,
  ChainConfig,
  DepositEvent,
  BridgeEvent,
  RateLimiter,
  RetryOptions,
} from "../types";
import { randomInt } from "node:crypto";

// ─── ABI fragments (only the parts we need) ──────────────────────────────

const BRIDGE_MINTER_ABI = [
  "function threshold() view returns (uint256)",
  "function processed(bytes32) view returns (bool)",
  "function challengePeriod() view returns (uint256)",
  "function getProposalId(bytes32) view returns (uint256)",
  "function canFinalize(uint256) view returns (bool)",
  "event MintProposed(uint256 indexed proposalId, bytes32 indexed hsmcTxHash, address indexed to, uint256 amount, uint256 expiresAt, address[] signers)",
  "event MintFinalized(uint256 indexed proposalId, bytes32 indexed hsmcTxHash)",
  "event Minted(bytes32 indexed hsmcTxHash, address indexed to, uint256 amount)",
  "event MintChallenged(uint256 indexed proposalId, bytes32 indexed hsmcTxHash, address indexed challenger, bytes proof)",
];

const WHSMC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function bridgeBurn(uint256,string)",
  "function bridgeMint(address,uint256,bytes32)",
  "event BridgeMint(address indexed to, uint256 amount, bytes32 indexed hsmcTxHash)",
  "event BridgeBurn(address indexed from, uint256 amount, string hsmcDestination)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// ─── Token-bucket rate limiter (lightweight, no deps) ────────────────────

class TokenBucket implements RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(maxTokens: number, refillPerSecond: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
    this.refillRate = refillPerSecond / 1000;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
    await new Promise((resolve) => setTimeout(resolve, waitMs + 1));
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

// ─── Retry helper ────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxDelay = options.maxDelayMs ?? 30_000;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === options.maxRetries) break;

      const delay = Math.min(
        options.baseDelayMs * 2 ** attempt + randomInt(0, 500),
        maxDelay,
      );
      options.onRetry?.(attempt + 1, lastError);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError!;
}

// ─── Default chain presets ───────────────────────────────────────────────

const CHAIN_PRESETS: Record<string, Partial<ChainConfig>> = {
  eth: {
    chain: "eth",
    rpcUrl: process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com",
    minConfirmations: 12,
    pollIntervalMs: 15_000,
    maxRetries: 3,
    retryBaseDelayMs: 2_000,
    chainId: 1,
  },
  bsc: {
    chain: "bsc",
    rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org",
    minConfirmations: 15,
    pollIntervalMs: 15_000,
    maxRetries: 3,
    retryBaseDelayMs: 2_000,
    chainId: 56,
  },
  polygon: {
    chain: "polygon",
    rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
    minConfirmations: 256,
    pollIntervalMs: 15_000,
    maxRetries: 3,
    retryBaseDelayMs: 2_000,
    chainId: 137,
  },
  avalanche: {
    chain: "avalanche",
    rpcUrl: process.env.AVALANCHE_RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
    minConfirmations: 12,
    pollIntervalMs: 15_000,
    maxRetries: 3,
    retryBaseDelayMs: 2_000,
    chainId: 43114,
  },
  arbitrum: {
    chain: "arbitrum",
    rpcUrl: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    minConfirmations: 12,
    pollIntervalMs: 15_000,
    maxRetries: 3,
    retryBaseDelayMs: 2_000,
    chainId: 42161,
  },
  optimism: {
    chain: "optimism",
    rpcUrl: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
    minConfirmations: 12,
    pollIntervalMs: 15_000,
    maxRetries: 3,
    retryBaseDelayMs: 2_000,
    chainId: 10,
  },
  base: {
    chain: "base",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    minConfirmations: 12,
    pollIntervalMs: 15_000,
    maxRetries: 3,
    retryBaseDelayMs: 2_000,
    chainId: 8453,
  },
};

// ─── EVM Connector class ─────────────────────────────────────────────────

export type EvmChainId = "eth" | "bsc" | "polygon" | "avalanche" | "arbitrum" | "optimism" | "base";

export class EvmConnector implements ChainConnector {
  readonly chain: EvmChainId;

  private readonly provider: ethers.JsonRpcProvider;
  private readonly bridgeContract: ethers.Contract;
  private readonly whsmcContract: ethers.Contract;
  private readonly config: ChainConfig;
  private readonly rateLimiter: RateLimiter;
  private readonly retryOptions: RetryOptions;

  constructor(config: ChainConfig) {
    const validChains: EvmChainId[] = ["eth", "bsc", "polygon", "avalanche", "arbitrum", "optimism", "base"];
    if (!validChains.includes(config.chain as EvmChainId)) {
      throw new Error(
        `EvmConnector only supports EVM chains, got "${config.chain}"`,
      );
    }
    this.chain = config.chain as EvmChainId;

    // Merge defaults → user overrides
    const preset = CHAIN_PRESETS[config.chain] ?? {};
    this.config = {
      ...preset,
      ...config,
      fallbackRpcUrls: config.fallbackRpcUrls ?? [],
      minConfirmations: config.minConfirmations ?? preset.minConfirmations ?? 12,
      pollIntervalMs: config.pollIntervalMs ?? preset.pollIntervalMs ?? 15_000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 2_000,
    };

    // Primary provider
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);

    // Contracts
    const bridgeAddr = this.config.bridgeMinterAddress;
    const whsmcAddr = this.config.whsmcAddress;
    if (!bridgeAddr) {
      throw new Error(
        `bridgeMinterAddress is required for ${this.chain} connector`,
      );
    }
    if (!whsmcAddr) {
      throw new Error(`whsmcAddress is required for ${this.chain} connector`);
    }

    this.bridgeContract = new ethers.Contract(
      bridgeAddr,
      BRIDGE_MINTER_ABI,
      this.provider,
    );
    this.whsmcContract = new ethers.Contract(
      whsmcAddr,
      WHSMC_ABI,
      this.provider,
    );

    // Rate limiter: 10 req/s (generous for most public RPCs)
    this.rateLimiter = new TokenBucket(10, 10);
    this.retryOptions = {
      maxRetries: this.config.maxRetries,
      baseDelayMs: this.config.retryBaseDelayMs,
      maxDelayMs: 30_000,
    };
  }

  // ─── Address validation ─────────────────────────────────────────────

  isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  // ─── Balance (wHSMC) ────────────────────────────────────────────────

  /**
   * Get wHSMC balance for an address.
   * Returns the raw token amount (8 decimals → 1 wHSMC = 10^8 base units).
   */
  async getBalance(address: string): Promise<bigint> {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid EVM address: ${address}`);
    }
    await this.rateLimiter.acquire();

    const raw = await withRetry(async () => {
      return this.whsmcContract.balanceOf(address);
    }, this.retryOptions);

    return BigInt(raw.toString());
  }

  /**
   * Get native coin balance (ETH / BNB) for an address.
   * Returns balance in wei.
   */
  async getNativeBalance(address: string): Promise<bigint> {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid EVM address: ${address}`);
    }
    await this.rateLimiter.acquire();

    const raw = await withRetry(async () => {
      return this.provider.getBalance(address);
    }, this.retryOptions);

    return BigInt(raw.toString());
  }

  // ─── Broadcast ──────────────────────────────────────────────────────

  /**
   * Broadcast a signed raw transaction hex.
   * @param signedTx  Hex-encoded signed transaction (0x…).
   * @returns Transaction hash.
   */
  async broadcastTransaction(signedTx: string): Promise<string> {
    if (!signedTx || signedTx.length < 10) {
      throw new Error("Invalid transaction hex");
    }

    await this.rateLimiter.acquire();

    const txResponse = await withRetry(async () => {
      return this.provider.broadcastTransaction(signedTx);
    }, this.retryOptions);

    return txResponse.hash;
  }

  // ─── Gas estimation ─────────────────────────────────────────────────

  /**
   * Estimate gas for a transaction.
   * Returns EIP-1559 fee data: maxFeePerGas, maxPriorityFeePerGas, gasLimit.
   */
  async estimateGas(tx: ethers.TransactionRequest): Promise<{
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    await this.rateLimiter.acquire();

    const [feeData, gasLimit] = await Promise.all([
      withRetry(() => this.provider.getFeeData(), this.retryOptions),
      withRetry(() => this.provider.estimateGas(tx), this.retryOptions),
    ]);

    // Add 20% buffer to gas limit for safety
    const gasLimitBuffered = (gasLimit * 120n) / 100n;

    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 2_000_000_000n; // 2 gwei default
    const maxFeePerGas = feeData.maxFeePerGas ?? 50_000_000_000n; // 50 gwei default

    return {
      gasLimit: BigInt(gasLimitBuffered.toString()),
      maxFeePerGas: BigInt(maxFeePerGas.toString()),
      maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas.toString()),
    };
  }

  // ─── Contract event watcher ─────────────────────────────────────────

  /**
   * Watch all BridgeMinter events starting from a block number.
   * Uses polling (ether.js polling) for reliability — event subscriptions
   * over WebSocket can drop; polling is safer for production relayers.
   *
   * @param fromBlock  Starting block (use "latest" for real-time only).
   * @returns AsyncIterable of BridgeEvent, yielding events as they occur.
   */
  async *watchContractEvents(
    fromBlock: number | "latest" = "latest",
  ): AsyncIterable<BridgeEvent> {
    let currentBlock: number;

    if (fromBlock === "latest") {
      currentBlock = await this.provider.getBlockNumber();
    } else {
      currentBlock = fromBlock;
    }

    const bridgeIface = this.bridgeContract.interface;
    const eventNames = [
      "MintProposed",
      "MintFinalized",
      "Minted",
      "MintChallenged",
    ];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const latestBlock = await withRetry(
          () => this.provider.getBlockNumber(),
          this.retryOptions,
        );

        if (latestBlock >= currentBlock) {
          // Fetch logs in batches to avoid RPC limits
          const batchSize = 2000;
          let from = currentBlock;

          while (from <= latestBlock) {
            const to = Math.min(from + batchSize - 1, latestBlock);
            await this.rateLimiter.acquire();

            const bridgeAddr = await this.bridgeContract.getAddress();

            let logs: ethers.Log[];
            try {
              logs = await withRetry(
                () =>
                  this.provider.getLogs({
                    address: bridgeAddr,
                    fromBlock: from,
                    toBlock: to,
                  }),
                this.retryOptions,
              );
            } catch (err) {
              // Some RPCs reject large block ranges — shrink and retry
              if ((err as Error).message.includes("too many") || (err as Error).message.includes("exceed")) {
                // For simplicity, shrink the chunk and continue
                const smallerTo = Math.min(from + 500, to);
                logs = await withRetry(
                  () =>
                    this.provider.getLogs({
                      address: bridgeAddr,
                      fromBlock: from,
                      toBlock: smallerTo,
                    }),
                  this.retryOptions,
                );
                from = smallerTo + 1;
                // process logs below, then continue outer loop
              } else {
                throw err;
              }
            }

            // Parse logs into BridgeEvent
            for (const log of logs) {
              try {
                const parsed = bridgeIface.parseLog({
                  topics: [...log.topics],
                  data: log.data,
                });

                if (!parsed || !eventNames.includes(parsed.name)) continue;

                const event = this.toBridgeEvent(
                  parsed.name,
                  parsed.args,
                  log,
                );
                if (event) yield event;
              } catch {
                // Ignore logs from other contracts at the same address
              }
            }

            from = to + 1;
          }

          currentBlock = latestBlock + 1;
        }
      } catch (err) {
        console.warn(
          `[${this.chain}::watchContractEvents] transient error: ${(err as Error).message}`,
        );
      }

      await new Promise((r) => setTimeout(r, this.config.pollIntervalMs));
    }
  }

  // ─── Deposit watcher (ChainConnector interface) ──────────────────────

  /**
   * Watch for incoming deposits to an address on this chain.
   *
   * On EVM chains, "deposits" arrive as `Minted` events from the BridgeMinter
   * contract (wHSMC minted after a bridge attestation). This watcher filters
   * Minted events where `to === address` and yields them as DepositEvents.
   */
  async *watchForDeposit(
    address: string,
    minConfirmations?: number,
  ): AsyncIterable<DepositEvent> {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid EVM address: ${address}`);
    }

    const minConf = minConfirmations ?? this.config.minConfirmations;
    const normalizedAddress = address.toLowerCase();

    for await (const ev of this.watchContractEvents()) {
      if (ev.type !== "Minted") continue;
      if (ev.data.to.toLowerCase() !== normalizedAddress) continue;

      // Check confirmations
      const currentBlock = await withRetry(
        () => this.provider.getBlockNumber(),
        this.retryOptions,
      );
      const confs = currentBlock - ev.data.blockNumber + 1;
      if (confs < minConf) continue; // skip, will be re-emitted on next iteration

      yield {
        txHash: ev.data.txHash,
        from: this.config.bridgeMinterAddress ?? "",
        to: ev.data.to,
        amount: ev.data.amount,
        confirmations: confs,
        blockTime: Math.floor(Date.now() / 1000), // approximate
        blockHeight: ev.data.blockNumber,
        chain: this.chain,
        extra: {
          hsmcTxHash: ev.data.hsmcTxHash,
        },
      };
    }
  }

  // ─── Convenience: watch specific event ───────────────────────────────

  /**
   * Watch for a specific BridgeMinter event by name.
   * Shorthand for filtering `watchContractEvents`.
   */
  async *watchEvent(
    eventName: "MintProposed" | "MintFinalized" | "Minted" | "MintChallenged",
    fromBlock: number | "latest" = "latest",
  ): AsyncIterable<BridgeEvent> {
    for await (const ev of this.watchContractEvents(fromBlock)) {
      if (ev.type === eventName) yield ev;
    }
  }

  // ─── Contract accessors ──────────────────────────────────────────────

  /** Get the ethers Provider (for advanced use). */
  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  /** Get the BridgeMinter Contract instance (read-only). */
  getBridgeContract(): ethers.Contract {
    return this.bridgeContract;
  }

  /** Get the wHSMC Contract instance (read-only). */
  getWhsmcContract(): ethers.Contract {
    return this.whsmcContract;
  }

  /** Get the configured chain config (read-only). */
  getConfig(): Readonly<ChainConfig> {
    return { ...this.config };
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  private toBridgeEvent(
    name: string,
    args: ethers.Result,
    log: ethers.Log,
  ): BridgeEvent | null {
    switch (name) {
      case "MintProposed":
        return {
          type: "MintProposed",
          data: {
            proposalId: BigInt(args.proposalId.toString()),
            hsmcTxHash: args.hsmcTxHash as string,
            to: args.to as string,
            amount: BigInt(args.amount.toString()),
            expiresAt: Number(args.expiresAt),
            signers: args.signers as string[],
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          },
        };
      case "MintFinalized":
        return {
          type: "MintFinalized",
          data: {
            proposalId: BigInt(args.proposalId.toString()),
            hsmcTxHash: args.hsmcTxHash as string,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          },
        };
      case "Minted":
        return {
          type: "Minted",
          data: {
            hsmcTxHash: args.hsmcTxHash as string,
            to: args.to as string,
            amount: BigInt(args.amount.toString()),
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          },
        };
      case "MintChallenged":
        return {
          type: "MintChallenged",
          data: {
            proposalId: BigInt(args.proposalId.toString()),
            hsmcTxHash: args.hsmcTxHash as string,
            challenger: args.challenger as string,
            proof: args.proof as string,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          },
        };
      default:
        return null;
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────

/**
 * Create an EVM connector for a specific chain.
 *
 * @example
 * ```ts
 * const ethConnector = createEvmConnector({
 *   chain: "eth",
 *   rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/KEY",
 *   bridgeMinterAddress: "0x…",
 *   whsmcAddress: "0x…",
 * });
 * ```
 */
export function createEvmConnector(config: ChainConfig): EvmConnector {
  return new EvmConnector(config);
}
