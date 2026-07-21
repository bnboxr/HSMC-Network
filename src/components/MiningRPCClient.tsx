/**
 * HSMC Mining Client — Stratum-only, Web Worker powered.
 *
 * Connects to a Rust Stratum node via real WebSocket.
 * All mining happens in a dedicated Web Worker (mining-worker.ts).
 * No local/simulated mining fallback — if the node is offline,
 * the user sees a clear error message.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Zap, Activity, Play, Square, Settings2, Hash,
  Server, User, Target, BarChart3, Award,
  Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2,
  Radio
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { toast } from '@/hooks/use-toast';
import MiningWorker from '@/workers/mining-worker?worker';

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
}

/** Default Stratum URL — stored in localStorage so the user can persist their own */
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
  } catch { /* ignore quota errors */ }
}

const ALGORITHMS: { id: Algorithm; label: string; desc: string }[] = [
  { id: 'RandomX', label: 'RandomX', desc: 'CPU-optimized, ASIC-resistant' },
  { id: 'SHA-256', label: 'SHA-256', desc: 'Classic PoW — ASIC dominant' },
  { id: 'ProgPoW', label: 'ProgPoW', desc: 'GPU-friendly, ASIC-resistant' },
  { id: 'KawPoW', label: 'KawPoW', desc: 'GPU memory-hard' },
  { id: 'Ethash', label: 'Ethash', desc: 'Memory-hard DAG PoW' },
  { id: 'X11', label: 'X11', desc: 'Chained 11 hash functions' },
];

/** Check whether a URL is a Stratum WebSocket endpoint */
function isStratumUrl(url: string): boolean {
  return url.startsWith('ws://') || url.startsWith('wss://');
}

/** Check whether a URL looks like an obvious placeholder */
function isPlaceholderUrl(url: string): boolean {
  return /YOUR_VPS_IP|placeholder|example\.com|localhost:3333/i.test(url);
}

/**
 * Attempt to connect to a Stratum node via WebSocket.
 * Performs mining.subscribe + mining.authorize handshake.
 * Returns the WS instance and initial job params, or null on failure.
 */
