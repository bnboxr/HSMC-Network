import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ArrowRight, Check, Copy, CreditCard, Loader2, Lock, QrCode, ShieldCheck, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/db/client';

type PayStep = 'amount' | 'stripe' | 'deposit' | 'sell-confirm' | 'processing' | 'success' | 'failed' | 'p2p';

interface HSMCPayProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'buy' | 'sell';
}

type StripeLike = {
  elements: (opts?: Record<string, unknown>) => StripeElementsLike;
  confirmPayment: (opts: {
    elements: StripeElementsLike;
    clientSecret: string;
    confirmParams: { return_url: string };
    redirect: 'if_required';
  }) => Promise<{ error?: { message?: string }; paymentIntent?: { id: string; status: string } }>;
};

type StripeElementsLike = {
  create: (type: 'payment', opts?: Record<string, unknown>) => StripePaymentElementLike;
};

type StripePaymentElementLike = {
  mount: (selector: string) => void;
  unmount: () => void;
};

declare global {
  interface Window {
    Stripe?: (key: string) => StripeLike;
  }
}

const STRIPE_JS_ID = 'stripe-js-sdk';

async function loadStripeJs(): Promise<void> {
  if (window.Stripe) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(STRIPE_JS_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Stripe.js failed to load')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = STRIPE_JS_ID;
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Stripe.js failed to load'));
    document.head.appendChild(script);
  });
}

