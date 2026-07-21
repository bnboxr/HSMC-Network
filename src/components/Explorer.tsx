import { useState, forwardRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Copy, Check, ChevronDown, ChevronUp, Box,
  ArrowRightLeft, Loader2, Lock, Radio, Wifi, WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBlockchain, DbTransaction, DbBlock } from '@/hooks/useBlockchain';
import { formatAddress, formatHash, formatRelativeTime, formatNumber } from '@/utils/blockchain-generator';
import { supabase } from '@/integrations/db/client';

// ── Node-proxy types ──────────────────────────────────────────────────────────
interface NodeBlock {
  block_number: number;
  hash: string;
  prev_hash: string;
  miner_address: string;
  nonce: number;
  difficulty: number;
  transactions_count: number;
  timestamp: number;
  privacy_protocol?: string;
}

interface MempoolTx {
  hash: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  privacy_level?: string;
}

interface NodeProxyResult<T> {
  ok: boolean;
  node_online: boolean;
  data?: T;
  error?: string;
}

async function callNodeProxy<T>(path: string, method = 'GET', data?: unknown): Promise<NodeProxyResult<T>> {
  try {
    const { data: res, error } = await supabase.functions.invoke('node-proxy', {
      body: { path, method, data },
    });

    if (error) {
      // DB client wraps non-2xx as FunctionsHttpError where context is a Response object
      const context = (error as any)?.context;
      if (context) {
        try {
          // context may be a Response object (needs .json()) or already parsed
          const body = typeof context.json === 'function'
            ? await context.json()
            : (typeof context === 'string' ? JSON.parse(context) : context);
          if (body && typeof body === 'object' && 'node_online' in body) {
            return { ok: false, node_online: false, error: body.error ?? 'Node offline' };
          }
        } catch { /* fall through */ }
      }
      // Any 503 / network error → treat as node offline gracefully
      const msg = String((error as any)?.message ?? 'Node offline');
      return { ok: false, node_online: false, error: msg };
    }

    // Edge function returned JSON with node_online:false (e.g. node unreachable)
    if (res && typeof res === 'object' && 'node_online' in res && !res.node_online) {
      return { ok: false, node_online: false, error: (res as NodeProxyResult<T>).error };
    }

    return (res ?? { ok: false, node_online: false, error: 'Empty response' }) as NodeProxyResult<T>;
  } catch {
    return { ok: false, node_online: false, error: 'Edge Function unreachable' };
  }
}

