import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, Plus, Snowflake, Flame, Trash2, DollarSign,
  AlertTriangle, Loader2, SlidersHorizontal, ArrowUpRight, History
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

const API_BASE = 'http://localhost:3001';

interface CardData {
  id: string;
  stripe_card_id: string;
  last4: string;
  brand: string;
  card_type: 'virtual' | 'physical';
  status: 'active' | 'inactive' | 'frozen' | 'cancelled' | 'shipped' | 'pending';
  daily_limit_usd: number;
  monthly_limit_usd: number;
  per_tx_limit_usd: number;
  card_balance_usd: number;
  expiration_month: number;
  expiration_year: number;
  created_at: string;
  activated_at: string | null;
}

interface CardTransaction {
  id: string;
  stripe_tx_id: string;
  card_id: string;
  amount_cents: number;
  merchant_name: string;
  merchant_category?: string;
  tx_type: string;
  status: string;
  created_at: string;
}

type ViewState = 'dashboard' | 'create' | 'fund';

function getBrandColor(brand: string): string {
  const b = brand?.toLowerCase() || '';
  if (b === 'visa') return 'from-blue-600 to-blue-800';
  if (b === 'mastercard') return 'from-red-500 to-orange-600';
  return 'from-gray-700 to-gray-900';
}

function getBrandLogo(brand: string): string {
  const b = brand?.toLowerCase() || '';
  if (b === 'visa') return 'VISA';
  if (b === 'mastercard') return 'MC';
  return '•••';
}

function maskCardNumber(last4: string): string {
  return `•••• •••• •••• ${last4}`;
}

