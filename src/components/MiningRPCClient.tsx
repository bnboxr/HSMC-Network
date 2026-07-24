/**
 * HSMC Mining Client — Stratum V1 + V2, Web Worker powered.
 *
 * Connects to the HSMC Stratum server via WebSocket.
 * Auto-negotiates protocol: tries Stratum V2 (binary), falls back to V1 (JSON).
 * All mining happens in a dedicated Web Worker (mining-worker.ts).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Zap, Activity, Play, Square, Settings2, Hash,
  Server, User, Target, BarChart3, Award,
  Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2,
  Radio, Shield
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { toast } from '@/hooks/use-toast';
import MiningWorker from '@/workers/mining-worker?worker';
import {
  V2MsgType,
  V2Algo,
  encodeV2Frame,
  decodeV2Frame,
  isV2Frame,
  encodeSetupConnection,
  decodeSetupConnectionSuccess,
  decodeNewMiningJob,
  encodeSubmitShare,
  decodeSubmitShareResponse,
  decodeSetDifficulty,
  encodeJobNegotiation,
  type V2NewMiningJob,
  type V2SetupConnectionSuccess,
} from '@/utils/stratum-v2';

type Algorithm = 'RandomX' | 'SHA-256' | 'ProgPoW' | 'KawPoW' | 'Ethash' | 'X11';

interface PoolConfig {
  url: string;
  workerName: string;
  algorithm: Algorithm;
  difficultyTarget: number;
}

interface RpcStats {
  hashrate: number;
  sharesAccepted: number;
  sharesRejected: number;
  blocksFound: number;
  totalEarned: number;
  uptime: number;
  ping: number;
  difficulty: number;
  connected: boolean;
  protocolVersion: string | null; // 'v1' | 'v2'
}

const DEFAULT_STRATUM_URL = 'ws://localhost:3333';
const STRATUM_URL_STORAGE_KEY = 'hsmc_mining_stratum_url';

function loadStratumUrl(): string {
  try {
    return localStorage.getItem(STRATUM_URL_STORAGE_KEY)?.trim() || DEFAULT_STRATUM_URL;
  } catch {
    return DEFAULT_STRATUM_URL;
  }
}

function saveStratumUrl(url: string): void {
  try {
    localStorage.setItem(STRATUM_URL_STORAGE_KEY, url);
  } catch { /* ignore */ }
}

const ALGORITHMS: { id: Algorithm; label: string; desc: string }[] = [
  { id: 'RandomX', label: 'RandomX', desc: 'CPU-optimized, ASIC-resistant' },
  { id: 'SHA-256', label: 'SHA-256', desc: 'Classic PoW — ASIC dominant' },
  { id: 'ProgPoW', label: 'ProgPoW', desc: 'GPU-friendly, ASIC-resistant' },
  { id: 'KawPoW', label: 'KawPoW', desc: 'GPU memory-hard' },
  { id: 'Ethash', label: 'Ethash', desc: 'Memory-hard DAG PoW' },
  { id: 'X11', label: 'X11', desc: 'Chained 11 hash functions' },
];

function algoToV2Algo(algo: Algorithm): V2Algo {
  switch (algo) {
    case 'RandomX': return V2Algo.RandomX;
    case 'SHA-256': return V2Algo.SHA256d;
    case 'ProgPoW': return V2Algo.ProgPoW;
    case 'KawPoW': return V2Algo.KawPoW;
    case 'Ethash': return V2Algo.Ethash;
    case 'X11': return V2Algo.X11;
    default: return V2Algo.SHA256d;
  }
}

function isStratumUrl(url: string): boolean {
  return url.startsWith('ws://') || url.startsWith('wss://');
}

function isPlaceholderUrl(url: string): boolean {
  return /YOUR_VPS_IP|placeholder|example\.com/i.test(url);
}

// ─── V2 Connection ─────────────────────────────────────────────────────

