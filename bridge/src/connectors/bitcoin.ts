/**
 * Bitcoin Bridge Connector
 * ========================
 *
 * Monitors the Bitcoin blockchain for deposits destined for the HSMC bridge.
 * Uses Blockstream's public REST API as the default data source (no Bitcoin
 * Core node required). Optionally supports Bitcoin Core JSON-RPC for
 * self-hosted / higher-throughput deployments.
 *
 * Address support:
 *   - P2PKH   (1…   — legacy)
 *   - P2SH    (3…   — wrapped segwit / multisig)
 *   - P2WPKH  (bc1q… — native segwit, bech32)
 *   - P2TR    (bc1p… — Taproot, bech32m)
 *
 * Finality: 6 confirmations (standard Bitcoin best-practice).
 *
 * Rate limiting: token-bucket at 5 req/s to Blockstream (generous for public API).
 * Retry: exponential backoff, 3 attempts, jittered.
 *
 * Env vars:
 *   BTC_RPC_URL       — Blockstream API base (default: https://blockstream.info/api)
 *   BTC_CORE_URL      — Optional Bitcoin Core JSON-RPC URL
 *   BTC_CORE_USER     — RPC auth username
 *   BTC_CORE_PASS     — RPC auth password
 *   BTC_MIN_CONF      — Override min confirmations (default: 6)
 *   BTC_POLL_MS       — Poll interval for watchForDeposit (default: 30000)
 */

import type {
  ChainConnector,
  ChainConfig,
  DepositEvent,
  RateLimiter,
  RetryOptions,
} from "../types";
import { randomInt } from "node:crypto";

// ─── Address validation regexes ──────────────────────────────────────────

const P2PKH_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const P2SH_RE = /^[3][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const P2WPKH_RE = /^bc1[ac-hj-np-z02-9]{11,71}$/i;
const P2TR_RE = /^bc1p[ac-hj-np-z02-9]{11,71}$/i;

// ─── Blockstream API types ──────────────────────────────────────────────

interface BlockstreamUtxo {
  txid: string;
  vout: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
  value: number; // satoshis
}

interface BlockstreamTx {
  txid: string;
  version: number;
  locktime: number;
  vin: {
    txid: string;
    vout: number;
    prevout?: {
      scriptpubkey_address?: string;
      value: number;
    };
    scriptsig?: string;
    witness?: string[];
    is_coinbase: boolean;
    sequence: number;
  }[];
  vout: {
    scriptpubkey_address?: string;
    value: number; // satoshis
    scriptpubkey_type?: string;
  }[];
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
  fee?: number;
  weight?: number;
}

// ─── Token-bucket rate limiter ──────────────────────────────────────────

class TokenBucket implements RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

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
    // Wait until a token is available
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
    await new Promise((resolve) => setTimeout(resolve, waitMs + 1));
    this.tokens = 0; // consume the token
    this.lastRefill = Date.now();
  }
}

// ─── Retry with exponential backoff ─────────────────────────────────────

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

// ─── Bitcoin Core JSON-RPC client (optional) ────────────────────────────

class BitcoinCoreRpc {
  private url: string;
  private auth: string;
  private id = 0;

  constructor(url: string, user: string, pass: string) {
    this.url = url;
    this.auth = Buffer.from(`${user}:${pass}`).toString("base64");
  }

