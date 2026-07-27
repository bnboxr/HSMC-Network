/**
 * useStaking hook — Mobile staking operations.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { getStakingPools, getUserStakes, stakeTokens, unstakeTokens } from '../services/api';
import type { StakingPoolRow, StakeRow } from '../services/api';

export function useStaking() {
  const { userId, wallet } = useAppStore();
  const [pools, setPools] = useState<StakingPoolRow[]>([]);
  const [stakes, setStakes] = useState<StakeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      const [poolData, stakeData] = await Promise.all([
        getStakingPools().catch(() => [] as StakingPoolRow[]),
        getUserStakes(userId).catch(() => [] as StakeRow[]),
      ]);
      setPools(poolData);
      setStakes(stakeData);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const stake = useCallback(async (poolId: string, amount: number): Promise<boolean> => {
    if (!wallet || !userId) return false;
    try {
      await stakeTokens(userId, poolId, amount, wallet.id);
      await fetchData();
      return true;
    } catch {
      return false;
    }
  }, [userId, wallet, fetchData]);

  const unstake = useCallback(async (stakeId: string): Promise<boolean> => {
    if (!wallet || !userId) return false;
    const s = stakes.find(st => st.id === stakeId);
    if (!s) return false;
    try {
      await unstakeTokens(stakeId, s.amount, s.rewards_earned, s.rewards_claimed, wallet.id);
      await fetchData();
      return true;
    } catch {
      return false;
    }
  }, [userId, wallet, stakes, fetchData]);

  const totalStaked = stakes.filter(s => s.status === 'active').reduce((sum, s) => sum + s.amount, 0);
  const totalRewards = stakes.filter(s => s.status === 'active')
    .reduce((sum, s) => sum + (s.rewards_earned - s.rewards_claimed), 0);

  return { pools, stakes, loading, stake, unstake, fetchData, totalStaked, totalRewards };
}
