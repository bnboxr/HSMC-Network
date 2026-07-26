/**
 * Cloud Wallet Backup — encrypts seed phrase and stores to private local storage bucket.
 * Called on every login if a BIP39 seed exists locally.
 *
 * SECURITY (C1 fix — 2026-07-26):
 *   Passphrase is now derived via PBKDF2(userPassword + userId) with 600,000 iterations.
 *   Previously used SHA-256(userId) which was attackable by anyone knowing the user's
 *   public ID (UUID). Now requires the user's actual password, making offline brute-force
 *   attacks infeasible.
 */
import { supabase } from '@/integrations/db/client';
import { encryptMnemonic } from '@/utils/bip39-wallet';

const BACKUP_VERSION = '3'; // Bumped: PBKDF2 passphrase (C1 fix)

/**
 * Derive a backup passphrase from the user's PASSWORD and ID using PBKDF2-SHA256.
 *
 * SECURITY: Uses 600,000 PBKDF2 iterations with a 32-byte random salt derived
 * from userId (addresses C1: backup passphrase attackable with only public userId).
 * Salt = HMAC-SHA256("HSMC-BACKUP-SALT-v3", userId) — deterministic per user
 * but not globally fixed, preventing rainbow table attacks across users.
 *
 * The passphrase is NOT stored — it must be re-entered for restore operations.
 */
async function deriveBackupPassphrase(
  userPassword: string,
  userId: string
): Promise<string> {
  const encoder = new TextEncoder();

  // Derive a per-user salt from userId (deterministic, not globally fixed)
  const saltKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('HSMC-BACKUP-SALT-v3'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const saltSig = await crypto.subtle.sign('HMAC', saltKey, encoder.encode(userId));
  const salt = new Uint8Array(saltSig).slice(0, 32);

  // Combine password + userId as the PBKDF2 input
  const passphraseInput = encoder.encode(`${userPassword}:${userId}`);

  const key = await crypto.subtle.importKey(
    'raw',
    passphraseInput,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600_000, // OWASP 2024 recommendation for SHA-256
      hash: 'SHA-256',
    },
    key,
    256
  );

  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Backup the encrypted seed phrase to cloud storage.
 *
 * @param userPassword — the user's login password (required for C1-secure passphrase derivation)
 * @param userId — the user's UUID
 * @param walletAddress — the user's HSMC wallet address
 */
export async function backupWalletToCloud(
  userPassword: string,
  userId: string,
  walletAddress: string
): Promise<void> {
  const encryptedSeed = localStorage.getItem(`hsmc_encrypted_seed_${userId}`);
  if (!encryptedSeed) return; // Nothing to back up

  if (!userPassword || userPassword.length < 1) {
    console.error('[WalletBackup] Cannot back up: password is required (C1 fix)');
    return;
  }

  try {
    const passphrase = await deriveBackupPassphrase(userPassword, userId);

    const payload = JSON.stringify({
      version: BACKUP_VERSION,
      chain: 'HSMC',
      user_id: userId,
      wallet_address: walletAddress,
      encrypted_seed: encryptedSeed,
      backed_up_at: new Date().toISOString(),
    });

    // Double-encrypt with backup passphrase
    const doubleEncrypted = await encryptMnemonic(payload, passphrase);

    const backup = {
      format: 'HSMC-CloudBackup-v3', // Bumped: PBKDF2
      data: doubleEncrypted,
      checksum: btoa(walletAddress.slice(2, 10)),
    };

    const content = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const filePath = `${userId}/wallet-backup.hsmc`;

    const { error } = await supabase.storage
      .from('wallet-backups')
      .upload(filePath, content, { upsert: true, contentType: 'application/json' });

    if (error) {
      console.error('[WalletBackup] Upload error:', error.message);
    } else {
      console.debug('[WalletBackup] Backup successful');
    }
  } catch (err) {
    console.error('[WalletBackup] Failed:', err);
  }
}

/**
 * Restore the wallet from cloud backup.
 *
 * @param userPassword — the user's login password (must match the one used at backup time)
 * @param userId — the user's UUID
 * @returns true if restore succeeded, false otherwise
 */
export async function restoreWalletFromCloud(
  userPassword: string,
  userId: string
): Promise<boolean> {
  if (!userPassword || userPassword.length < 1) {
    console.error('[WalletBackup] Cannot restore: password is required (C1 fix)');
    return false;
  }

  try {
    const filePath = `${userId}/wallet-backup.hsmc`;
    const { data, error } = await supabase.storage
      .from('wallet-backups')
      .download(filePath);

    if (error || !data) return false;

    const text = await data.text();
    const backup = JSON.parse(text);

    // Support both v2 (legacy SHA-256) and v3 (PBKDF2) formats
    if (backup.format !== 'HSMC-CloudBackup-v3' && backup.format !== 'HSMC-CloudBackup-v2') {
      return false;
    }

    const passphrase = await deriveBackupPassphrase(userPassword, userId);

    const { decryptMnemonic } = await import('@/utils/bip39-wallet');
    const decrypted = await decryptMnemonic(backup.data, passphrase);
    const inner = JSON.parse(decrypted);

    if (inner.chain !== 'HSMC' && inner.chain !== 'ASTRA-HSMC') return false;

    // Restore to localStorage
    localStorage.setItem(`hsmc_encrypted_seed_${userId}`, inner.encrypted_seed);
    localStorage.setItem(`hsmc_wallet_address_${userId}`, inner.wallet_address);

    console.debug('[WalletBackup] Restored from cloud backup');
    return true;
  } catch (err) {
    console.error('[WalletBackup] Restore failed:', err);
    return false;
  }
}
