/**
 * wallet-seed-db.ts
 * Persists encrypted BIP39 seeds to the wallet_seeds DB table
 * so they survive localStorage clears and device changes.
 *
 * The seed is ALWAYS stored client-side encrypted (AES-256-GCM) before upload.
 * The DB never sees the plaintext seed — only the password-encrypted blob.
 */
import { supabase } from "@/integrations/db/client";
import { withRetry } from "@/utils/db-retry";

/** Shape of a wallet_seeds row returned by the DB */
interface WalletSeedRow {
  user_id: string;
  encrypted_seed: string;
  wallet_address: string;
  id?: string;
  created_at?: string;
  updated_at?: string;
}

const LS_KEY_SEED = (uid: string) => `hsmc_encrypted_seed_${uid}`;
const LS_KEY_ADDR = (uid: string) => `hsmc_wallet_address_${uid}`;

/**
 * Save an encrypted seed to both localStorage AND the DB table.
 * Called after every wallet creation / import.
 */
export async function persistSeedToDb(
  userId: string,
  encryptedSeed: string,
  walletAddress: string,
): Promise<void> {
  // Always keep localStorage copy as cache
  localStorage.setItem(LS_KEY_SEED(userId), encryptedSeed);
  localStorage.setItem(LS_KEY_ADDR(userId), walletAddress);
  const { error } = await withRetry(() => supabase
    .from("wallet_seeds")
    .upsert(
      { user_id: userId, encrypted_seed: encryptedSeed, wallet_address: walletAddress },
      { onConflict: "user_id" },
    ) as unknown as { data: WalletSeedRow | null; error: { message: string } | null });

  if (error) {
    console.error('[SeedDB] Failed to persist seed to DB:', error instanceof Error ? error.message : String(error));
    throw error;
  } else {
    console.debug('[SeedDB] Seed persisted to DB successfully');
  }
}

/**
 * Restore encrypted seed from DB to localStorage if missing.
 * Call this on every login / app start.
 * Returns true if seed was restored, false if already present or not found.
 */
export async function restoreSeedFromDb(userId: string): Promise<boolean> {
  // Already in localStorage — no action needed
  if (localStorage.getItem(LS_KEY_SEED(userId))) return false;
  const { data, error } = await withRetry(() => supabase
    .from("wallet_seeds")
    .select("encrypted_seed, wallet_address")
    .eq("user_id", userId)
    .maybeSingle()) as { data: WalletSeedRow | null; error: { message: string } | null };

  if (error || !data) {
    console.debug('[SeedDB] No DB backup found for user', userId);
    return false;
  }

  localStorage.setItem(LS_KEY_SEED(userId), data.encrypted_seed);
  localStorage.setItem(LS_KEY_ADDR(userId), data.wallet_address);
  console.debug('[SeedDB] Seed restored from DB to localStorage');
  return true;
}

/**
 * Get the encrypted seed — first from localStorage, then from DB.
 */
export async function getEncryptedSeed(userId: string): Promise<string | null> {
  const local = localStorage.getItem(LS_KEY_SEED(userId));
  if (local) return local;
  const { data } = await withRetry(() => supabase
    .from("wallet_seeds")
    .select("encrypted_seed")
    .eq("user_id", userId)
    .maybeSingle()) as { data: WalletSeedRow | null; error: { message: string } | null };

  return data?.encrypted_seed ?? null;
}

/**
 * Delete the seed from both localStorage and DB.
 * Call only on explicit "Remove Wallet" action.
 */
export async function deleteSeed(userId: string): Promise<void> {
  localStorage.removeItem(LS_KEY_SEED(userId));
  localStorage.removeItem(LS_KEY_ADDR(userId));
  await withRetry(() => supabase
    .from("wallet_seeds")
    .delete()
    .eq("user_id", userId));
}
