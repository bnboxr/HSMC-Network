import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Coins,
  TrendingUp,
  Award,
  Clock,
  ChevronRight,
  Loader2,
  Gift,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useStaking } from '@/hooks/useStaking';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';

interface StakingDashboardProps {
  onOpenAuth: () => void;
}

const StakingDashboard = ({ onOpenAuth }: StakingDashboardProps) => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const {
    pools,
    stakes,
    loading,
    stake,
    unstake,
    claimRewards,
    totalStaked,
    totalRewards,
  } = useStaking();
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState('');
  const [isStaking, setIsStaking] = useState(false);

  const handleStake = async () => {
    if (!selectedPool || !stakeAmount) return;
    setIsStaking(true);
    await stake(selectedPool, parseFloat(stakeAmount));
    setIsStaking(false);
    setStakeAmount('');
    setSelectedPool(null);
  };

  const fmt = (num: number) =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);

  return (
    <section id="staking" className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <p className="section-eyebrow mb-4">Proof of Stake</p>
          <h2 className="text-3xl sm:text-4xl font-black mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
            Staking <span className="gradient-text">Dashboard</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Delegate your HSMC to validators and earn real staking rewards. Secure the HSMC network while growing your holdings.
          </p>
        </motion.div>

        {!user ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16 glass-panel"
          >
            <Wallet className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-xl font-semibold mb-2">Connect to Start Staking</h3>
            <p className="text-muted-foreground mb-6">
              Create an account or sign in to access the staking dashboard
            </p>
            <Button onClick={onOpenAuth} size="lg" variant="hero">
              Get Started
            </Button>
          </motion.div>
        ) : (
          <>
            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              {[
                {
                  icon: Wallet,
                  label: 'Available Balance',
                  value: `${fmt(wallet?.balance || 0)} HSMC`,
                  color: 'text-primary',
                  bg: 'hsl(var(--primary) / 0.1)',
                },
                {
                  icon: Coins,
                  label: 'Total Staked',
                  value: `${fmt(totalStaked)} HSMC`,
                  color: 'text-secondary',
                  bg: 'hsl(var(--secondary) / 0.1)',
                },
                {
                  icon: Gift,
                  label: 'Pending Rewards',
                  value: `${fmt(totalRewards)} HSMC`,
                  color: 'text-accent',
                  bg: 'hsl(var(--accent) / 0.1)',
                },
                {
                  icon: TrendingUp,
                  label: 'Active Stakes',
                  value: stakes.filter((s) => s.status === 'active').length,
                  color: 'text-foreground',
                  bg: 'hsl(var(--muted) / 0.4)',
                },
              ].map(({ icon: Icon, label, value, color, bg }, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="glass-card p-6"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg" style={{ background: bg }}>
                      <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                    <span className="text-sm text-muted-foreground">{label}</span>
                  </div>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                </motion.div>
              ))}
            </div>

            {/* Staking Pools */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass-panel mb-8"
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Award className="w-5 h-5 text-primary" />
                Validator Pools
              </h3>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : pools.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <p className="text-sm">No staking pools available yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pools.map((pool) => (
                    <div
                      key={pool.id}
                      className={`p-4 rounded-xl border transition-all cursor-pointer ${
                        selectedPool === pool.id
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border hover:border-primary/30 bg-muted/10'
                      }`}
                      onClick={() => setSelectedPool(selectedPool === pool.id ? null : pool.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-3 rounded-xl" style={{ background: 'hsl(var(--primary) / 0.1)' }}>
                            <Award className="w-6 h-6 text-primary" />
                          </div>
                          <div>
                            <h4 className="font-semibold">{pool.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              Min: {fmt(pool.min_stake)} HSMC
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-8">
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground">APR</p>
                            <p className="text-lg font-bold text-secondary">{pool.apr}%</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground">Commission</p>
                            <p className="text-lg font-semibold">{pool.commission_rate}%</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground">Total Staked</p>
                            <p className="text-lg font-semibold">
                              {pool.total_staked > 0 ? `${(pool.total_staked / 1_000_000).toFixed(2)}M` : '0'}
                            </p>
                          </div>
                          <ChevronRight
                            className={`w-5 h-5 text-muted-foreground transition-transform ${
                              selectedPool === pool.id ? 'rotate-90' : ''
                            }`}
                          />
                        </div>
                      </div>

                      {selectedPool === pool.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="mt-4 pt-4 border-t border-border"
                        >
                          <div className="flex items-end gap-4">
                            <div className="flex-1">
                              <label className="text-sm font-medium mb-2 block">Amount to Stake (HSMC)</label>
                              <Input
                                type="number"
                                placeholder={`Min ${pool.min_stake} HSMC`}
                                value={stakeAmount}
                                onChange={(e) => setStakeAmount(e.target.value)}
                                min={pool.min_stake}
                                max={wallet?.balance || 0}
                              />
                            </div>
                            <Button
                              onClick={handleStake}
                              disabled={
                                isStaking ||
                                !stakeAmount ||
                                parseFloat(stakeAmount) < pool.min_stake ||
                                parseFloat(stakeAmount) > (wallet?.balance || 0)
                              }
                              variant="hero"
                            >
                              {isStaking && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                              Stake HSMC
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2 font-mono">
                            Validator: {pool.validator_address.slice(0, 14)}...{pool.validator_address.slice(-6)}
                          </p>
                        </motion.div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Active Stakes */}
            {stakes.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="glass-panel"
              >
                <h3 className="text-lg font-semibold mb-4">Your Stakes</h3>
                <div className="space-y-4">
                  {stakes.map((stakeItem) => {
                    const pendingRewards = stakeItem.rewards_earned - stakeItem.rewards_claimed;
                    const pool = stakeItem.pool;
                    const maxReward = stakeItem.amount * (pool?.apr || 12) * 0.01;
                    const rewardPct = maxReward > 0
                      ? Math.min(100, (stakeItem.rewards_earned / maxReward) * 100)
                      : 0;

                    return (
                      <div key={stakeItem.id} className="p-4 rounded-xl border border-border bg-muted/10">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg" style={{ background: 'hsl(var(--primary) / 0.1)' }}>
                              <Coins className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <h4 className="font-semibold">{pool?.name || 'Unknown Pool'}</h4>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                <span>Staked {new Date(stakeItem.staked_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-sm text-muted-foreground">Staked</p>
                              <p className="font-semibold">{fmt(stakeItem.amount)} HSMC</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-muted-foreground">Pending</p>
                              <p className="font-semibold text-secondary">+{fmt(pendingRewards)} HSMC</p>
                            </div>
                          </div>
                        </div>

                        <div className="mb-3">
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                            <span>Reward Progress</span>
                            <span>{rewardPct.toFixed(1)}%</span>
                          </div>
                          <Progress value={rewardPct} className="h-2" />
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => claimRewards(stakeItem.id)}
                            disabled={pendingRewards <= 0}
                            className="gap-1"
                          >
                            <Gift className="w-4 h-4" />
                            Claim Rewards
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => unstake(stakeItem.id)}
                            disabled={stakeItem.status !== 'active'}
                          >
                            Unstake
                          </Button>
                          <span
                            className={`ml-auto px-2 py-1 text-xs font-medium rounded-full border ${
                              stakeItem.status === 'active'
                                ? 'border-secondary/30 text-secondary bg-secondary/10'
                                : 'border-muted text-muted-foreground'
                            }`}
                          >
                            {stakeItem.status.charAt(0).toUpperCase() + stakeItem.status.slice(1)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default StakingDashboard;
