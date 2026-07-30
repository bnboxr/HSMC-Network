/**
 * Seed-only wallet authentication helpers.
 * The seed phrase NEVER leaves the browser. We derive:
 *  - wallet address (sent to server)
 *  - auth_password = PBKDF2(seed, salt='hsmc-auth-v1', 200k iter) → hex (sent to server)
 * The server creates a synthetic <addr>@hsmc.wallet account on first sign-in,
 * then the client logs in normally with local auth.
 */
import { supabase } from '@/integrations/db/client';
import { deriveAddress, mnemonicToSeed, validateMnemonic, encryptMnemonic } from '@/utils/bip39-wallet';
import { persistSeedToDb } from '@/utils/wallet-seed-db';

const AUTH_SALT = new TextEncoder().encode('hsmc-auth-v1');

async function deriveAuthPassword(mnemonic: string): Promise<string> {
  const seed = await mnemonicToSeed(mnemonic);
  const seedBuf = new Uint8Array(seed).buffer;
  const baseKey = await crypto.subtle.importKey('raw', seedBuf, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: AUTH_SALT, iterations: 200000, hash: 'SHA-256' },
    baseKey,
    256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface SeedAuthResult {
  ok: boolean;
  error?: string;
  address?: string;
}

async function validateSeedPhrase(mnemonic: string): Promise<boolean> {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length === 25) return validateMnemonic(mnemonic);
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;
  try {
    const bip39mod = await import('bip39');
    // bip39 exports validateMnemonic directly; fallback to .default for ESM interop
    const validate: (mnemonic: string) => boolean =
      bip39mod.validateMnemonic ?? (bip39mod as { default?: { validateMnemonic: (m: string) => boolean } }).default?.validateMnemonic;
    return typeof validate === 'function' ? validate(mnemonic.trim()) : false;
  } catch {
    return false;
  }
}

/**
 * Create or sign in to a seed-only wallet account.
 * OFFLINE-FIRST: saves seed to localStorage immediately.
 * Local auth is attempted in background for cloud sync — failures are non-blocking.
 * @param mnemonic 12/24/25-word BIP39 phrase
 * @param storagePassword optional password to AES-encrypt the seed for cloud backup (recommended)
 */
export async function authenticateWithSeed(
  mnemonic: string,
  storagePassword?: string
): Promise<SeedAuthResult> {
  const normalizedMnemonic = mnemonic.trim().replace(/\s+/g, ' ');
  if (!(await validateSeedPhrase(normalizedMnemonic))) {
    return { ok: false, error: 'Invalid seed phrase. Check word count (12, 15, 18, 21, 24 or 25) and spelling.' };
  }
  const address = await deriveAddress(normalizedMnemonic);
  const auth_password = await deriveAuthPassword(normalizedMnemonic);

  // ── Save encrypted seed to localStorage FIRST (offline) ──────────────
  try {
    const pw = storagePassword || auth_password;
    const enc = await encryptMnemonic(normalizedMnemonic, pw);
    localStorage.setItem('hsmc_encrypted_seed', enc);
  } catch (e) {
    console.warn('Seed encryption failed:', e);
    return { ok: false, error: 'Failed to encrypt seed locally. Try again.' };
  }

  // ── Try local auth in background (non-blocking) ──────────────────
  const email = `${address}@hsmc.wallet`;
  supabase.functions.invoke('wallet-signin', { body: { address, auth_password } })
    .then(async ({ error: fnErr }) => {
      if (fnErr) { console.warn('[seed-auth] wallet-signin skipped:', fnErr.message); return; }
      const { error: signInErr } = await localAuth({ email, password: auth_password });
      if (signInErr) { console.warn('[seed-auth] local sign-in skipped:', signInErr.message); return; }
      const { data: u } = await supabase.auth.getUser();
      if (u?.user) {
        const enc = localStorage.getItem('hsmc_encrypted_seed');
        if (enc) await persistSeedToDb(u.user.id, enc, address);
      }
    })
    .catch(e => console.warn('[seed-auth] local auth unavailable (offline mode):', e));

  return { ok: true, address };
}
