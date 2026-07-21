import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Users, Clock, Layers, TrendingUp, TrendingDown,
  Download, Wifi, Loader2, DatabaseZap, Hash, BarChart2,
  Zap, ArrowRightLeft, Send, ShieldCheck, X, Pickaxe,
  CreditCard, ArrowDownCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBlockchain } from '@/hooks/useBlockchain';
import { formatNumber, formatLargeNumber } from '@/utils/blockchain-generator';
import PriceChart from '@/components/PriceChart';
import { useState } from 'react';
import { HSMCPay } from '@/components/HSMCPay';

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const StatCard = ({
  title, value, subtitle, icon: Icon, trend, trendValue, status,
}: {
  title: string; value: string | number; subtitle?: string; icon: any;
  trend?: 'up' | 'down' | 'neutral'; trendValue?: string; status?: string;
}) => {
  const statusClasses: Record<string, string> = {
    SYNCING: 'status-syncing',
    FINALIZING: 'status-finalizing',
    STABLE: 'status-stable',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="stat-card"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="p-2 rounded-lg" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
          <Icon className="w-4.5 h-4.5" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs ${trend === 'up' ? 'text-secondary' : trend === 'down' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trendValue}
          </div>
        )}
        {status && (
          <span className={`px-2 py-0.5 text-xs rounded-full border font-mono ${statusClasses[status] || ''}`}>
            {status}
          </span>
        )}
      </div>
      <div className="text-2xl sm:text-3xl font-black mb-1" style={{ fontFamily: 'var(--font-serif)' }}>{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">{title}</div>
      {subtitle && <div className="text-xs text-muted-foreground/60 mt-1">{subtitle}</div>}
    </motion.div>
  );
};

