import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpDown, Settings2, Loader2, Shield, ShieldAlert, ShieldCheck, Info, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { toast } from '@/hooks/use-toast';

const TOKENS = ['HSMC', 'wHSMC', 'HSMC-LEU', 'HSMC-EUR', 'HSMC-USD', 'HSMC-XAU', 'HSMC-XAG'] as const;
type Token = typeof TOKENS[number];

const TOKEN_META: Record<Token, { label: string; desc: string; color: string }> = {
  'HSMC':      { label: 'HSMC',      desc: 'Native Token',   color: 'from-primary to-secondary' },
  'wHSMC':     { label: 'wHSMC',     desc: 'Wrapped',        color: 'from-secondary to-primary' },
  'HSMC-LEU':  { label: 'HSMC-LEU',  desc: 'Romanian Leu',   color: 'from-accent to-primary' },
  'HSMC-EUR':  { label: 'HSMC-EUR',  desc: 'Euro',           color: 'from-primary/80 to-primary/40' },
  'HSMC-USD':  { label: 'HSMC-USD',  desc: 'US Dollar',      color: 'from-secondary/80 to-secondary/40' },
  'HSMC-XAU':  { label: 'HSMC-XAU',  desc: 'Gold',           color: 'from-accent/80 to-accent/40' },
  'HSMC-XAG':  { label: 'HSMC-XAG',  desc: 'Silver',         color: 'from-muted-foreground to-muted' },
};

const PRIVACY_LEVELS = [
  { value: 'standard', label: 'Standard', icon: Shield,      desc: 'Ring size 7',  color: 'text-muted-foreground' },
  { value: 'private',  label: 'Private',  icon: ShieldCheck, desc: 'Ring size 11', color: 'text-primary' },
  { value: 'maximum',  label: 'Maximum',  icon: ShieldAlert, desc: 'Ring size 16', color: 'text-secondary' },
];

interface SwapRate {
  from_token: string;
  to_token: string;
  rate: number;
  updated_at: string;
}

/* ─── Token Picker ──────────────────────────────────────────────────────── */
const TokenPicker = ({
  value, exclude, onChange, label,
}: { value: Token; exclude: Token; onChange: (t: Token) => void; label: string }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const meta = TOKEN_META[value];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 group"
      >
        <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${meta.color} flex-shrink-0 shadow-sm`} />
        <div className="text-left">
          <div className="font-bold text-base leading-tight">{meta.label}</div>
          <div className="text-[10px] text-muted-foreground leading-tight">{meta.desc}</div>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full left-0 mt-2 w-52 glass border border-border rounded-xl shadow-xl z-30 overflow-hidden"
          >
            {TOKENS.filter(t => t !== exclude).map(t => {
              const m = TOKEN_META[t];
              const isSelected = t === value;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { onChange(t); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors ${
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60 text-foreground'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${m.color} flex-shrink-0`} />
                  <div className="text-left flex-1">
                    <div className="text-sm font-semibold leading-tight">{m.label}</div>
                    <div className="text-[10px] text-muted-foreground">{m.desc}</div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ─── SwapPanel ─────────────────────────────────────────────────────────── */
