import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Box, Blocks, Cpu, Activity, Clock, Hash,
  ChevronRight, Shield, Network, Zap, Database, ArrowUpRight,
  RefreshCw, Circle, BoxSelect, Binary
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Navbar } from '@/components/Navbar';
import { SEO } from '@/components/SEO';

// ── Types ───────────────────────────────────────────────────────────────────
interface BlockInfo {
  block_number: number;
  hash: string;
  prev_hash: string;
  timestamp: number;
  transactions_count: number;
  difficulty: number;
  miner_address: string;
  reward: number;
  total_fees: number;
  size_bytes: number;
  privacy_protocol: string;
}

interface ChainStats {
  chain_height: number;
  total_transactions: number;
  total_blocks: number;
  mempool_size: number;
  peer_count: number;
  total_supply: number;
  circulating_supply: number;
  current_difficulty: number;
  hashrate_khs: number;
  avg_block_time_secs: number;
  next_halving_block: number;
}

interface TxInfo {
  hash: string;
  block_number: number;
  timestamp: number;
  inputs: number;
  outputs: number;
  amount: number;
  fee: number;
  privacy: string;
  status: string;
}

// ── Constants ───────────────────────────────────────────────────────────────
const API_BASE = '/node-proxy';

// ── Helpers ─────────────────────────────────────────────────────────────────
function shorten(s: string, n = 8): string {
  if (!s || s.length <= n * 2 + 3) return s;
  return s.slice(0, n) + '...' + s.slice(-n);
}
function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
function formatHSMC(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' HSMC';
}