export const Dashboard = () => {
  const { networkStats, transactions, blocks } = useBlockchain();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [hsmcPayOpen, setHsmcPayOpen] = useState(false);
  const [hsmcPayMode, setHsmcPayMode] = useState<'buy' | 'sell'>('buy');

  const exportData = () => {
    const data = { networkStats, recentTransactions: transactions.slice(0, 10), recentBlocks: blocks.slice(0, 10), exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `hsmc-stats-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!networkStats) {
    return (
      <section id="dashboard" className="py-24 gradient-mesh">
        <div className="container mx-auto px-4 flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const hasRealActivity = networkStats.total_transactions > 0;
  const confirmedTx = transactions.filter(t => t.status === 'confirmed').length;
  const pendingTx = transactions.filter(t => t.status === 'pending').length;
  const successRate = confirmedTx + pendingTx > 0 ? (confirmedTx / (confirmedTx + pendingTx)) * 100 : null;

  const onboardingActions = [
    { icon: Send, label: 'Trimite HSMC', desc: 'Prima tranzacție reală', color: 'hsl(var(--primary))' },
    { icon: ArrowRightLeft, label: 'Swap tokens', desc: 'HSMC → EUR, USD, XAU', color: 'hsl(var(--secondary))' },
    { icon: Zap, label: 'Stake HSMC', desc: 'Câștigă recompense APR', color: 'hsl(var(--accent))' },
    { icon: ShieldCheck, label: 'Privacy TX', desc: 'Ring Signatures + Stealth', color: 'hsl(var(--primary))' },
  ];

  return (
    <section id="dashboard" className="py-24 gradient-mesh">
      <div className="container mx-auto px-4">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-10">
          <p className="section-eyebrow mb-4">Live Network</p>
          <h2 className="text-3xl sm:text-4xl font-black mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
            Chain <span className="gradient-text">Dashboard</span>
          </h2>
          <p className="text-muted-foreground text-sm max-w-xl mx-auto">
            Real-time HSMC network statistics — updated every block
          </p>
        </motion.div>

        {/* Controls */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wifi className="w-4 h-4 text-secondary animate-pulse" />
            <span className="font-mono text-xs">Realtime Feed Active</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="hero"
              size="sm"
              className="gap-2"
              onClick={() => { setHsmcPayMode('buy'); setHsmcPayOpen(true); }}
            >
              <CreditCard className="w-3.5 h-3.5" />
              Buy HSMC
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => { setHsmcPayMode('sell'); setHsmcPayOpen(true); }}
            >
              <ArrowDownCircle className="w-3.5 h-3.5" />
              Sell HSMC
            </Button>
            <Button variant="outline" size="sm" onClick={exportData} className="gap-2 text-xs">
              <Download className="w-3.5 h-3.5" />
              Export
            </Button>
          </div>
        </div>

        {/* HSMCPay modal */}
        <HSMCPay isOpen={hsmcPayOpen} onClose={() => setHsmcPayOpen(false)} mode={hsmcPayMode} />

        {/* ── STATE 1: No real activity ─────────────────────────────────── */}
        {!hasRealActivity && (
          <>
            {/* Onboarding banner */}
            <AnimatePresence>
              {!bannerDismissed && (
                <motion.div
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.3 }}
                  className="mb-8 relative overflow-hidden rounded-2xl border border-primary/30"
                  style={{ background: 'linear-gradient(135deg, hsl(var(--primary)/0.08), hsl(var(--secondary)/0.05))' }}
                >
                  <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ background: 'hsl(var(--primary))' }} />
                  <div className="absolute -bottom-8 right-0 w-32 h-32 rounded-full blur-2xl opacity-10 pointer-events-none" style={{ background: 'hsl(var(--secondary))' }} />
                  <div className="relative p-6 sm:p-8">
                    <button onClick={() => setBannerDismissed(true)} className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                    <div className="flex items-start gap-4 mb-6">
                      <div className="p-3 rounded-xl shrink-0" style={{ background: 'hsl(var(--primary)/0.15)', color: 'hsl(var(--primary))' }}>
                        <Activity className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="font-black text-lg mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
                          Rețeaua așteaptă prima activitate reală
                        </h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Blocurile sunt generate automat — chain-ul trăiește. Dar{' '}
                          <span className="text-foreground font-medium">tranzacțiile, prețul și volumul</span>{' '}
                          apar doar din acțiuni reale. Fă una din cele de mai jos.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {onboardingActions.map((a) => (
                        <div key={a.label} className="flex flex-col items-start gap-2 p-4 rounded-xl border border-border/40 bg-background/40 text-left">
                          <div className="p-2 rounded-lg" style={{ background: `color-mix(in srgb, ${a.color} 12%, transparent)`, color: a.color }}>
                            <a.icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-bold leading-tight">{a.label}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">{a.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Chain infrastructure — date 100% reale */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              <StatCard title="Block Height" value={formatNumber(networkStats.block_height)} icon={Hash} trend="up" trendValue="Live" />
              <StatCard title="Hash Rate" value={networkStats.hash_rate} icon={BarChart2} trend="up" trendValue="Active" />
              <StatCard title="Network Latency" value={`${networkStats.latency}ms`} subtitle="Avg. round-trip" icon={Clock} trend={networkStats.latency < 50 ? 'up' : 'down'} trendValue={networkStats.latency < 50 ? 'Optimal' : 'High'} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              <StatCard title="Consensus State" value={networkStats.consensus_state} icon={Layers} status={networkStats.consensus_state} />
              <StatCard title="Active Nodes" value={formatNumber(networkStats.active_nodes)} icon={Users} trend="up" trendValue="Connected" />
            </div>

            {/* Mining activity — real */}
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Pickaxe className="w-4 h-4 text-primary" />
                  <h3 className="font-bold text-sm uppercase tracking-wider font-mono">Mining Activity</h3>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                  Live
                </span>
              </div>
              {blocks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground/50 text-sm font-mono">
                  Așteptând primul bloc...
                </div>
              ) : (
                <div className="space-y-2">
                  {blocks.slice(0, 8).map((block, i) => (
                    <div key={block.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-secondary shrink-0" />
                        <div>
                          <span className="font-mono text-xs text-primary">Block #{formatNumber(block.block_number)}</span>
                          <span className="text-muted-foreground font-mono text-xs"> — {block.hash.slice(0, 18)}...</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <div className="text-[11px] text-muted-foreground font-mono">{timeAgo(block.created_at)}</div>
                        <div className="text-[10px] text-muted-foreground/50 font-mono">{block.transactions_count} tx</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </>
        )}

        {/* ── STATE 2: Real activity exists ────────────────────────────── */}
        {hasRealActivity && (
          <>
            {/* Primary Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <StatCard title="Transactions / Second" value={formatNumber(networkStats.tps)} icon={Activity} trend="up" trendValue="Live" />
              <StatCard title="Active Nodes" value={formatNumber(networkStats.active_nodes)} icon={Users} trend="up" trendValue="Connected" />
              <StatCard title="Consensus State" value={networkStats.consensus_state} icon={Layers} status={networkStats.consensus_state} />
              <StatCard title="Network Latency" value={`${networkStats.latency}ms`} subtitle="Avg. round-trip" icon={Clock} trend={networkStats.latency < 30 ? 'up' : 'down'} trendValue={networkStats.latency < 30 ? 'Optimal' : 'High'} />
            </div>

            {/* Secondary Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total Transactions', value: formatLargeNumber(networkStats.total_transactions), icon: Activity, color: 'neon-text' },
                { label: 'Block Height', value: formatNumber(networkStats.block_height), icon: Hash, color: 'neon-text-green' },
                { label: 'Hash Rate', value: networkStats.hash_rate, icon: BarChart2, color: 'text-accent' },
                { label: 'Difficulty', value: formatLargeNumber(networkStats.network_difficulty), icon: DatabaseZap, color: 'text-muted-foreground' },
              ].map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="glass-card p-4 text-center"
                >
                  <div className={`text-xl font-black mb-0.5 ${item.color}`} style={{ fontFamily: 'var(--font-serif)' }}>{item.value}</div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{item.label}</div>
                </motion.div>
              ))}
            </div>

            {/* Price Chart */}
            <div className="mb-5">
              <PriceChart />
            </div>

            {/* Recent Activity + Network Health */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Recent Transactions */}
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold text-sm uppercase tracking-wider font-mono">Recent Transactions</h3>
                  <span className="flex items-center gap-1.5 text-xs text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                    Live
                  </span>
                </div>
                <div className="space-y-2.5">
                  {transactions.slice(0, 6).map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors">
                      <div>
                        <div className="font-mono text-xs text-primary">{tx.hash.slice(0, 18)}...</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(tx.created_at)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold">{tx.amount.toFixed(4)} <span className="text-muted-foreground text-xs">HSMC</span></div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tx.status === 'confirmed' ? 'status-confirmed' : 'status-pending'}`}>
                          {tx.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Network Health — only real metrics */}
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="glass-panel">
                <h3 className="font-bold text-sm uppercase tracking-wider font-mono mb-5">Network Health</h3>
                <div className="space-y-4">
                  {/* Tx Success Rate — real */}
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground font-mono">Tx Success Rate</span>
                      <span className="font-mono font-bold">{successRate !== null ? `${successRate.toFixed(1)}%` : <span className="text-muted-foreground/50">No data</span>}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      {successRate !== null && (
                        <motion.div initial={{ width: 0 }} whileInView={{ width: `${successRate}%` }} viewport={{ once: true }} transition={{ duration: 1.2 }} className="h-full rounded-full" style={{ background: 'hsl(var(--secondary))' }} />
                      )}
                    </div>
                  </div>

                  {/* Block interval — real: avg seconds between last 5 blocks */}
                  {blocks.length >= 2 && (() => {
                    const recent = blocks.slice(0, 5);
                    const diffs = recent.slice(0, -1).map((b, i) =>
                      (new Date(b.created_at).getTime() - new Date(recent[i + 1].created_at).getTime()) / 1000
                    );
                    const avgInterval = diffs.reduce((a, b) => a + b, 0) / diffs.length;
                    const targetInterval = 15; // seconds
                    const health = Math.min(100, Math.round((targetInterval / Math.max(avgInterval, 1)) * 100));
                    return (
                      <div>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-muted-foreground font-mono">Block Interval</span>
                          <span className="font-mono font-bold">{avgInterval.toFixed(1)}s avg</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div initial={{ width: 0 }} whileInView={{ width: `${health}%` }} viewport={{ once: true }} transition={{ duration: 1 }} className="h-full rounded-full" style={{ background: 'hsl(var(--secondary))' }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Mining status */}
                <div className="mt-6 p-3 rounded-lg bg-muted/20 border border-border/40">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-muted-foreground uppercase tracking-wider">Mining Activity</span>
                    <span className="font-mono text-muted-foreground/60">
                      {blocks.length > 0 ? `Last block: ${timeAgo(blocks[0]?.created_at || '')}` : 'No blocks yet'}
                    </span>
                  </div>
                  {blocks.length > 0 && (
                    <div className="mt-2 text-xs font-mono">
                      <span className="text-secondary">● </span>
                      <span className="text-muted-foreground">Block #{formatNumber(blocks[0]?.block_number)} — </span>
                      <span className="text-primary">{blocks[0]?.miner_address?.slice(0, 20)}...</span>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default Dashboard;
