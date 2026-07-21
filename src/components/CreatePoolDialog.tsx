/**
 * CreatePoolDialog — wizard cu validări stricte + preview înainte de confirmare.
 * Three pool types:
 *  - internal_virtual : seed both sides from your HSMC balance (testnet)
 *  - stripe_real      : real USD funded by a Stripe payment_intent
 *  - onchain_dex      : read-only oracle of an external DEX pair (PancakeSwap/Uniswap)
 */
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Plus, AlertCircle, Info, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/integrations/db/client';
import { toast } from '@/hooks/use-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

const PRESET_PAIRS = ['USDT-VIRTUAL', 'USDT', 'USDC', 'BUSD', 'DAI', 'EUR', 'BNB', 'ETH'];
const PAIR_RE = /^[A-Z0-9-]{2,16}$/;
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const STRIPE_PI_RE = /^pi_[A-Za-z0-9_]{10,}$/;
const FEE_MIN = 1;
const FEE_MAX = 1000;
const MIN_SEED_HSMC = 10;       // minim 10 HSMC pe partea HSMC
const MIN_SEED_PAIR_VIRTUAL = 10;
const MIN_SEED_USD = 1;          // minim $1 pentru stripe_real

type Step = 'form' | 'preview';

export default function CreatePoolDialog({ isOpen, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [poolType, setPoolType] = useState<'internal_virtual' | 'stripe_real' | 'onchain_dex'>('internal_virtual');
  const [pair, setPair] = useState('USDT-VIRTUAL');
  const [hsmcSeed, setHsmcSeed] = useState('');
  const [pairSeed, setPairSeed] = useState('');
  const [feeBps, setFeeBps] = useState(30);
  const [paymentRef, setPaymentRef] = useState('');
  const [chainName, setChainName] = useState('BSC');
  const [dexName, setDexName] = useState('PancakeSwap');
  const [poolAddress, setPoolAddress] = useState('');
  const [busy, setBusy] = useState(false);

  // ── Validări ──────────────────────────────────────────────────────────────
  const errors = useMemo<string[]>(() => {
    const errs: string[] = [];
    const pairUp = pair.trim().toUpperCase();
    if (!PAIR_RE.test(pairUp))
      errs.push('Pair token: doar A-Z, 0-9 și „-", lungime 2-16.');
    if (!Number.isInteger(feeBps) || feeBps < FEE_MIN || feeBps > FEE_MAX)
      errs.push(`Fee bps trebuie între ${FEE_MIN} și ${FEE_MAX} (0.01%–10%).`);

    if (poolType === 'onchain_dex') {
      if (!chainName.trim()) errs.push('Chain este obligatoriu.');
      if (!ADDR_RE.test(poolAddress.trim()))
        errs.push('Pool address: format invalid (0x + 40 hex).');
    } else {
      const h = parseFloat(hsmcSeed);
      const p = parseFloat(pairSeed);
      if (!(h > 0)) errs.push('HSMC seed trebuie > 0.');
      else if (h < MIN_SEED_HSMC) errs.push(`HSMC seed minim ${MIN_SEED_HSMC} HSMC.`);
      if (!(p > 0)) errs.push(`${pairUp} seed trebuie > 0.`);
      else {
        const minP = poolType === 'stripe_real' ? MIN_SEED_USD : MIN_SEED_PAIR_VIRTUAL;
        if (p < minP) errs.push(`${pairUp} seed minim ${minP}.`);
      }
      if (poolType === 'stripe_real' && !STRIPE_PI_RE.test(paymentRef.trim()))
        errs.push('Stripe payment_intent invalid (format pi_…).');
    }
    return errs;
  }, [pair, feeBps, poolType, hsmcSeed, pairSeed, paymentRef, chainName, poolAddress]);

  if (!isOpen) return null;

  const previewData = useMemo(() => {
    const h = parseFloat(hsmcSeed) || 0;
    const p = parseFloat(pairSeed) || 0;
    const initialPrice = h > 0 ? p / h : 0;
    const initialLp = Math.sqrt(h * p);
    return { h, p, initialPrice, initialLp, feePct: (feeBps / 100).toFixed(2) };
  }, [hsmcSeed, pairSeed, feeBps]);

  const goPreview = () => {
    if (errors.length) {
      toast({ title: 'Verifică câmpurile', description: errors[0], variant: 'destructive' });
      return;
    }
    setStep('preview');
  };

  const submit = async () => {
    setBusy(true);
    const body: Record<string, unknown> = {
      action: 'create_pool',
      pair_token: pair.trim().toUpperCase(),
      pool_type: poolType,
      fee_bps: Number(feeBps) || 30,
    };
    if (poolType === 'onchain_dex') {
      Object.assign(body, { chain_name: chainName, dex_name: dexName, pool_address: poolAddress.trim() });
    } else {
      Object.assign(body, {
        hsmc_seed: parseFloat(hsmcSeed),
        pair_seed: parseFloat(pairSeed),
        ...(poolType === 'stripe_real' ? { payment_ref: paymentRef.trim() } : {}),
      });
    }
    const { data, error } = await supabase.functions.invoke('pool-engine', { body });
    setBusy(false);
    if (error || data?.error) {
      toast({ title: 'Pool creation failed', description: error?.message ?? data?.error, variant: 'destructive' });
      return;
    }
    toast({ title: '✅ Pool created', description: `HSMC/${pair.toUpperCase()} (${poolType})` });
    onCreated?.();
    onClose();
    setStep('form');
    setHsmcSeed(''); setPairSeed(''); setPaymentRef(''); setPoolAddress('');
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }}
          onClick={e => e.stopPropagation()}
          className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl p-5 max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                {step === 'form' ? 'Create Liquidity Pool' : 'Confirm Pool'}
              </h2>
              <p className="text-xs text-muted-foreground">
                HSMC native AMM (constant-product x*y=k)
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg"><X className="w-4 h-4" /></button>
          </div>

          {step === 'form' && (
            <>
              <Tabs value={poolType} onValueChange={v => setPoolType(v as any)}>
                <TabsList className="w-full">
                  <TabsTrigger value="internal_virtual" className="flex-1 text-xs">Internal (Test)</TabsTrigger>
                  <TabsTrigger value="stripe_real" className="flex-1 text-xs">Real USD (Stripe)</TabsTrigger>
                  <TabsTrigger value="onchain_dex" className="flex-1 text-xs">On-chain DEX</TabsTrigger>
                </TabsList>

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-xs font-medium block mb-1">Pair token (A-Z, 0-9, „-", 2-16)</label>
                    <Input
                      value={pair}
                      onChange={e => setPair(e.target.value.toUpperCase())}
                      maxLength={16}
                      className="font-mono uppercase"
                    />
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {PRESET_PAIRS.map(p => (
                        <button key={p} type="button" onClick={() => setPair(p)}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-muted hover:bg-primary/20 transition-colors">
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium block mb-1">
                      Fee (bps, {FEE_MIN}–{FEE_MAX} = 0.01%–10%) — actual: {(feeBps / 100).toFixed(2)}%
                    </label>
                    <Input type="number" min={FEE_MIN} max={FEE_MAX} value={feeBps}
                      onChange={e => setFeeBps(parseInt(e.target.value) || 30)} className="font-mono" />
                  </div>

                  <TabsContent value="internal_virtual" className="space-y-3 m-0">
                    <div className="text-xs p-2 rounded bg-secondary/10 text-secondary border border-secondary/30 flex gap-2">
                      <Info className="w-4 h-4 shrink-0" />
                      Both reserves are debited from your HSMC balance. Pair token is virtual (no real USD).
                    </div>
                    <SeedInputs hsmcSeed={hsmcSeed} setHsmcSeed={setHsmcSeed} pairSeed={pairSeed} setPairSeed={setPairSeed} pair={pair} minPair={MIN_SEED_PAIR_VIRTUAL} />
                  </TabsContent>

                  <TabsContent value="stripe_real" className="space-y-3 m-0">
                    <div className="text-xs p-2 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 flex gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      Charge the customer in Stripe first, then paste the succeeded payment_intent ID below.
                    </div>
                    <SeedInputs hsmcSeed={hsmcSeed} setHsmcSeed={setHsmcSeed} pairSeed={pairSeed} setPairSeed={setPairSeed} pair="USD" minPair={MIN_SEED_USD} />
                    <div>
                      <label className="text-xs block mb-1">Stripe payment_intent (pi_…)</label>
                      <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
                        placeholder="pi_3Oabc..." className="font-mono text-xs" />
                    </div>
                  </TabsContent>

                  <TabsContent value="onchain_dex" className="space-y-3 m-0">
                    <div className="text-xs p-2 rounded bg-primary/10 text-primary border border-primary/30 flex gap-2">
                      <Info className="w-4 h-4 shrink-0" />
                      Read-only oracle of an existing on-chain pool. Reserves are fetched from RPC every 5 min.
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs block mb-1">Chain</label>
                        <Input value={chainName} onChange={e => setChainName(e.target.value)} placeholder="BSC" />
                      </div>
                      <div>
                        <label className="text-xs block mb-1">DEX</label>
                        <Input value={dexName} onChange={e => setDexName(e.target.value)} placeholder="PancakeSwap" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs block mb-1">Pair contract address (0x + 40 hex)</label>
                      <Input value={poolAddress} onChange={e => setPoolAddress(e.target.value)}
                        placeholder="0x0000000000000000000000000000000000000000" className="font-mono text-xs" />
                      {poolAddress && !ADDR_RE.test(poolAddress.trim()) && (
                        <p className="text-[10px] text-destructive mt-1">Format invalid: 0x urmat de 40 caractere hex.</p>
                      )}
                    </div>
                  </TabsContent>
                </div>
              </Tabs>

              {errors.length > 0 && (
                <div className="mt-3 text-xs p-2 rounded bg-destructive/10 text-destructive border border-destructive/30">
                  <div className="font-medium mb-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {errors.length} problem{errors.length > 1 ? 'e' : 'ă'}:
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex gap-2 mt-5">
                <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
                <Button onClick={goPreview} disabled={errors.length > 0} className="flex-1 gap-2">
                  Preview →
                </Button>
              </div>
            </>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              <div className="text-xs p-2 rounded bg-primary/10 text-primary border border-primary/30 flex gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Verifică toate detaliile. Această acțiune este ireversibilă: fondurile sunt debitate imediat.
              </div>

              <div className="rounded-lg border border-border divide-y divide-border text-sm">
                <Row label="Pool" value={`HSMC / ${pair.toUpperCase()}`} mono />
                <Row label="Type" value={poolType.replace('_', ' ')} />
                <Row label="Fee" value={`${feeBps} bps (${previewData.feePct}%)`} />
                {poolType === 'onchain_dex' ? (
                  <>
                    <Row label="Chain" value={chainName} />
                    <Row label="DEX" value={dexName} />
                    <Row label="Pool address" value={poolAddress} mono small />
                  </>
                ) : (
                  <>
                    <Row label="HSMC seed" value={`${previewData.h.toLocaleString()} HSMC`} mono />
                    <Row label={`${poolType === 'stripe_real' ? 'USD' : pair.toUpperCase()} seed`} value={previewData.p.toLocaleString()} mono />
                    <Row label="Initial price" value={`1 HSMC = ${previewData.initialPrice.toFixed(6)} ${poolType === 'stripe_real' ? 'USD' : pair.toUpperCase()}`} />
                    <Row label="LP tokens minted to you" value={previewData.initialLp.toFixed(6)} mono />
                    {poolType === 'stripe_real' && <Row label="Stripe payment_intent" value={paymentRef} mono small />}
                  </>
                )}
              </div>

              <div className="text-[11px] text-muted-foreground">
                Formula AMM: <code>x · y = k</code>. Schimbările de preț urmează curba constant-product;
                slippage-ul crește cu mărimea swap-ului raportată la rezerve.
              </div>

              <div className="flex gap-2 mt-2">
                <Button variant="outline" onClick={() => setStep('form')} className="flex-1 gap-2">
                  <ArrowLeft className="w-4 h-4" /> Back
                </Button>
                <Button onClick={submit} disabled={busy} className="flex-1 gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm & Create
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Row({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} ${small ? 'text-[11px]' : 'text-sm'} truncate max-w-[60%] text-right`}>
        {value}
      </span>
    </div>
  );
}

function SeedInputs({
  hsmcSeed, setHsmcSeed, pairSeed, setPairSeed, pair, minPair,
}: {
  hsmcSeed: string; setHsmcSeed: (v: string) => void;
  pairSeed: string; setPairSeed: (v: string) => void;
  pair: string; minPair: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="text-xs block mb-1">HSMC seed (min {MIN_SEED_HSMC})</label>
        <Input type="number" min={MIN_SEED_HSMC} step="any" value={hsmcSeed}
          onChange={e => setHsmcSeed(e.target.value)} placeholder="1000" className="font-mono" />
      </div>
      <div>
        <label className="text-xs block mb-1">{pair} seed (min {minPair})</label>
        <Input type="number" min={minPair} step="any" value={pairSeed}
          onChange={e => setPairSeed(e.target.value)} placeholder="1000" className="font-mono" />
      </div>
    </div>
  );
}
