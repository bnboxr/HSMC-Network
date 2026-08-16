/**
 * Node transaction helpers — honest chain interaction via /node-proxy.
 *
 * The browser cannot reach the Rust node (port 8080) directly; every node call
 * goes through the API server's /node-proxy route, which returns the envelope
 * { ok, node_online, data }. These helpers:
 *
 *   - submitTransaction()  — POST /tx/submit and return the REAL tx_hash
 *                            (or null + error). NEVER fabricates hashes.
 *   - confirmTransaction() — poll GET /tx/:hash until the tx is confirmed.
 *   - isNodeAvailable()    — re-exported from privacy-utils (single source).
 *
 * If the node is unreachable, submitTransaction returns
 * { txHash: null, status: 'submitted', error: 'HSMC node not connected' }
 * so callers can refuse to move balances instead of inventing confirmations.
 */
import { isNodeAvailable } from './privacy-utils';

// Re-export the canonical availability check so components import one helper.
export { isNodeAvailable } from './privacy-utils';

const NODE_API_BASE = '';

// ────────────────────────────────────────────────────────────────────────────
// Types (mirror rust-node/hsmc-rpc/src/types.rs SubmitTxRequest)
// ────────────────────────────────────────────────────────────────────────────
export interface SubmitTxPayload {
  from: string;
  to: string;
  amount: number;
  fee: number;
  privacy_level: string;
  ring_signature?: string;
  commitment?: string;
  range_proof?: string;
  stealth_address?: string;
  decoy_count?: number;
  memo?: string;
  nonce?: number;
}

export interface SubmitTxResult {
  /** Real node tx hash, or null when the submission did not reach the chain. */
  txHash: string | null;
  /**
   * 'pending'  → accepted by the node mempool with a real tx_hash.
   * 'submitted' → an attempt was made but nothing reached the chain
   *               (node down / node rejected). No hash was fabricated.
   */
  status: 'pending' | 'submitted';
  error?: string;
}

export interface TxConfirmation {
  location: 'mempool' | 'confirmed';
  block_number?: number;
  hash?: string;
}

export interface ConfirmOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Envelope plumbing
// ────────────────────────────────────────────────────────────────────────────
interface NodeProxyEnvelope {
  ok?: boolean;
  node_online?: boolean;
  error?: string;
  hint?: string;
  data?: unknown;
}

async function nodeProxyRequest<T>(
  path: string,
  method: 'GET' | 'POST',
  data?: unknown,
): Promise<{ envelope: NodeProxyEnvelope; inner: T | null }> {
  const res = await fetch(`${NODE_API_BASE}/node-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, method, data }),
  });
  if (!res.ok) {
    return { envelope: { ok: false, node_online: false, error: `API server HTTP ${res.status}` }, inner: null };
  }
  const envelope = (await res.json()) as NodeProxyEnvelope;
  if (envelope?.ok !== true || envelope?.node_online !== true) {
    return { envelope, inner: null };
  }
  return { envelope, inner: (envelope.data as T) ?? null };
}

// ────────────────────────────────────────────────────────────────────────────
// submitTransaction — POST /tx/submit, return the real tx hash
// ────────────────────────────────────────────────────────────────────────────
export async function submitTransaction(req: SubmitTxPayload): Promise<SubmitTxResult> {
  if (!(await isNodeAvailable())) {
    return {
      txHash: null,
      status: 'submitted',
      error: 'HSMC node not connected',
    };
  }

  let result: { envelope: NodeProxyEnvelope; inner: unknown };
  try {
    result = await nodeProxyRequest('/tx/submit', 'POST', req);
  } catch (err: unknown) {
    return {
      txHash: null,
      status: 'submitted',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const { envelope, inner } = result;
  if (inner === null || typeof inner !== 'object') {
    return {
      txHash: null,
      status: 'submitted',
      error: envelope?.error ?? envelope?.hint ?? 'HSMC node not connected',
    };
  }

  const data = inner as Record<string, unknown>;
  if (typeof data.error === 'string') {
    // Node rejected the tx (self-transfer, bad amount, low fee...) — real
    // feedback, still no fabricated hash.
    return { txHash: null, status: 'submitted', error: data.error };
  }
  if (typeof data.tx_hash !== 'string' || data.tx_hash.length === 0) {
    return {
      txHash: null,
      status: 'submitted',
      error: 'Node accepted the request but returned no transaction hash',
    };
  }
  return { txHash: data.tx_hash, status: 'pending' };
}

// ────────────────────────────────────────────────────────────────────────────
// confirmTransaction — poll GET /tx/:hash until confirmed
// ────────────────────────────────────────────────────────────────────────────
/**
 * Poll the node for a transaction's status.
 * Returns { location: 'confirmed', block_number } when confirmed,
 * { location: 'mempool' } when still pending at timeout,
 * or null when the node is unreachable / the hash is unknown.
 */
export async function confirmTransaction(
  hash: string,
  opts?: ConfirmOptions,
): Promise<TxConfirmation | null> {
  if (!hash || hash.length > 128 || !/^[A-Za-z0-9]+$/.test(hash)) {
    return null;
  }
  const pollIntervalMs = opts?.pollIntervalMs ?? 2_000;
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;

  let last: TxConfirmation | null = null;
  for (;;) {
    const status = await checkTransactionOnce(hash);
    if (status) {
      last = status;
      if (status.location === 'confirmed') return status;
    }
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/** Single GET /tx/:hash check — the primitive confirmTransaction polls. */
async function checkTransactionOnce(hash: string): Promise<TxConfirmation | null> {
  try {
    const { inner } = await nodeProxyRequest<Record<string, unknown>>(
      `/tx/${hash}`,
      'GET',
    );
    if (inner === null || typeof inner !== 'object') {
      return null;
    }
    const data = inner as Record<string, unknown>;
    if (typeof data.error === 'string') return null;
    const location = data.location;
    if (location !== 'mempool' && location !== 'confirmed') return null;
    const blockNumber =
      typeof data.block_number === 'number' ? data.block_number : undefined;
    return { location, block_number: blockNumber, hash };
  } catch {
    return null;
  }
}
