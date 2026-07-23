/**
 * Cosmos Bridge Connector
 * =======================
 *
 * Non-EVM connector for Cosmos Hub and IBC-enabled cosmos-sdk chains.
 * Uses the Cosmos REST (LCD) API for all operations — no SDK required.
 *
 * Address format: bech32 (cosmos1… for Cosmos Hub)
 * Balance endpoint:  /cosmos/bank/v1beta1/balances/{address}
 * Broadcast endpoint: /cosmos/tx/v1beta1/txs
 * Deposit watcher:   /cosmos/tx/v1beta1/txs?events=transfer.recipient={address}
 *
 * Env vars:
 *   COSMOS_RPC_URL    — LCD REST API base (default: https://cosmos-rest.publicnode.com)
 *   COSMOS_MIN_CONF   — Minimum confirmations (default: 6)
 *   COSMOS_POLL_MS    — Poll interval (default: 30000)
 */

import type {
  ChainConnector,
  ChainConfig,
  DepositEvent,
  RateLimiter,
  RetryOptions,
} from "../types";

// ─── Token-bucket rate limiter ──────────────────────────────────────────

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
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRate,
    );
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
        options.baseDelayMs * 2 ** attempt + Math.random() * 500,
        maxDelay,
      );
      options.onRetry?.(attempt + 1, lastError);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError!;
}

// ─── Address validation ─────────────────────────────────────────────────

const BECH32_COSMOS_RE = /^cosmos1[ac-hj-np-z02-9]{38,58}$/i;

// ─── Cosmos LCD API types ───────────────────────────────────────────────

interface CosmosBalanceResponse {
  balances: { denom: string; amount: string }[];
  pagination?: { next_key: string | null; total: string };
}

interface CosmosTxResponse {
  tx: {
    body: {
      messages: Array<{
        "@type": string;
        from_address?: string;
        to_address?: string;
        amount?: { denom: string; amount: string }[];
      }>;
    };
  };
  tx_response: {
    txhash: string;
    height: string;
    timestamp: string;
    code: number;
    raw_log?: string;
  };
}

interface CosmosTxsResponse {
  tx_responses: CosmosTxResponse["tx_response"][];
  txs: CosmosTxResponse["tx"][];
  pagination?: { next_key: string | null; total: string };
}

interface CosmosLatestBlockResponse {
  block: {
    header: { height: string; time: string };
  };
}

// ─── Cosmos Connector class ──────────────────────────────────────────────

export class CosmosConnector implements ChainConnector {
  readonly chain = "cosmos" as const;

  private readonly apiBase: string;
  private readonly minConfirmations: number;
  private readonly pollIntervalMs: number;
  private readonly rateLimiter: RateLimiter;
  private readonly retryOptions: RetryOptions;

  constructor(config: Partial<ChainConfig> = {}) {
    this.apiBase = (
      config.rpcUrl ??
      process.env.COSMOS_RPC_URL ??
      "https://cosmos-rest.publicnode.com"
    ).replace(/\/+$/, "");

    this.minConfirmations =
      config.minConfirmations ??
      (process.env.COSMOS_MIN_CONF
        ? Number(process.env.COSMOS_MIN_CONF)
        : 6);

    this.pollIntervalMs =
      config.pollIntervalMs ??
      (process.env.COSMOS_POLL_MS
        ? Number(process.env.COSMOS_POLL_MS)
        : 30_000);

    this.retryOptions = {
      maxRetries: config.maxRetries ?? 3,
      baseDelayMs: config.retryBaseDelayMs ?? 2_000,
      maxDelayMs: 30_000,
    };

    // 3 req/s conservative for public LCD
    this.rateLimiter = new TokenBucket(3, 3);
  }

  // ─── Address validation ─────────────────────────────────────────────

  isValidAddress(address: string): boolean {
    return BECH32_COSMOS_RE.test(address);
  }

  // ─── Balance ────────────────────────────────────────────────────────

  async getBalance(address: string): Promise<bigint> {
    if (!this.isValidAddress(address)) {
      throw new Error(`Invalid Cosmos address: ${address}`);
    }

    await this.rateLimiter.acquire();

    const data = await withRetry(async () => {
      const res = await fetch(
        `${this.apiBase}/cosmos/bank/v1beta1/balances/${address}`,
      );
      if (!res.ok) {
        throw new Error(`Cosmos LCD error ${res.status}: ${await res.text().catch(() => "")}`);
      }
      return res.json() as Promise<CosmosBalanceResponse>;
    }, this.retryOptions);

    // Sum all balances (in uatom / base denom units)
    let total = 0n;
    for (const coin of data.balances) {
      total += BigInt(coin.amount);
    }
    return total;
  }

