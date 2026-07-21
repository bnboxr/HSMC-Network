/**
 * HSMC Bridge — Common types for multi-chain connectors.
 *
 * Every chain connector implements the ChainConnector interface so the
 * bridge index (`getConnector`) can return a uniform API regardless of
 * whether the underlying chain is UTXO-based (Bitcoin) or account-based
 * (Ethereum, BSC, Polygon).
 *
 * All amounts in the bridge layer use `bigint` for precision.
 * - BTC connector: satoshis  (1 BTC = 100_000_000 sats)
 * - ETH/BSC connector: wei   (1 ETH = 10^18 wei)
 * - wHSMC: raw base units    (8 decimals, so 1 wHSMC = 10^8)
 *
 * Timestamps are Unix seconds.
 */

// ─── Chain identifiers ─────────────────────────────────────────────────

export type ChainId = "btc" | "eth" | "bsc";

// ─── Core event types ──────────────────────────────────────────────────

/** A deposit observed on the source chain (needs to be relayed → mint wHSMC). */
export interface DepositEvent {
  /** Unique identifier of the deposit transaction on its chain. */
  txHash: string;

  /** Source address that sent the deposit (if known/applicable). */
  from: string;

  /** Destination address (HSMC mainnet or EVM recipient). */
  to: string;

  /** Amount in the chain's native smallest unit (sats, wei). */
  amount: bigint;

  /** Number of on-chain confirmations at observation time. */
  confirmations: number;

  /** Unix timestamp of the block containing the transaction. */
  blockTime: number;

  /** Block height. */
  blockHeight: number;

  /** Chain this event originated on. */
  chain: ChainId;

  /** Arbitrary extra data (e.g. OP_RETURN, Taproot annex). */
  extra?: Record<string, unknown>;
}

/** A withdrawal request (burn wHSMC → release native asset on destination chain). */
export interface WithdrawalRequest {
  id: string;
  chain: ChainId;
  /** Destination address on the native chain. */
  to: string;
  /** Amount in the chain's smallest unit. */
  amount: bigint;
  /** hsmcTxHash from the wHSMC BridgeBurn event. */
  hsmcTxHash: string;
  status: "pending" | "broadcast" | "confirmed" | "failed";
  /** Transaction hash on the destination chain (set after broadcast). */
  settlementTxHash?: string;
  createdAt: number;
}

// ─── Chain connector interface ─────────────────────────────────────────

export interface ChainConnector {
  /** Short chain identifier ("btc" | "eth" | "bsc"). */
  readonly chain: ChainId;

  /**
   * Watch for incoming deposits on this chain.
   *
   * Returns an `AsyncIterable` so callers can `for await (const ev of connector.watchForDeposit(...))`.
   * The connector polls the chain (or subscribes to events) and yields each
   * new `DepositEvent` as it is confirmed.
   *
   * @param address        Address to watch on this chain.
   * @param minConfirmations Minimum confirmations before yielding (default: chain-specific).
   */
  watchForDeposit(
    address: string,
    minConfirmations?: number
  ): AsyncIterable<DepositEvent>;

  /**
   * Get the balance of an address on this chain.
   *
   * @param address  Address to query.
   * @returns Balance in the chain's smallest unit (sats / wei).
   */
  getBalance(address: string): Promise<bigint>;

  /**
   * Broadcast a raw signed transaction hex to the chain.
   *
   * @param signedTx  Hex-encoded signed transaction.
   * @returns Transaction hash (txid) on success.
   */
  broadcastTransaction(signedTx: string): Promise<string>;

  /**
   * Validate whether a string is a well-formed address for this chain.
   *
   * @param address  Candidate address string.
   * @returns `true` if the address is syntactically valid for this chain.
   */
  isValidAddress(address: string): boolean;
}

// ─── Chain configuration ───────────────────────────────────────────────

/** RPC / API configuration for a chain connector. */
export interface ChainConfig {
  /** Chain identifier. */
  chain: ChainId;

  /**
   * RPC endpoint(s).
   * - Bitcoin: Blockstream API base URL or Bitcoin Core JSON-RPC URL.
   * - EVM chains: JSON-RPC URL (HTTP/HTTPS).
   */
  rpcUrl: string;

  /**
   * Optional fallback RPCs, tried in order when the primary fails.
   */
  fallbackRpcUrls?: string[];

  /** Minimum confirmations for finality (BTC: 6, ETH: 12-64 depending on context). */
  minConfirmations: number;

  /** Polling interval in ms for watchForDeposit loops. */
  pollIntervalMs: number;

  /** Maximum retries for RPC calls before failing. */
  maxRetries: number;

  /** Base delay between retries in ms (exponential backoff). */
  retryBaseDelayMs: number;

  // ─── EVM-specific ──────────────────────────────────────────────────

  /** BridgeMinter contract address (EVM chains only). */
  bridgeMinterAddress?: string;

  /** wHSMC token address (EVM chains only). */
  whsmcAddress?: string;

  /** Chain ID (EIP-155). */
  chainId?: number;
}

// ─── EVM event types ───────────────────────────────────────────────────

/** Parsed BridgeMinter log event (EVM chains). */
export interface MintProposedEvent {
  proposalId: bigint;
  hsmcTxHash: string;
  to: string;
  amount: bigint;
  expiresAt: number;
  signers: string[];
  txHash: string;
  blockNumber: number;
}

export interface MintFinalizedEvent {
  proposalId: bigint;
  hsmcTxHash: string;
  txHash: string;
  blockNumber: number;
}

export interface MintedEvent {
  hsmcTxHash: string;
  to: string;
  amount: bigint;
  txHash: string;
  blockNumber: number;
}

export interface MintChallengedEvent {
  proposalId: bigint;
  hsmcTxHash: string;
  challenger: string;
  proof: string;
  txHash: string;
  blockNumber: number;
}

/** Union of all bridge-related events an EVM connector can emit. */
export type BridgeEvent =
  | { type: "MintProposed"; data: MintProposedEvent }
  | { type: "MintFinalized"; data: MintFinalizedEvent }
  | { type: "Minted"; data: MintedEvent }
  | { type: "MintChallenged"; data: MintChallengedEvent };

// ─── Retry / rate limit helpers ────────────────────────────────────────

export interface RateLimiter {
  /** Wait until a request slot is available. */
  acquire(): Promise<void>;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /** Called on each retry with (attempt, error). */
  onRetry?: (attempt: number, error: Error) => void;
}