export function CardManager() {
  const [view, setView] = useState<ViewState>('dashboard');
  const [cards, setCards] = useState<CardData[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [transactions, setTransactions] = useState<CardTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [amountHsmc, setAmountHsmc] = useState('');
  const [hsmcPrice, setHsmcPrice] = useState(1);

  // New card form state
  const [cardType, setCardType] = useState<'virtual' | 'physical'>('virtual');
  const [dailyLimit, setDailyLimit] = useState(1000);
  const [monthlyLimit, setMonthlyLimit] = useState(10000);
  const [perTxLimit, setPerTxLimit] = useState(500);

  const getToken = () => localStorage.getItem('hsme_jwt') || '';

  const apiCall = async (path: string, method = 'GET', body?: unknown) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
      'User-Agent': 'HSMC-CardManager/1.0',
    };
    const opts: RequestInit = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_BASE}${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
    return data;
  };

  const loadCards = async () => {
    setLoading(true);
    try {
      const data = await apiCall('/cards/list');
      setCards(data);
    } catch (err: unknown) {
      toast({ title: 'Failed to load cards', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async (cardId: string) => {
    try {
      const data = await apiCall(
        `/rest/v1/card_transactions?select=*&card_id=eq.${cardId}&order=created_at.desc&limit=20`
      );
      setTransactions(data);
    } catch { /* transactions may not exist yet */ }
  };

  const loadHsmcPrice = async () => {
    try {
      const data = await apiCall(
        '/rest/v1/token_metrics?select=price&order=updated_at.desc&limit=1'
      );
      setHsmcPrice(data?.[0]?.price || 1);
    } catch { /* use default */ }
  };

  useEffect(() => { loadCards(); loadHsmcPrice(); }, []);

  const handleCreateCard = async () => {
    setLoading(true);
    try {
      await apiCall('/cards/create', 'POST', {
        card_type: cardType, daily_limit_usd: dailyLimit,
        monthly_limit_usd: monthlyLimit, per_tx_limit_usd: perTxLimit,
      });
      toast({ title: 'Card created successfully!' });
      setView('dashboard'); loadCards();
    } catch (err: unknown) {
      toast({ title: 'Card creation failed', description: (err as Error).message, variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const handleFreeze = async (cardId: string) => {
    try { await apiCall(`/cards/${cardId}/freeze`, 'POST'); toast({ title: 'Card frozen' }); loadCards(); }
    catch (err: unknown) { toast({ title: 'Failed', description: (err as Error).message, variant: 'destructive' }); }
  };

  const handleUnfreeze = async (cardId: string) => {
    try { await apiCall(`/cards/${cardId}/unfreeze`, 'POST'); toast({ title: 'Card unfrozen' }); loadCards(); }
    catch (err: unknown) { toast({ title: 'Failed', description: (err as Error).message, variant: 'destructive' }); }
  };

  const handleCancel = async (cardId: string) => {
    if (!confirm('Cancel this card permanently? This cannot be undone.')) return;
    try { await apiCall(`/cards/${cardId}/cancel`, 'POST'); toast({ title: 'Card cancelled' }); setSelectedCard(null); loadCards(); }
    catch (err: unknown) { toast({ title: 'Failed', description: (err as Error).message, variant: 'destructive' }); }
  };

  const handleFund = async () => {
    if (!selectedCard || !amountHsmc) return;
    setLoading(true);
    try {
      const result = await apiCall(`/cards/${selectedCard.id}/fund`, 'POST', { amount_hsmc: parseFloat(amountHsmc) });
      toast({ title: `Funded $${result.amount_usd.toFixed(2)}` });
      setAmountHsmc(''); setView('dashboard'); loadCards();
    } catch (err: unknown) {
      toast({ title: 'Funding failed', description: (err as Error).message, variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const selectCard = (card: CardData) => {
    setSelectedCard(card); setFlipped(false); loadTransactions(card.id);
  };

  // ── Render: Dashboard ─────────────────────────────────────────────
  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Your Cards</h2>
        <Button onClick={() => setView('create')} className="bg-purple-600 hover:bg-purple-700">
          <Plus className="w-4 h-4 mr-2" /> Order Card
        </Button>
      </div>

      {loading && cards.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Loading cards...
        </div>
      )}

      {!loading && cards.length === 0 && (
        <div className="text-center py-12 bg-gray-800/50 rounded-xl border border-gray-700">
          <CreditCard className="w-12 h-12 mx-auto text-gray-500 mb-3" />
          <p className="text-gray-400 mb-4">No cards yet. Order your first HSMC debit card.</p>
          <Button onClick={() => setView('create')} variant="outline">
            <Plus className="w-4 h-4 mr-2" /> Get Started
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map(card => (
          <motion.div key={card.id} whileHover={{ scale: 1.02 }}
            onClick={() => selectCard(card)}
            className={`cursor-pointer rounded-xl p-5 bg-gradient-to-br ${getBrandColor(card.brand)} text-white shadow-lg relative overflow-hidden`}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="flex justify-between items-start mb-8">
              <span className="text-lg font-bold tracking-wider">{getBrandLogo(card.brand)}</span>
              <span className="text-xs uppercase tracking-wider opacity-80">{card.card_type}</span>
            </div>
            <div className="text-xl tracking-[0.25em] font-mono mb-3">{maskCardNumber(card.last4)}</div>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-xs opacity-70 mb-1">Balance</div>
                <div className="text-lg font-bold">${(card.card_balance_usd || 0).toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs opacity-70 mb-1">Expires</div>
                <div className="text-sm">{String(card.expiration_month).padStart(2,'0')}/{String(card.expiration_year).slice(-2)}</div>
              </div>
            </div>
            <div className="mt-3">
              {card.status === 'active' && <span className="text-xs bg-green-500/30 px-2 py-0.5 rounded-full">Active</span>}
              {card.status === 'frozen' && <span className="text-xs bg-blue-400/30 px-2 py-0.5 rounded-full">Frozen</span>}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );

  // ── Render: Card Detail ───────────────────────────────────────────
  const renderCardDetail = () => {
    if (!selectedCard) return null;
    return (
      <div className="space-y-6">
        <button onClick={() => { setSelectedCard(null); setTransactions([]); }}
          className="text-gray-400 hover:text-white flex items-center gap-1 mb-4">← Back to cards</button>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="lg:w-96">
            <motion.div className="relative w-full h-56 cursor-pointer"
              animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: 0.5 }}
              onClick={() => setFlipped(!flipped)} style={{ transformStyle: 'preserve-3d' }}>
              {/* Front */}
              <div className={`absolute inset-0 rounded-xl p-6 bg-gradient-to-br ${getBrandColor(selectedCard.brand)} text-white`} style={{ backfaceVisibility: 'hidden' }}>
                <div className="flex justify-between items-start mb-8">
                  <span className="text-xl font-bold tracking-wider">{getBrandLogo(selectedCard.brand)}</span>
                  <span className="text-xs uppercase opacity-80">{selectedCard.card_type}</span>
                </div>
                <div className="text-2xl tracking-[0.3em] font-mono mb-4">{maskCardNumber(selectedCard.last4)}</div>
                <div className="flex justify-between items-end">
                  <div><div className="text-xs opacity-70">Balance</div><div className="text-xl font-bold">${(selectedCard.card_balance_usd || 0).toFixed(2)}</div></div>
                  <div><div className="text-xs opacity-70">Exp</div><div>{String(selectedCard.expiration_month).padStart(2,'0')}/{String(selectedCard.expiration_year).slice(-2)}</div></div>
                </div>
              </div>
              {/* Back */}
              <div className={`absolute inset-0 rounded-xl p-6 bg-gradient-to-br ${getBrandColor(selectedCard.brand)} text-white`}
                style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                <div className="h-10 bg-black/30 -mx-6 mt-4" />
                <div className="mt-4 flex justify-end"><div className="bg-white/20 px-3 py-1 rounded text-sm font-mono">CVV ***</div></div>
                <div className="mt-6 text-xs opacity-70"><p>Customer service: 1-800-HSMC-NET</p><p>Issued by Stripe Issuing</p><p>HSMC Network — Privacy L1</p></div>
              </div>
            </motion.div>
          </div>

          <div className="flex-1 space-y-4">
            <div className="flex gap-2 flex-wrap">
              <Button onClick={() => setView('fund')} className="bg-purple-600 hover:bg-purple-700"><DollarSign className="w-4 h-4 mr-1" /> Fund</Button>
              {selectedCard.status === 'active' ? (
                <Button onClick={() => handleFreeze(selectedCard.id)} variant="outline"><Snowflake className="w-4 h-4 mr-1" /> Freeze</Button>
              ) : selectedCard.status === 'frozen' ? (
                <Button onClick={() => handleUnfreeze(selectedCard.id)} variant="outline"><Flame className="w-4 h-4 mr-1" /> Unfreeze</Button>
              ) : null}
              <Button onClick={() => handleCancel(selectedCard.id)} variant="outline" className="text-red-400 border-red-800 hover:bg-red-900/30"><Trash2 className="w-4 h-4 mr-1" /> Cancel</Button>
            </div>

            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2"><SlidersHorizontal className="w-4 h-4" /> Spending Limits</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-gray-500 text-xs">Per Tx</div><div className="text-white font-medium">${selectedCard.per_tx_limit_usd?.toLocaleString()}</div></div>
                <div><div className="text-gray-500 text-xs">Daily</div><div className="text-white font-medium">${selectedCard.daily_limit_usd?.toLocaleString()}</div></div>
                <div><div className="text-gray-500 text-xs">Monthly</div><div className="text-white font-medium">${selectedCard.monthly_limit_usd?.toLocaleString()}</div></div>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">Card Details</h3>
              <div className="text-sm space-y-1 text-gray-400">
                <p>Type: <span className="text-white capitalize">{selectedCard.card_type}</span></p>
                <p>Status: <span className={`capitalize ${selectedCard.status === 'active' ? 'text-green-400' : selectedCard.status === 'frozen' ? 'text-blue-400' : 'text-red-400'}`}>{selectedCard.status}</span></p>
                <p>Created: {new Date(selectedCard.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Transactions */}
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700 flex items-center gap-2"><History className="w-4 h-4 text-gray-400" /><h3 className="font-semibold text-white">Recent Transactions</h3></div>
          <div className="divide-y divide-gray-700/50 max-h-64 overflow-y-auto">
            {transactions.length === 0 && <div className="p-6 text-center text-gray-500 text-sm">No transactions yet</div>}
            {transactions.map(tx => (
              <div key={tx.id} className="px-5 py-3 flex justify-between items-center">
                <div><div className="text-white text-sm font-medium">{tx.merchant_name || 'Unknown'}</div><div className="text-gray-500 text-xs">{new Date(tx.created_at).toLocaleString()}</div></div>
                <div className="text-right">
                  <div className={`text-sm font-mono font-medium ${tx.tx_type === 'refund' ? 'text-green-400' : 'text-white'}`}>{tx.tx_type === 'refund' ? '+' : '-'}${(tx.amount_cents / 100).toFixed(2)}</div>
                  <div className="text-xs text-gray-500 capitalize">{tx.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Render: Create Card ───────────────────────────────────────────
  const renderCreateCard = () => (
    <div className="max-w-lg mx-auto space-y-6">
      <button onClick={() => setView('dashboard')} className="text-gray-400 hover:text-white flex items-center gap-1 mb-4">← Back</button>
      <h2 className="text-2xl font-bold text-white">Order New Card</h2>
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700 space-y-4">
        <div>
          <label className="text-sm text-gray-400 mb-2 block">Card Type</label>
          <div className="flex gap-3">
            {(['virtual', 'physical'] as const).map(type => (
              <button key={type} onClick={() => setCardType(type)}
                className={`flex-1 p-3 rounded-lg border text-sm font-medium capitalize transition ${cardType === type ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-gray-600 text-gray-400 hover:border-gray-500'}`}>
                {type === 'virtual' ? '📱 Virtual' : '💳 Physical'}
              </button>
            ))}
          </div>
        </div>
        <div><label className="text-sm text-gray-400 mb-2 block">Daily Limit (USD)</label><Input type="number" value={dailyLimit} onChange={e => setDailyLimit(Number(e.target.value))} className="bg-gray-900 border-gray-700 text-white" /></div>
        <div><label className="text-sm text-gray-400 mb-2 block">Monthly Limit (USD)</label><Input type="number" value={monthlyLimit} onChange={e => setMonthlyLimit(Number(e.target.value))} className="bg-gray-900 border-gray-700 text-white" /></div>
        <div><label className="text-sm text-gray-400 mb-2 block">Per-Transaction Limit (USD)</label><Input type="number" value={perTxLimit} onChange={e => setPerTxLimit(Number(e.target.value))} className="bg-gray-900 border-gray-700 text-white" /></div>
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-300"><p className="font-medium mb-1">Stripe Issuing activation required</p><p className="text-yellow-400/70">Card issuance uses the real Stripe API and requires Stripe Issuing to be enabled on the connected account.</p></div>
        </div>
        <Button onClick={handleCreateCard} disabled={loading} className="w-full bg-purple-600 hover:bg-purple-700">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CreditCard className="w-4 h-4 mr-2" />} Order Card
        </Button>
      </div>
    </div>
  );

  // ── Render: Fund Card ─────────────────────────────────────────────
  const renderFundCard = () => (
    <div className="max-w-lg mx-auto space-y-6">
      <button onClick={() => setView('dashboard')} className="text-gray-400 hover:text-white flex items-center gap-1 mb-4">← Back</button>
      <h2 className="text-2xl font-bold text-white">Fund Card</h2>
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700 space-y-4">
        <div className="flex justify-between text-sm"><span className="text-gray-400">Current Balance</span><span className="text-white font-mono">${(selectedCard?.card_balance_usd || 0).toFixed(2)}</span></div>
        <div>
          <label className="text-sm text-gray-400 mb-2 block">Amount (HSMC)</label>
          <Input type="number" value={amountHsmc} onChange={e => setAmountHsmc(e.target.value)} placeholder="0.00" className="bg-gray-900 border-gray-700 text-white text-lg" />
          {amountHsmc && <p className="text-sm text-gray-400 mt-2">≈ ${(parseFloat(amountHsmc || '0') * hsmcPrice).toFixed(2)} USD <span className="text-gray-500 ml-2">(1 HSMC = ${hsmcPrice.toFixed(4)})</span></p>}
        </div>
        <Button onClick={handleFund} disabled={loading || !amountHsmc} className="w-full bg-purple-600 hover:bg-purple-700">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowUpRight className="w-4 h-4 mr-2" />} Fund Card
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div key={view + (selectedCard?.id || '')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {view === 'dashboard' && !selectedCard && renderDashboard()}
            {view === 'dashboard' && selectedCard && renderCardDetail()}
            {view === 'create' && renderCreateCard()}
            {view === 'fund' && renderFundCard()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
