/**
 * useWallet hook — Mobile-specific wallet state management.
 * Wraps AsyncStorage persistence with reactive updates.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { loadWallet, saveWallet } from '../services/wallet';
import { getPrimaryWallet, getTokenMetrics } from '../services/api';
import type { WalletRow } from '../services/api';

export function useWallet() {
  const { wallet, setWallet, tokenMetrics, setTokenMetrics, userId } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshWallet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load from backend if available
      if (userId) {
        const [dbWallet, metrics] = await Promise.all([
          getPrimaryWallet(userId).catch(() => null),
          getTokenMetrics().catch(() => null),
        ]);
        if (dbWallet) setWallet(dbWallet);
        if (metrics) setTokenMetrics(metrics);
      }

      // Fallback to local storage
      if (!wallet) {
        const localWallet = await loadWallet();
        if (localWallet) {
          setWallet({
            id: 'local',
            address: localWallet.address,
            balance: 0,
            staked_balance: 0,
            user_id: userId || '',
            label: localWallet.label,
            is_primary: 1,
            created_at: localWallet.createdAt,
            updated_at: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, [userId, wallet, setWallet, setTokenMetrics]);

  useEffect(() => {
    refreshWallet();
  }, []);

  return {
    wallet,
    loading,
    error,
    refreshWallet,
    balance: wallet?.balance || 0,
    address: wallet?.address || '',
    usdValue: (wallet?.balance || 0) * (tokenMetrics?.price || 0),
  };
}