// ══════════════════════════════════════════════════════════════════════════════
// Stats Card — small metric tile
// ══════════════════════════════════════════════════════════════════════════════
function StatCard({ icon: Icon, label, value, color }: {
  icon: typeof Cpu; label: string; value: string; color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gray-900/80 border border-gray-800 rounded-xl p-4 flex items-center gap-3"
    >
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <div className="text-xs text-gray-500 font-mono uppercase tracking-wider">{label}</div>
        <div className="text-lg font-bold text-white">{value}</div>
      </div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Block Card — single block row
// ══════════════════════════════════════════════════════════════════════════════
function BlockCard({ block, index }: { block: BlockInfo; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-gray-900/60 border border-gray-800 rounded-lg p-4 hover:border-primary/30 hover:bg-gray-900/90 transition-all group"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-primary" />
          <span className="text-white font-mono font-bold">
            Block #{block.block_number.toLocaleString()}
          </span>
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded font-mono">
            {block.privacy_protocol}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {timeAgo(block.timestamp)}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div><span className="text-gray-500">Hash:</span> <span className="text-gray-300 font-mono">{shorten(block.hash)}</span></div>
        <div><span className="text-gray-500">Miner:</span> <span className="text-gray-300 font-mono">{shorten(block.miner_address)}</span></div>
        <div><span className="text-gray-500">Txs:</span> <span className="text-white font-bold">{block.transactions_count}</span></div>
        <div><span className="text-gray-500">Reward:</span> <span className="text-green-400">{block.reward.toFixed(2)} HSMC</span></div>
      </div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Transaction Card
// ══════════════════════════════════════════════════════════════════════════════
function TxCard({ tx, index }: { tx: TxInfo; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 hover:border-secondary/30 transition-all group"
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4 text-blue-400" />
          <span className="text-white font-mono text-sm">{shorten(tx.hash, 10)}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
            tx.privacy.includes('Stealth') ? 'bg-purple-900/50 text-purple-300' :
            tx.privacy === 'RingCT' ? 'bg-blue-900/50 text-blue-300' :
            'bg-gray-800 text-gray-400'
          }`}>{tx.privacy}</span>
        </div>
        <span className="text-xs text-gray-500">{timeAgo(tx.timestamp)}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div><span className="text-gray-500">Amount:</span> <span className="text-white">{tx.amount.toFixed(2)} HSMC</span></div>
        <div><span className="text-gray-500">Fee:</span> <span className="text-gray-300">{tx.fee.toFixed(4)} HSMC</span></div>
        <div><span className="text-gray-500">Block:</span> <span className="text-primary font-mono">#{tx.block_number}</span></div>
        <div className="flex items-center gap-1">
          <Circle className={`w-2 h-2 ${tx.status === 'confirmed' ? 'text-green-400 fill-green-400' : 'text-amber-400 fill-amber-400'}`} />
          <span className="text-gray-400">{tx.status}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Explorer Page — main component
// ══════════════════════════════════════════════════════════════════════════════
export default function ExplorerPage() {
  const [stats, setStats] = useState<ChainStats>({ chain_height: 0, total_transactions: 0, total_blocks: 0, mempool_size: 0, peer_count: 0, total_supply: 0, circulating_supply: 0, current_difficulty: 0, hashrate_khs: 0, avg_block_time_secs: 0, next_halving_block: 210000 });
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  const [txs, setTxs] = useState<TxInfo[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const responses = await Promise.all([
        fetch(`${API_BASE}/explorer/stats`),
        fetch(`${API_BASE}/explorer/blocks?offset=0&limit=10`),
        fetch(`${API_BASE}/explorer/transactions?offset=0&limit=10`),
      ]);
      if (responses.some(r => !r.ok)) throw new Error('Explorer API request failed');
      const [statsData, blocksData, txData] = await Promise.all(responses.map(r => r.json()));
      setStats(prev => ({ ...prev, ...statsData }));
      setBlocks(Array.isArray(blocksData) ? blocksData : []);
      setTxs(Array.isArray(txData) ? txData : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Explorer API');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const iv = setInterval(fetchData, 15_000);
    return () => clearInterval(iv);
  }, [autoRefresh, fetchData]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    fetch(`${API_BASE}/explorer/search?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : Promise.reject(new Error("Search failed"))).then(data => { if (data.blocks?.length) setBlocks(data.blocks); if (data.transactions?.length) setTxs(data.transactions); }).catch(() => setError("Search failed"));
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <SEO title="HSMC Block Explorer — Mainnet" description="Explore the HSMC blockchain — blocks, transactions, stats, and network activity." path="/explorer" />
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-6">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-full px-4 py-1.5 mb-4">
            <Circle className="w-2 h-2 text-green-400 fill-green-400 animate-pulse" />
            <span className="text-xs text-green-400 font-mono">MAINNET LIVE</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-3">
            <span className="text-white">HSMC</span>{' '}
            <span className="bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
              Block Explorer
            </span>
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Explore blocks, transactions, and network activity on the privacy-first HSMC blockchain.
            RingCT, stealth addresses, and RandomX PoW — all on-chain.
          </p>
        </motion.div>

        {/* ── Search Bar ──────────────────────────────────────────────────── */}
        <motion.form
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          onSubmit={handleSearch}
          className="max-w-2xl mx-auto flex gap-2"
        >
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by block number, block hash, transaction hash, or address..."
            className="bg-gray-900 border-gray-700 text-white font-mono text-sm flex-1 placeholder:text-gray-600"
          />
          <Button type="submit" className="gap-2">
            <Search className="w-4 h-4" /> Search
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => { fetchData(); }}
            disabled={loading}
            className="border-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </motion.form>

        {error && <div className="rounded-lg border border-red-800 bg-red-950/30 p-3 text-center text-sm text-red-300">{error}</div>}
        {loading && <div className="flex items-center justify-center gap-2 text-sm text-gray-400"><RefreshCw className="w-4 h-4 animate-spin" /> Loading live chain data…</div>}

        {/* ── Network Stats Grid ──────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> Network Stats
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="text-xs text-gray-500 gap-1"
            >
              <Clock className="w-3 h-3" />
              {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={Blocks}   label="Chain Height"    value={`#${stats.chain_height.toLocaleString()}`} color="bg-blue-600/60" />
            <StatCard icon={Shield}   label="Difficulty"      value={stats.current_difficulty.toLocaleString()} color="bg-amber-600/60" />
            <StatCard icon={Zap}      label="Hashrate"        value={`${(stats.hashrate_khs / 1000).toFixed(1)} MH/s`} color="bg-green-600/60" />
            <StatCard icon={Database} label="Mempool"         value={`${stats.mempool_size} txs`} color="bg-purple-600/60" />
            <StatCard icon={Network}  label="Peers"           value={`${stats.peer_count}`} color="bg-cyan-600/60" />
            <StatCard icon={Hash}     label="Circulating"     value={`${(stats.circulating_supply / 1_000_000).toFixed(1)}M HSMC`} color="bg-pink-600/60" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs text-gray-500">
            <div className="bg-gray-900/40 rounded-lg p-3 text-center">
              <span className="block text-gray-400">Total Supply</span>
              <span className="text-white font-mono">{(stats.total_supply / 1_000_000).toFixed(0)}M HSMC</span>
            </div>
            <div className="bg-gray-900/40 rounded-lg p-3 text-center">
              <span className="block text-gray-400">Avg Block Time</span>
              <span className="text-white font-mono">{stats.avg_block_time_secs}s</span>
            </div>
            <div className="bg-gray-900/40 rounded-lg p-3 text-center">
              <span className="block text-gray-400">Total Txs</span>
              <span className="text-white font-mono">{stats.total_transactions.toLocaleString()}</span>
            </div>
            <div className="bg-gray-900/40 rounded-lg p-3 text-center">
              <span className="block text-gray-400">Next Halving</span>
              <span className="text-white font-mono">Block #{stats.next_halving_block.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* ── Two-column: Latest Blocks + Latest Transactions ─────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Latest Blocks */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Box className="w-5 h-5 text-primary" /> Latest Blocks
              </h2>
              <ChevronRight className="w-5 h-5 text-gray-600 cursor-pointer hover:text-primary transition-colors" />
            </div>
            <div className="space-y-3">
              {blocks.length === 0 && !loading ? <div className="text-sm text-gray-500 py-6 text-center">No data yet</div> : blocks.map((block, i) => (
                <BlockCard key={block.block_number} block={block} index={i} />
              ))}
            </div>
          </div>

          {/* Latest Transactions */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-blue-400" /> Latest Transactions
              </h2>
              <ChevronRight className="w-5 h-5 text-gray-600 cursor-pointer hover:text-primary transition-colors" />
            </div>
            <div className="space-y-2">
              {txs.length === 0 && !loading ? <div className="text-sm text-gray-500 py-6 text-center">No data yet</div> : txs.map((tx, i) => (
                <TxCard key={tx.hash} tx={tx} index={i} />
              ))}
            </div>
          </div>
        </div>

        {/* ── Chain Info Footer ───────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-gray-900/60 border border-gray-800 rounded-xl p-6"
        >
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Binary className="w-5 h-5 text-primary" /> Chain Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Chain ID:</span>{' '}
              <span className="text-white font-mono">hsmc-mainnet-1</span>
            </div>
            <div>
              <span className="text-gray-500">Consensus:</span>{' '}
              <span className="text-white">Proof-of-Work (RandomX)</span>
            </div>
            <div>
              <span className="text-gray-500">Privacy:</span>{' '}
              <span className="text-white">RingCT + CLSAG + Stealth Addresses</span>
            </div>
            <div>
              <span className="text-gray-500">Block Time:</span>{' '}
              <span className="text-white">120 seconds (target)</span>
            </div>
            <div>
              <span className="text-gray-500">Max Supply:</span>{' '}
              <span className="text-white">500,000,000 HSMC</span>
            </div>
            <div>
              <span className="text-gray-500">Halving Interval:</span>{' '}
              <span className="text-white">Every 210,000 blocks (~16 months)</span>
            </div>
            <div>
              <span className="text-gray-500">Protocol Version:</span>{' '}
              <span className="text-white font-mono">0x000B (Base + RingCT + Bulletproofs)</span>
            </div>
            <div>
              <span className="text-gray-500">RPC Endpoint:</span>{' '}
              <span className="text-primary font-mono">http://localhost:8080</span>
            </div>
            <div>
              <span className="text-gray-500">Explorer API:</span>{' '}
              <span className="text-primary font-mono">/stats /blocks /tx/:hash /block/:num</span>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
