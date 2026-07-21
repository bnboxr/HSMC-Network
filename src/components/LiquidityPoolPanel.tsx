/**
 * LiquidityPoolPanel — real AMM interactions against pool-engine.
 * Supports add/remove/swap on internal_virtual + stripe_real pools and read-only sync_onchain.
 * Price = reserve_pair / reserve_hsmc (constant product x*y=k).
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Droplets, ArrowDownUp, Plus, Minus, RefreshCw, Loader2,
  TrendingUp, AlertCircle, CheckCircle2, Coins, DollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import CreatePoolDialog from '@/components/CreatePoolDialog';

interface Pool {
  id: string;
  pair_token: string;
  pool_type: 'internal_virtual' | 'stripe_real' | 'onchain_dex';
  reserve_hsmc: number;
  reserve_pair: number;
  total_lp_tokens: number;
  fee_bps: number;
  status: string;
  chain_name: string | null;
  dex_name: string | null;
}

interface LpPosition {
  pool_id: string;
  lp_tokens: number;
  hsmc_deposited: number;
  pair_deposited: number;
  fees_earned: number;
}

const POOL_TYPE_LABEL: Record<string, { label: string; color: string; help: string }> = {
  internal_virtual: { label: 'Internal · Virtual USDT', color: 'bg-secondary/10 text-secondary border-secondary/30', help: 'Both sides credited from your wallet — testnet liquidity, no real money.' },
  stripe_real:      { label: 'Real USD · Stripe',     color: 'bg-green-500/10 text-green-500 border-green-500/30', help: 'USD funded by a Stripe payment_intent — real money flow.' },
  onchain_dex:      { label: 'On-chain DEX',          color: 'bg-primary/10 text-primary border-primary/30', help: 'Read-only oracle of real PancakeSwap/Uniswap reserves.' },
};

export default function LiquidityPoolPanel() {
  const { user } = useAuth();
  const [pools, setPools] = useState<Pool[]>([]);
  const [positions, setPositions] = useState<LpPosition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hsmcAmount, setHsmcAmount] = useState('');
  const [pairAmount, setPairAmount] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [swapDir, setSwapDir] = useState<'hsmc_to_pair' | 'pair_to_hsmc'>('hsmc_to_pair');
  const [swapAmount, setSwapAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [poolsRes, posRes] = await Promise.all([
      supabase.from('liquidity_pools').select('*').eq('status', 'active').order('pool_type'),
      user ? supabase.from('lp_positions').select('*').eq('user_id', user.id) : Promise.resolve({ data: [] }),
    ]);
    setPools((poolsRes.data as Pool[]) ?? []);
    setPositions((posRes.data as LpPosition[]) ?? []);
    if (!selectedId && poolsRes.data && poolsRes.data.length > 0) {
      setSelectedId((poolsRes.data[0] as Pool).id);
    }
    setLoading(false);
  }, [user, selectedId]);

  useEffect(() => { load(); }, [load]);

  // Realtime updates on pool reserves
  useEffect(() => {
    const ch = supabase
      .channel('lp-pools')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'liquidity_pools' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lp_positions' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const selected = pools.find(p => p.id === selectedId);
  const myPosition = positions.find(p => p.pool_id === selectedId);
  const price = selected && selected.reserve_hsmc > 0 ? selected.reserve_pair / selected.reserve_hsmc : 0;

  const callEngine = async (action: string, payload: Record<string, unknown>) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('pool-engine', {
      body: { action, ...payload },
    });
    setBusy(false);
    if (error || data?.error) {
      toast({ title: 'Action failed', description: error?.message ?? data?.error ?? 'Unknown', variant: 'destructive' });
      return null;
    }
    toast({ title: '✅ Done', description: action.replace(/_/g, ' ') });
    return data;
  };

  const onAdd = async () => {
    if (!selected) return;
    const h = parseFloat(hsmcAmount), p = parseFloat(pairAmount);
    if (!(h > 0) || !(p > 0)) { toast({ title: 'Enter both amounts > 0', variant: 'destructive' }); return; }
    if (selected.pool_type === 'stripe_real' && !paymentRef.trim()) {
      toast({ title: 'Stripe payment_intent required', description: 'Charge the customer with your Stripe key first, then paste the pi_… id.', variant: 'destructive' });
      return;
    }
    const ok = await callEngine('add_liquidity', {
      pool_id: selected.id, hsmc_amount: h, pair_amount: p,
      payment_ref: selected.pool_type === 'stripe_real' ? paymentRef.trim() : undefined,
    });
    if (ok) { setHsmcAmount(''); setPairAmount(''); setPaymentRef(''); }
  };

  const onRemove = async (lpFraction: number) => {
    if (!selected || !myPosition) return;
    const burn = myPosition.lp_tokens * lpFraction;
    if (!(burn > 0)) return;
    await callEngine('remove_liquidity', { pool_id: selected.id, lp_tokens: burn });
  };

  const onSwap = async () => {
    if (!selected) return;
    const a = parseFloat(swapAmount);
    if (!(a > 0)) { toast({ title: 'Enter amount > 0', variant: 'destructive' }); return; }
    const ok = await callEngine('swap', { pool_id: selected.id, direction: swapDir, amount_in: a });
    if (ok) setSwapAmount('');
  };

  const onSyncOnchain = async () => {
    if (!selected) return;
    await callEngine('sync_onchain', { pool_id: selected.id });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (pools.length === 0) {
    return (
      <div className="space-y-3">
        <div className="p-8 rounded-lg border border-dashed border-border text-center">
          <Droplets className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">No liquidity pools configured yet.</p>
          <Button size="sm" className="gap-1" onClick={() => setShowCreate(true)}>
            <Plus className="h-3 w-3" /> Create the first pool
          </Button>
        </div>
        <CreatePoolDialog isOpen={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Droplets className="h-4 w-4 text-primary" /> Liquidity Pools
        </h3>
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Pool
        </Button>
      </div>
      <CreatePoolDialog isOpen={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      {/* Pool selector */}
      <div className="grid md:grid-cols-3 gap-3">
        {pools.map(p => {
          const meta = POOL_TYPE_LABEL[p.pool_type];
          const sel = p.id === selectedId;
          const px = p.reserve_hsmc > 0 ? p.reserve_pair / p.reserve_hsmc : 0;
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`p-4 rounded-lg border text-left transition-all ${
                sel ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono font-semibold text-sm">HSMC / {p.pair_token}</span>
                <Badge className={`text-[9px] ${meta.color}`}>{meta.label}</Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>Reserve: {p.reserve_hsmc.toFixed(2)} HSMC · {p.reserve_pair.toFixed(2)} {p.pair_token}</div>
                <div className="font-mono text-foreground">Price: ${px.toFixed(6)}</div>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <motion.div
          key={selected.id}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-5 space-y-4"
        >
          {/* Header */}
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Droplets className="h-4 w-4 text-primary" />
                HSMC / {selected.pair_token} Pool
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">{POOL_TYPE_LABEL[selected.pool_type].help}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Spot price</p>
              <p className="font-mono text-lg text-primary">${price.toFixed(6)}</p>
            </div>
          </div>

          {/* Reserves */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="bg-muted/40 p-3 rounded">
              <div className="text-muted-foreground">HSMC reserve</div>
              <div className="font-mono text-foreground text-sm">{selected.reserve_hsmc.toLocaleString()}</div>
            </div>
            <div className="bg-muted/40 p-3 rounded">
              <div className="text-muted-foreground">{selected.pair_token} reserve</div>
              <div className="font-mono text-foreground text-sm">{selected.reserve_pair.toLocaleString()}</div>
            </div>
            <div className="bg-muted/40 p-3 rounded">
              <div className="text-muted-foreground">Total LP tokens</div>
              <div className="font-mono text-foreground text-sm">{selected.total_lp_tokens.toLocaleString()}</div>
            </div>
          </div>

          {/* Your position */}
          {myPosition && myPosition.lp_tokens > 0 && (
            <div className="p-3 rounded border border-secondary/30 bg-secondary/5 text-xs">
              <div className="flex items-center gap-2 mb-1 font-medium">
                <CheckCircle2 className="h-4 w-4 text-secondary" />
                Your position
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono">
                <span>LP: {myPosition.lp_tokens.toFixed(4)}</span>
                <span>Fees: {myPosition.fees_earned.toFixed(4)}</span>
                <span>HSMC in: {myPosition.hsmc_deposited.toFixed(2)}</span>
                <span>{selected.pair_token} in: {myPosition.pair_deposited.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* On-chain pools: read-only sync */}
          {selected.pool_type === 'onchain_dex' ? (
            <Button onClick={onSyncOnchain} disabled={busy} className="w-full gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync from {selected.dex_name ?? 'DEX'} ({selected.chain_name ?? 'chain'})
            </Button>
          ) : (
            <Tabs defaultValue="add">
              <TabsList className="w-full">
                <TabsTrigger value="add" className="flex-1 gap-1"><Plus className="h-3 w-3" />Add</TabsTrigger>
                <TabsTrigger value="remove" className="flex-1 gap-1"><Minus className="h-3 w-3" />Remove</TabsTrigger>
                <TabsTrigger value="swap" className="flex-1 gap-1"><ArrowDownUp className="h-3 w-3" />Swap</TabsTrigger>
              </TabsList>

              <TabsContent value="add" className="space-y-3 pt-3">
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Coins className="h-3 w-3" />HSMC amount</label>
                  <Input type="number" min="0" step="0.0001" value={hsmcAmount} onChange={e => setHsmcAmount(e.target.value)} placeholder="0.00" className="font-mono" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><DollarSign className="h-3 w-3" />{selected.pair_token} amount</label>
                  <Input type="number" min="0" step="0.0001" value={pairAmount} onChange={e => setPairAmount(e.target.value)} placeholder="0.00" className="font-mono" />
                </div>
                {selected.pool_type === 'stripe_real' && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Stripe payment_intent (pi_…)</label>
                    <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="pi_3OabcdEFGHIJKL12345" className="font-mono text-xs" />
                    <p className="text-[10px] text-muted-foreground mt-1 flex items-start gap-1">
                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      Charge the customer through your Stripe dashboard or HSMCPay first, then paste the succeeded payment_intent ID.
                    </p>
                  </div>
                )}
                <Button onClick={onAdd} disabled={busy} className="w-full gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Liquidity
                </Button>
              </TabsContent>

              <TabsContent value="remove" className="space-y-3 pt-3">
                {!myPosition || myPosition.lp_tokens <= 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">You have no LP tokens in this pool.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {[0.25, 0.5, 0.75, 1].map(f => (
                      <Button key={f} variant="outline" size="sm" onClick={() => onRemove(f)} disabled={busy}>
                        {Math.round(f * 100)}%
                      </Button>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="swap" className="space-y-3 pt-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant={swapDir === 'hsmc_to_pair' ? 'default' : 'outline'}
                    size="sm" className="flex-1"
                    onClick={() => setSwapDir('hsmc_to_pair')}
                  >HSMC → {selected.pair_token}</Button>
                  <Button
                    variant={swapDir === 'pair_to_hsmc' ? 'default' : 'outline'}
                    size="sm" className="flex-1"
                    onClick={() => setSwapDir('pair_to_hsmc')}
                  >{selected.pair_token} → HSMC</Button>
                </div>
                <Input type="number" min="0" step="0.0001" value={swapAmount} onChange={e => setSwapAmount(e.target.value)} placeholder="amount in" className="font-mono" />
                <Button onClick={onSwap} disabled={busy} className="w-full gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownUp className="h-4 w-4" />}
                  Execute Swap (fee {selected.fee_bps / 100}%)
                </Button>
              </TabsContent>
            </Tabs>
          )}
        </motion.div>
      )}
    </div>
  );
}
