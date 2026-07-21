/**
 * Retry helper for transient DB errors.
 * PGRST002 = "Could not query the database for the schema cache. Retrying."
 * This happens for ~5–15s after a migration or when the cache reloads.
 *
 * Usage:
 *   const { data, error } = await withRetry(() =>
 *     db.from('wallets').select('*').eq('user_id', uid).maybeSingle()
 *   );
 */
const TRANSIENT_CODES = new Set(['PGRST002', 'PGRST001', '503', '504', '57P03', '08006', '08001']);

export function isTransientDbError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; message?: string; status?: number };
  if (e.code && TRANSIENT_CODES.has(String(e.code))) return true;
  if (e.status && (e.status === 503 || e.status === 504)) return true;
  const msg = String(e.message || '').toLowerCase();
  return msg.includes('schema cache') || msg.includes('retrying') || msg.includes('connection');
}

export async function withRetry<T>(
  fn: () => PromiseLike<{ data: T; error: unknown } | { data: null; error: unknown }>,
  opts: { attempts?: number; baseMs?: number } = {}
): Promise<{ data: T | null; error: unknown }> {
  const attempts = opts.attempts ?? 8;
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await Promise.resolve(fn());
      if (!result.error) return result as { data: T | null; error: null };
      lastErr = result.error;
      if (!isTransientDbError(result.error)) return result as { data: T | null; error: unknown };
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err)) throw err;
    }
    if (i < attempts - 1) {
      const delay = baseMs * Math.pow(1.7, i);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { data: null, error: lastErr };
}
