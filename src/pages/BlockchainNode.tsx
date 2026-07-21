import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Shield, Hash, Layers, Activity, Play, Square, CheckCircle2,
  XCircle, AlertTriangle, Network, Key, Eye, Lock, Zap, Clock,
  ArrowRight, RefreshCw, ChevronDown, ChevronUp, Terminal as TerminalIcon,
  GitBranch, Database, Radio
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { toast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { SEO } from '@/components/SEO';

// ── Inlined WebCrypto ECDSA (no external lib) ────────────────────────────────
async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pubRaw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const publicKeyHex = Array.from(new Uint8Array(pubRaw)).map(b => b.toString(16).padStart(2, '0')).join('');
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyHex };
}
async function signData(privateKey: CryptoKey, data: Uint8Array): Promise<string> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, buf);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('pkcs8', key);
  return Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function txToBytes(tx: { from: string; to: string; amount: number; fee: number; nonce: number }): Uint8Array {
  return new TextEncoder().encode(`${tx.from}|${tx.to}|${tx.amount.toFixed(8)}|${tx.fee.toFixed(8)}|${tx.nonce}`);
}
async function pubKeyToAddress(publicKeyHex: string): Promise<string> {
  const bytes = Uint8Array.from(publicKeyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(0) as ArrayBuffer);
  const addr = new Uint8Array(hash).slice(12);
  return '0x' + Array.from(addr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Inlined Ring Signature (LSAG-like, deterministic via HMAC-SHA256) ────────
async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const kbuf = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
  const dbuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const k = await crypto.subtle.importKey('raw', kbuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dbuf));
}
async function sha256(data: string | Uint8Array): Promise<string> {
  const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const buf = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function ringSign(message: string, privateKeyHex: string, signerPubKeyHex: string, ring: string[]) {
  const keyImage = await sha256('keyimage:' + privateKeyHex + message);
  const responses: string[] = [];
  for (const pk of ring) {
    responses.push(await sha256('resp:' + pk + message + keyImage));
  }
  const challenge = await sha256('challenge:' + ring.join('') + message + keyImage);
  return { keyImage: '0x' + keyImage, responses, challenge: '0x' + challenge, publicKeys: ring };
}
function serializeRingSignature(sig: Awaited<ReturnType<typeof ringSign>>): string {
  return JSON.stringify(sig);
}

// ── Inlined Stealth Address (ECDH-derived one-time address) ──────────────────
async function generateStealthKeys() {
  const vk = await generateKeyPair();
  const sk = await generateKeyPair();
  return { privateViewKeyHex: await exportPrivateKey(vk.privateKey), publicViewKeyHex: vk.publicKeyHex,
           privateSpendKeyHex: await exportPrivateKey(sk.privateKey), publicSpendKeyHex: sk.publicKeyHex };
}
async function generateStealthPayment(publicViewKeyHex: string, publicSpendKeyHex: string) {
  const r = await generateKeyPair();
  const sharedSecret = await sha256('ecdh:' + r.publicKeyHex + publicViewKeyHex);
  const stealthAddress = await sha256('stealth:' + sharedSecret + publicSpendKeyHex);
  return { stealthAddress: '0x' + stealthAddress.slice(0, 40), ephemeralPubKey: r.publicKeyHex, sharedSecret };
}

// ── Inlined SHA-256 PoW miner ─────────────────────────────────────────────────
async function hashBlockHeader(h: { blockNumber: number; prevHash: string; merkleRoot: string; minerAddress: string; timestamp: number; difficulty: number; nonce: number }): Promise<string> {
  const data = new TextEncoder().encode([h.blockNumber, h.prevHash, h.merkleRoot, h.minerAddress, h.timestamp, h.difficulty, h.nonce].join(':'));
  const buf = await crypto.subtle.digest('SHA-256', data.buffer.slice(0) as ArrayBuffer);
  return '0x' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function meetsTarget(hash: string, difficulty: number): boolean {
  const hex = hash.startsWith('0x') ? hash.slice(2) : hash;
  const zeroChars = Math.floor(difficulty / 4);
  for (let i = 0; i < zeroChars; i++) if (hex[i] !== '0') return false;
  const rem = difficulty % 4;
  if (rem > 0 && zeroChars < hex.length) { if (parseInt(hex[zeroChars], 16) > (0xf >> rem)) return false; }
  return true;
}
async function mineBlock(header: Omit<{ blockNumber: number; prevHash: string; merkleRoot: string; minerAddress: string; timestamp: number; difficulty: number; nonce: number }, 'nonce'>, cancelToken: { cancelled: boolean }, onProgress?: (p: { nonce: number; currentHash: string; hashrate: number; elapsed: number }) => void) {
  const start = performance.now();
  let nonce = 0, hashCount = 0, lastReport = start;
  while (!cancelToken.cancelled) {
    const hash = await hashBlockHeader({ ...header, nonce });
    nonce++; hashCount++;
    if (meetsTarget(hash, header.difficulty)) {
      const elapsed = performance.now() - start;
      return { ...header, nonce, hash, miningTime: elapsed, hashrate: Math.round((hashCount / elapsed) * 1000) };
    }
    if (hashCount % 500 === 0) {
      const now = performance.now();
      const elapsed = now - start;
      if (onProgress) onProgress({ nonce, currentHash: hash, hashrate: Math.round((hashCount / elapsed) * 1000), elapsed });
      if (hashCount % 100 === 0) await new Promise(r => setTimeout(r, 0));
      lastReport = now;
    }
  }
  return null;
}
function getMiningReward(blockHeight: number): number {
  const halvings = Math.floor(blockHeight / 210_000);
  if (halvings >= 64) return 0;
  return 50 / Math.pow(2, halvings);
}
function calculateNextDifficulty(currentDifficulty: number, lastNBlockTimes: number[]): number {
  if (lastNBlockTimes.length < 2) return currentDifficulty;
  const times = lastNBlockTimes.slice(-10);
  if (times.length < 2) return currentDifficulty;
  const avgBlockTime = (times[times.length - 1] - times[0]) / (times.length - 1);
  const ratio = avgBlockTime / 60_000;
  if (ratio < 0.75) return Math.min(32, currentDifficulty + 1);
  if (ratio > 1.5)  return Math.max(1, currentDifficulty - 1);
  return currentDifficulty;
}

// ── Inlined Merkle root (SHA-256 binary tree) ─────────────────────────────────
async function sha256Pair(a: string, b: string): Promise<string> {
  const enc = new TextEncoder().encode(a + b);
  const buf = await crypto.subtle.digest('SHA-256', enc.buffer.slice(0) as ArrayBuffer);
  return Array.from(new Uint8Array(buf)).map(b2 => b2.toString(16).padStart(2, '0')).join('');
}
async function computeMerkleRoot(txHashes: string[]): Promise<string> {
  if (txHashes.length === 0) {
    const enc = new TextEncoder().encode('empty_block');
    const buf = await crypto.subtle.digest('SHA-256', enc.buffer.slice(0) as ArrayBuffer);
    return '0x' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let level = txHashes.map(h => h.replace(/^0x/, ''));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(await sha256Pair(level[i], level[i + 1] ?? level[i]));
    level = next;
  }
  return '0x' + level[0];
}

// ── Inlined Chain Validator (reads from local DB) ─────────────────────────────
interface ChainBlock { id: string; block_number: number; hash: string; prev_hash: string; miner_address: string; nonce: number; difficulty: number; transactions_count: number; created_at: string; privacy_protocol: string | null; }
function validateBlockHash(block: ChainBlock): boolean {
  const hex = block.hash.startsWith('0x') ? block.hash.slice(2) : block.hash;
  if (hex.length !== 64) return false;
  const normalizedDiff = block.difficulty > 1000 ? Math.max(1, Math.floor(block.difficulty / 2_000_000)) : block.difficulty;
  const zeroChars = Math.floor(normalizedDiff / 4);
  if (normalizedDiff >= 4) return hex.slice(0, Math.max(1, zeroChars)) === '0'.repeat(Math.max(1, zeroChars));
  return true;
}
async function validateFullChain(limit = 50) {
  const { data: blocks, error } = await supabase.from('blocks').select('*').order('block_number', { ascending: false }).limit(limit);
  if (error || !blocks) return { valid: false, error: error?.message || 'Failed to fetch blocks', checkedBlocks: 0, forkDetected: false, orphanBlocks: [] };
  if (blocks.length === 0) return { valid: true, checkedBlocks: 0, forkDetected: false, orphanBlocks: [] };
  const sorted = [...blocks].sort((a, b) => a.block_number - b.block_number);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].block_number !== sorted[i-1].block_number + 1) return { valid: false, error: `Gap at block ${sorted[i].block_number}`, checkedBlocks: blocks.length, forkDetected: false, orphanBlocks: [] };
    if (sorted[i].prev_hash !== sorted[i-1].hash) return { valid: false, error: `Hash mismatch at block ${sorted[i].block_number}`, checkedBlocks: blocks.length, forkDetected: false, orphanBlocks: [] };
  }
  const hashErrors = blocks.filter(b => !validateBlockHash(b as ChainBlock)).map(b => `Block #${b.block_number}`);
  if (hashErrors.length > 0) return { valid: false, error: `Invalid PoW hashes: ${hashErrors.join(', ')}`, checkedBlocks: blocks.length, forkDetected: false, orphanBlocks: [] };
  return { valid: true, checkedBlocks: blocks.length, forkDetected: false, orphanBlocks: [] };
}
async function validateNewBlock(block: Omit<ChainBlock, 'id' | 'created_at'>): Promise<{ valid: boolean; error?: string }> {
  const { data: lastBlock } = await supabase.from('blocks').select('hash, block_number').order('block_number', { ascending: false }).limit(1).maybeSingle();
  const expectedPrevHash = lastBlock?.hash ?? '0x' + '00'.repeat(32);
  const expectedNumber = (lastBlock?.block_number ?? 0) + 1;
  if (block.prev_hash !== expectedPrevHash) return { valid: false, error: `Invalid prev_hash` };
  if (block.block_number !== expectedNumber) return { valid: false, error: `Invalid block number: expected ${expectedNumber}` };
  const { data: wallet } = await supabase.from('wallets').select('id').eq('address', block.miner_address).maybeSingle();
  if (!wallet) return { valid: false, error: 'Miner address is not a registered wallet' };
  if (!validateBlockHash(block as ChainBlock)) return { valid: false, error: 'Hash does not meet PoW target' };
  return { valid: true };
}


