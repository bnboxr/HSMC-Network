/**
 * Cloud Wallet Backup — encrypts seed phrase and stores to private local storage bucket
 * Called on every login if a BIP39 seed exists locally.
 */
import { supabase } from '@/integrations/db/client';
import { encryptMnemonic } from '@/utils/bip39-wallet';

const BACKUP_VERSION = '2';

/**
 * Derive a stable backup passphrase from the user's ID using SHA-256.
 * This is deterministic — same userId always produces same passphrase.
 * No localStorage dependency: survives browser data clears.
 */
async function deriveBackupPassphrase(userId: string): Promise<string> {
  const salt = 'ASTRA-HSMC-BACKUP-v2';
  const input = new TextEncoder().encode(`${salt}:${userId}`);
  const buf = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function backupWalletToCloud(userId: string, walletAddress: string): Promise<void> {
  const encryptedSeed = localStorage.getItem(`hsmc_encrypted_seed_${userId}`);
  if (!encryptedSeed) return; // Nothing to back up

  try {
    const passphrase = await deriveBackupPassphrase(userId);

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
      format: 'HSMC-CloudBackup-v2',
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

export async function restoreWalletFromCloud(userId: string): Promise<boolean> {
  try {
    const filePath = `${userId}/wallet-backup.hsmc`;
    const { data, error } = await supabase.storage
      .from('wallet-backups')
      .download(filePath);

    if (error || !data) return false;

    const text = await data.text();
    const backup = JSON.parse(text);

    if (backup.format !== 'HSMC-CloudBackup-v2') return false;

    const passphrase = await deriveBackupPassphrase(userId);

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