  async call(method: string, params: unknown[] = []): Promise<unknown> {
    this.id++;
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${this.auth}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.id,
        method,
        params,
      }),
    });
    if (!res.ok) {
      throw new Error(`Bitcoin Core RPC error ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const json = await res.json() as { error?: { message: string }; result?: unknown };
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
    return json.result;
  }
}

// ─── BTC Connector class ────────────────────────────────────────────────

export class BitcoinConnector implements ChainConnector {
  readonly chain = "btc" as const;

  private readonly apiBase: string;
  private readonly coreRpc: BitcoinCoreRpc | null;
  private readonly minConfirmations: number;
  private readonly pollIntervalMs: number;
  private readonly rateLimiter: RateLimiter;
  private readonly retryOptions: RetryOptions;
  private readonly useCoreRpc: boolean;

  constructor(config: Partial<ChainConfig> & { rpcUrl?: string } = {}) {
    // Blockstream API (public) — PRIMARY
    this.apiBase = (config.rpcUrl || process.env.BTC_RPC_URL || "https://blockstream.info/api")
      .replace(/\/+$/, "");

    // Bitcoin Core JSON-RPC (optional, for self-hosted)
    const coreUrl = process.env.BTC_CORE_URL;
    const coreUser = process.env.BTC_CORE_USER;
    const corePass = process.env.BTC_CORE_PASS;
    this.useCoreRpc = !!(coreUrl && coreUser && corePass);
    this.coreRpc = this.useCoreRpc
      ? new BitcoinCoreRpc(coreUrl!, coreUser!, corePass!)
      : null;

    this.minConfirmations =
      config.minConfirmations ??
      (process.env.BTC_MIN_CONF ? Number(process.env.BTC_MIN_CONF) : 6);

    this.pollIntervalMs =
      config.pollIntervalMs ??
      (process.env.BTC_POLL_MS ? Number(process.env.BTC_POLL_MS) : 30_000);

    this.retryOptions = {
      maxRetries: config.maxRetries ?? 3,
      baseDelayMs: config.retryBaseDelayMs ?? 2_000,
      maxDelayMs: 30_000,
    };

    // 5 req/s to Blockstream (generous; they rate-limit at ~10/s)
    this.rateLimiter = new TokenBucket(5, 5);
  }

  // ─── Address validation ─────────────────────────────────────────────

  isValidAddress(address: string): boolean {
    return (
      P2PKH_RE.test(address) ||
      P2SH_RE.test(address) ||
      P2WPKH_RE.test(address) ||
      P2TR_RE.test(address)
    );
  }

  // ─── Balance ────────────────────────────────────────────────────────

  async getBalance(address: string): Promise<bigint> {
    if (!this.isValidAddress(address)) {
      throw new Error(`Invalid Bitcoin address: ${address}`);
    }

    if (this.useCoreRpc && this.coreRpc) {
      return this.getBalanceCore(address);
    }
    return this.getBalanceBlockstream(address);
  }

  private async getBalanceCore(address: string): Promise<bigint> {
    // Bitcoin Core: listunspent and sum, or use scantxoutset
    const utxos = await this.coreRpc!.call("listunspent", [0, 9999999, [address]]);
    let total = 0n;
    for (const utxo of utxos as { amount: number }[]) {
      total += BigInt(Math.round(utxo.amount * 1e8));
    }
    return total;
  }

  private async getBalanceBlockstream(address: string): Promise<bigint> {
    await this.rateLimiter.acquire();

    const data = await withRetry(async () => {
      const res = await fetch(`${this.apiBase}/address/${address}/utxo`);
      if (!res.ok) throw new Error(`Blockstream UTXO: ${res.status}`);
      return res.json() as Promise<BlockstreamUtxo[]>;
    }, this.retryOptions);

    let total = 0n;
    for (const utxo of data) {
      total += BigInt(utxo.value);
    }
    return total;
  }

  // ─── Broadcast ──────────────────────────────────────────────────────

  async broadcastTransaction(signedTxHex: string): Promise<string> {
    if (!signedTxHex || signedTxHex.length < 10) {
      throw new Error("Invalid transaction hex");
    }

    if (this.useCoreRpc && this.coreRpc) {
      return this.broadcastCore(signedTxHex);
    }
    return this.broadcastBlockstream(signedTxHex);
  }

  private async broadcastCore(signedTxHex: string): Promise<string> {
    const txid = await this.coreRpc!.call("sendrawtransaction", [signedTxHex]);
    return txid as string;
  }

  private async broadcastBlockstream(signedTxHex: string): Promise<string> {
    await this.rateLimiter.acquire();

    const txid = await withRetry(async () => {
      const res = await fetch(`${this.apiBase}/tx`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: signedTxHex,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Broadcast failed: ${res.status} ${errText}`);
      }
      // Blockstream returns the txid as plain text
      return (await res.text()).trim();
    }, this.retryOptions);

    if (!txid) throw new Error("Empty txid from broadcast");
    return txid;
  }

  // ─── Deposit watcher ────────────────────────────────────────────────

  async *watchForDeposit(
    address: string,
    minConfirmations?: number,
  ): AsyncIterable<DepositEvent> {
    if (!this.isValidAddress(address)) {
      throw new Error(`Invalid Bitcoin address: ${address}`);
    }

    const minConf = minConfirmations ?? this.minConfirmations;
    const seen = new Set<string>(); // track txids we've already yielded

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const txs = await this.fetchAddressTxs(address);

        for (const tx of txs) {
          if (seen.has(tx.txid)) continue;
          if (!tx.status.confirmed) continue;

          const confs = await this.getConfirmations(tx);
          if (confs < minConf) continue;

          // Sum outputs to our address
          let totalOut = 0n;
          let fromAddr = "";
          for (const vin of tx.vin) {
            if (vin.prevout?.scriptpubkey_address) {
              fromAddr = vin.prevout.scriptpubkey_address;
              break; // first sender
            }
          }
          for (const vout of tx.vout) {
            if (vout.scriptpubkey_address === address) {
              totalOut += BigInt(vout.value);
            }
          }

          if (totalOut > 0n) {
            seen.add(tx.txid);
            yield {
              txHash: tx.txid,
              from: fromAddr,
              to: address,
              amount: totalOut,
              confirmations: confs,
              blockTime: tx.status.block_time ?? 0,
              blockHeight: tx.status.block_height ?? 0,
              chain: "btc",
              extra: {
                fee: tx.fee,
                weight: tx.weight,
                voutCount: tx.vout.length,
              },
            };
          }
        }
      } catch (err) {
        // Log but keep watching — transient API errors shouldn't kill the watcher
        console.warn(
          `[btc::watchForDeposit] transient error (will retry): ${(err as Error).message}`,
        );
      }

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async fetchAddressTxs(address: string): Promise<BlockstreamTx[]> {
    if (this.useCoreRpc && this.coreRpc) {
      return this.fetchAddressTxsCore(address);
    }
    return this.fetchAddressTxsBlockstream(address);
  }

  private async fetchAddressTxsCore(address: string): Promise<BlockstreamTx[]> {
    // listtransactions or scantxoutset + getrawtransaction
    const txs = await this.coreRpc!.call("listtransactions", ["*", 100, 0, true]);
    const relevant = (txs as { address?: string; txid: string }[]).filter(
      (t: { address?: string }) => t.address === address,
    );

    const results: BlockstreamTx[] = [];
    const seen = new Set<string>();
    for (const t of relevant) {
      if (seen.has(t.txid)) continue;
      seen.add(t.txid);
      try {
        const raw = await this.coreRpc!.call("getrawtransaction", [t.txid, true]);
        results.push(this.normalizeCoreTx(raw as Record<string, unknown>));
      } catch {
        // skip malformed
      }
    }
    return results;
  }

  /** Convert Bitcoin Core's getrawtransaction output to our BlockstreamTx shape. */
  private normalizeCoreTx(raw: Record<string, unknown>): BlockstreamTx {
    const vin = (raw.vin as Array<Record<string, unknown>> ?? []).map(
      (v: Record<string, unknown>) => ({
        txid: (v.txid as string) ?? "",
        vout: (v.vout as number) ?? 0,
        prevout: v.scriptPubKey
          ? {
              scriptpubkey_address: (v.scriptPubKey as Record<string, unknown>)?.address as string | undefined,
              value: 0,
            }
          : undefined,
        is_coinbase: "coinbase" in v,
        sequence: (v.sequence as number) ?? 0,
      }),
    );
    const vout = (raw.vout as Array<Record<string, unknown>> ?? []).map(
      (v: Record<string, unknown>) => ({
        scriptpubkey_address: (v.scriptPubKey as Record<string, unknown>)?.address as string | undefined,
        value: Math.round((v.value as number) * 1e8),
        scriptpubkey_type: (v.scriptPubKey as Record<string, unknown>)?.type as string | undefined,
      }),
    );
    return {
      txid: (raw.txid as string) ?? "",
      version: (raw.version as number) ?? 0,
      locktime: (raw.locktime as number) ?? 0,
      vin,
      vout,
      status: {
        confirmed: true,
        block_height: (raw.blockheight as number) ?? undefined,
        block_hash: (raw.blockhash as string) ?? undefined,
        block_time: (raw.blocktime as number) ?? undefined,
      },
    };
  }

  private async fetchAddressTxsBlockstream(address: string): Promise<BlockstreamTx[]> {
    await this.rateLimiter.acquire();

    return withRetry(async () => {
      const res = await fetch(`${this.apiBase}/address/${address}/txs`);
      if (!res.ok) throw new Error(`Blockstream txs: ${res.status}`);
      return res.json() as Promise<BlockstreamTx[]>;
    }, this.retryOptions);
  }

  private async getConfirmations(tx: BlockstreamTx): Promise<number> {
    if (!tx.status.block_height) return 0;

    const tipHeight = await this.getTipHeight();
    return tipHeight - tx.status.block_height + 1;
  }

  private async getTipHeight(): Promise<number> {
    if (this.useCoreRpc && this.coreRpc) {
      const info = await this.coreRpc.call("getblockchaininfo");
      return (info as { blocks: number }).blocks;
    }

    await this.rateLimiter.acquire();
    const res = await fetch(`${this.apiBase}/blocks/tip/height`);
    if (!res.ok) throw new Error(`Failed to get tip height: ${res.status}`);
    return Number(await res.text());
  }
}

// ─── Factory ────────────────────────────────────────────────────────────

/**
 * Create a Bitcoin connector with default Blockstream API configuration.
 * Set `BTC_CORE_URL` + auth env vars for Bitcoin Core JSON-RPC mode.
 */
export function createBitcoinConnector(
  config?: Partial<ChainConfig>,
): BitcoinConnector {
  return new BitcoinConnector(config);
}