export const SwapPanel = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const [fromToken, setFromToken] = useState<Token>('HSMC');
  const [toToken, setToToken] = useState<Token>('wHSMC');
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [rates, setRates] = useState<SwapRate[]>([]);
  const [currentRate, setCurrentRate] = useState<number>(1);
  const [hsmcPrice, setHsmcPrice] = useState<number>(0.045);
  const [slippage, setSlippage] = useState(0.5);
  const [privacyLevel, setPrivacyLevel] = useState('standard');
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [recentSwaps, setRecentSwaps] = useState<Array<{
    id: string; from_token: string; to_token: string;
    from_amount: number; to_amount: number; created_at: string; status: string;
  }>>([]);

  const fetchRates = useCallback(async () => {
    setLoading(true);
    const [{ data: ratesData }, { data: metrics }] = await Promise.all([
      supabase.from('swap_rates').select('*'),
      supabase.from('token_metrics').select('price').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (ratesData) { setRates(ratesData); setLastUpdated(new Date()); }
    if (metrics?.price && metrics.price > 0) setHsmcPrice(metrics.price);
    setLoading(false);
  }, []);

  const fetchRecentSwaps = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('token_swaps')
      .select('id, from_token, to_token, from_amount, to_amount, created_at, status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    if (data) setRecentSwaps(data);
  }, [user]);

  useEffect(() => {
    fetchRates();
    fetchRecentSwaps();
    const channel = supabase
      .channel('swap-rates-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'swap_rates' }, () => fetchRates())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'swap_rates' }, () => fetchRates())
      .subscribe();
    const metricsChannel = supabase
      .channel('token-metrics-for-swap')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'token_metrics' }, () => setTimeout(fetchRates, 500))
      .subscribe();
    return () => { supabase.removeChannel(channel); supabase.removeChannel(metricsChannel); };
  }, [fetchRates, fetchRecentSwaps]);

  useEffect(() => {
    const rate = rates.find(r => r.from_token === fromToken && r.to_token === toToken);
    // Fallback: try reverse rate 1/x
    if (!rate) {
      const reverse = rates.find(r => r.from_token === toToken && r.to_token === fromToken);
      setCurrentRate(reverse && reverse.rate > 0 ? 1 / reverse.rate : 1);
    } else {
      setCurrentRate(rate.rate);
    }
  }, [fromToken, toToken, rates]);

  useEffect(() => {
    if (fromAmount && !isNaN(parseFloat(fromAmount))) {
      const out = parseFloat(fromAmount) * currentRate;
      setToAmount((out * (1 - slippage / 100)).toFixed(6));
    } else {
      setToAmount('');
    }
  }, [fromAmount, currentRate, slippage]);

  const handleFlip = () => {
    const f = toToken; const t = fromToken;
    setFromToken(f); setToToken(t); setFromAmount(toAmount);
  };

  const handleSwap = async () => {
    if (!user || !wallet) { toast({ title: 'Connect wallet first', variant: 'destructive' }); return; }
    const amount = parseFloat(fromAmount);
    if (isNaN(amount) || amount <= 0) { toast({ title: 'Invalid amount', variant: 'destructive' }); return; }
    if (fromToken === 'HSMC' && amount > wallet.balance) {
      toast({ title: 'Insufficient balance', description: `You have ${wallet.balance.toFixed(4)} HSMC`, variant: 'destructive' });
      return;
    }
    setSwapping(true);
    try {
      const hashBytes = new Uint8Array(32);
      crypto.getRandomValues(hashBytes);
      const txHash = '0x' + Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const actualOut = parseFloat(toAmount);

      const { error } = await supabase.from('token_swaps').insert({
        user_id: user.id, from_token: fromToken, to_token: toToken,
        from_amount: amount, to_amount: actualOut, rate: currentRate,
        slippage, privacy_level: privacyLevel, status: 'completed', tx_hash: txHash,
      });
      if (error) throw error;

      if (fromToken === 'HSMC') await supabase.from('wallets').update({ balance: wallet.balance - amount }).eq('id', wallet.id);
      if (toToken === 'HSMC') await supabase.from('wallets').update({ balance: wallet.balance + actualOut }).eq('id', wallet.id);

      await supabase.from('transactions').insert({
        hash: txHash, from_address: wallet.address, to_address: wallet.address,
        amount, fee: amount * 0.001, status: 'confirmed', privacy_level: privacyLevel,
        decoy_count: privacyLevel === 'maximum' ? 15 : privacyLevel === 'private' ? 10 : 6,
      });

      toast({ title: '✅ Swap Completed', description: `${amount} ${fromToken} → ${actualOut.toFixed(6)} ${toToken}` });
      setFromAmount(''); setToAmount('');
      fetchRecentSwaps();
    } catch (err: unknown) {
      toast({ title: 'Swap failed', description: String(err), variant: 'destructive' });
    } finally {
      setSwapping(false);
    }
  };

  const minReceived = toAmount ? (parseFloat(toAmount) * (1 - slippage / 100)).toFixed(6) : '—';
  const priceImpact = fromAmount ? Math.min(parseFloat(fromAmount) / 100000 * 100, 2.5).toFixed(2) : '0.00';
  const fromUsd = fromAmount && hsmcPrice > 0 && fromToken === 'HSMC' ? `≈ $${(parseFloat(fromAmount) * hsmcPrice).toFixed(2)}` : null;
  const toUsd   = toAmount   && hsmcPrice > 0 && toToken   === 'HSMC' ? `≈ $${(parseFloat(toAmount)   * hsmcPrice).toFixed(2)}` : null;

  return (
    <section id="swap" className="py-20 gradient-mesh">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            <span className="gradient-text">Token</span> Swap
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Swap between HSMC ecosystem tokens with live rates and configurable privacy
          </p>
          {/* Token overview strip */}
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {TOKENS.map(t => {
              const m = TOKEN_META[t];
              return (
                <div key={t} className="flex items-center gap-2 px-3 py-1.5 bg-card/60 border border-border rounded-full text-xs">
                  <div className={`w-3 h-3 rounded-full bg-gradient-to-br ${m.color}`} />
                  <span className="font-mono font-semibold">{m.label}</span>
                  <span className="text-muted-foreground">{m.desc}</span>
                </div>
              );
            })}
          </div>
        </motion.div>

        <div className="max-w-lg mx-auto space-y-4">
          {/* Main Swap Card */}
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">Swap</h3>
              <div className="flex items-center gap-2">
                {lastUpdated && (
                  <span className="text-xs text-muted-foreground">
                    {Math.floor((Date.now() - lastUpdated.getTime()) / 1000)}s ago
                  </span>
                )}
                {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                >
                  <Settings2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Settings panel */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-5 p-4 bg-muted/30 rounded-xl border border-border space-y-4"
                >
                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block">Slippage Tolerance</label>
                    <div className="flex items-center gap-2">
                      {[0.1, 0.5, 1.0, 2.0].map(s => (
                        <button
                          key={s}
                          onClick={() => setSlippage(s)}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${slippage === s ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                        >
                          {s}%
                        </button>
                      ))}
                      <div className="relative flex-1">
                        <Input
                          type="number"
                          value={slippage}
                          onChange={e => setSlippage(Math.min(50, Math.max(0.01, parseFloat(e.target.value) || 0.5)))}
                          className="text-xs h-8 pr-6"
                          step="0.1"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                    {slippage > 5 && (
                      <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                        <Info className="w-3 h-3" /> High slippage — your trade may be frontrun
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block">Privacy Level</label>
                    <div className="grid grid-cols-3 gap-2">
                      {PRIVACY_LEVELS.map(({ value, label, icon: Icon, desc, color }) => (
                        <button
                          key={value}
                          onClick={() => setPrivacyLevel(value)}
                          className={`p-2 rounded-lg border text-center transition-all ${privacyLevel === value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                        >
                          <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                          <div className="text-xs font-medium">{label}</div>
                          <div className="text-[10px] text-muted-foreground">{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* From Token */}
            <div className="p-4 bg-muted/30 rounded-xl border border-border mb-2">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">You Pay</span>
                {wallet && fromToken === 'HSMC' && (
                  <span className="text-xs text-muted-foreground">
                    Balance: {wallet.balance.toFixed(4)} HSMC
                    <button onClick={() => setFromAmount(wallet.balance.toString())} className="ml-1 text-primary text-xs font-medium">MAX</button>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <TokenPicker value={fromToken} exclude={toToken} onChange={setFromToken} label="From" />
                <div className="flex-1 text-right">
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={fromAmount}
                    onChange={e => setFromAmount(e.target.value)}
                    className="text-right text-xl font-mono border-none bg-transparent focus-visible:ring-0 p-0"
                  />
                  {fromUsd && <div className="text-xs text-muted-foreground">{fromUsd}</div>}
                </div>
              </div>
            </div>

            {/* Flip Button + Live Rate */}
            <div className="flex items-center justify-center gap-3 my-1">
              <button
                onClick={handleFlip}
                className="w-9 h-9 rounded-xl bg-muted hover:bg-primary/10 hover:text-primary border border-border flex items-center justify-center transition-all shrink-0"
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
              {currentRate !== 1 || rates.length > 0 ? (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-primary/5 border border-primary/20 rounded-full text-xs font-mono">
                  <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-500 animate-pulse' : 'bg-secondary'}`} />
                  <span className="text-muted-foreground">1 {fromToken}</span>
                  <span className="text-foreground font-semibold">=</span>
                  <span className="text-primary font-bold">
                    {currentRate >= 1000 ? currentRate.toLocaleString('en', { maximumFractionDigits: 2 }) : currentRate.toFixed(currentRate < 0.01 ? 8 : currentRate < 1 ? 6 : 4)}
                  </span>
                  <span className="text-muted-foreground">{toToken}</span>
                </div>
              ) : null}
            </div>

            {/* To Token */}
            <div className="p-4 bg-muted/30 rounded-xl border border-border mt-2">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">You Receive</span>
                {slippage > 0 && toAmount && (
                  <span className="text-xs text-muted-foreground">Min: {minReceived}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <TokenPicker value={toToken} exclude={fromToken} onChange={setToToken} label="To" />
                <div className="flex-1 text-right">
                  <div className="text-xl font-mono text-secondary">{toAmount || '0.00'}</div>
                  {toUsd && <div className="text-xs text-muted-foreground">{toUsd}</div>}
                </div>
              </div>
            </div>

            {/* Rate Info */}
            {fromAmount && toAmount && (
              <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Rate</span>
                  <span className="font-mono">1 {fromToken} = {currentRate.toFixed(6)} {toToken}</span>
                </div>
                <div className="flex justify-between">
                  <span>Price Impact</span>
                  <span className={parseFloat(priceImpact) > 1 ? 'text-amber-500' : 'text-secondary'}>~{priceImpact}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Network Fee</span>
                  <span className="font-mono">{(parseFloat(fromAmount) * 0.001).toFixed(6)} {fromToken}</span>
                </div>
                <div className="flex justify-between">
                  <span>Privacy</span>
                  <span className="capitalize text-primary">{privacyLevel}</span>
                </div>
              </div>
            )}

            <Button
              variant="hero"
              className="w-full mt-5"
              onClick={handleSwap}
              disabled={swapping || !fromAmount || !toAmount || !user}
            >
              {swapping ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Swapping...</>
              ) : !user ? (
                'Sign in to Swap'
              ) : (
                <>Swap {fromToken} → {toToken}</>
              )}
            </Button>
          </motion.div>

          {/* Recent Swaps */}
          {recentSwaps.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
              <h4 className="font-semibold mb-4 text-sm">Recent Swaps</h4>
              <div className="space-y-2">
                {recentSwaps.map(swap => (
                  <div key={swap.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${TOKEN_META[swap.from_token as Token]?.color ?? 'from-primary to-secondary'}`} />
                      <span className="text-xs font-mono">{swap.from_amount.toFixed(4)} {swap.from_token}</span>
                      <span className="text-xs text-muted-foreground">→</span>
                      <span className="text-xs font-mono text-secondary">{swap.to_amount.toFixed(4)} {swap.to_token}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-3 h-3 text-secondary" />
                      <span className="text-xs text-muted-foreground">{new Date(swap.created_at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
};

export default SwapPanel;
