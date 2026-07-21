/**
 * Public Payment Page — /pay/:slug
 * Anyone with the link can pay via HSMC — no account required to view
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity, QrCode, Copy, Check, Loader2, AlertTriangle,
  Wallet, CheckCircle2, ExternalLink, ArrowLeft, Shield
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/db/client';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface PaymentLink {
  id: string;
  slug: string;
  description: string | null;
  amount: number | null;
  token: string;
  wallet_address: string;
  active: boolean;
  payments_count: number;
  total_received: number;
}

export const PayPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [link, setLink] = useState<PaymentLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [txHash, setTxHash] = useState('');

  useEffect(() => {
    const fetchLink = async () => {
      if (!slug) { setNotFound(true); setLoading(false); return; }
      const { data, error } = await supabase
        .from('payment_links')
        .select('*')
        .eq('slug', slug)
        .eq('active', true)
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
      } else {
        setLink(data as PaymentLink);
        if (data.amount) setPayAmount(String(data.amount));
      }
      setLoading(false);
    };
    fetchLink();
  }, [slug]);

  const handleCopy = () => {
    navigator.clipboard.writeText(link?.wallet_address ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePay = async () => {
    if (!link) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Invalid amount', description: 'Enter a valid payment amount', variant: 'destructive' });
      return;
    }
    if (!user) {
      toast({ title: 'Login required', description: 'You need to be logged in to send HSMC payments', variant: 'destructive' });
      navigate(`/onboarding?redirect=/pay/${slug}`);
      return;
    }

    setPaying(true);
    try {
      // Get sender's primary wallet
      const { data: senderWallet } = await supabase
        .from('wallets')
        .select('id, balance, address')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!senderWallet) throw new Error('No wallet found. Please set up your wallet first.');
      if (senderWallet.balance < amount) throw new Error(`Insufficient balance. You have ${senderWallet.balance} HSMC.`);

      // Check recipient wallet
      const { data: recipientWallet } = await supabase
        .from('wallets')
        .select('id, balance')
        .eq('address', link.wallet_address)
        .maybeSingle();

      const hash = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      // Insert transaction
      await supabase.from('transactions').insert({
        hash,
        from_address: senderWallet.address,
        to_address: link.wallet_address,
        amount,
        fee: 0,
        status: 'confirmed',
        privacy_level: 'standard',
        confirmed_at: new Date().toISOString(),
      });

      // Deduct from sender
      await supabase.from('wallets')
        .update({ balance: senderWallet.balance - amount })
        .eq('id', senderWallet.id);

      // Credit recipient if wallet exists in DB
      if (recipientWallet) {
        await supabase.from('wallets')
          .update({ balance: recipientWallet.balance + amount })
          .eq('id', recipientWallet.id);
      }

      // Update payment link counters
      await supabase.from('payment_links')
        .update({
          payments_count: (link.payments_count ?? 0) + 1,
          total_received: (link.total_received ?? 0) + amount,
        })
        .eq('id', link.id);

      setTxHash(hash);
      setPaid(true);
      toast({ title: '✅ Payment sent!', description: `${amount} ${link.token} sent successfully` });
    } catch (err: unknown) {
      toast({ title: 'Payment failed', description: String(err), variant: 'destructive' });
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !link) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4 opacity-60" />
        <h1 className="text-2xl font-bold mb-2">Payment Link Not Found</h1>
        <p className="text-muted-foreground mb-6">This payment link doesn't exist or has been deactivated.</p>
        <Button variant="hero" asChild>
          <a href="/">Go to HSMC</a>
        </Button>
      </div>
    );
  }

  const qrData = `hsmc:${link.wallet_address}?amount=${payAmount || link.amount || ''}&token=${link.token}`;
  const shortAddr = `${link.wallet_address.slice(0, 10)}...${link.wallet_address.slice(-8)}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Bg */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, hsl(var(--primary) / 0.08), transparent)' }} />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/40 backdrop-blur-sm">
        <a href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold gradient-text text-sm">HSMC</span>
        </a>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="w-3.5 h-3.5" />
          <span>Secure Payment</span>
        </div>
      </nav>

      <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-65px)] p-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-lg"
        >
          {!paid ? (
            <div className="glass-panel space-y-6">
              {/* Header */}
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/30">
                  <QrCode className="w-7 h-7 text-primary-foreground" />
                </div>
                <h1 className="text-xl font-black mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
                  {link.description || 'HSMC Payment Request'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Send {link.token} to this address
                </p>
              </div>

              {/* QR Code */}
              <div className="flex justify-center">
                <div className="p-4 bg-white rounded-2xl shadow-lg">
                  <QRCodeSVG
                    value={qrData}
                    size={200}
                    level="H"
                    fgColor="#050814"
                    bgColor="#ffffff"
                    includeMargin={false}
                  />
                </div>
              </div>

              {/* Amount */}
              {link.amount ? (
                <div className="text-center p-4 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="text-3xl font-black gradient-text" style={{ fontFamily: 'var(--font-serif)' }}>
                    {link.amount} <span className="text-lg font-bold">{link.token}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Fixed amount</p>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Amount ({link.token})</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    min="0"
                    step="0.0001"
                    className="font-mono text-lg text-center h-12"
                  />
                </div>
              )}

              {/* Address */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Recipient Address</label>
                <div className="flex items-center gap-2 p-3 bg-muted/30 border border-border rounded-xl">
                  <Wallet className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs flex-1 truncate">{link.wallet_address}</span>
                  <button onClick={handleCopy} className="shrink-0 p-1 hover:bg-muted rounded-lg transition-colors">
                    {copied ? <Check className="w-4 h-4 text-secondary" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                  <div className="text-lg font-bold font-mono">{link.payments_count}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Payments</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                  <div className="text-lg font-bold font-mono">{link.total_received.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Received ({link.token})</div>
                </div>
              </div>

              {/* Pay button */}
              {user ? (
                <Button
                  variant="hero"
                  className="w-full h-12 text-base"
                  onClick={handlePay}
                  disabled={paying || !payAmount || parseFloat(payAmount) <= 0}
                >
                  {paying ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Processing...</>
                  ) : (
                    <><Wallet className="w-4 h-4" />Pay {payAmount || '?'} {link.token}</>
                  )}
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-muted/30 border border-border text-xs text-center text-muted-foreground">
                    You can also pay manually by copying the address above and sending from any compatible wallet.
                  </div>
                  <Button variant="hero" className="w-full" asChild>
                    <a href={`/onboarding?redirect=/pay/${slug}`}>
                      <Wallet className="w-4 h-4" />Sign In to Pay with HSMC
                    </a>
                  </Button>
                </div>
              )}

              <p className="text-center text-[10px] text-muted-foreground/50 font-mono">
                Powered by HSMC Network · Zero-fee internal transfers
              </p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-panel text-center space-y-6"
            >
              <div className="w-20 h-20 mx-auto rounded-full bg-secondary/15 border-2 border-secondary/40 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-secondary" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-secondary mb-2">Payment Sent!</h2>
                <p className="text-muted-foreground text-sm">
                  <strong className="text-foreground">{payAmount} {link.token}</strong> sent successfully
                </p>
              </div>

              <div className="p-3 bg-muted/20 rounded-xl border border-border text-left">
                <p className="text-[10px] text-muted-foreground mb-1 font-mono uppercase">Transaction Hash</p>
                <p className="font-mono text-xs break-all text-foreground">{txHash}</p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" asChild>
                  <a href="/">
                    <ArrowLeft className="w-4 h-4" />Home
                  </a>
                </Button>
                <Button variant="hero" className="flex-1" asChild>
                  <a href="/app">
                    <ExternalLink className="w-4 h-4" />Dashboard
                  </a>
                </Button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default PayPage;
