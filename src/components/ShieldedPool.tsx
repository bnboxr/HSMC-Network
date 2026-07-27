import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, Coins, ArrowDownToLine, ArrowUpFromLine,
  FileCode, Key, Hash, Eye, EyeOff, Loader2, Check, X,
  Copy, RefreshCw, AlertTriangle, Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// ═══════════════════════════════════════════════════════════════
// API helpers
// ═══════════════════════════════════════════════════════════════

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const API_KEY = import.meta.env.VITE_API_KEY || '';

async function apiCall(endpoint: string, method: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  const resp = await fetch(`${API_BASE}/${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

interface PoolState {
  tvl: number;
  note_count: number;
  root_hex: string;
  depth: number;
  nullifier_count: number;
}

interface Note {
  commitment: string;
  amount: number;
  blinding: string;
  leaf_index: number;
}

interface ProofResult {
  proof_hex: string;
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

export default function ShieldedPool() {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'verify'>('deposit');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  // Pool state
  const [poolState, setPoolState] = useState<PoolState | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);

  // Deposit
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState<Note | null>(null);
  const [depositProof, setDepositProof] = useState<ProofResult | null>(null);
  const [showBlinding, setShowBlinding] = useState(false);

  // Withdraw
  const [withdrawNoteJson, setWithdrawNoteJson] = useState('');
  const [withdrawSecret, setWithdrawSecret] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState<number | null>(null);
  const [withdrawNullifier, setWithdrawNullifier] = useState<string | null>(null);

  // Verify
  const [verifyProofJson, setVerifyProofJson] = useState('');
  const [verifyInputsJson, setVerifyInputsJson] = useState('');
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);

  // Fetch pool state
  const fetchPoolState = useCallback(async () => {
    setPoolLoading(true);
    try {
      const data = await apiCall('shielded/state', 'GET');
      if (data.tvl !== undefined) {
        setPoolState(data as PoolState);
        setError(null);
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pool state');
    } finally {
      setPoolLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPoolState();
  }, [fetchPoolState]);

  // ── Deposit ────────────────────────────────────────────────
  const handleDeposit = async () => {
    const amount = parseInt(depositAmount);
    if (!amount || amount <= 0) {
      setError('Enter a valid amount (> 0)');
      return;
    }
    setLoading(true);
    setError(null);
    setDepositNote(null);
    setDepositProof(null);
    try {
      const data = await apiCall('shielded/deposit', 'POST', { amount_satoshis: amount });
      if (data.ok) {
        setDepositNote(data.note);
        setDepositProof(data.proof);
        setResult(data);
        fetchPoolState();
      } else {
        setError(data.error || 'Deposit failed');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  // ── Withdraw ───────────────────────────────────────────────
  const handleWithdraw = async () => {
    if (!withdrawNoteJson.trim() || !withdrawSecret.trim()) {
      setError('Both note JSON and secret hex are required');
      return;
    }
    setLoading(true);
    setError(null);
    setWithdrawAmount(null);
    setWithdrawNullifier(null);
    try {
      const noteObj = JSON.parse(withdrawNoteJson);
      const data = await apiCall('shielded/withdraw', 'POST', {
        note: noteObj,
        secret_hex: withdrawSecret.trim(),
      });
      if (data.ok) {
        setWithdrawAmount(data.amount);
        setWithdrawNullifier(data.nullifier);
        setResult(data);
        fetchPoolState();
      } else {
        setError(data.error || 'Withdraw failed');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid input');
    } finally {
      setLoading(false);
    }
  };

  // ── Verify ─────────────────────────────────────────────────
  const handleVerify = async () => {
    if (!verifyProofJson.trim() || !verifyInputsJson.trim()) {
      setError('Both proof JSON and public inputs JSON are required');
      return;
    }
    setLoading(true);
    setError(null);
    setVerifyResult(null);
    try {
      const proof = JSON.parse(verifyProofJson);
      const pubInputs = JSON.parse(verifyInputsJson);
      const data = await apiCall('shielded/verify', 'POST', { proof, pub_inputs: pubInputs });
      setVerifyResult(data.valid === true);
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid JSON input');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const formatTVL = (tvl: number) => {
    if (tvl >= 1e8) return `${(tvl / 1e8).toFixed(4)} HSMC`;
    return `${tvl.toLocaleString()} satoshis`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
          <Shield className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Shielded Pool</h2>
          <p className="text-sm text-muted-foreground">zk-STARK private transactions</p>
        </div>
      </div>

      {/* Pool Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">TVL</span>
          </div>
          <div className="text-lg font-bold font-mono">
            {poolLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
             poolState ? formatTVL(poolState.tvl) : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">Notes</span>
          </div>
          <div className="text-lg font-bold font-mono">
            {poolLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
             poolState ? poolState.note_count : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">Merkle Root</span>
          </div>
          <div className="text-xs font-mono truncate">
            {poolLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
             poolState ? poolState.root_hex.slice(0, 16) + '…' : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <EyeOff className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">Nullifiers Spent</span>
          </div>
          <div className="text-lg font-bold font-mono">
            {poolLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
             poolState ? poolState.nullifier_count : '—'}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={fetchPoolState} disabled={poolLoading}>
          <RefreshCw className={`w-3 h-3 mr-1 ${poolLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-2">
        {(['deposit', 'withdraw', 'verify'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setError(null); }}
            className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${
              activeTab === tab
                ? 'bg-primary/10 text-primary font-semibold border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'deposit' && <><ArrowDownToLine className="w-3.5 h-3.5 inline mr-1" /> Deposit</>}
            {tab === 'withdraw' && <><ArrowUpFromLine className="w-3.5 h-3.5 inline mr-1" /> Withdraw</>}
            {tab === 'verify' && <><FileCode className="w-3.5 h-3.5 inline mr-1" /> Verify</>}
          </button>
        ))}
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Deposit Tab ──────────────────────────────────────── */}
      {activeTab === 'deposit' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Amount (satoshis)</label>
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="e.g. 100000000 (= 1 HSMC)"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono"
              min="1"
            />
            <p className="text-xs text-muted-foreground mt-1">1 HSMC = 100,000,000 satoshis</p>
          </div>
          <Button onClick={handleDeposit} disabled={loading} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
            Deposit Privately
          </Button>

          {depositNote && (
            <div className="p-4 bg-green-500/5 border border-green-500/20 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-green-600 font-semibold">
                <Check className="w-4 h-4" />
                Deposit successful!
              </div>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Commitment:</span>
                  <div className="flex items-center gap-1">
                    <span className="truncate max-w-[200px]">{depositNote.commitment.slice(0, 20)}…</span>
                    <Copy className="w-3 h-3 cursor-pointer hover:text-primary" onClick={() => copyToClipboard(depositNote.commitment)} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Amount:</span>
                  <span>{depositNote.amount.toLocaleString()} satoshis</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Blinding:</span>
                  <div className="flex items-center gap-1">
                    <span className="truncate max-w-[200px]">
                      {showBlinding ? depositNote.blinding : depositNote.blinding.slice(0, 10) + '…'}
                    </span>
                    <button onClick={() => setShowBlinding(!showBlinding)} className="text-primary">
                      {showBlinding ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                    <Copy className="w-3 h-3 cursor-pointer hover:text-primary" onClick={() => copyToClipboard(depositNote.blinding)} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Leaf Index:</span>
                  <span>{depositNote.leaf_index}</span>
                </div>
              </div>
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-xs text-amber-600">
                <strong>⚠️ Save these values!</strong> You need the commitment, blinding, and leaf index to withdraw later.
                Copy the full note below:
              </div>
              <pre className="text-xs bg-black/20 p-2 rounded overflow-x-auto max-h-32">
                {JSON.stringify(depositNote, null, 2)}
              </pre>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(JSON.stringify(depositNote))}>
                <Copy className="w-3 h-3 mr-1" /> Copy Note JSON
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Withdraw Tab ─────────────────────────────────────── */}
      {activeTab === 'withdraw' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Note JSON</label>
            <textarea
              value={withdrawNoteJson}
              onChange={(e) => setWithdrawNoteJson(e.target.value)}
              placeholder='{"commitment":"hex...","amount":100000000,"blinding":"hex...","leaf_index":0}'
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono text-xs h-24 resize-y"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Secret (hex, 32 bytes)</label>
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-muted-foreground" />
              <input
                type={showBlinding ? 'text' : 'password'}
                value={withdrawSecret}
                onChange={(e) => setWithdrawSecret(e.target.value)}
                placeholder="hex-encoded secret..."
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono text-sm"
              />
              <button onClick={() => setShowBlinding(!showBlinding)} className="text-primary">
                {showBlinding ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Button onClick={handleWithdraw} disabled={loading} className="w-full" variant="destructive">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowUpFromLine className="w-4 h-4 mr-2" />}
            Withdraw
          </Button>

          {withdrawAmount !== null && (
            <div className="p-4 bg-green-500/5 border border-green-500/20 rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-green-600 font-semibold">
                <Check className="w-4 h-4" />
                Withdraw successful!
              </div>
              <div className="text-sm font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount:</span>
                  <span>{withdrawAmount.toLocaleString()} satoshis</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Nullifier:</span>
                  <div className="flex items-center gap-1">
                    <span className="truncate max-w-[200px]">{withdrawNullifier?.slice(0, 20)}…</span>
                    <Copy className="w-3 h-3 cursor-pointer hover:text-primary" onClick={() => withdrawNullifier && copyToClipboard(withdrawNullifier)} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Verify Tab ───────────────────────────────────────── */}
      {activeTab === 'verify' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Proof JSON</label>
            <textarea
              value={verifyProofJson}
              onChange={(e) => setVerifyProofJson(e.target.value)}
              placeholder='{"proof_hex":"..."}'
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono text-xs h-24 resize-y"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Public Inputs JSON</label>
            <textarea
              value={verifyInputsJson}
              onChange={(e) => setVerifyInputsJson(e.target.value)}
              placeholder='{"merkle_root":"hex","operation":0,"nullifier":"hex"}'
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono text-xs h-24 resize-y"
            />
          </div>
          <Button onClick={handleVerify} disabled={loading} className="w-full" variant="outline">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileCode className="w-4 h-4 mr-2" />}
            Verify Proof
          </Button>

          {verifyResult !== null && (
            <div className={`p-4 rounded-lg border ${
              verifyResult ? 'bg-green-500/5 border-green-500/20' : 'bg-destructive/5 border-destructive/20'
            }`}>
              <div className="flex items-center gap-2">
                {verifyResult ? (
                  <><Check className="w-5 h-5 text-green-600" /><span className="text-green-600 font-semibold">Proof valid</span></>
                ) : (
                  <><X className="w-5 h-5 text-destructive" /><span className="text-destructive font-semibold">Proof invalid</span></>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