function tryStratumConnect(
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
      // Stratum v1 subscribe
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'mining.subscribe',
          params: [workerName, '2.0'],
        }),
      );
      // Stratum v1 authorize
      ws.send(
        JSON.stringify({
          id: 2,
          method: 'mining.authorize',
          params: [miningAddress, workerName],
        }),
      );
    };

    ws.onmessage = (evt: MessageEvent) => {
      if (settled) return;
      try {
        const msg = JSON.parse(evt.data);
        // Accept on any valid JSON response (subscription, authorization, or first notify)
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
      } catch {
        // Ignore parse errors, wait for next message or timeout
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
  });
  const [log, setLog] = useState<
    { time: string; msg: string; type: 'info' | 'success' | 'warn' | 'error' }[]
  >([]);
  const [showConfig, setShowConfig] = useState(false);

  // Refs for mutable state shared with callbacks / intervals
  const miningRef = useRef(false);
  const uptimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const stratumWsRef = useRef<WebSocket | null>(null);
  const workerRef = useRef<Worker | null>(null);
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

  /** Create and set up the mining worker */
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
        setStats((prev) => ({
          ...prev,
          sharesAccepted: prev.sharesAccepted + 1,
        }));

        // Submit share to Stratum server
        const ws = stratumWsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && currentJobRef.current) {
          ws.send(
            JSON.stringify({
              id: Date.now() % 100000,
              method: 'mining.submit',
              params: [
                config.workerName,
                share.jobId,
                share.nonce.toString(16),
                currentJobRef.current.target,
                share.nonce,
              ],
            }),
          );
        }
      }
    };

    worker.onerror = (err) => {
      addLog(`Mining worker error: ${err.message}`, 'error');
    };
  }, [config.workerName]);

  /** Destroy the mining worker */
  const terminateWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    currentJobRef.current = null;
  }, []);

  // ── Stratum WebSocket message handler ───────────────────────────────

  const setupStratumMessageHandler = useCallback(
    (ws: WebSocket) => {
      ws.onmessage = (evt: MessageEvent) => {
        try {
          const msg = JSON.parse(evt.data);

          // mining.notify — new job from server
          if (msg.method === 'mining.notify') {
            const params = msg.params as unknown[];
            const jobId = (params?.[0] as string) ?? '0';
            const prevHash = (params?.[1] as string) ?? '0x0';
            // params[6] (nbits) encodes the target
            const nbits = (params?.[6] as string) ?? '1f00ffff';

            // Convert nbits to target hex (simplified: use nbits directly as target)
            // In real Stratum, nbits like "1b0404cb" encodes target; here we pass it through
            const target = nbits.startsWith('0x') ? nbits.slice(2) : nbits;

            // Build header for hashing: prevHash + nbits (simplified Stratum header)
            const header = prevHash.startsWith('0x') ? prevHash.slice(2) : prevHash;

            currentJobRef.current = { jobId, header, target };

            // Send new job to worker
            if (miningRef.current && workerRef.current) {
              workerRef.current.postMessage({
                type: 'start',
                data: { jobId, header, target },
              });
            }

            if (!connected) {
              setConnected(true);
              setStats((prev) => ({ ...prev, connected: true }));
            }

            const blockNumber = (params?.[8] as number) ?? 0;
            addLog(`New job #${jobId} | Block #${blockNumber}`, 'info');
          }

          // mining.set_difficulty
          if (msg.method === 'mining.set_difficulty') {
            const diff = msg.params?.[0] ?? stats.difficulty;
            setStats((prev) => ({ ...prev, difficulty: Number(diff) }));
            addLog(`Difficulty set to ${diff}`, 'info');
          }

          // Response to mining.submit
          if (msg.id && msg.result !== undefined && msg.id > 2) {
            if (msg.result === true) {
              setStats((prev) => ({
                ...prev,
                blocksFound: prev.blocksFound + 1,
              }));
              addLog('✅ Share accepted by pool', 'success');
            } else {
              setStats((prev) => ({
                ...prev,
                sharesRejected: prev.sharesRejected + 1,
              }));
              addLog(`❌ Share rejected: ${msg.error ?? 'stale or invalid'}`, 'warn');
            }
          }

          // Response to mining.authorize (id: 2)
          if (msg.id === 2) {
            if (msg.result === true) {
              addLog('✅ Stratum authorized', 'success');
            } else {
              addLog(`❌ Stratum authorization failed: ${JSON.stringify(msg.error)}`, 'error');
            }
          }
        } catch {
          // Ignore unparseable messages
        }
      };

      ws.onclose = () => {
        if (connected) {
          setConnected(false);
          setStats((prev) => ({ ...prev, connected: false }));
          addLog('⚠️ Stratum connection closed', 'warn');
          if (miningRef.current) {
            // Stop mining if connection drops
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

      ws.onerror = () => {
        // onclose will fire after this
      };
    },
    [connected, stats.difficulty, addLog, terminateWorker],
  );

  // ── Connect to Stratum pool ─────────────────────────────────────────

  const connectToPool = useCallback(async () => {
    if (!wallet) {
      toast({
        title: 'Wallet required',
        description: 'Create a wallet first',
        variant: 'destructive',
      });
      return false;
    }

    setConnecting(true);
    addLog(`Connecting to ${config.url}...`, 'info');

    // Only Stratum WebSocket is supported — no local://chain fallback
    if (!isStratumUrl(config.url)) {
      addLog(
        `❌ Unsupported URL scheme: "${config.url}". Only ws:// and wss:// Stratum endpoints are supported.`,
        'error',
      );
      toast({
        title: 'Invalid pool URL',
        description: 'Use a ws:// or wss:// Stratum endpoint. Example: ws://YOUR_VPS_IP:3333',
        variant: 'destructive',
      });
      setConnecting(false);
      return false;
    }

    // M1: Warn when ws:// is used on an HTTPS page
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && config.url.startsWith('ws://')) {
      addLog(
        '⚠️ Mining connection is unencrypted (ws://). Your wallet address may be visible to network observers.',
        'warn',
      );
      toast({
        title: '⚠️ Insecure WebSocket',
        description: 'Mining connection is unencrypted (ws://). Your wallet address may be visible to network observers.',
        variant: 'destructive',
      });
      // Do NOT block — still let them connect, but warn prominently
    }

    // Reject obvious placeholder URLs
    if (isPlaceholderUrl(config.url)) {
      addLog(
        `❌ Pool URL "${config.url}" is a placeholder. Set your real Stratum node address.`,
        'error',
      );
      toast({
        title: 'Pool URL not configured',
        description:
          'Replace the placeholder with your real Rust node WebSocket (e.g. ws://1.2.3.4:3333).',
        variant: 'destructive',
      });
      setConnecting(false);
      return false;
    }

    addLog('Opening Stratum WebSocket...', 'info');
    const connectStart = performance.now();
    const result = await tryStratumConnect(config.url, config.workerName, wallet.address);

    if (result) {
      const ping = Math.round(performance.now() - connectStart);
      stratumWsRef.current = result.ws;

      // Set up ongoing message handling
      setupStratumMessageHandler(result.ws);

      setStats((prev) => ({
        ...prev,
        ping,
        connected: true,
        difficulty: Math.max(prev.difficulty, 1),
      }));
      setConnected(true);
      setConnecting(false);
      addLog(
        `✅ Stratum node connected (${ping}ms) — Block #${result.job.blockNumber}`,
        'success',
      );

      // Save URL for next session
      saveStratumUrl(config.url);

      return true;
    }

    // ── Node offline — clear error, no fallback ───────────────────────
    addLog(
      `❌ Stratum node unreachable at ${config.url}. Verify the Rust node is running and the WebSocket port is reachable.`,
      'error',
    );
    toast({
      title: 'Stratum node offline',
      description: `${config.url} did not respond. Check that your Rust node is running and the port is reachable.`,
      variant: 'destructive',
    });
    setConnecting(false);
    return false;
  }, [wallet, config, addLog, setupStratumMessageHandler]);

  // ── Start / Stop mining ─────────────────────────────────────────────

  const startMining = async () => {
    if (!user) {
      toast({ title: 'Sign in required', variant: 'destructive' });
      return;
    }

    // Connect if not already connected
    if (!connected) {
      const ok = await connectToPool();
      if (!ok) {
        // Connection failed — do not start mining, no fallback
        addLog('Mining not started — Stratum node is offline.', 'error');
        return;
      }
    }

    // Create worker if needed
    createWorker();

    miningRef.current = true;
    setMining(true);
    startTimeRef.current = Date.now();

    uptimeRef.current = setInterval(() => {
      setStats((prev) => ({
        ...prev,
        uptime: Math.floor((Date.now() - startTimeRef.current) / 1000),
      }));
    }, 1000);

    // If we have a current job, start the worker on it
    if (currentJobRef.current && workerRef.current) {
      workerRef.current.postMessage({
        type: 'start',
        data: currentJobRef.current,
      });
    }

    addLog(`Mining started on worker "${config.workerName}"`, 'info');
  };

  const stopMining = () => {
    miningRef.current = false;
    setMining(false);

    // Stop uptime counter
    if (uptimeRef.current) {
      clearInterval(uptimeRef.current);
      uptimeRef.current = null;
    }

    // Stop worker
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'stop' });
    }

    addLog('Mining stopped by user', 'warn');
    toast({
      title: '⏹ Mining stopped',
      description: `Earned ${stats.totalEarned.toFixed(4)} HSMC`,
    });
  };

  const disconnect = () => {
    stopMining();

    // Close Stratum WebSocket
    if (stratumWsRef.current) {
      try {
        stratumWsRef.current.close();
      } catch {
        /* ignore */
      }
      stratumWsRef.current = null;
    }

    // Terminate worker
    terminateWorker();

    setConnected(false);
    setStats((prev) => ({
      ...prev,
      connected: false,
      hashrate: 0,
    }));
    addLog('Disconnected from pool', 'warn');
  };

  // ── Cleanup on unmount ──────────────────────────────────────────────

  useEffect(() => {
    return () => {
      miningRef.current = false;
      if (uptimeRef.current) clearInterval(uptimeRef.current);
      if (stratumWsRef.current) {
        try {
          stratumWsRef.current.close();
        } catch {
          /* ignore */
        }
      }
      terminateWorker();
    };
  }, [terminateWorker]);

  // ── Helpers ─────────────────────────────────────────────────────────

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
            <span className="gradient-text">Stratum Mining</span> Client
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            Connect to your HSMC Rust Stratum node, configure your worker, and mine with a
            dedicated Web Worker — no simulated blocks, only real Stratum mining.
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
                  {connected && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-secondary/40 bg-secondary/10 text-secondary font-mono">
                      RUST NODE
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
                  <Wifi className="w-4 h-4" /> Connect to Stratum
                </Button>
              )}
              {connecting && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Connecting...
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
                <span className="text-xs text-muted-foreground">
                  {showConfig ? '▲' : '▼'}
                </span>
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
                        onChange={(e) => {
                          const url = e.target.value;
                          setConfig((c) => ({ ...c, url }));
                          saveStratumUrl(url);
                        }}
                        className="font-mono text-xs"
                        disabled={mining}
                        placeholder="ws://YOUR_VPS_IP:3333"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        WebSocket Stratum endpoint of your HSMC Rust node. Only{' '}
                        <code className="text-secondary">ws://</code> and{' '}
                        <code className="text-secondary">wss://</code> are supported.
                      </p>
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                        <User className="w-3 h-3" /> Worker Name
                      </label>
                      <Input
                        value={config.workerName}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            workerName: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                          }))
                        }
                        className="font-mono text-sm"
                        disabled={mining}
                        placeholder="worker01"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                        <Target className="w-3 h-3" /> Difficulty Target:{' '}
                        <span className="text-primary font-mono ml-1">
                          {config.difficultyTarget}
                        </span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={8}
                        value={config.difficultyTarget}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            difficultyTarget: parseInt(e.target.value),
                          }))
                        }
                        disabled={mining}
                        className="w-full accent-primary"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                        <span>Easy (1)</span>
                        <span>Hard (8)</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Algorithm
                      </label>
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
                  variant="outline"
                  size="lg"
                  className="w-full gap-3 border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={stopMining}
                >
                  <Square className="w-5 h-5" /> Stop Mining
                </Button>
              ) : (
                <Button
                  variant="hero"
                  size="lg"
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
            {/* Stats Grid */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            >
              {[
                {
                  icon: Zap,
                  label: 'Hashrate',
                  value: mining
                    ? `${stats.hashrate.toLocaleString()} H/s`
                    : '0 H/s',
                  color: 'text-primary',
                },
                {
                  icon: CheckCircle2,
                  label: 'Accepted',
                  value: stats.sharesAccepted.toString(),
                  color: 'text-secondary',
                },
                {
                  icon: AlertTriangle,
                  label: 'Rejected',
                  value: stats.sharesRejected.toString(),
                  color: 'text-destructive',
                },
                {
                  icon: Activity,
                  label: 'Uptime',
                  value: formatUptime(stats.uptime),
                  color: 'text-accent',
                },
                {
                  icon: Hash,
                  label: 'Blocks',
                  value: stats.blocksFound.toString(),
                  color: 'text-primary',
                },
                {
                  icon: Award,
                  label: 'Earned',
                  value: `${stats.totalEarned.toFixed(4)} HSMC`,
                  color: 'text-secondary',
                },
                {
                  icon: Target,
                  label: 'Difficulty',
                  value: stats.difficulty.toString(),
                  color: 'text-muted-foreground',
                },
                {
                  icon: BarChart3,
                  label: 'Algorithm',
                  value: config.algorithm,
                  color: 'text-accent',
                },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="glass-card p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icon className={`w-3.5 h-3.5 ${color}`} />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {label}
                    </span>
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
                        entry.type === 'success'
                          ? 'text-secondary'
                          : entry.type === 'error'
                            ? 'text-destructive'
                            : entry.type === 'warn'
                              ? 'text-yellow-400'
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