export const HSMCPay = ({ isOpen, onClose, mode = 'buy' }: HSMCPayProps) => {
  const { user } = useAuth();
  const [step, setStep] = useState<PayStep>('amount');
  const [amountUsd, setAmountUsd] = useState('');
  const [estimatedHsmc, setEstimatedHsmc] = useState(0);
  const [hsmcPrice, setHsmcPrice] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [stripe, setStripe] = useState<StripeLike | null>(null);
  const [elements, setElements] = useState<StripeElementsLike | null>(null);
  const [paymentElement, setPaymentElement] = useState<StripePaymentElementLike | null>(null);
  const [result, setResult] = useState<{ txHash: string; amountHsmc: string; paymentId: string } | null>(null);
  const [failure, setFailure] = useState('');
  // Sell-specific state
  const [sellDepositAddress, setSellDepositAddress] = useState('');
  const [sellTxHash, setSellTxHash] = useState('');
  const [sellFee, setSellFee] = useState(0);
  const [sellFeeTier, setSellFeeTier] = useState('');
  const [sellPayoutSessionId, setSellPayoutSessionId] = useState('');
  const [sellAmountRequired, setSellAmountRequired] = useState(0);
  // Kill-switch / P2P state
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [p2pWalletAddress, setP2pWalletAddress] = useState('0xHSMC_Treasury_P2P_000000000000000000000');
  const [p2pInstructions, setP2pInstructions] = useState('');

  const canContinue = useMemo(() => Number(amountUsd) >= 1 && Number.isFinite(Number(amountUsd)), [amountUsd]);

  useEffect(() => {
    supabase.from('token_metrics').select('price').order('updated_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setHsmcPrice(Number(data?.price ?? 1) >= 1 ? Number(data?.price ?? 1) : 1));
  }, []);

  useEffect(() => {
    setEstimatedHsmc(canContinue ? Number(amountUsd) / hsmcPrice : 0);
  }, [amountUsd, hsmcPrice, canContinue]);

  useEffect(() => {
    if (step !== 'stripe' || !paymentElement) return;
    paymentElement.mount('#hsmcpay-payment-element');
    return () => paymentElement.unmount();
  }, [step, paymentElement]);

  // ── Kill-switch detection ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch('/admin/kill-switch')
      .then(res => res.json())
      .then((data: { kill_switch_active?: boolean; p2p_wallet_address?: string; p2p_instructions?: string }) => {
        if (cancelled) return;
        setKillSwitchActive(!!data.kill_switch_active);
        if (data.p2p_wallet_address) setP2pWalletAddress(data.p2p_wallet_address);
        if (data.p2p_instructions) setP2pInstructions(data.p2p_instructions);
      })
      .catch(() => { /* API not available — assume normal mode */ });
    return () => { cancelled = true; };
  }, [isOpen]);

  const reset = () => {
    paymentElement?.unmount();
    setStep('amount');
    setAmountUsd('');
    setEstimatedHsmc(0);
    setSessionId('');
    setPaymentIntentId('');
    setClientSecret('');
    setStripe(null);
    setElements(null);
    setPaymentElement(null);
    setResult(null);
    setFailure('');
    setSellDepositAddress('');
    setSellTxHash('');
    setSellFee(0);
    setSellFeeTier('');
    setSellPayoutSessionId('');
    setSellAmountRequired(0);
  };

  const initiate = async () => {
    if (!user || !canContinue) return;
    setLoading(true);
    setFailure('');
    try {
      if (mode === 'sell') {
        // ── SELL FLOW: call /stripe/payout ──────────────────────────
        const res = await fetch('/stripe/payout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'initiate', amount_usd: Number(amountUsd), user_wallet: user.id || 'local-user' }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (!data.payout_session_id || !data.deposit_address) {
          throw new Error('Payout initiation returned incomplete data.');
        }

        setSellPayoutSessionId(data.payout_session_id);
        setSellDepositAddress(data.deposit_address);
        setSellAmountRequired(data.amount_hsmc_required);
        setSellFee(data.fee_hsmc);
        setSellFeeTier(data.fee_tier);
        setEstimatedHsmc(data.amount_hsmc_required);
        setStep('deposit');
        return;
      }

      // ── BUY FLOW: check kill-switch ────────────────────────────────
      if (killSwitchActive) {
        // P2P mode — skip Stripe entirely
        setStep('p2p');
        return;
      }

      // ── BUY FLOW: original Stripe checkout ───────────────────────
      // Try local API server
      let data: Record<string, unknown> | null = null;
      let errorMsg: string | null = null;

      const { data: fnData, error: fnError } = await supabase.functions.invoke('hsmcpay-checkout', {
        body: { action: 'initiate', mode, amount_usd: Number(amountUsd) },
      });

      if (!fnError && fnData && !fnData.error) {
        data = fnData as Record<string, unknown>;
      } else {
        // Fallback to local API server
        console.debug('[HSMCPay] Edge function unavailable, falling back to local API');
        const res = await fetch('/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'initiate', mode, amount_usd: Number(amountUsd) }),
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          errorMsg = json.error || `HTTP ${res.status}`;
        } else {
          data = json;
        }
      }

      if (errorMsg) throw new Error(errorMsg || 'Payment initiation failed');
      if (!data) throw new Error('No response from payment service');

      if (data.error) throw new Error(String(data.error));
      if (!data.stripe_publishable_key || !data.client_secret || !data.payment_intent_id) {
        throw new Error('HSMCPay did not return Stripe confirmation details.');
      }

      await loadStripeJs();
      const stripeClient = window.Stripe?.(data.stripe_publishable_key);
      if (!stripeClient) throw new Error('Stripe.js unavailable.');

      const stripeElements = stripeClient.elements({ clientSecret: data.client_secret, appearance: { theme: 'night' } });
      const element = stripeElements.create('payment', { layout: 'tabs' });

      setStripe(stripeClient);
      setElements(stripeElements);
      setPaymentElement(element);
      setSessionId(data.session_id);
      setPaymentIntentId(data.payment_intent_id);
      setClientSecret(data.client_secret);
      setEstimatedHsmc(Number(data.amount_hsmc));
      setStep('stripe');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFailure(msg);
      setStep('failed');
      toast({ title: 'Payment unavailable', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const confirmAndSettle = async () => {
    if (!stripe || !elements || !clientSecret || !sessionId || !paymentIntentId) return;
    setLoading(true);
    setStep('processing');
    try {
      const confirmation = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: { return_url: `${window.location.origin}/app` },
        redirect: 'if_required',
      });
      if (confirmation.error) throw new Error(confirmation.error.message || 'Stripe confirmation failed');
      if (confirmation.paymentIntent?.status !== 'succeeded') {
        throw new Error(`Stripe payment is ${confirmation.paymentIntent?.status ?? 'not complete'}.`);
      }

      // Try local API server
      let settleData: Record<string, unknown> | null = null;
      let settleError: string | null = null;

      const { data: fnData, error: fnError } = await supabase.functions.invoke('hsmcpay-checkout', {
        body: { action: 'settle', session_id: sessionId, payment_intent_id: paymentIntentId },
      });

      if (!fnError && fnData && !fnData.error) {
        settleData = fnData as Record<string, unknown>;
      } else {
        console.debug('[HSMCPay] Edge function unavailable for settle, falling back to local API');
        const res = await fetch('/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'settle', session_id: sessionId, payment_intent_id: paymentIntentId }),
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          settleError = json.error || `HTTP ${res.status}`;
        } else {
          settleData = json;
        }
      }

      if (settleError) throw new Error(settleError);
      if (!settleData) throw new Error('No response from settlement service');
      if (settleData.error) throw new Error(String(settleData.error));

      setResult({ txHash: settleData.tx_hash as string, amountHsmc: settleData.amount_hsmc as string, paymentId: settleData.payment_id as string });
      setStep('success');
      setTimeout(() => window.dispatchEvent(new CustomEvent('hsmc-wallet-refresh')), 800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFailure(msg);
      setStep('failed');
      toast({ title: 'Payment failed', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const settleSell = async () => {
    if (!sellPayoutSessionId || !sellTxHash.trim()) return;
    setLoading(true);
    setStep('processing');
    try {
      const res = await fetch('/stripe/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'settle', payout_session_id: sellPayoutSessionId, tx_hash: sellTxHash.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setResult({
        txHash: data.tx_hash as string,
        amountHsmc: sellAmountRequired.toFixed(6),
        paymentId: sellPayoutSessionId,
      });
      setStep('success');
      setTimeout(() => window.dispatchEvent(new CustomEvent('hsmc-wallet-refresh')), 800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFailure(msg);
      setStep('failed');
      toast({ title: 'Sell settlement failed', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        >
          <div className="bg-gradient-to-r from-primary/20 to-secondary/20 border-b border-border p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/30">
                  <ShieldCheck className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <div className="font-bold text-lg tracking-tight">HSMCPay — {mode === 'sell' ? 'Sell HSMC' : 'Buy HSMC'}</div>
                  <div className="text-xs text-muted-foreground">HSMCPay → Stripe → bank rails</div>
                </div>
              </div>
              <button onClick={() => { reset(); onClose(); }} className="p-2 hover:bg-muted rounded-lg transition-colors" aria-label="Close HSMCPay">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <div className="p-6">
            {step === 'amount' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="text-center mb-4">
                  <p className="text-sm text-muted-foreground">HSMC Price</p>
                  <p className="text-2xl font-bold gradient-text">${hsmcPrice.toFixed(4)} USD</p>
                </div>

                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">Amount in USD</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                    <Input
                      type="number"
                      placeholder="10.00"
                      value={amountUsd}
                      onChange={(e) => setAmountUsd(e.target.value)}
                      className="pl-7 text-lg font-mono"
                      min="1"
                      step="0.01"
                    />
                  </div>
                </div>

                {estimatedHsmc > 0 && (
                  <div className="p-3 bg-muted/30 rounded-xl border border-border text-center">
                    <p className="text-xs text-muted-foreground mb-1">{mode === 'sell' ? 'You will send' : 'You will receive'}</p>
                    <p className="text-xl font-bold gradient-text">{estimatedHsmc.toFixed(4)} HSMC</p>
                    {mode === 'sell' && sellFee > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">Fee: {sellFee.toFixed(4)} HSMC ({sellFeeTier})</p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {[10, 25, 50, 100, 250].map((amt) => (
                    <button key={amt} onClick={() => setAmountUsd(amt.toString())} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:border-primary/50 hover:bg-muted/30 transition-all">
                      ${amt}
                    </button>
                  ))}
                </div>

                <Button variant="hero" className="w-full" disabled={!canContinue || loading} onClick={initiate}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                  Continue{mode === 'sell' ? ' — Sell HSMC' : ' to Stripe 3D Secure'}
                </Button>
              </motion.div>
            )}

            {/* ── SELL: Deposit step — user sends HSMC to treasury ── */}
            {step === 'deposit' && mode === 'sell' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="text-center">
                  <h3 className="font-semibold text-lg">Send HSMC to Treasury</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Send exactly <span className="font-bold text-foreground">{sellAmountRequired.toFixed(4)} HSMC</span> to the address below
                  </p>
                </div>

                {/* Fee breakdown */}
                <div className="p-3 bg-muted/20 rounded-xl border border-border space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HSMC to send</span>
                    <span className="font-mono font-bold">{sellAmountRequired.toFixed(4)} HSMC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HSMC Fee</span>
                    <span className="font-mono text-destructive">{sellFee.toFixed(4)} HSMC</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2">
                    <span className="text-muted-foreground">Fee Tier</span>
                    <span className="font-mono text-secondary">{sellFeeTier}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">You receive (fiat)</span>
                    <span className="font-mono font-bold text-secondary">${amountUsd} USD</span>
                  </div>
                </div>

                {/* Deposit address */}
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Deposit Address</label>
                  <div className="p-3 bg-muted/30 rounded-xl border border-border break-all font-mono text-xs">
                    {sellDepositAddress}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(sellDepositAddress); toast({ title: 'Copied!', description: 'Deposit address copied to clipboard' }); }}
                    className="w-full py-2 text-xs border border-border rounded-lg hover:border-primary/50 hover:bg-muted/30 transition-all"
                  >
                    Copy Address
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                  <span>Send only HSMC to this address. Transactions are irreversible. Once sent, click "I Have Sent HSMC" below.</span>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep('amount')} className="flex-1">Back</Button>
                  <Button variant="hero" onClick={() => setStep('sell-confirm')} className="flex-1">
                    I Have Sent HSMC <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── SELL: Confirm tx hash step ── */}
            {step === 'sell-confirm' && mode === 'sell' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="text-center">
                  <h3 className="font-semibold text-lg">Confirm Transaction</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Paste the transaction hash (tx hash) from your wallet after sending {sellAmountRequired.toFixed(4)} HSMC
                  </p>
                </div>

                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">Transaction Hash</label>
                  <Input
                    type="text"
                    placeholder="0x..."
                    value={sellTxHash}
                    onChange={(e) => setSellTxHash(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 bg-muted/20 rounded-lg">
                  <Lock className="w-3 h-3" />
                  <span>The tx hash is used to verify your HSMC transfer and initiate the fiat payout.</span>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep('deposit')} className="flex-1">Back</Button>
                  <Button
                    variant="hero"
                    onClick={settleSell}
                    disabled={loading || !sellTxHash.trim().startsWith('0x')}
                    className="flex-1"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                    Confirm & Settle
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── P2P Mode: Kill-switch active, show wallet address + QR ── */}
            {step === 'p2p' && mode === 'buy' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="text-center">
                  <div className="w-14 h-14 mx-auto rounded-full bg-destructive/20 flex items-center justify-center mb-3">
                    <AlertTriangle className="w-7 h-7 text-destructive" />
                  </div>
                  <h3 className="font-semibold text-lg">P2P Mode Active</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Card payments are disabled. Send HSMC directly to the treasury address.
                  </p>
                </div>

                {/* QR Code */}
                <div className="flex justify-center">
                  <div className="p-4 bg-white rounded-xl border-2 border-destructive/30">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(p2pWalletAddress)}`}
                      alt="P2P Wallet QR Code"
                      className="w-48 h-48"
                    />
                  </div>
                </div>

                {/* Wallet Address */}
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Wallet className="w-4 h-4" />
                    Send {estimatedHsmc > 0 ? estimatedHsmc.toFixed(4) : '...'} HSMC to:
                  </label>
                  <div className="p-3 bg-muted/30 rounded-xl border border-border break-all font-mono text-xs select-all">
                    {p2pWalletAddress}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      navigator.clipboard.writeText(p2pWalletAddress);
                      toast({ title: 'Copied!', description: 'Wallet address copied to clipboard' });
                    }}
                  >
                    <Copy className="w-4 h-4 mr-2" /> Copy Address
                  </Button>
                </div>

                {/* Instructions */}
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2 text-xs text-muted-foreground">
                  <p className="flex items-center gap-2 font-medium text-amber-400">
                    <QrCode className="w-3 h-3" /> Instructions:
                  </p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Scan the QR code with your HSMC wallet app</li>
                    <li>Or copy the address and send {estimatedHsmc > 0 ? estimatedHsmc.toFixed(4) : ''} HSMC manually</li>
                    <li>Include your User ID in the transaction memo: <span className="font-mono text-foreground">{user?.id || 'N/A'}</span></li>
                    <li>Transaction will be credited within 10-30 minutes after confirmation</li>
                  </ol>
                  {p2pInstructions && (
                    <p className="text-destructive-foreground bg-destructive/10 p-2 rounded mt-2">{p2pInstructions}</p>
                  )}
                </div>

                {/* Amount summary */}
                <div className="p-3 bg-muted/20 rounded-xl border border-border space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount (USD)</span>
                    <span className="font-mono font-bold">${amountUsd}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HSMC to send</span>
                    <span className="font-mono font-bold gradient-text">{estimatedHsmc.toFixed(4)} HSMC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fee</span>
                    <span className="font-mono text-secondary">$0.00 (P2P mode)</span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep('amount')} className="flex-1">Back</Button>
                  <Button variant="hero" className="flex-1" onClick={() => { reset(); onClose(); }}>
                    <Check className="w-4 h-4 mr-2" /> Done
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 'stripe' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold">Secure card confirmation</h3>
                </div>
                <div id="hsmcpay-payment-element" className="min-h-[180px] rounded-xl border border-border bg-background p-3" />
                <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 bg-muted/20 rounded-lg">
                  <Lock className="w-3 h-3" />
                  <span>Card number and CVV are handled only by Stripe Elements, not by HSMCPay or this app.</span>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep('amount')} className="flex-1">Back</Button>
                  <Button variant="hero" onClick={confirmAndSettle} disabled={loading} className="flex-1">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Confirm
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 'processing' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8 space-y-4">
                <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
                <h3 className="font-semibold">
                  {mode === 'sell' ? 'Processing payout...' : 'Settling through HSMCPay...'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {mode === 'sell'
                    ? 'Verifying your HSMC transfer and preparing fiat payout to your card.'
                    : 'Verifying Stripe settlement, then updating your wallet through the HSMCPay processor path.'}
                </p>
              </motion.div>
            )}

            {step === 'success' && result && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-5">
                <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-secondary/30 to-primary/30 flex items-center justify-center border-2 border-secondary/30">
                  <Check className="w-10 h-10 text-secondary" />
                </div>
                <div>
                  <h3 className="font-bold text-xl">{mode === 'sell' ? 'Sale Initiated' : 'Purchase Complete'}</h3>
                  <p className="text-3xl font-bold gradient-text mt-2">{result.amountHsmc} HSMC</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {mode === 'sell'
                      ? `${amountUsd} USD payout — estimated 2-5 business days to your card`
                      : 'credited after real Stripe settlement'}
                  </p>
                </div>
                <div className="text-left space-y-2 p-4 bg-muted/20 rounded-xl text-xs">
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">{mode === 'sell' ? 'Payout ID' : 'Payment ID'}</span><span className="font-mono truncate">{result.paymentId}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Tx Ref</span><span className="font-mono truncate">{result.txHash}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="text-secondary font-semibold">{mode === 'sell' ? 'Processing' : 'Confirmed'}</span></div>
                </div>
                <Button variant="hero" className="w-full" onClick={() => { reset(); onClose(); }}>Done</Button>
              </motion.div>
            )}

            {step === 'failed' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-5">
                <div className="w-20 h-20 mx-auto rounded-full bg-destructive/20 flex items-center justify-center">
                  <AlertTriangle className="w-10 h-10 text-destructive" />
                </div>
                <h3 className="font-bold text-xl">Payment Not Completed</h3>
                <p className="text-sm text-muted-foreground break-words">{failure || 'Your payment could not be processed. No simulated charge was created.'}</p>
                <Button variant="hero" className="w-full" onClick={reset}>Try Again</Button>
              </motion.div>
            )}
          </div>

          <div className="border-t border-border px-5 py-3 flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> HSMCPay</div>
            <div className="flex items-center gap-1"><Lock className="w-3 h-3" /> Stripe Elements</div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default HSMCPay;