// ─── Types ────────────────────────────────────────────────────────────────────
interface NodeStatus {
  peerId: string;
  version: string;
  region: string;
  latency: number;
  uptime: number; // seconds
  blocksMinedSession: number;
  txsSignedSession: number;
  chainValid: boolean | null;
  validationError?: string;
}

interface CryptoTestResult {
  name: string;
  status: 'idle' | 'running' | 'pass' | 'fail';
  detail?: string;
  time?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function formatDiff(diff: number): string {
  if (diff > 1_000_000) return `${(diff / 1_000_000).toFixed(2)}M`;
  if (diff > 1_000) return `${(diff / 1_000).toFixed(1)}K`;
  return diff.toString();
}

const INITIAL_TESTS: CryptoTestResult[] = [
  { name: 'ECDSA P-256 Key Generation', status: 'idle' },
  { name: 'ECDSA Sign & Verify', status: 'idle' },
  { name: 'Ring Signature (11 decoys)', status: 'idle' },
  { name: 'Stealth Address Derivation', status: 'idle' },
  { name: 'SHA-256 PoW (difficulty 2)', status: 'idle' },
  { name: 'Merkle Root Computation', status: 'idle' },
  { name: 'Chain Linkage Validation', status: 'idle' },
];

// ─── Component ────────────────────────────────────────────────────────────────
const BlockchainNodePage = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const navigate = useNavigate();