async function tryStratumV2Connect(
  url: string,
  workerName: string,
  miningAddress: string,
  algo: Algorithm,
): Promise<{
  ws: WebSocket;
  job: { jobId: string; prevHash: string; target: string; blockNumber: number };
} | null> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket;
    let protocolOk = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws?.close(); } catch { /* ignore */ }
        resolve(null);
      }
    }, 8000);

    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timeout);
      resolve(null);
      return;
    }

    // Must use binary for V2
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      // Send V2 SetupConnection
      const setupPayload = encodeSetupConnection(2, 2, 0x01);
      const setupFrame = encodeV2Frame(V2MsgType.SetupConnection, setupPayload);
      ws.send(setupFrame);
    };

    ws.onmessage = (evt: MessageEvent) => {
      if (settled) return;

      // V2 messages come as binary
      if (evt.data instanceof ArrayBuffer || evt.data instanceof Uint8Array) {
        const data = new Uint8Array(evt.data);
        const frame = decodeV2Frame(data);
        if (!frame) return;

        if (frame.msgType === V2MsgType.SetupConnectionSuccess) {
          try {
            const success = decodeSetupConnectionSuccess(frame.payload);
            console.log(`[V2] SetupConnectionSuccess: version=${success.version} server=${success.serverName}`);
            protocolOk = true;

            // Send job negotiation
            const negPayload = encodeJobNegotiation(BigInt(4), algoToV2Algo(algo));
            ws.send(encodeV2Frame(V2MsgType.JobNegotiation, negPayload));
          } catch (e) {
            console.error('[V2] Failed to decode SetupConnectionSuccess:', e);
          }
          return;
        }

        if (frame.msgType === V2MsgType.SetupConnectionError) {
          console.log('[V2] SetupConnectionError — falling back to V1');
          settled = true;
          clearTimeout(timeout);
          try { ws.close(); } catch { /* ignore */ }
          resolve(null);
          return;
        }

        if (frame.msgType === V2MsgType.NewMiningJob && protocolOk) {
          try {
            const job = decodeNewMiningJob(frame.payload);
            settled = true;
            clearTimeout(timeout);

            const targetHex = Array.from(job.target).map(b => b.toString(16).padStart(2, '0')).join('');
            const prevHashHex = Array.from(job.prevHash).map(b => b.toString(16).padStart(2, '0')).join('');

            resolve({
              ws,
              job: {
                jobId: job.jobId.toString(16),
                prevHash: `0x${prevHashHex}`,
                target: targetHex,
                blockNumber: job.blockNumber,
              },
            });
          } catch (e) {
            console.error('[V2] Failed to decode NewMiningJob:', e);
          }
          return;
        }

        // SetDifficulty — just log, don't settle
        if (frame.msgType === V2MsgType.SetDifficulty) {
          const diff = decodeSetDifficulty(frame.payload);
          console.log(`[V2] Difficulty set to ${diff}`);
          return;
        }
      }

      // If we got a text message, it might be V1 — reject V2
      if (typeof evt.data === 'string') {
        console.log('[V2] Received text message — falling back to V1');
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch { /* ignore */ }
        resolve(null);
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(null);
      }
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(null);
      }
    };
  });
}

// ─── V1 Connection (legacy) ────────────────────────────────────────────

async function tryStratumV1Connect(
  url: string,
  workerName: string,
  miningAddress: string,
): Promise<{
  ws: WebSocket;
  job: { jobId: string; prevHash: string; target: string; blockNumber: number };
} | null> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws?.close(); } catch { /* ignore */ }
        resolve(null);
      }
    }, 8000);

    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timeout);
      resolve(null);
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'mining.subscribe', params: [workerName, '2.0'] }));
      ws.send(JSON.stringify({ id: 2, method: 'mining.authorize', params: [miningAddress, workerName] }));
    };

    ws.onmessage = (evt: MessageEvent) => {
      if (settled) return;
      try {
        const msg = JSON.parse(evt.data);
        if (msg && !settled) {
          settled = true;
          clearTimeout(timeout);
          const params = msg.params ?? {};
          const result = msg.result ?? {};
          resolve({
            ws,
            job: {
              jobId: params[0] ?? result.job_id ?? '0',
              prevHash: params[1] ?? result.prev_hash ?? '0x0',
              target: params[6] ?? result.target ?? '0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
              blockNumber: result.block_number ?? 1,
            },
          });
        }
      } catch { /* wait */ }
    };

    ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(null); } };
    ws.onclose = () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(null); } };
  });
}

