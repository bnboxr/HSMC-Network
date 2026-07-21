import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, TrendingUp, Loader2, Zap, Clock, ArrowUpDown, Info } from 'lucide-react';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { Button } from '@/components/ui/button';
import { formatAddress } from '@/utils/blockchain-generator';
import { toast } from '@/hooks/use-toast';

interface MempoolTx {
  id: string;
  hash: string;
  from_address: string;
  to_address: string;
  amount: number;
  fee: number;
  created_at: string;
  privacy_level: string | null;
}

function formatFee(fee: number): string {
  if (fee < 0.001) return `${(fee * 1000).toFixed(4)} mHSMC`;
  return `${fee.toFixed(6)} HSMC`;
}

function formatAge(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

export const Mempool = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const [pendingTxs, setPendingTxs] = useState<MempoolTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'fee' | 'age'>('fee');
  const [accelerating, setAccelerating] = useState<string | null>(null);

  useEffect(() => {
    const fetchPending = async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, hash, from_address, to_address, amount, fee, created_at, privacy_level')
        .eq('status', 'pending')
        .order('fee', { ascending: false })
        .limit(30);

      if (data) setPendingTxs(data as MempoolTx[]);
      setLoading(false);
    };

    fetchPending();

    // Realtime: new pending tx inserted
    const channel = supabase
      .channel('mempool-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, (payload) => {
        if (payload.new?.status === 'pending') {
          setPendingTxs(prev => {
            const updated = [payload.new as MempoolTx, ...prev].slice(0, 30);
            return sortBy === 'fee'
              ? updated.sort((a, b) => b.fee - a.fee)
              : updated;
          });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, (payload) => {
        if (payload.new?.status !== 'pending') {
          setPendingTxs(prev => prev.filter(t => t.id !== payload.new.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sortBy]);

  const sorted = [...pendingTxs].sort((a, b) =>
    sortBy === 'fee'
      ? b.fee - a.fee
      : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const handleAccelerate = async (tx: MempoolTx) => {
    if (!user || !wallet) {
      toast({ title: 'Sign in required', description: 'You must be logged in to accelerate transactions.', variant: 'destructive' });
      return;
    }
    if (tx.from_address !== wallet.address) {
      toast({ title: 'Not your transaction', description: 'You can only accelerate your own transactions.', variant: 'destructive' });
      return;
    }

    setAccelerating(tx.id);
    const newFee = tx.fee * 1.5;
    const { error } = await supabase
      .from('transactions')
      .update({ fee: newFee })
      .eq('id', tx.id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Fee increased!', description: `New fee: ${formatFee(newFee)}` });
      setPendingTxs(prev => prev.map(t => t.id === tx.id ? { ...t, fee: newFee } : t));
    }
    setAccelerating(null);
  };

  return (
    <section id="mempool" className="py-20 gradient-mesh">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Live <span className="gradient-text">Mempool</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Real-time pending transactions sorted by fee — accelerate your own transactions by increasing the fee
          </p>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto mb-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-card p-4 text-center">
            <div className="text-2xl font-bold neon-text">{pendingTxs.length}</div>
            <div className="text-xs text-muted-foreground">Pending Txns</div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="glass-card p-4 text-center">
            <div className="text-2xl font-bold neon-text-green">
              {pendingTxs.length > 0 ? formatFee(Math.max(...pendingTxs.map(t => t.fee))) : '—'}
            </div>
            <div className="text-xs text-muted-foreground">Highest Fee</div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }} className="glass-card p-4 text-center">
            <div className="text-2xl font-bold">
              {pendingTxs.length > 0 ? formatFee(pendingTxs.reduce((s, t) => s + t.fee, 0) / pendingTxs.length) : '—'}
            </div>
            <div className="text-xs text-muted-foreground">Avg Fee</div>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" />
              <h3 className="font-semibold">Pending Transactions</h3>
              <span className="flex items-center gap-1 text-xs text-secondary ml-2">
                <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                Live
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Sort:</span>
              <Button
                variant={sortBy === 'fee' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSortBy('fee')}
                className="text-xs h-7 gap-1"
              >
                <TrendingUp className="w-3 h-3" /> Fee
              </Button>
              <Button
                variant={sortBy === 'age' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSortBy('age')}
                className="text-xs h-7 gap-1"
              >
                <Clock className="w-3 h-3" /> Age
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground flex flex-col items-center gap-3">
              <Info className="w-10 h-10 text-muted-foreground/40" />
              <p>Mempool is empty — no pending transactions.</p>
              <p className="text-xs">New transactions will appear here in real-time.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Hash</th>
                    <th className="pb-3 pr-4 font-medium">From</th>
                    <th className="pb-3 pr-4 font-medium">To</th>
                    <th className="pb-3 pr-4 font-medium text-right">Amount</th>
                    <th className="pb-3 pr-4 font-medium text-right flex items-center gap-1">
                      <ArrowUpDown className="w-3 h-3" /> Fee
                    </th>
                    <th className="pb-3 pr-4 font-medium">Age</th>
                    <th className="pb-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {sorted.map((tx, idx) => {
                      const isOwn = wallet && tx.from_address === wallet.address;
                      return (
                        <motion.tr
                          key={tx.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          transition={{ delay: idx * 0.02 }}
                          className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${isOwn ? 'bg-primary/5' : ''}`}
                        >
                          <td className="py-3 pr-4 font-mono text-primary">{formatAddress(tx.hash, 6)}</td>
                          <td className="py-3 pr-4 font-mono text-muted-foreground">{formatAddress(tx.from_address, 6)}</td>
                          <td className="py-3 pr-4 font-mono text-muted-foreground">{formatAddress(tx.to_address, 6)}</td>
                          <td className="py-3 pr-4 text-right font-mono">{tx.amount.toFixed(4)} HSMC</td>
                          <td className={`py-3 pr-4 text-right font-mono font-medium ${idx === 0 ? 'text-secondary' : ''}`}>
                            {formatFee(tx.fee)}
                          </td>
                          <td className="py-3 pr-4 text-muted-foreground">{formatAge(tx.created_at)}</td>
                          <td className="py-3">
                            {isOwn ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs gap-1 border-primary/50 text-primary"
                                onClick={() => handleAccelerate(tx)}
                                disabled={accelerating === tx.id}
                              >
                                {accelerating === tx.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Zap className="w-3 h-3" />
                                )}
                                Boost
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">—</span>
                            )}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
};

export default Mempool;