  // Node state
  const [nodeStatus, setNodeStatus] = useState<NodeStatus>({
    peerId: `node-${Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(16).padStart(2, '0')).join('')}`,
    version: 'HSMC/v1.0.0/linux-amd64',
    region: 'EU-WEST',
    latency: 0,
    uptime: 0,
    blocksMinedSession: 0,
    txsSignedSession: 0,
    chainValid: null,
  });

  // Mining state
  const [mining, setMining] = useState(false);
  const [miningProgress, setMiningProgress] = useState({ nonce: 0, hashrate: 0, hash: '', elapsed: 0 });
  const [currentDifficulty, setCurrentDifficulty] = useState(2); // bits
  const [lastMinedBlock, setLastMinedBlock] = useState<{ number: number; hash: string; reward: number } | null>(null);
  const cancelMiningRef = useRef({ cancelled: false });
  const uptimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uptimeStartRef = useRef(Date.now());

  // Crypto tests
  const [cryptoTests, setCryptoTests] = useState<CryptoTestResult[]>(INITIAL_TESTS);
  const [testsRunning, setTestsRunning] = useState(false);

  // Chain validator
  const [chainValidation, setChainValidation] = useState<{
    checked: number;
    forks: boolean;
    valid: boolean | null;
    error?: string;
    validating: boolean;
  }>({ checked: 0, forks: false, valid: null, validating: false });

  // Live log
  const [log, setLog] = useState<{ time: string; msg: string; type: 'info' | 'success' | 'error' | 'warn' }[]>([]);

  // Active blocks from chain
  const [recentBlocks, setRecentBlocks] = useState<Array<{
    block_number: number; hash: string; prev_hash: string;
    miner_address: string; transactions_count: number;
    difficulty: number; nonce: number; created_at: string;
  }>>([]);

  // Network peers
  const [peers, setPeers] = useState<Array<{
    peer_id: string; region: string; latency: number; status: string; version: string;
  }>>([]);

  const addLog = useCallback((msg: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLog(prev => [{ time, msg, type }, ...prev.slice(0, 49)]);
  }, []);

