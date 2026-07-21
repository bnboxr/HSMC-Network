import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
  Store, Plus, Copy, Check, Link2, Trash2, ArrowDownLeft,
  Loader2, LogIn, RefreshCw, ExternalLink, QrCode, BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { toast } from '@/hooks/use-toast';
import { MerchantAnalytics } from '@/components/MerchantAnalytics';

interface PaymentLink {
  id: string;
  wallet_address: string;
  amount: number | null;
  token: string;
  description: string | null;
  slug: string;
  active: boolean;
  created_at: string;
  total_received: number;
  payments_count: number;
}

interface ReceivedTx {
  id: string;
  hash: string;
  from_address: string;
  amount: number;
  status: string;
  created_at: string;
  privacy_level: string | null;
}

export const MerchantPanel = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const [activeTab, setActiveTab] = useState<'payments' | 'analytics'>('payments');

  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [receivedTxs, setReceivedTxs] = useState<ReceivedTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newDescription, setNewDescription] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newToken, setNewToken] = useState('HSMC');
  const [selectedLink, setSelectedLink] = useState<PaymentLink | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('payment_links')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setLinks(data as PaymentLink[]);
  }, [user]);

  const fetchReceivedTxs = useCallback(async () => {
    if (!wallet) return;
    const { data } = await supabase
      .from('transactions')
      .select('id, hash, from_address, amount, status, created_at, privacy_level')
      .eq('to_address', wallet.address)
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setReceivedTxs(data as ReceivedTx[]);
    setLoading(false);
  }, [wallet]);

  useEffect(() => {
    if (!user || !wallet) { setLoading(false); return; }
    fetchLinks();
    fetchReceivedTxs();

    // Realtime subscription for incoming transactions
    const channel = supabase
      .channel('merchant-incoming')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'transactions',
        filter: `to_address=eq.${wallet.address}`,
      }, (payload) => {
        const tx = payload.new as ReceivedTx;
        setReceivedTxs(prev => [tx, ...prev.slice(0, 19)]);
        toast({
          title: '💸 Payment Received!',
          description: `${tx.amount.toFixed(4)} HSMC from ${tx.from_address.slice(0, 10)}...`,
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, wallet, fetchLinks, fetchReceivedTxs]);

  const createLink = async () => {
    if (!user || !wallet) return;
    setCreating(true);
    try {
      const { error } = await supabase.from('payment_links').insert({
        user_id: user.id,
        wallet_address: wallet.address,
        amount: newAmount ? parseFloat(newAmount) : null,
        token: newToken,
        description: newDescription || null,
      });
      if (error) throw error;
      toast({ title: '✅ Payment link created' });
      setNewDescription('');
      setNewAmount('');
      setShowCreate(false);
      fetchLinks();
    } catch (err: unknown) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const deleteLink = async (id: string) => {
    await supabase.from('payment_links').delete().eq('id', id);
    setLinks(prev => prev.filter(l => l.id !== id));
    if (selectedLink?.id === id) setSelectedLink(null);
    toast({ title: 'Link deleted' });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const getPaymentUrl = (link: PaymentLink) => {
    const base = window.location.origin;
    const params = new URLSearchParams({ to: link.wallet_address, token: link.token });
    if (link.amount) params.set('amount', link.amount.toString());
    if (link.description) params.set('desc', link.description);
    return `${base}/pay/${link.slug}?${params.toString()}`;
  };

  const getQrValue = (link: PaymentLink) => {
    // HSMC URI format
    return `hsmc:${link.wallet_address}?amount=${link.amount || ''}&token=${link.token}&desc=${encodeURIComponent(link.description || '')}`;
  };

  const formatAddress = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`;

  if (!user) {
    return (
      <section id="merchant" className="py-20 gradient-mesh">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              <span className="gradient-text">HSMCPay</span> Merchant
            </h2>
          </div>
          <div className="max-w-md mx-auto text-center py-16 bg-card/50 rounded-xl border border-border">
            <LogIn className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-xl font-semibold mb-2">Sign in to use Merchant Panel</h3>
            <p className="text-muted-foreground">Create payment links and receive HSMC</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="merchant" className="py-20 gradient-mesh">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            <span className="gradient-text">HSMCPay</span> Merchant
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Generate payment QR codes and shareable links. Receive HSMC in real-time.
          </p>
        </motion.div>

        {/* Tab switcher */}
        <div className="max-w-5xl mx-auto mb-6">
          <div className="flex rounded-xl border border-border bg-muted/20 p-1 w-fit">
            {([
              { id: 'payments', label: 'Payments', icon: Store },
              { id: 'analytics', label: 'Analytics', icon: BarChart3 },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  activeTab === id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'analytics' ? (
          <div className="max-w-5xl mx-auto">
            <MerchantAnalytics />
          </div>
        ) : (
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Payment Links */}
          <div className="space-y-4">
            {/* Create New Link */}
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold flex items-center gap-2">
                  <Store className="w-5 h-5 text-primary" /> Payment Links
                </h3>
                <Button
                  variant="hero"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowCreate(!showCreate)}
                >
                  <Plus className="w-4 h-4" /> New Link
                </Button>
              </div>

              {showCreate && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mb-4 p-4 bg-muted/30 rounded-xl border border-border space-y-3"
                >
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Description (optional)</label>
                    <Input
                      placeholder="e.g. Coffee payment, Invoice #123"
                      value={newDescription}
                      onChange={e => setNewDescription(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Amount (optional)</label>
                      <Input
                        type="number"
                        placeholder="Leave empty for any"
                        value={newAmount}
                        onChange={e => setNewAmount(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Token</label>
                      <select
                        value={newToken}
                        onChange={e => setNewToken(e.target.value)}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                      >
                        {['HSMC', 'wHSMC', 'HSMC-EUR', 'HSMC-USD'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
                    <Button variant="hero" size="sm" className="flex-1" onClick={createLink} disabled={creating}>
                      {creating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Create
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Links List */}
              <div className="space-y-2">
                {links.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-6">
                    No payment links yet. Create your first one!
                  </p>
                ) : (
                  links.map(link => {
                    const url = getPaymentUrl(link);
                    return (
                      <div
                        key={link.id}
                        onClick={() => setSelectedLink(selectedLink?.id === link.id ? null : link)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          selectedLink?.id === link.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40 bg-muted/20'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <QrCode className="w-4 h-4 text-primary flex-shrink-0" />
                              <span className="text-sm font-medium truncate">
                                {link.description || `Payment Link`}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {link.amount ? (
                                <span className="text-secondary font-mono">{link.amount} {link.token}</span>
                              ) : (
                                <span>Any amount · {link.token}</span>
                              )}
                              <span>·</span>
                              <span>{link.payments_count} payments</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={e => { e.stopPropagation(); copyToClipboard(url, link.id + '-url'); }}
                              className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                              title="Copy link"
                            >
                              {copied === link.id + '-url' ? <Check className="w-3.5 h-3.5 text-secondary" /> : <Link2 className="w-3.5 h-3.5 text-muted-foreground" />}
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); window.open(url, '_blank'); }}
                              className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                              title="Open link"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); deleteLink(link.id); }}
                              className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-lg transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>

            {/* Wallet QR — always visible */}
            {wallet && (
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel text-center">
                <h4 className="font-semibold mb-4 flex items-center justify-center gap-2">
                  <QrCode className="w-4 h-4 text-primary" /> Wallet QR Code
                </h4>
                <div className="w-48 h-48 mx-auto mb-4 bg-white p-3 rounded-xl shadow-lg">
                  <QRCodeSVG
                    value={`hsmc:${wallet.address}`}
                    size={168}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="H"
                    includeMargin={false}
                  />
                </div>
                <p className="text-xs text-muted-foreground font-mono mb-3 break-all px-2">{wallet.address}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => copyToClipboard(wallet.address, 'wallet-addr')}
                >
                  {copied === 'wallet-addr' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  Copy Address
                </Button>
              </motion.div>
            )}
          </div>

          {/* Right: QR Preview + Received Transactions */}
          <div className="space-y-4">
            {/* Selected Link QR */}
            {selectedLink && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-panel text-center"
              >
                <h4 className="font-semibold mb-1">Payment QR Code</h4>
                <p className="text-xs text-muted-foreground mb-4">
                  {selectedLink.description || 'Scan to pay'}
                  {selectedLink.amount ? ` · ${selectedLink.amount} ${selectedLink.token}` : ''}
                </p>
                <div className="w-56 h-56 mx-auto mb-4 bg-white p-3 rounded-xl shadow-lg">
                  <QRCodeSVG
                    value={getQrValue(selectedLink)}
                    size={200}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="H"
                    includeMargin={false}
                  />
                </div>
                <div className="text-xs font-mono text-muted-foreground break-all bg-muted/30 p-3 rounded-lg mb-3 text-left">
                  {getPaymentUrl(selectedLink)}
                </div>
                <Button
                  variant="glass"
                  size="sm"
                  className="gap-2 w-full"
                  onClick={() => copyToClipboard(getPaymentUrl(selectedLink), selectedLink.id + '-qr')}
                >
                  {copied === selectedLink.id + '-qr' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  Copy Payment Link
                </Button>
              </motion.div>
            )}

            {/* Received Transactions */}
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold flex items-center gap-2">
                  <ArrowDownLeft className="w-4 h-4 text-secondary" /> Received Payments
                </h4>
                <button onClick={fetchReceivedTxs} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                  <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : receivedTxs.length === 0 ? (
                <div className="text-center py-8">
                  <ArrowDownLeft className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No payments received yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Share your QR code or payment link to receive HSMC</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {receivedTxs.map(tx => (
                    <div key={tx.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          tx.status === 'confirmed' ? 'bg-secondary/20' : 'bg-amber-500/20'
                        }`}>
                          <ArrowDownLeft className={`w-4 h-4 ${tx.status === 'confirmed' ? 'text-secondary' : 'text-amber-500'}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-mono text-muted-foreground truncate">
                            from {formatAddress(tx.from_address)}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                              tx.status === 'confirmed'
                                ? 'bg-secondary/10 text-secondary'
                                : 'bg-amber-500/10 text-amber-500'
                            }`}>
                              {tx.status}
                            </span>
                            {tx.privacy_level && tx.privacy_level !== 'standard' && (
                              <span className="text-xs text-primary">🔒 {tx.privacy_level}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-mono font-bold text-secondary text-sm">
                          +{tx.amount.toFixed(4)} HSMC
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(tx.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        </div>
        )}
      </div>
    </section>
  );
};

export default MerchantPanel;
