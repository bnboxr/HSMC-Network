import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/db/client';
import { useAuth } from './useAuth';
import { toast } from '@/hooks/use-toast';

interface StakingPool {
  id: string;
  name: string;
  validator_address: string;
  apr: number;
  min_stake: number;
  commission_rate: number;
  total_staked: number;
  status: string;
}

interface Stake {
  id: string;
  user_id: string;
  pool_id: string;
  amount: number;
  rewards_earned: number;
  rewards_claimed: number;
  staked_at: string;
  status: string;
  pool?: StakingPool;
}

export const useStaking = () => {
  const { user } = useAuth();
  const [pools, setPools] = useState<StakingPool[]>([]);
  const [stakes, setStakes] = useState<Stake[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch staking pools
  useEffect(() => {
    const fetchPools = async () => {
      const { data, error } = await supabase
        .from('staking_pools')
        .select('*')
        .eq('status', 'active');

      if (error) {
        console.error('Error fetching pools:', error);
      } else {
        setPools(data || []);
      }
    };

    fetchPools();
  }, []);

  // Fetch user stakes
  useEffect(() => {
    if (!user) {
      setStakes([]);
      setLoading(false);
      return;
    }

    const fetchStakes = async () => {
      const { data, error } = await supabase
        .from('stakes')
        .select(`
          *,
          pool:staking_pools(*)
        `)
        .eq('user_id', user.id);

      if (error) {
        console.error('Error fetching stakes:', error);
      } else {
        setStakes(data || []);
      }
      setLoading(false);
    };

    fetchStakes();

    // Subscribe to stake changes
    const channel = supabase
      .channel('stakes-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stakes',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchStakes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const stake = useCallback(
    async (poolId: string, amount: number) => {
      if (!user) {
        toast({
          title: 'Error',
          description: 'You must be logged in to stake',
          variant: 'destructive',
        });
        return { success: false };
      }

      // Get user primary wallet (or first wallet — handles multi-wallet users)
      const { data: wallet, error: walletError } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (walletError || !wallet) {
        toast({
          title: 'Error',
          description: 'Could not find your wallet',
          variant: 'destructive',
        });
        return { success: false };
      }

      if (wallet.balance < amount) {
        toast({
          title: 'Insufficient Balance',
          description: 'You do not have enough tokens to stake',
          variant: 'destructive',
        });
        return { success: false };
      }

      // Create stake
      const { error: stakeError } = await supabase.from('stakes').insert({
        user_id: user.id,
        pool_id: poolId,
        amount,
      });

      if (stakeError) {
        toast({
          title: 'Error',
          description: 'Failed to create stake',
          variant: 'destructive',
        });
        return { success: false };
      }

      // Update wallet balance
      const { error: updateError } = await supabase
        .from('wallets')
        .update({
          balance: wallet.balance - amount,
          staked_balance: wallet.staked_balance + amount,
        })
        .eq('id', wallet.id);

      if (updateError) {
        toast({
          title: 'Error',
          description: 'Failed to update wallet',
          variant: 'destructive',
        });
        return { success: false };
      }

      // Pool total_staked is updated automatically server-side via DB trigger

      toast({
        title: 'Success!',
        description: `Successfully staked ${amount} tokens`,
      });

      return { success: true };
    },
    [user, pools]
  );

  const unstake = useCallback(
    async (stakeId: string) => {
      if (!user) return { success: false };

      const stakeToUnstake = stakes.find((s) => s.id === stakeId);
      if (!stakeToUnstake) return { success: false };

      // Get user primary wallet
      const { data: wallet } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!wallet) return { success: false };

      // Mark stake as unstaked immediately — no artificial cooldown
      const { error: stakeError } = await supabase
        .from('stakes')
        .update({ status: 'unstaked', unstake_at: new Date().toISOString() })
        .eq('id', stakeId);

      if (stakeError) {
        toast({
          title: 'Error',
          description: 'Failed to unstake',
          variant: 'destructive',
        });
        return { success: false };
      }

      // Return tokens + earned rewards to wallet immediately
      const pendingRewards = stakeToUnstake.rewards_earned - stakeToUnstake.rewards_claimed;
      const totalReturn = stakeToUnstake.amount + pendingRewards;
      const { error: walletError } = await supabase
        .from('wallets')
        .update({
          balance: wallet.balance + totalReturn,
          staked_balance: Math.max(0, wallet.staked_balance - stakeToUnstake.amount),
        })
        .eq('id', wallet.id);

      if (walletError) {
        toast({ title: 'Error', description: 'Failed to return tokens', variant: 'destructive' });
        return { success: false };
      }

      toast({
        title: '✅ Unstaked Successfully',
        description: `${stakeToUnstake.amount.toFixed(4)} HSMC + ${pendingRewards.toFixed(4)} rewards returned to wallet`,
      });

      return { success: true };
    },
    [user, stakes]
  );

  const claimRewards = useCallback(
    async (stakeId: string) => {
      if (!user) return { success: false };

      const stakeToClaimFrom = stakes.find((s) => s.id === stakeId);
      if (!stakeToClaimFrom) return { success: false };

      const rewardsToClaim =
        stakeToClaimFrom.rewards_earned - stakeToClaimFrom.rewards_claimed;
      if (rewardsToClaim <= 0) {
        toast({
          title: 'No Rewards',
          description: 'No rewards available to claim',
        });
        return { success: false };
      }

      // Get user primary wallet
      const { data: wallet } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!wallet) return { success: false };

      // Update stake
      await supabase
        .from('stakes')
        .update({
          rewards_claimed: stakeToClaimFrom.rewards_earned,
          last_reward_at: new Date().toISOString(),
        })
        .eq('id', stakeId);

      // Update wallet
      await supabase
        .from('wallets')
        .update({ balance: wallet.balance + rewardsToClaim })
        .eq('id', wallet.id);

      toast({
        title: 'Rewards Claimed!',
        description: `Successfully claimed ${rewardsToClaim.toFixed(2)} tokens`,
      });

      return { success: true };
    },
    [user, stakes]
  );

  const totalStaked = stakes.reduce((sum, s) => sum + s.amount, 0);
  const totalRewards = stakes.reduce(
    (sum, s) => sum + (s.rewards_earned - s.rewards_claimed),
    0
  );

  return {
    pools,
    stakes,
    loading,
    stake,
    unstake,
    claimRewards,
    totalStaked,
    totalRewards,
  };
};