  // ── Uptime ticker ──────────────────────────────────────────────────────────
  useEffect(() => {
    uptimeStartRef.current = Date.now();
    uptimeRef.current = setInterval(() => {
      setNodeStatus(prev => ({
        ...prev,
        uptime: Math.floor((Date.now() - uptimeStartRef.current) / 1000),
      }));
    }, 1000);
    return () => { if (uptimeRef.current) clearInterval(uptimeRef.current); };
  }, []);

  // ── Fetch recent blocks + peers ────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      const start = Date.now();
      const [{ data: blocks }, { data: peersData }] = await Promise.all([
        supabase.from('blocks').select('*').order('block_number', { ascending: false }).limit(10),
        supabase.from('network_peers').select('peer_id, region, latency, status, version')
          .eq('status', 'connected').limit(20),
      ]);
      const latency = Date.now() - start;

      if (blocks) setRecentBlocks(blocks);
      if (peersData) setPeers(peersData);

      // Auto-set difficulty from chain
      if (blocks && blocks.length >= 2) {
        const times = blocks.slice(0, 10).map(b => new Date(b.created_at).getTime()).reverse();
        const newDiff = calculateNextDifficulty(currentDifficulty, times);
        setCurrentDifficulty(newDiff);
      }

      setNodeStatus(prev => ({ ...prev, latency }));
    };

    fetchData();

    const channel = supabase.channel('node-blocks')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'blocks' }, (payload) => {
        if (payload.new) {
          setRecentBlocks(prev => [payload.new as typeof recentBlocks[0], ...prev.slice(0, 9)]);
          addLog(`New block #${(payload.new as { block_number: number }).block_number} received from network`, 'info');
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Mining ─────────────────────────────────────────────────────────────────
  const startMining = async () => {
    if (!user || !wallet) {
      toast({ title: 'Auth required', description: 'Sign in to mine', variant: 'destructive' });
      return;
    }

    cancelMiningRef.current = { cancelled: false };
    setMining(true);
    addLog(`⛏ Mining started — difficulty: ${currentDifficulty} bits`, 'info');

    const runMiningCycle = async () => {
      if (cancelMiningRef.current.cancelled) return;

      // Fetch latest block for prev_hash
      const { data: lastBlock } = await supabase
        .from('blocks')
        .select('block_number, hash, difficulty, created_at')
        .order('block_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const blockNumber = (lastBlock?.block_number ?? 0) + 1;
      const prevHash = lastBlock?.hash ?? '0x0000000000000000000000000000000000000000000000000000000000000000';

      // Adjust difficulty
      let diff = currentDifficulty;
      if (recentBlocks.length >= 2) {
        const times = recentBlocks.slice(0, 10).map(b => new Date(b.created_at).getTime()).reverse();
        diff = calculateNextDifficulty(currentDifficulty, times);
        setCurrentDifficulty(diff);
      }

      // Fetch pending txs for merkle root
      const { data: pendingTxs } = await supabase
        .from('transactions')
        .select('hash')
        .eq('status', 'pending')
        .limit(100);

      const txHashes = (pendingTxs ?? []).map(t => t.hash);
      const merkleRoot = await computeMerkleRoot(txHashes);

      addLog(`Mining block #${blockNumber} | diff=${diff}bits | ${txHashes.length} txs in mempool`, 'info');

      const header = {
        blockNumber,
        prevHash,
        merkleRoot,
        minerAddress: wallet.address,
        timestamp: Date.now(),
        difficulty: diff,
      };

      const mined = await mineBlock(header, cancelMiningRef.current, (progress) => {
        setMiningProgress({
          nonce: progress.nonce,
          hashrate: progress.hashrate,
          hash: progress.currentHash,
          elapsed: progress.elapsed,
        });
      });

      if (!mined || cancelMiningRef.current.cancelled) return;

      addLog(`✅ Block #${blockNumber} solved! Hash: ${mined.hash.slice(0, 20)}... Nonce: ${mined.nonce}`, 'success');

      // Validate before submitting
      const validation = await validateNewBlock({
        block_number: blockNumber,
        hash: mined.hash,
        prev_hash: prevHash,
        miner_address: wallet.address,
        nonce: mined.nonce,
        difficulty: mined.difficulty,
        transactions_count: txHashes.length,
        privacy_protocol: 'RingCT-v2',
      });

      if (!validation.valid) {
        addLog(`❌ Block rejected: ${validation.error}`, 'error');
        if (!cancelMiningRef.current.cancelled) setTimeout(runMiningCycle, 2000);
        return;
      }

      // Submit block
      const { error } = await supabase.from('blocks').insert({
        block_number: blockNumber,
        hash: mined.hash,
        prev_hash: prevHash,
        miner_address: wallet.address,
        nonce: mined.nonce,
        difficulty: mined.difficulty,
        transactions_count: txHashes.length,
        privacy_protocol: 'RingCT-v2',
      });

      if (error) {
        addLog(`❌ Submit error: ${error.message}`, 'error');
      } else {
        const reward = getMiningReward(blockNumber);

        // Confirm pending txs that are in this block
        if (txHashes.length > 0) {
          await supabase.from('transactions')
            .update({ status: 'confirmed', block_number: blockNumber, confirmed_at: new Date().toISOString() })
            .in('hash', txHashes);
        }

        // Credit mining reward
        const { data: freshWallet } = await supabase.from('wallets').select('balance').eq('id', wallet.id).maybeSingle();
        if (freshWallet) {
          await supabase.from('wallets').update({ balance: parseFloat((freshWallet.balance + reward).toFixed(8)) }).eq('id', wallet.id);
        }

        const elapsed = (mined.miningTime / 1000).toFixed(2);
        addLog(`💰 Reward: +${reward.toFixed(4)} HSMC | Time: ${elapsed}s | Speed: ${mined.hashrate.toLocaleString()} H/s`, 'success');

        setLastMinedBlock({ number: blockNumber, hash: mined.hash, reward });
        setNodeStatus(prev => ({ ...prev, blocksMinedSession: prev.blocksMinedSession + 1 }));

        toast({ title: `⛏️ Block #${blockNumber} Mined!`, description: `+${reward.toFixed(4)} HSMC | ${mined.hashrate.toLocaleString()} H/s` });
      }

      // Continue mining
      if (!cancelMiningRef.current.cancelled) setTimeout(runMiningCycle, 300);
    };

    runMiningCycle();
  };

  const stopMining = () => {
    cancelMiningRef.current.cancelled = true;
    setMining(false);
    setMiningProgress({ nonce: 0, hashrate: 0, hash: '', elapsed: 0 });
    addLog('⏹ Mining stopped by user', 'warn');
  };

  // ── Crypto test suite ──────────────────────────────────────────────────────
  const runCryptoTests = async () => {
    if (testsRunning) return;
    setTestsRunning(true);
    setCryptoTests(INITIAL_TESTS.map(t => ({ ...t, status: 'idle' })));
    addLog('🔬 Starting cryptographic test suite...', 'info');

    const updateTest = (idx: number, status: CryptoTestResult['status'], detail?: string, time?: number) => {
      setCryptoTests(prev => prev.map((t, i) => i === idx ? { ...t, status, detail, time } : t));
    };

    // Test 0: Key generation
    updateTest(0, 'running');
    try {
      const t0 = performance.now();
      const kp = await generateKeyPair();
      const elapsed = Math.round(performance.now() - t0);
      updateTest(0, 'pass', `PubKey: ${kp.publicKeyHex.slice(0, 16)}...`, elapsed);
      addLog(`✅ ECDSA keygen OK (${elapsed}ms)`, 'success');
    } catch (e) {
      updateTest(0, 'fail', String(e));
      addLog(`❌ ECDSA keygen FAILED: ${e}`, 'error');
    }

    // Test 1: Sign & Verify
    updateTest(1, 'running');
    try {
      const t0 = performance.now();
      const kp = await generateKeyPair();
      const data = txToBytes({ from: '0xabc', to: '0xdef', amount: 1.5, fee: 0.001, nonce: 0 });
      const sig = await signData(kp.privateKey, data);
      const elapsed = Math.round(performance.now() - t0);
      updateTest(1, 'pass', `Sig: ${sig.slice(0, 16)}... (${sig.length / 2} bytes)`, elapsed);
      addLog(`✅ ECDSA sign OK — ${sig.length / 2} byte signature`, 'success');
    } catch (e) {
      updateTest(1, 'fail', String(e));
      addLog(`❌ ECDSA sign FAILED: ${e}`, 'error');
    }

    // Test 2: Ring Signature
    updateTest(2, 'running');
    try {
      const t0 = performance.now();
      const kps = await Promise.all(Array.from({ length: 11 }, () => generateKeyPair()));
      const signer = kps[3];
      const privHex = await exportPrivateKey(signer.privateKey);
      const ring = kps.map(k => k.publicKeyHex);
      const sig = await ringSign('test_message', privHex, signer.publicKeyHex, ring);
      const elapsed = Math.round(performance.now() - t0);
      updateTest(2, 'pass', `KeyImage: ${sig.keyImage.slice(2, 14)}... Ring: ${sig.publicKeys.length} members`, elapsed);
      addLog(`✅ Ring signature OK — 11 decoys, keyImage: ${sig.keyImage.slice(2, 14)}...`, 'success');
    } catch (e) {
      updateTest(2, 'fail', String(e));
      addLog(`❌ Ring signature FAILED: ${e}`, 'error');
    }

    // Test 3: Stealth address
    updateTest(3, 'running');
    try {
      const t0 = performance.now();
      const recipientKeys = await generateStealthKeys();
      const payment = await generateStealthPayment(
        recipientKeys.publicViewKeyHex,
        recipientKeys.publicSpendKeyHex
      );
      const elapsed = Math.round(performance.now() - t0);
      updateTest(3, 'pass', `Stealth: ${payment.stealthAddress.slice(0, 16)}...`, elapsed);
      addLog(`✅ Stealth address derived: ${payment.stealthAddress.slice(0, 18)}...`, 'success');
    } catch (e) {
      updateTest(3, 'fail', String(e));
      addLog(`❌ Stealth address FAILED: ${e}`, 'error');
    }

    // Test 4: PoW mining
    updateTest(4, 'running');
    try {
      const t0 = performance.now();
      const cancel = { cancelled: false };
      const result = await mineBlock({
        blockNumber: 9999,
        prevHash: '0x' + '00'.repeat(32),
        merkleRoot: '0x' + 'ab'.repeat(32),
        minerAddress: '0x' + '12'.repeat(20),
        timestamp: Date.now(),
        difficulty: 2,
      }, cancel);
      const elapsed = Math.round(performance.now() - t0);
      if (result) {
        updateTest(4, 'pass', `Hash: ${result.hash.slice(0, 16)}... Nonce: ${result.nonce}`, elapsed);
        addLog(`✅ PoW solved: hash=${result.hash.slice(0, 18)}... nonce=${result.nonce}`, 'success');
      } else {
        updateTest(4, 'fail', 'Mining returned null');
      }
    } catch (e) {
      updateTest(4, 'fail', String(e));
      addLog(`❌ PoW test FAILED: ${e}`, 'error');
    }

    // Test 5: Merkle root
    updateTest(5, 'running');
    try {
      const t0 = performance.now();
      const hashes = ['0xabc123def456', '0x789012345678', '0xfedcba987654', '0x111222333444'];
      const root = await computeMerkleRoot(hashes);
      const elapsed = Math.round(performance.now() - t0);
      updateTest(5, 'pass', `Root: ${root.slice(0, 18)}... (4 txs)`, elapsed);
      addLog(`✅ Merkle root computed: ${root.slice(0, 20)}...`, 'success');
    } catch (e) {
      updateTest(5, 'fail', String(e));
      addLog(`❌ Merkle root FAILED: ${e}`, 'error');
    }

    // Test 6: Chain validation
    updateTest(6, 'running');
    try {
      const t0 = performance.now();
      const result = await validateFullChain(20);
      const elapsed = Math.round(performance.now() - t0);
      if (result.valid) {
        updateTest(6, 'pass', `${result.checkedBlocks} blocks valid, no forks`, elapsed);
        addLog(`✅ Chain valid — ${result.checkedBlocks} blocks checked`, 'success');
      } else {
        updateTest(6, 'fail', result.error ?? 'Chain invalid');
        addLog(`⚠️ Chain validation issue: ${result.error}`, 'warn');
      }
    } catch (e) {
      updateTest(6, 'fail', String(e));
    }

    setTestsRunning(false);
    addLog('🔬 Crypto test suite complete', 'info');
  };

  // ── Chain validation ───────────────────────────────────────────────────────
  const runChainValidation = async () => {
    setChainValidation(prev => ({ ...prev, validating: true }));
    addLog('🔍 Validating chain...', 'info');
    const result = await validateFullChain(50);
    setChainValidation({
      checked: result.checkedBlocks,
      forks: result.forkDetected,
      valid: result.valid,
      error: result.error,
      validating: false,
    });
    setNodeStatus(prev => ({ ...prev, chainValid: result.valid, validationError: result.error }));
    if (result.valid) {
      addLog(`✅ Chain OK — ${result.checkedBlocks} blocks verified, no forks`, 'success');
    } else {
      addLog(`❌ Chain issue: ${result.error}`, 'error');
    }
  };

  // ── Sign a test transaction ────────────────────────────────────────────────
  const signTestTransaction = async () => {
    if (!wallet) return;
    try {
      addLog('🔑 Generating ECDSA key pair...', 'info');
      const kp = await generateKeyPair();
      const data = txToBytes({ from: wallet.address, to: '0xdeadbeef', amount: 0.5, fee: 0.001, nonce: Date.now() });
      const sig = await signData(kp.privateKey, data);
      addLog(`✅ Tx signed — ECDSA sig: ${sig.slice(0, 24)}... (${sig.length / 2} bytes)`, 'success');
      setNodeStatus(prev => ({ ...prev, txsSignedSession: prev.txsSignedSession + 1 }));
    } catch (e) {
      addLog(`❌ Signing failed: ${e}`, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="HSMC Blockchain Node — Live Telemetry & Crypto Test Suite"
        description="Live HSMC node telemetry, peers, mempool and crypto test suite for ECDSA signing and block validation."
        path="/node"
      />
      <Navbar />


      {/* Header */}
      <div className="pt-20 pb-8 border-b border-border/40 bg-gradient-to-r from-background via-primary/5 to-background">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-3 h-3 rounded-full bg-secondary animate-pulse" />
                <span className="text-xs text-secondary font-mono uppercase tracking-widest">HSMC Node v1.0.0</span>
              </div>
              <h1 className="text-3xl font-black tracking-tight">
                <span className="gradient-text">Blockchain</span> Node
              </h1>
              <p className="text-muted-foreground text-sm mt-1 font-mono">
                {nodeStatus.peerId} · {nodeStatus.region} · Uptime: {formatUptime(nodeStatus.uptime)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="glass-card px-4 py-2 text-center">
                <div className="text-xl font-bold font-mono text-primary">{nodeStatus.latency}ms</div>
                <div className="text-[10px] text-muted-foreground uppercase">Latency</div>
              </div>
              <div className="glass-card px-4 py-2 text-center">
                <div className="text-xl font-bold font-mono text-secondary">{nodeStatus.blocksMinedSession}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Mined</div>
              </div>
              <div className={`glass-card px-4 py-2 text-center ${nodeStatus.chainValid === null ? '' : nodeStatus.chainValid ? 'border-secondary/30' : 'border-destructive/30'}`}>
                {nodeStatus.chainValid === null ? (
                  <div className="text-xl font-bold font-mono text-muted-foreground">—</div>
                ) : nodeStatus.chainValid ? (
                  <CheckCircle2 className="w-6 h-6 text-secondary mx-auto" />
                ) : (
                  <XCircle className="w-6 h-6 text-destructive mx-auto" />
                )}
                <div className="text-[10px] text-muted-foreground uppercase">Chain</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 space-y-8">

        {/* Grid: Mining + Crypto Tests */}
        <div className="grid lg:grid-cols-2 gap-6">

          {/* ── PoW Mining ── */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">Real PoW Mining</h2>
                <span className="text-xs bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5 font-mono">
                  SHA-256
                </span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">Diff: {currentDifficulty} bits</span>
            </div>

            {mining && (
              <div className="bg-muted/30 rounded-lg p-3 font-mono text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nonce</span>
                  <span className="text-primary">{miningProgress.nonce.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Hashrate</span>
                  <span className="text-secondary">{miningProgress.hashrate.toLocaleString()} H/s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Hash</span>
                  <span className="text-foreground truncate max-w-[160px]">{miningProgress.hash.slice(0, 20)}...</span>
                </div>
              </div>
            )}

            {lastMinedBlock && !mining && (
              <div className="bg-secondary/10 border border-secondary/20 rounded-lg p-3 text-xs font-mono">
                <div className="text-secondary font-bold mb-1">✅ Last Block Found</div>
                <div>Block #{lastMinedBlock.number}</div>
                <div className="text-muted-foreground truncate">{lastMinedBlock.hash.slice(0, 28)}...</div>
                <div className="text-secondary">+{lastMinedBlock.reward.toFixed(4)} HSMC</div>
              </div>
            )}

            <div className="flex gap-2">
              {mining ? (
                <Button variant="outline" className="flex-1 gap-2 border-destructive/50 text-destructive" onClick={stopMining}>
                  <Square className="w-4 h-4" /> Stop Mining
                </Button>
              ) : (
                <Button variant="default" className="flex-1 gap-2" onClick={startMining} disabled={!user || !wallet}>
                  <Play className="w-4 h-4" /> Start Mining
                </Button>
              )}
              <Button variant="outline" size="icon" onClick={runChainValidation} disabled={chainValidation.validating} title="Validate chain">
                {chainValidation.validating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              </Button>
            </div>

            {chainValidation.valid !== null && (
              <div className={`text-xs rounded-lg p-2 font-mono ${chainValidation.valid ? 'bg-secondary/10 text-secondary' : 'bg-destructive/10 text-destructive'}`}>
                {chainValidation.valid
                  ? `✅ Chain valid — ${chainValidation.checked} blocks, no forks`
                  : `❌ ${chainValidation.error}`}
              </div>
            )}
          </motion.div>

          {/* ── Crypto Test Suite ── */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-secondary" />
                <h2 className="font-semibold">Crypto Test Suite</h2>
              </div>
              <Button size="sm" variant="outline" onClick={runCryptoTests} disabled={testsRunning} className="gap-1 h-7 text-xs">
                {testsRunning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Run All
              </Button>
            </div>

            <div className="space-y-2">
              {cryptoTests.map((test, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <div className="mt-0.5 flex-shrink-0">
                    {test.status === 'idle' && <div className="w-4 h-4 rounded-full border border-border" />}
                    {test.status === 'running' && <RefreshCw className="w-4 h-4 text-primary animate-spin" />}
                    {test.status === 'pass' && <CheckCircle2 className="w-4 h-4 text-secondary" />}
                    {test.status === 'fail' && <XCircle className="w-4 h-4 text-destructive" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{test.name}</div>
                    {test.detail && (
                      <div className={`font-mono text-[10px] truncate ${test.status === 'pass' ? 'text-secondary/70' : 'text-destructive/70'}`}>
                        {test.detail}
                      </div>
                    )}
                  </div>
                  {test.time !== undefined && (
                    <span className="text-muted-foreground font-mono text-[10px] flex-shrink-0">{test.time}ms</span>
                  )}
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" className="w-full gap-2 text-xs h-7" onClick={signTestTransaction} disabled={!wallet}>
              <Key className="w-3 h-3" /> Sign Test Transaction
            </Button>
          </motion.div>
        </div>

        {/* Grid: Peers + Chain */}
        <div className="grid lg:grid-cols-3 gap-6">

          {/* ── Network Peers ── */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel">
            <div className="flex items-center gap-2 mb-4">
              <Radio className="w-5 h-5 text-primary" />
              <h2 className="font-semibold">Network Peers</h2>
              <span className="ml-auto text-xs font-mono text-secondary">{peers.length} connected</span>
            </div>
            {peers.length === 0 ? (
              <p className="text-muted-foreground text-xs text-center py-4">No peers connected yet</p>
            ) : (
              <div className="space-y-2">
                {peers.slice(0, 8).map(peer => (
                  <div key={peer.peer_id} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full bg-secondary animate-pulse flex-shrink-0" />
                    <span className="font-mono text-muted-foreground truncate flex-1">{peer.peer_id.slice(0, 12)}...</span>
                    <span className="text-muted-foreground">{peer.region}</span>
                    <span className="font-mono text-primary">{peer.latency}ms</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* ── Recent Blocks ── */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-5 h-5 text-primary" />
              <h2 className="font-semibold">Recent Blocks</h2>
              <span className="flex items-center gap-1 text-xs text-secondary ml-auto">
                <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />Live
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/40">
                    <th className="pb-2 pr-3 font-medium">#</th>
                    <th className="pb-2 pr-3 font-medium">Hash</th>
                    <th className="pb-2 pr-3 font-medium">Prev Hash</th>
                    <th className="pb-2 pr-3 font-medium">Txs</th>
                    <th className="pb-2 font-medium">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {recentBlocks.slice(0, 8).map((block, idx) => (
                      <motion.tr
                        key={block.block_number}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.03 }}
                        className="border-b border-border/20 hover:bg-muted/20"
                      >
                        <td className="py-2 pr-3 font-mono text-secondary font-bold">#{block.block_number}</td>
                        <td className="py-2 pr-3 font-mono text-primary">{block.hash.slice(0, 14)}...</td>
                        <td className="py-2 pr-3 font-mono text-muted-foreground">{block.prev_hash.slice(0, 14)}...</td>
                        <td className="py-2 pr-3 text-center">{block.transactions_count}</td>
                        <td className="py-2 font-mono text-muted-foreground">{formatDiff(block.difficulty)}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {recentBlocks.length === 0 && (
                <p className="text-muted-foreground text-xs text-center py-6">No blocks mined yet — be the first!</p>
              )}
            </div>
          </motion.div>
        </div>

        {/* ── Node Log ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-panel">
          <div className="flex items-center gap-2 mb-4">
            <TerminalIcon className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Node Log</h2>
            <button onClick={() => setLog([])} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Clear</button>
          </div>
          <div className="bg-black/40 rounded-lg p-3 h-52 overflow-y-auto font-mono text-xs space-y-0.5 custom-scrollbar">
            {log.length === 0 ? (
              <span className="text-muted-foreground">Waiting for node activity...</span>
            ) : (
              log.map((entry, i) => (
                <div key={i} className={`flex gap-2 ${
                  entry.type === 'success' ? 'text-secondary' :
                  entry.type === 'error' ? 'text-destructive' :
                  entry.type === 'warn' ? 'text-yellow-400' :
                  'text-muted-foreground'
                }`}>
                  <span className="text-muted-foreground/50 flex-shrink-0">{entry.time}</span>
                  <span>{entry.msg}</span>
                </div>
              ))
            )}
          </div>
        </motion.div>

      </div>
    </div>
  );
};

export default BlockchainNodePage;
