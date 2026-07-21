import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { backupWalletToCloud } from '@/utils/wallet-backup';

/**
 * Runs an automatic cloud backup of the encrypted seed phrase on every login.
 * Silently fires in the background — no UI.
 */
export const useAutoBackup = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();

  useEffect(() => {
    if (!user || !wallet) return;

    // Only backup if there is an encrypted seed in localStorage
    const hasSeed = !!localStorage.getItem(`hsmc_encrypted_seed_${user.id}`);
    if (!hasSeed) return;

    backupWalletToCloud(user.id, wallet.address);
  }, [user, wallet]);
};