// ── Node status badge ─────────────────────────────────────────────────────────
const NodeBadge = ({ online }: { online: boolean | null }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border ${
    online === null ? 'border-border text-muted-foreground' :
    online ? 'border-secondary/40 bg-secondary/10 text-secondary' :
    'border-destructive/30 bg-destructive/10 text-destructive'
  }`}>
    {online === null ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> :
     online ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
    {online === null ? 'Checking…' : online ? 'RUST NODE' : 'NODE OFFLINE'}
  </span>
);

// forwardRef-safe copy button
const CopyButton = forwardRef<HTMLButtonElement, { text: string }>(
  ({ text }, ref) => {
    const [copied, setCopied] = useState(false);
    return (
      <button
        ref={ref}
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="p-1 hover:bg-muted/60 rounded transition-colors"
        title="Copy"
      >
        {copied
          ? <Check className="w-3.5 h-3.5 text-secondary" />
          : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
    );
  }
);
CopyButton.displayName = 'CopyButton';

const privacyColor = (level: string | null) => {
  if (level === 'maximum') return 'text-accent border-accent/30 bg-accent/10';
  if (level === 'private') return 'text-primary border-primary/30 bg-primary/10';
  return 'text-muted-foreground border-border bg-muted/20';
};

// forwardRef-safe TransactionRow
const TransactionRow = forwardRef<HTMLTableRowElement, { tx: DbTransaction }>(
  ({ tx }, ref) => (
    <tr ref={ref} className="group border-b border-border/30 hover:bg-muted/10 transition-colors">
      <td className="py-3 px-4">
        <div className="flex items-center gap-1.5">
          <span className="hash-display">{formatHash(tx.hash)}</span>
          <CopyButton text={tx.hash} />
        </div>
      </td>
      <td className="py-3 px-4">
        <span className="font-mono text-xs text-muted-foreground">{formatAddress(tx.from_address, 6)}</span>
      </td>
      <td className="py-3 px-4">
        <span className="font-mono text-xs text-muted-foreground">{formatAddress(tx.to_address, 6)}</span>
      </td>
      <td className="py-3 px-4 text-right">
        <span className="font-mono text-sm font-semibold">{tx.amount.toFixed(4)}</span>
        <span className="text-xs text-muted-foreground ml-1">HSMC</span>
      </td>
      <td className="py-3 px-4">
        <span className="text-xs text-muted-foreground font-mono">{formatRelativeTime(tx.created_at)}</span>
      </td>
      <td className="py-3 px-4">
        <span className={`px-2 py-0.5 text-[10px] rounded-full border font-mono ${tx.status === 'confirmed' ? 'status-confirmed' : 'status-pending'}`}>
          {tx.status}
        </span>
      </td>
      <td className="py-3 px-4">
        {tx.privacy_level && (
          <span className={`px-2 py-0.5 text-[10px] rounded-full border font-mono flex items-center gap-1 w-fit ${privacyColor(tx.privacy_level)}`}>
            <Lock className="w-2.5 h-2.5" />
            {tx.privacy_level}
          </span>
        )}
      </td>
    </tr>
  )
);
TransactionRow.displayName = 'TransactionRow';

// MempoolTx row (from Rust node)
const MempoolRow = ({ tx }: { tx: MempoolTx }) => (
  <tr className="border-b border-border/30 hover:bg-muted/10 transition-colors">
    <td className="py-3 px-4">
      <span className="hash-display font-mono text-xs">{tx.hash.slice(0, 18)}…</span>
    </td>
    <td className="py-3 px-4">
      <span className="font-mono text-xs text-muted-foreground">{tx.from.slice(0, 10)}…</span>
    </td>
    <td className="py-3 px-4">
      <span className="font-mono text-xs text-muted-foreground">{tx.to.slice(0, 10)}…</span>
    </td>
    <td className="py-3 px-4 text-right">
      <span className="font-mono text-sm font-semibold">{tx.amount.toFixed(4)}</span>
      <span className="text-xs text-muted-foreground ml-1">HSMC</span>
    </td>
    <td className="py-3 px-4">
      <span className="text-xs text-muted-foreground font-mono">{tx.fee.toFixed(6)}</span>
    </td>
    <td className="py-3 px-4">
      <span className="px-2 py-0.5 text-[10px] rounded-full border font-mono status-pending">pending</span>
    </td>
    <td className="py-3 px-4">
      {tx.privacy_level && (
        <span className={`px-2 py-0.5 text-[10px] rounded-full border font-mono flex items-center gap-1 w-fit ${privacyColor(tx.privacy_level)}`}>
          <Lock className="w-2.5 h-2.5" />
          {tx.privacy_level}
        </span>
      )}
    </td>
  </tr>
);

const BlockCard = ({ block, isExpanded, onToggle }: { block: DbBlock; isExpanded: boolean; onToggle: () => void }) => (
  <div className="glass-card overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full p-4 flex items-center justify-between hover:bg-muted/20 transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'hsl(var(--primary) / 0.1)' }}>
          <Box className="w-5 h-5 text-primary" />
        </div>
        <div className="text-left">
          <div className="font-mono font-bold text-sm">
            Block <span className="text-primary">#{formatNumber(block.block_number)}</span>
          </div>
          <div className="text-xs text-muted-foreground">{formatRelativeTime(block.created_at)}</div>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right hidden sm:block">
          <div className="text-sm font-bold font-mono">{block.transactions_count}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">txns</div>
        </div>
        <div className="text-right hidden md:block">
          <div className="text-xs font-mono text-muted-foreground">{block.privacy_protocol}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">protocol</div>
        </div>
        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </div>
    </button>
    <AnimatePresence>
      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="border-t border-border/40"
        >
          <div className="p-4 space-y-2.5 text-sm">
            {[
              { label: 'Block Hash', val: block.hash, copy: true },
              { label: 'Previous Hash', val: block.prev_hash, copy: true },
              { label: 'Miner Address', val: block.miner_address, copy: true },
              { label: 'Nonce', val: formatNumber(block.nonce), copy: false },
              { label: 'Difficulty', val: formatNumber(block.difficulty), copy: false },
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs font-mono">{row.label}</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs">
                    {row.copy ? formatHash(row.val as string, 16) : row.val}
                  </span>
                  {row.copy && <CopyButton text={row.val as string} />}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

// NodeBlock card (from Rust node RPC — /block/latest)
const NodeBlockCard = ({ block }: { block: NodeBlock }) => (
  <div className="glass-card p-4 border-l-2 border-secondary/60">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'hsl(var(--secondary) / 0.12)' }}>
          <Radio className="w-4 h-4 text-secondary" />
        </div>
        <div>
          <div className="font-mono font-bold text-sm text-secondary">
            Block #{formatNumber(block.block_number)} <span className="text-[10px] font-normal text-muted-foreground">(RUST NODE)</span>
          </div>
          <div className="text-xs text-muted-foreground">{new Date(block.timestamp * 1000).toLocaleTimeString()}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-bold font-mono">{block.transactions_count}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">txns</div>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
      <div>
        <span className="text-muted-foreground">Hash: </span>
        <span>{block.hash.slice(0, 20)}…</span>
      </div>
      <div>
        <span className="text-muted-foreground">Nonce: </span>
        <span>{formatNumber(block.nonce)}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Miner: </span>
        <span>{block.miner_address.slice(0, 16)}…</span>
      </div>
      <div>
        <span className="text-muted-foreground">Difficulty: </span>
        <span>{formatNumber(block.difficulty)}</span>
      </div>
    </div>
  </div>
);

export const Explorer = () => {
  const { transactions, blocks, loading, searchByHash, searchByAddress } = useBlockchain();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'transactions' | 'blocks' | 'mempool' | 'node'>('transactions');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    type: 'block' | 'transaction' | 'address' | null;
    data: any;
  } | null>(null);

  // Node-proxy state
  const [nodeOnline, setNodeOnline] = useState<boolean | null>(null);
  const [nodeLatestBlock, setNodeLatestBlock] = useState<NodeBlock | null>(null);
  const [nodeMempool, setNodeMempool] = useState<MempoolTx[]>([]);
  const [nodeLoading, setNodeLoading] = useState(false);

  // Poll node health every 15s — never throws, handles offline gracefully
  const refreshNode = useCallback(async () => {
    setNodeLoading(true);
    try {
      const health = await callNodeProxy<{ version: string; status: string }>('/health');
      setNodeOnline(health.node_online ?? false);

      if (health.node_online) {
        const [latestRes, mempoolRes] = await Promise.all([
          callNodeProxy<NodeBlock>('/block/latest'),
          callNodeProxy<{ count: number; transactions: MempoolTx[] }>('/mempool'),
        ]);
        if (latestRes.ok && latestRes.data) setNodeLatestBlock(latestRes.data);
        if (mempoolRes.ok && mempoolRes.data) {
          const txList = Array.isArray(mempoolRes.data)
            ? mempoolRes.data
            : (mempoolRes.data as { transactions?: MempoolTx[] }).transactions ?? [];
          setNodeMempool(txList);
        }
      }
    } catch {
      // Network/edge error — mark offline silently
      setNodeOnline(false);
    } finally {
      setNodeLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshNode();
    const id = setInterval(refreshNode, 15_000);
    return () => clearInterval(id);
  }, [refreshNode]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const hashResult = await searchByHash(searchQuery);
      if (hashResult.type) { setSearchResults(hashResult); return; }
      const addressResults = await searchByAddress(searchQuery);
      if (addressResults.length > 0) {
        setSearchResults({ type: 'address', data: addressResults });
        return;
      }
      setSearchResults({ type: null, data: null });
    } finally {
      setSearching(false);
    }
  };

  return (
    <section id="explorer" className="py-24">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <p className="section-eyebrow mb-4">Block Explorer</p>
          <h2 className="text-3xl sm:text-4xl font-black mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
            HSMC <span className="gradient-text">Explorer</span>
          </h2>
          <div className="flex items-center justify-center gap-3 mt-2">
            <p className="text-muted-foreground text-sm">
              Real on-chain data only. Every transaction is cryptographically verified.
            </p>
            <NodeBadge online={nodeOnline} />
          </div>
        </motion.div>

        {/* Search */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto mb-8"
        >
          <div className="glass-panel flex items-center gap-3 py-3 px-4">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search block hash, tx hash, or wallet address..."
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/50 font-mono"
            />
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/85"
              onClick={handleSearch}
              disabled={searching}
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
            </Button>
          </div>
        </motion.div>

        {/* Search Results */}
        <AnimatePresence>
          {searchResults && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="max-w-3xl mx-auto mb-8"
            >
              {searchResults.type === null ? (
                <div className="glass-card p-4 text-center text-muted-foreground text-sm">
                  No results found for &ldquo;<span className="font-mono text-primary">{searchQuery}</span>&rdquo;
                </div>
              ) : (
                <div className="glass-panel">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="px-2 py-0.5 text-xs rounded bg-primary/15 text-primary font-mono capitalize border border-primary/20">
                      {searchResults.type}
                    </span>
                    <span className="text-sm text-muted-foreground">found</span>
                  </div>
                  {searchResults.type === 'transaction' && (
                    <div className="space-y-2 text-sm font-mono">
                      {[
                        { label: 'Hash', val: formatHash(searchResults.data.hash, 24) },
                        { label: 'Amount', val: `${searchResults.data.amount.toFixed(4)} HSMC` },
                        { label: 'Fee', val: `${searchResults.data.fee.toFixed(6)} HSMC` },
                        { label: 'Privacy', val: searchResults.data.privacy_level || 'standard' },
                        { label: 'Ring Size', val: searchResults.data.decoy_count != null ? `${searchResults.data.decoy_count + 1}` : '—' },
                        { label: 'Status', val: searchResults.data.status },
                      ].map(row => (
                        <div key={row.label} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{row.label}</span>
                          <span className={row.label === 'Status'
                            ? (searchResults.data.status === 'confirmed' ? 'text-secondary' : 'text-yellow-400')
                            : ''
                          }>
                            {row.val}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {searchResults.type === 'block' && (
                    <div className="space-y-2 text-sm font-mono">
                      {[
                        { label: 'Block #', val: formatNumber(searchResults.data.block_number) },
                        { label: 'Transactions', val: searchResults.data.transactions_count },
                        { label: 'Miner', val: formatAddress(searchResults.data.miner_address, 12) },
                        { label: 'Protocol', val: searchResults.data.privacy_protocol },
                      ].map(row => (
                        <div key={row.label} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{row.label}</span>
                          <span>{row.val}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {searchResults.type === 'address' && (
                    <p className="text-sm text-muted-foreground font-mono">
                      Found {searchResults.data.length} transactions for this address
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {[
            { tab: 'transactions' as const, icon: ArrowRightLeft, label: 'Transactions', count: transactions.length },
            { tab: 'blocks' as const, icon: Box, label: 'Blocks', count: blocks.length },
            { tab: 'mempool' as const, icon: Radio, label: 'Mempool (Node)', count: nodeMempool.length },
            { tab: 'node' as const, icon: nodeOnline ? Wifi : WifiOff, label: 'Latest Block (Node)', count: nodeLatestBlock ? 1 : 0 },
          ].map(({ tab, icon: Icon, label, count }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono transition-colors ${
                activeTab === tab
                  ? 'bg-primary/15 text-primary border border-primary/25'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              <span className="ml-1 text-xs opacity-60">({count})</span>
            </button>
          ))}
          <button
            onClick={refreshNode}
            disabled={nodeLoading}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            {nodeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />}
            Refresh Node
          </button>
        </div>

        {/* Content */}
        {loading && activeTab !== 'mempool' && activeTab !== 'node' ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.18 }}
            >
              {activeTab === 'transactions' && (
                <div className="glass-panel overflow-hidden">
                  {transactions.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon"><ArrowRightLeft className="w-5 h-5" /></div>
                      <p className="text-sm font-semibold text-muted-foreground">No transactions on the network yet</p>
                      <p className="text-xs text-muted-foreground/60">
                        Transactions appear here in real-time as they are submitted to the network
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Tx Hash</th><th>From</th><th>To</th>
                            <th className="text-right">Amount</th>
                            <th>Time</th><th>Status</th><th>Privacy</th>
                          </tr>
                        </thead>
                        <tbody>
                          {transactions.slice(0, 20).map((tx) => (
                            <TransactionRow key={tx.id} tx={tx} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'blocks' && (
                <div className="grid gap-3">
                  {blocks.length === 0 ? (
                    <div className="glass-card empty-state">
                      <div className="empty-state-icon"><Box className="w-5 h-5" /></div>
                      <p className="text-sm font-semibold text-muted-foreground">No blocks mined yet</p>
                      <p className="text-xs text-muted-foreground/60">Blocks appear here as the network produces them</p>
                    </div>
                  ) : (
                    blocks.slice(0, 12).map((block) => (
                      <BlockCard
                        key={block.id}
                        block={block}
                        isExpanded={expandedBlock === block.id}
                        onToggle={() => setExpandedBlock(expandedBlock === block.id ? null : block.id)}
                      />
                    ))
                  )}
                </div>
              )}

              {activeTab === 'mempool' && (
                <div className="glass-panel overflow-hidden">
                  <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border/40">
                    <Radio className="w-4 h-4 text-secondary" />
                    <span className="font-mono text-xs uppercase tracking-wider font-bold">Rust Node Mempool</span>
                    <NodeBadge online={nodeOnline} />
                    <span className="ml-auto text-xs text-muted-foreground font-mono">{nodeMempool.length} pending txns</span>
                  </div>
                  {nodeOnline === false ? (
                    <div className="empty-state">
                      <div className="empty-state-icon"><WifiOff className="w-5 h-5" /></div>
                      <p className="text-sm font-semibold text-muted-foreground">Rust node offline</p>
                      <p className="text-xs text-muted-foreground/60">
                        Add <code className="text-primary">RUST_NODE_URL</code> secret in Settings → Secrets
                      </p>
                    </div>
                  ) : nodeMempool.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon"><Radio className="w-5 h-5" /></div>
                      <p className="text-sm font-semibold text-muted-foreground">Mempool empty</p>
                      <p className="text-xs text-muted-foreground/60">No pending transactions in the Rust node</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Tx Hash</th><th>From</th><th>To</th>
                            <th className="text-right">Amount</th>
                            <th>Fee</th><th>Status</th><th>Privacy</th>
                          </tr>
                        </thead>
                        <tbody>
                          {nodeMempool.map((tx) => (
                            <MempoolRow key={tx.hash} tx={tx} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'node' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <NodeBadge online={nodeOnline} />
                    <span className="text-xs text-muted-foreground font-mono">
                      {nodeOnline ? 'Live data via node-proxy edge function' : 'Set RUST_NODE_URL in Lovable Cloud secrets to activate'}
                    </span>
                  </div>
                  {nodeOnline === false ? (
                    <div className="glass-card p-8 text-center space-y-3">
                      <WifiOff className="w-12 h-12 text-muted-foreground/30 mx-auto" />
                      <p className="font-semibold text-muted-foreground">Rust node not reachable</p>
                      <div className="text-xs text-muted-foreground/60 space-y-1 font-mono">
                        <p>1. Deploy the Rust node using <code className="text-primary">rust-node/deploy.sh</code> or Docker Compose</p>
                        <p>2. Add <code className="text-primary">RUST_NODE_URL=http://YOUR_VPS_IP:8080</code> in Settings → Secrets</p>
                        <p>3. Click "Refresh Node" above</p>
                      </div>
                    </div>
                  ) : nodeLatestBlock ? (
                    <NodeBlockCard block={nodeLatestBlock} />
                  ) : (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </section>
  );
};

export default Explorer;