// ─── Component ─────────────────────────────────────────────────────────

export const MiningRPCClient = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();

  const [config, setConfig] = useState<PoolConfig>({
    url: loadStratumUrl(),
    workerName: 'worker01',
    algorithm: 'SHA-256',
    difficultyTarget: 4,
  });

  const [mining, setMining] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [stats, setStats] = useState<RpcStats>({
    hashrate: 0,
    sharesAccepted: 0,
    sharesRejected: 0,
    blocksFound: 0,
    totalEarned: 0,
    uptime: 0,
    ping: 0,
    difficulty: 4,
    connected: false,
    protocolVersion: null,
  });
  const [log, setLog] = useState<
    { time: string; msg: string; type: 'info' | 'success' | 'warn' | 'error' }[]
  >([]);
  const [showConfig, setShowConfig] = useState(false);

  const miningRef = useRef(false);
  const uptimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const stratumWsRef = useRef<WebSocket | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const protocolRef = useRef<'v1' | 'v2' | null>(null);
  const currentJobRef = useRef<{
    jobId: string;
    header: string;
    target: string;
  } | null>(null);

  const addLog = (msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLog((prev) => [{ time, msg, type }, ...prev.slice(0, 49)]);
  };

  // ── Worker lifecycle ────────────────────────────────────────────────

  const createWorker = useCallback(() => {
    if (workerRef.current) return;
    const worker = new MiningWorker();
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { type, data } = e.data;

      if (type === 'hashrate') {
        setStats((prev) => ({ ...prev, hashrate: data as number }));
      }

      if (type === 'share') {
        const share = data as { jobId: string; nonce: number; hash: string };
        addLog(
          `Share found | Hash: ${share.hash.slice(0, 14)}... | Nonce: ${share.nonce}`,
          'success',
        );
        setStats((prev) => ({ ...prev, sharesAccepted: prev.sharesAccepted + 1 }));

        const ws = stratumWsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && currentJobRef.current) {
          if (protocolRef.current === 'v2') {
            // V2 binary submit
            const submitFrame = encodeV2Frame(
              V2MsgType.SubmitShare,
              encodeSubmitShare(
                parseInt(share.jobId, 16),
                BigInt(share.nonce),
                algoToV2Algo(config.algorithm),
              ),
            );
            ws.send(submitFrame);
          } else {
            // V1 JSON submit
            ws.send(
              JSON.stringify({
                id: Date.now() % 100000,
                method: 'mining.submit',
                params: [config.workerName, share.jobId, share.nonce.toString(16), currentJobRef.current.target, share.nonce],
              }),
            );
          }
        }
      }
    };

    worker.onerror = (err) => {
      addLog(`Mining worker error: ${err.message}`, 'error');
    };
  }, [config.workerName, config.algorithm]);

  const terminateWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    currentJobRef.current = null;
  }, []);

  // ── V2 Stratum message handler ─────────────────────────────────────

  const setupV2MessageHandler = useCallback(
    (ws: WebSocket) => {
      ws.binaryType = 'arraybuffer';

      ws.onmessage = (evt: MessageEvent) => {
        if (evt.data instanceof ArrayBuffer || evt.data instanceof Uint8Array) {
          const data = new Uint8Array(evt.data);
          const frame = decodeV2Frame(data);
          if (!frame) return;

          switch (frame.msgType) {
            case V2MsgType.NewMiningJob: {
              const job = decodeNewMiningJob(frame.payload);
              const prevHashHex = Array.from(job.prevHash).map(b => b.toString(16).padStart(2, '0')).join('');
              const targetHex = Array.from(job.target).map(b => b.toString(16).padStart(2, '0')).join('');

              currentJobRef.current = {
                jobId: job.jobId.toString(16),
                header: prevHashHex,
                target: targetHex,
              };

              if (miningRef.current && workerRef.current) {
                workerRef.current.postMessage({
                  type: 'start',
                  data: currentJobRef.current,
                });
              }

              if (!connected) {
                setConnected(true);
                setStats((prev) => ({ ...prev, connected: true }));
              }

              addLog(`[V2] New job #${job.jobId.toString(16)} | Block #${job.blockNumber} | algo=${job.algo}`, 'info');
              break;
            }

            case V2MsgType.SubmitShareResponse: {
              const resp = decodeSubmitShareResponse(frame.payload);
              if (resp.accepted) {
                setStats((prev) => ({ ...prev, blocksFound: prev.blocksFound + 1 }));
                addLog('[V2] ✅ Share accepted', 'success');
              } else {
                setStats((prev) => ({ ...prev, sharesRejected: prev.sharesRejected + 1 }));
                addLog(`[V2] ❌ Share rejected (code=${resp.errorCode})`, 'warn');
              }
              break;
            }

            case V2MsgType.SetDifficulty: {
              const diff = decodeSetDifficulty(frame.payload);
              setStats((prev) => ({ ...prev, difficulty: Number(diff) }));
              addLog(`[V2] Difficulty set to ${diff}`, 'info');
              break;
            }

            case V2MsgType.SetupConnectionSuccess: {
              addLog('[V2] ✅ Setup accepted by server', 'success');
              break;
            }

            case V2MsgType.Pong: {
              // keep-alive acknowledged
              break;
            }

            case V2MsgType.Error: {
              const errMsg = new TextDecoder().decode(frame.payload.slice(1));
              addLog(`[V2] Server error: ${errMsg}`, 'error');
              break;
            }
          }
          return;
        }

        // Fallback: text messages treated as V1
        try {
          const msg = JSON.parse(evt.data as string);
          handleV1Message(msg);
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        if (connected) {
          setConnected(false);
          setStats((prev) => ({ ...prev, connected: false }));
          addLog('⚠️ Stratum connection closed', 'warn');
          if (miningRef.current) {
            miningRef.current = false;
            setMining(false);
            terminateWorker();
            addLog('Mining stopped — Stratum disconnected', 'error');
            toast({
              title: 'Connection lost',
              description: 'Stratum node disconnected. Mining stopped.',
              variant: 'destructive',
            });
          }
        }
      };

      ws.onerror = () => { /* onclose fires after */ };
    },
    [connected, addLog, terminateWorker],
  );

  // ── V1 message handler (also used for V2 text messages) ────────────

  const handleV1Message = useCallback((msg: any) => {
    // mining.notify
    if (msg.method === 'mining.notify') {
      const params = msg.params as unknown[];
      const jobId = (params?.[0] as string) ?? '0';
      const prevHash = (params?.[1] as string) ?? '0x0';
      const nbits = (params?.[6] as string) ?? '1f00ffff';
      const target = nbits.startsWith('0x') ? nbits.slice(2) : nbits;
      const header = prevHash.startsWith('0x') ? prevHash.slice(2) : prevHash;

      currentJobRef.current = { jobId, header, target };

      if (miningRef.current && workerRef.current) {
        workerRef.current.postMessage({ type: 'start', data: currentJobRef.current });
      }

      if (!connected) {
        setConnected(true);
        setStats((prev) => ({ ...prev, connected: true }));
      }
      addLog(`[V1] New job #${jobId}`, 'info');
    }

    if (msg.method === 'mining.set_difficulty') {
      const diff = msg.params?.[0] ?? stats.difficulty;
      setStats((prev) => ({ ...prev, difficulty: Number(diff) }));
      addLog(`[V1] Difficulty set to ${diff}`, 'info');
    }

    if (msg.id && msg.result !== undefined && msg.id > 2) {
      if (msg.result === true) {
        setStats((prev) => ({ ...prev, blocksFound: prev.blocksFound + 1 }));
        addLog('[V1] ✅ Share accepted', 'success');
      } else {
        setStats((prev) => ({ ...prev, sharesRejected: prev.sharesRejected + 1 }));
        addLog(`[V1] ❌ Share rejected: ${msg.error ?? 'invalid'}`, 'warn');
      }
    }

    if (msg.id === 2) {
      if (msg.result === true) {
        addLog('[V1] ✅ Authorized', 'success');
      } else {
        addLog(`[V1] ❌ Auth failed: ${JSON.stringify(msg.error)}`, 'error');
      }
    }
  }, [connected, stats.difficulty, addLog]);

  // ── Connect to pool (auto-negotiate V2 → V1) ──────────────────────

  const connectToPool = useCallback(async () => {
    if (!wallet) {
      toast({ title: 'Wallet required', description: 'Create a wallet first', variant: 'destructive' });
      return false;
    }

    setConnecting(true);
    addLog(`Connecting to ${config.url}...`, 'info');

    if (!isStratumUrl(config.url)) {
      addLog(`❌ Unsupported URL scheme: "${config.url}"`, 'error');
      setConnecting(false);
      return false;
    }

    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && config.url.startsWith('ws://')) {
      addLog('⚠️ Mining connection is unencrypted (ws://).', 'warn');
    }

    if (isPlaceholderUrl(config.url)) {
      addLog(`❌ Pool URL "${config.url}" is a placeholder.`, 'error');
      setConnecting(false);
      return false;
    }

    // ── Try V2 first ──────────────────────────────────────────────
    addLog('Attempting Stratum V2 (binary protocol)...', 'info');
    const connectStart = performance.now();
    let result = await tryStratumV2Connect(config.url, config.workerName, wallet.address, config.algorithm);

    if (result) {
      const ping = Math.round(performance.now() - connectStart);
      protocolRef.current = 'v2';
      stratumWsRef.current = result.ws;
      setupV2MessageHandler(result.ws);

      setStats((prev) => ({ ...prev, ping, connected: true, protocolVersion: 'v2', difficulty: Math.max(prev.difficulty, 1) }));
      setConnected(true);
      setConnecting(false);
      addLog(`✅ Stratum V2 connected (${ping}ms) — Block #${result.job.blockNumber}`, 'success');
      saveStratumUrl(config.url);
      return true;
    }

    // ── Fallback to V1 ───────────────────────────────────────────
    addLog('V2 failed — falling back to Stratum V1 (JSON-RPC)...', 'warn');
    const v1Start = performance.now();
    result = await tryStratumV1Connect(config.url, config.workerName, wallet.address);

    if (result) {
      const ping = Math.round(performance.now() - v1Start);
      protocolRef.current = 'v1';
      stratumWsRef.current = result.ws;

      // Use the V2 message handler which also handles V1 text messages
      setupV2MessageHandler(result.ws);

      setStats((prev) => ({ ...prev, ping, connected: true, protocolVersion: 'v1', difficulty: Math.max(prev.difficulty, 1) }));
      setConnected(true);
      setConnecting(false);
      addLog(`✅ Stratum V1 connected (${ping}ms) — Block #${result.job.blockNumber}`, 'success');
      saveStratumUrl(config.url);
      return true;
    }

    // ── Both failed ──────────────────────────────────────────────
    addLog(`❌ Stratum node unreachable at ${config.url}.`, 'error');
    toast({
      title: 'Stratum node offline',
      description: `${config.url} did not respond.`,
      variant: 'destructive',
    });
    setConnecting(false);
    return false;
  }, [wallet, config, addLog, setupV2MessageHandler]);

  // ── Start / Stop mining ─────────────────────────────────────────────

  const startMining = async () => {
    if (!user) { toast({ title: 'Sign in required', variant: 'destructive' }); return; }

    if (!connected) {
      const ok = await connectToPool();
      if (!ok) { addLog('Mining not started — Stratum node offline.', 'error'); return; }
    }

    createWorker();
    miningRef.current = true;
    setMining(true);
    startTimeRef.current = Date.now();

    uptimeRef.current = setInterval(() => {
      setStats((prev) => ({ ...prev, uptime: Math.floor((Date.now() - startTimeRef.current) / 1000) }));
    }, 1000);

    if (currentJobRef.current && workerRef.current) {
      workerRef.current.postMessage({ type: 'start', data: currentJobRef.current });
    }

    addLog(`Mining started on "${config.workerName}" [${protocolRef.current?.toUpperCase() ?? '?'}]`, 'info');
  };

  const stopMining = () => {
    miningRef.current = false;
    setMining(false);
    if (uptimeRef.current) { clearInterval(uptimeRef.current); uptimeRef.current = null; }
    if (workerRef.current) { workerRef.current.postMessage({ type: 'stop' }); }
    addLog('Mining stopped by user', 'warn');
    toast({ title: '⏹ Mining stopped', description: `Earned ${stats.totalEarned.toFixed(4)} HSMC` });
  };

  const disconnect = () => {
    stopMining();
    if (stratumWsRef.current) {
      try { stratumWsRef.current.close(); } catch { /* ignore */ }
      stratumWsRef.current = null;
    }
    terminateWorker();
    protocolRef.current = null;
    setConnected(false);
    setStats((prev) => ({ ...prev, connected: false, hashrate: 0, protocolVersion: null }));
    addLog('Disconnected from pool', 'warn');
  };

  useEffect(() => {
    return () => {
      miningRef.current = false;
      if (uptimeRef.current) clearInterval(uptimeRef.current);
      if (stratumWsRef.current) {
        try { stratumWsRef.current.close(); } catch { /* ignore */ }
      }
      terminateWorker();
    };
  }, [terminateWorker]);

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <section id="mining-rpc" className="py-24">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <p className="section-eyebrow mb-4">Pool Mining Client</p>
          <h2 className="text-3xl sm:text-4xl font-black mb-3">
            <span className="gradient-text">Stratum V1 + V2</span> Mining
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            Auto-negotiating Stratum client. Tries V2 (binary, Noise IK), falls back to V1 (JSON-RPC).
            Connect to your HSMC node and mine with a dedicated Web Worker.
          </p>
        </motion.div>

        <div className="max-w-6xl mx-auto grid lg:grid-cols-3 gap-6">
          {/* Config Panel */}
          <div className="lg:col-span-1 space-y-4">
            {/* Connection Status */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="glass-panel"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {connected ? (
                    <Radio className="w-4 h-4 text-secondary animate-pulse" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span className="text-sm font-semibold">Stratum Connection</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {connected && stats.protocolVersion && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                      stats.protocolVersion === 'v2'
                        ? 'border-secondary/40 bg-secondary/10 text-secondary'
                        : 'border-primary/40 bg-primary/10 text-primary'
                    }`}>
                      {stats.protocolVersion.toUpperCase()}
                    </span>
                  )}
                  {connected && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-accent/40 bg-accent/10 text-accent font-mono">
                      NODE
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border font-mono ${
                      connected
                        ? 'text-secondary border-secondary/30 bg-secondary/10'
                        : 'text-muted-foreground border-border bg-muted/30'
                    }`}
                  >
                    {connected ? `${stats.ping}ms` : 'Offline'}
                  </span>
                </div>
              </div>

              {connected && (
                <div className="text-xs text-muted-foreground font-mono truncate mb-3 p-2 bg-muted/30 rounded-lg">
                  {config.url}
                </div>
              )}

              {!connected && !connecting && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 border-secondary/30 text-secondary"
                  onClick={() => connectToPool()}
                >
                  <Wifi className="w-4 h-4" /> Connect (V2 → V1)
                </Button>
              )}
              {connecting && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Negotiating protocol...
                </div>
              )}
              {connected && !mining && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground text-xs"
                  onClick={disconnect}
                >
                  Disconnect
                </Button>
              )}
            </motion.div>

            {/* Pool Configuration */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="glass-panel"
            >
              <button
                className="flex items-center justify-between w-full mb-3"
                onClick={() => setShowConfig(!showConfig)}
              >
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Configuration</span>
                </div>
                <span className="text-xs text-muted-foreground">{showConfig ? '▲' : '▼'}</span>
              </button>

              <AnimatePresence>
                {showConfig && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3"
                  >
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                        <Server className="w-3 h-3" /> Stratum URL
                      </label>
                      <Input
                        value={config.url}
                        onChange={(e) => { const url = e.target.value; setConfig((c) => ({ ...c, url })); saveStratumUrl(url); }}
                        className="font-mono text-xs"
                        disabled={mining}
                        placeholder="ws://YOUR_VPS_IP:3333"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Supports V2 (binary) and V1 (JSON). Auto-negotiated.
                      </p>
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                        <User className="w-3 h-3" /> Worker Name
                      </label>
                      <Input
                        value={config.workerName}
                        onChange={(e) => setConfig((c) => ({ ...c, workerName: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') }))}
                        className="font-mono text-sm"
                        disabled={mining}
                        placeholder="worker01"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                        <Target className="w-3 h-3" /> Difficulty Target:{' '}
                        <span className="text-primary font-mono ml-1">{config.difficultyTarget}</span>
                      </label>
                      <input
                        type="range"
                        min={1} max={8}
                        value={config.difficultyTarget}
                        onChange={(e) => setConfig((c) => ({ ...c, difficultyTarget: parseInt(e.target.value) }))}
                        disabled={mining}
                        className="w-full accent-primary"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                        <span>Easy (1)</span><span>Hard (8)</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Algorithm</label>
                      <div className="grid grid-cols-2 gap-1">
                        {ALGORITHMS.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => setConfig((c) => ({ ...c, algorithm: a.id }))}
                            disabled={mining}
                            className={`text-[10px] px-2 py-1.5 rounded border transition-colors text-left ${
                              config.algorithm === a.id
                                ? 'border-primary/50 bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/30'
                            }`}
                          >
                            <div className="font-mono font-semibold">{a.label}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!showConfig && (
                <div className="text-xs text-muted-foreground font-mono">
                  {config.algorithm} | diff:{config.difficultyTarget} | {config.workerName}
                </div>
              )}
            </motion.div>

            {/* Start/Stop */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              {mining ? (
                <Button
                  variant="outline" size="lg"
                  className="w-full gap-3 border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={stopMining}
                >
                  <Square className="w-5 h-5" /> Stop Mining
                </Button>
              ) : (
                <Button
                  variant="hero" size="lg"
                  className="w-full gap-3"
                  onClick={startMining}
                  disabled={connecting}
                >
                  <Play className="w-5 h-5" />
                  {connected ? 'Start Mining' : 'Connect & Mine'}
                </Button>
              )}
            </motion.div>
          </div>

          {/* Stats + Log */}
          <div className="lg:col-span-2 space-y-4">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            >
              {[
                { icon: Zap, label: 'Hashrate', value: mining ? `${stats.hashrate.toLocaleString()} H/s` : '0 H/s', color: 'text-primary' },
                { icon: CheckCircle2, label: 'Accepted', value: stats.sharesAccepted.toString(), color: 'text-secondary' },
                { icon: AlertTriangle, label: 'Rejected', value: stats.sharesRejected.toString(), color: 'text-destructive' },
                { icon: Activity, label: 'Uptime', value: formatUptime(stats.uptime), color: 'text-accent' },
                { icon: Hash, label: 'Blocks', value: stats.blocksFound.toString(), color: 'text-primary' },
                { icon: Award, label: 'Earned', value: `${stats.totalEarned.toFixed(4)} HSMC`, color: 'text-secondary' },
                { icon: Target, label: 'Difficulty', value: stats.difficulty.toString(), color: 'text-muted-foreground' },
                { icon: Shield, label: 'Protocol', value: stats.protocolVersion?.toUpperCase() ?? '—', color: stats.protocolVersion === 'v2' ? 'text-secondary' : 'text-accent' },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="glass-card p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icon className={`w-3.5 h-3.5 ${color}`} />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
                  </div>
                  <div className={`font-mono font-bold text-sm ${color}`}>{value}</div>
                </div>
              ))}
            </motion.div>

            {/* Stratum Log */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="glass-panel"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Stratum Log</span>
                </div>
                {mining && (
                  <span className="flex items-center gap-1.5 text-xs text-secondary">
                    <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" /> Live
                  </span>
                )}
              </div>
              <div className="terminal rounded-lg p-3 h-64 overflow-y-auto font-mono text-xs space-y-0.5">
                {log.length === 0 ? (
                  <p className="text-muted-foreground/40 text-center py-8">
                    Connect to Stratum node and start mining...
                  </p>
                ) : (
                  log.map((entry, i) => (
                    <div
                      key={i}
                      className={`${
                        entry.type === 'success' ? 'text-secondary'
                        : entry.type === 'error' ? 'text-destructive'
                        : entry.type === 'warn' ? 'text-yellow-400'
                        : 'text-muted-foreground'
                      }`}
                    >
                      <span className="text-muted-foreground/50">[{entry.time}] </span>
                      {entry.msg}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default MiningRPCClient;
