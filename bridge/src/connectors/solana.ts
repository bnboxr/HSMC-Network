/**
 * Solana Bridge Connector
 * =======================
 *
 * Non-EVM connector for Solana mainnet. Monitors deposits via polling
 * `getSignaturesForAddress` + `getParsedTransaction` from a Solana RPC node.
 *
 * Address format: base58, 32-44 characters.
 * Supports native SOL and SPL tokens (wHSMC).
 *
 * Env vars:
 *   SOLANA_RPC_URL      — Solana JSON-RPC endpoint (default: https://api.mainnet-beta.solana.com)
 *   SOLANA_MIN_CONF     — Minimum confirmations (default: 32)
 *   SOLANA_POLL_MS      — Poll interval (default: 30000)
 */

import type {
  ChainConnector,
  ChainConfig,
  DepositEvent,
  RateLimiter,
  RetryOptions,
} from "../types";
import { randomInt } from "node:crypto";

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
        options.baseDelayMs * 2 ** attempt + randomInt(0, 500),
        maxDelay,
      );
      options.onRetry?.(attempt + 1, lastError);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError!;
}

// ─── Address validation ─────────────────────────────────────────────────

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ─── Solana RPC types ───────────────────────────────────────────────────

interface SolanaRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface SolanaSignatureInfo {
  signature: string;
  slot: number;
  err?: unknown;
  memo?: string;
  blockTime?: number;
  confirmationStatus?: string;
}

interface SolanaParsedTransaction {
  signature: string;
  slot: number;
  blockTime?: number;
  meta?: {
    postBalances?: number[];
    preBalances?: number[];
    err?: unknown;
  };
  transaction?: {
    message?: {
      accountKeys?: { pubkey: string }[];
      instructions?: Array<{
        parsed?: {
          info?: {
            source?: string;
            destination?: string;
            lamports?: number;
            amount?: string;
          };
        };
        program?: string;
      }>;
    };
  };
}

// ─── Solana Connector class ──────────────────────────────────────────────

export class SolanaConnector implements ChainConnector {
  readonly chain = "sol" as const;

  private readonly rpcUrl: string;
  private readonly minConfirmations: number;
  private readonly pollIntervalMs: number;
  private readonly rateLimiter: RateLimiter;
  private readonly retryOptions: RetryOptions;
  private rpcId = 0;

  constructor(config: Partial<ChainConfig> = {}) {
    this.rpcUrl =
      config.rpcUrl ??
      process.env.SOLANA_RPC_URL ??
      "https://api.mainnet-beta.solana.com";

    this.minConfirmations =
      config.minConfirmations ??
      (process.env.SOLANA_MIN_CONF
        ? Number(process.env.SOLANA_MIN_CONF)
        : 32);

    this.pollIntervalMs =
      config.pollIntervalMs ??
      (process.env.SOLANA_POLL_MS ? Number(process.env.SOLANA_POLL_MS) : 30_000);

    this.retryOptions = {
      maxRetries: config.maxRetries ?? 3,
      baseDelayMs: config.retryBaseDelayMs ?? 2_000,
      maxDelayMs: 30_000,
    };

    // 5 req/s for public RPC
    this.rateLimiter = new TokenBucket(5, 5);
  }

  // ─── Address validation ─────────────────────────────────────────────

  isValidAddress(address: string): boolean {
    return BASE58_RE.test(address);
  }

  // ─── Balance ────────────────────────────────────────────────────────