  // ─── Broadcast ──────────────────────────────────────────────────────

  async broadcastTransaction(signedTx: string): Promise<string> {
    if (!signedTx || signedTx.length < 20) {
      throw new Error("Invalid transaction data");
    }

    await this.rateLimiter.acquire();

    return withRetry(async () => {
      const res = await fetch(`${this.apiBase}/cosmos/tx/v1beta1/txs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_bytes: signedTx,
          mode: "BROADCAST_MODE_SYNC",
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Cosmos broadcast failed: ${res.status} ${errBody}`);
      }

      const json = (await res.json()) as {
        tx_response?: { txhash?: string; code?: number; raw_log?: string };
      };

      if (json.tx_response?.code !== 0 && json.tx_response?.code !== undefined) {
        throw new Error(
          `Cosmos tx failed with code ${json.tx_response.code}: ${json.tx_response.raw_log ?? ""}`,
        );
      }

      return json.tx_response?.txhash ?? "";
    }, this.retryOptions);
  }

  // ─── Deposit watcher ────────────────────────────────────────────────

  async *watchForDeposit(
    address: string,
    minConfirmations?: number,
  ): AsyncIterable<DepositEvent> {
    if (!this.isValidAddress(address)) {
      throw new Error(`Invalid Cosmos address: ${address}`);
    }

    const minConf = minConfirmations ?? this.minConfirmations;
    const seen = new Set<string>();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const latestHeight = await this.getLatestHeight();
        const txs = await this.fetchTransferTxs(address);

        for (const { tx_response, tx } of txs) {
          if (seen.has(tx_response.txhash)) continue;
          if (tx_response.code !== 0) continue; // skip failed txs

          const txHeight = Number(tx_response.height);
          const confs = latestHeight - txHeight + 1;
          if (confs < minConf) continue;

          // Extract deposits to our address
          for (const msg of tx.body.messages) {
            if (
              msg["@type"] === "/cosmos.bank.v1beta1.MsgSend" &&
              msg.to_address === address
            ) {
              let amount = 0n;
              for (const coin of msg.amount ?? []) {
                if (coin.denom === "uatom") {
                  amount += BigInt(coin.amount);
                }
              }

              if (amount > 0n) {
                seen.add(tx_response.txhash);
                yield {
                  txHash: tx_response.txhash,
                  from: msg.from_address ?? "",
                  to: address,
                  amount,
                  confirmations: confs,
                  blockTime: Math.floor(
                    new Date(tx_response.timestamp).getTime() / 1000,
                  ),
                  blockHeight: txHeight,
                  chain: "cosmos",
                  extra: {
                    raw_log: tx_response.raw_log,
                  },
                };
              }
            }
          }
        }
      } catch (err) {
        console.warn(
          `[cosmos::watchForDeposit] transient error: ${(err as Error).message}`,
        );
      }

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private async getLatestHeight(): Promise<number> {
    await this.rateLimiter.acquire();
    const data = await withRetry(async () => {
      const res = await fetch(
        `${this.apiBase}/cosmos/base/tendermint/v1beta1/blocks/latest`,
      );
      if (!res.ok) {
        throw new Error(`Cosmos LCD error ${res.status}`);
      }
      return res.json() as Promise<CosmosLatestBlockResponse>;
    }, this.retryOptions);
    return Number(data.block.header.height);
  }

  private async fetchTransferTxs(
    address: string,
  ): Promise<CosmosTxResponse[]> {
    await this.rateLimiter.acquire();
    const data = await withRetry(async () => {
      const url = `${this.apiBase}/cosmos/tx/v1beta1/txs?events=transfer.recipient='${encodeURIComponent(address)}'&order_by=ORDER_BY_DESC&limit=50`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Cosmos LCD txs error ${res.status}`);
      }
      return res.json() as Promise<CosmosTxsResponse>;
    }, this.retryOptions);

    // Pair up tx_responses with txs by index
    const results: CosmosTxResponse[] = [];
    const len = Math.min(
      data.tx_responses?.length ?? 0,
      data.txs?.length ?? 0,
    );
    for (let i = 0; i < len; i++) {
      results.push({
        tx: data.txs[i],
        tx_response: data.tx_responses[i],
      });
    }
    return results;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────

export function createCosmosConnector(
  config?: Partial<ChainConfig>,
): CosmosConnector {
  return new CosmosConnector(config);
}
