/**
 * useBalance hook — Real-time balance tracking with price conversion.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { getPrimaryWallet, getTokenMetrics } from '../services/api';

export function useBalance(refreshInterval = 30000) {
  const { wallet, setWallet, tokenMetrics, setTokenMetrics, userId } = useAppStore();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const [dbWallet, metrics] = await Promise.all([
        getPrimaryWallet(userId).catch(() => null),
        getTokenMetrics().catch(() => null),
      ]);
      if (dbWallet) setWallet(dbWallet);
      if (metrics) setTokenMetrics(metrics);
    } catch {
      // Silently fail on background refresh
    } finally {
      setLoading(false);
    }
  }, [userId, setWallet, setTokenMetrics]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return {
    balance: wallet?.balance || 0,
    stakedBalance: wallet?.staked_balance || 0,
    usdValue: (wallet?.balance || 0) * (tokenMetrics?.price || 0),
    price: tokenMetrics?.price || 0,
    priceChange24h: tokenMetrics?.price_change_24h || 0,
    loading,
    refresh,
  };
}