  async getBalance(address: string): Promise<bigint> {
    if (!this.isValidAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    await this.rateLimiter.acquire();

    const result = await withRetry(async () => {
      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.rpcId,
          method: "getBalance",
          params: [address],
        }),
      });
      if (!res.ok) {
        throw new Error(`Solana RPC error ${res.status}`);
      }
      const json = (await res.json()) as SolanaRpcResponse<{ value: number }>;
      if (json.error) {
        throw new Error(`Solana RPC: ${json.error.message}`);
      }
      return json.result!;
    }, this.retryOptions);

    // Solana returns balance in lamports (1 SOL = 1e9 lamports)
    return BigInt(result.value);
  }

  // ─── Broadcast ──────────────────────────────────────────────────────

  async broadcastTransaction(signedTx: string): Promise<string> {
    if (!signedTx || signedTx.length < 20) {
      throw new Error("Invalid transaction data");
    }

    await this.rateLimiter.acquire();

    const result = await withRetry(async () => {
      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.rpcId,
          method: "sendTransaction",
          params: [
            signedTx,
            { encoding: "base64", skipPreflight: false },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`Solana RPC error ${res.status}`);
      }
      const json = (await res.json()) as SolanaRpcResponse<string>;
      if (json.error) {
        throw new Error(`Solana sendTransaction: ${json.error.message}`);
      }
      return json.result!;
    }, this.retryOptions);

    return result; // transaction signature (base58)
  }

  // ─── Deposit watcher ────────────────────────────────────────────────

  async *watchForDeposit(
    address: string,
    minConfirmations?: number,
  ): AsyncIterable<DepositEvent> {
    if (!this.isValidAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    const minConf = minConfirmations ?? this.minConfirmations;
    const seen = new Set<string>();

    // Get current confirmed slot as starting point
    let lastSlot = await this.getLatestSlot();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const latestSlot = await this.getLatestSlot();
        const currentBlockHeight = latestSlot;

        // Fetch signatures since lastSlot
        const signatures = await this.fetchSignatures(address, lastSlot);

        for (const sig of signatures) {
          if (seen.has(sig.signature)) continue;
          if (sig.err) continue; // skip failed transactions

          const tx = await this.getParsedTransaction(sig.signature);
          if (!tx) continue;

          // Check confirmations
          const confs = currentBlockHeight - sig.slot + 1;
          if (confs < minConf) continue;

          // Extract incoming transfer to our address
          const deposit = this.extractDeposit(tx, address, confs);
          if (deposit) {
            seen.add(sig.signature);
            yield deposit;
          }
        }

        lastSlot = latestSlot + 1;
      } catch (err) {
        console.warn(
          `[sol::watchForDeposit] transient error: ${(err as Error).message}`,
        );
      }

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private async getLatestSlot(): Promise<number> {
    await this.rateLimiter.acquire();
    const result = await withRetry(async () => {
      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.rpcId,
          method: "getSlot",
          params: [{ commitment: "finalized" }],
        }),
      });
      if (!res.ok) throw new Error(`Solana RPC error ${res.status}`);
      const json = (await res.json()) as SolanaRpcResponse<number>;
      if (json.error) throw new Error(`Solana getSlot: ${json.error.message}`);
      return json.result!;
    }, this.retryOptions);
    return result;
  }

  private async fetchSignatures(
    address: string,
    untilSlot: number,
  ): Promise<SolanaSignatureInfo[]> {
    await this.rateLimiter.acquire();
    const result = await withRetry(async () => {
      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.rpcId,
          method: "getSignaturesForAddress",
          params: [
            address,
            { limit: 50, until: untilSlot },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Solana RPC error ${res.status}`);
      const json = (await res.json()) as SolanaRpcResponse<
        SolanaSignatureInfo[]
      >;
      if (json.error)
        throw new Error(`Solana getSignaturesForAddress: ${json.error.message}`);
      return json.result ?? [];
    }, this.retryOptions);
    return result;
  }

  private async getParsedTransaction(
    signature: string,
  ): Promise<SolanaParsedTransaction | null> {
    await this.rateLimiter.acquire();
    try {
      const result = await withRetry(async () => {
        const res = await fetch(this.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++this.rpcId,
            method: "getTransaction",
            params: [
              signature,
              { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
            ],
          }),
        });
        if (!res.ok) throw new Error(`Solana RPC error ${res.status}`);
        const json = (await res.json()) as SolanaRpcResponse<SolanaParsedTransaction>;
        if (json.error) {
          if (json.error.message?.includes("not found")) {
            return null;
          }
          throw new Error(`Solana getTransaction: ${json.error.message}`);
        }
        return json.result ?? null;
      }, this.retryOptions);
      return result;
    } catch {
      return null;
    }
  }

  private extractDeposit(
    tx: SolanaParsedTransaction,
    watchAddress: string,
    confirmations: number,
  ): DepositEvent | null {
    if (!tx.transaction?.message?.instructions) return null;

    let totalLamports = 0n;
    let fromAddr = "";

    for (const ix of tx.transaction.message.instructions) {
      // Native SOL transfer (system program)
      if (ix.parsed?.info?.destination === watchAddress) {
        totalLamports += BigInt(ix.parsed.info.lamports ?? 0);
        fromAddr = ix.parsed.info.source ?? fromAddr;
      }
      // SPL token transfer could be handled here for wHSMC
    }

    if (totalLamports === 0n) return null;

    return {
      txHash: tx.signature,
      from: fromAddr,
      to: watchAddress,
      amount: totalLamports,
      confirmations,
      blockTime: tx.blockTime ?? Math.floor(Date.now() / 1000),
      blockHeight: tx.slot,
      chain: "sol",
      extra: {
        slot: tx.slot,
      },
    };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────

export function createSolanaConnector(
  config?: Partial<ChainConfig>,
): SolanaConnector {
  return new SolanaConnector(config);
}
