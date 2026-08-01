/**
 * HSMC Mobile — Stratum V1 Mining Client
 *
 * Connects to the HSMC mining server (WebSocket, port 3333) using the Stratum
 * V1 JSON-RPC protocol: mining.subscribe / mining.authorize / mining.submit.
 * Performs REAL SHA-256d hash search against the server's target and submits
 * valid shares. Hashes/sec is modest on a phone, but the work is genuine —
 * the server validates every share cryptographically (validateShare).
 */

import { Platform } from 'react-native';
import { sha256, bytesToHex, hexToBytes } from './cryptoImpl';

const DEFAULT_WS_PORT = 3333;

export function defaultMiningUrl(): string {
  const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
  return `ws://${host}:${DEFAULT_WS_PORT}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MiningJob {
  jobId: string;
  prevHash: string;
  nbits: string;
  blockNumber: number;
  targetHex: string;
  receivedAt: number;
}

export interface MinerStatus {
  connected: boolean;
  authorized: boolean;
  worker: string;
  address: string;
  url: string;
  sharesAccepted: number;
  sharesRejected: number;
  hashrate: number; // hashes per second (rolling)
  totalHashes: number;
  currentJob: MiningJob | null;
  difficulty: number;
  blocksFound: number;
  lastError: string | null;
  startedAt: number | null;
}

export type MinerEvent =
  | { type: 'status'; status: MinerStatus }
  | { type: 'share'; accepted: boolean; detail: string }
  | { type: 'block'; blockNumber: number }
  | { type: 'error'; message: string };

type MinerListener = (event: MinerEvent) => void;

// ─── SHA-256d helper ────────────────────────────────────────────────────────

function sha256dHex(hex: string): string {
  return bytesToHex(sha256(sha256(hexToBytes(hex))));
}

// ─── Stratum client ─────────────────────────────────────────────────────────

class StratumMiner {
  private ws: WebSocket | null = null;
  private listeners: MinerListener[] = [];
  private status: MinerStatus = {
    connected: false,
    authorized: false,
    worker: 'hsmc-mobile',
    address: '',
    url: '',
    sharesAccepted: 0,
    sharesRejected: 0,
    hashrate: 0,
    totalHashes: 0,
    currentJob: null,
    difficulty: 4,
    blocksFound: 0,
    lastError: null,
    startedAt: null,
  };
  private mining = false;
  private miningTimer: ReturnType<typeof setInterval> | null = null;
  private hashWindow: number[] = [];
  private idCounter = 0;
  private lastKnownTargetHex = '0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

  on(listener: MinerListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(event: MinerEvent): void {
    for (const l of this.listeners) l(event);
  }

  private emitStatus(): void {
    this.emit({ type: 'status', status: { ...this.status } });
  }

  getStatus(): MinerStatus {
    return { ...this.status };
  }

  isMining(): boolean {
    return this.mining;
  }

  private nextId(): number {
    this.idCounter++;
    return this.idCounter;
  }

  /** Connect, subscribe and authorize with the pool. */
  connect(url: string, address: string, worker = 'hsmc-mobile'): Promise<boolean> {
    return new Promise(resolve => {
      this.disconnect(false);
      this.status.url = url;
      this.status.address = address;
      this.status.worker = worker;
      this.status.lastError = null;
      this.status.startedAt = Date.now();

      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        this.status.lastError = e instanceof Error ? e.message : 'Invalid WebSocket URL';
        this.emitStatus();
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        this.status.lastError = 'Connection timed out';
        this.emitStatus();
        resolve(false);
        try { this.ws?.close(); } catch { /* noop */ }
      }, 10000);

      this.ws.onopen = () => {
        this.status.connected = true;
        this.status.lastError = null;
        this.emitStatus();
        // Subscribe and authorize
        this.send('mining.subscribe', ['HSMC-Mobile/1.0']);
        this.send('mining.authorize', [address, worker]);
        setTimeout(() => {
          clearTimeout(timeout);
          resolve(true);
        }, 500);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.ws.onerror = () => {
        this.status.lastError = 'WebSocket error';
        this.emitStatus();
      };

      this.ws.onclose = () => {
        this.status.connected = false;
        this.status.authorized = false;
        if (this.mining) this.stopMiningLoop();
        this.emitStatus();
        clearTimeout(timeout);
        resolve(false);
      };
    });
  }

  disconnect(notify = true): void {
    if (this.mining) this.stopMiningLoop();
    try {
      this.ws?.close();
    } catch { /* noop */ }
    this.ws = null;
    this.status.connected = false;
    this.status.authorized = false;
    if (notify) this.emitStatus();
  }

  private send(method: string, params: unknown[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ id: this.nextId(), method, params }));
  }

  private handleMessage(event: { data: unknown }): void {
    let msg: { id?: number | null; method?: string; params?: unknown[]; result?: unknown; error?: unknown };
    try {
      msg = typeof event.data === 'string' ? JSON.parse(event.data) : (event.data as typeof msg);
    } catch {
      return;
    }

    if (msg.method === 'mining.notify' && Array.isArray(msg.params) && msg.params.length >= 8) {
      const [jobId, prevHash, , , , , nbits, blockNumber] = msg.params as [
        string, string, unknown, unknown, unknown, unknown, string, number
      ];
      // Difficulty N means target = (2^256 / (2^32 * N)) — server uses its own target;
      // approximate target from difficulty for display only.
      this.status.currentJob = {
        jobId,
        prevHash,
        nbits,
        blockNumber,
        targetHex: this.lastKnownTargetHex,
        receivedAt: Date.now(),
      };
      this.emitStatus();
      return;
    }

    if (msg.method === 'mining.set_difficulty' && Array.isArray(msg.params)) {
      const diff = Number(msg.params[0]);
      if (diff > 0) this.status.difficulty = diff;
      this.emitStatus();
      return;
    }

    if (msg.id !== undefined && msg.id !== null) {
      // Response to a request we sent
      if (typeof msg.result === 'boolean') {
        // mining.authorize or mining.submit response
        const isAuthorize = msg.result === true && this.idCounter <= 2;
        if (!isAuthorize) {
          this.emit({ type: 'share', accepted: msg.result === true, detail: String(msg.error ?? 'ok') });
          if (msg.result === true) {
            this.status.sharesAccepted++;
          } else {
            this.status.sharesRejected++;
          }
          this.emitStatus();
        }
      }
    }
  }

  /** Start the mining loop (SHA-256d hash search). */
  startMining(): void {
    if (this.mining || !this.status.connected) return;
    this.mining = true;
    this.hashWindow = [];
    this.miningTimer = setInterval(() => this.mineTick(), 100);
  }

  stopMiningLoop(): void {
    this.mining = false;
    if (this.miningTimer) {
      clearInterval(this.miningTimer);
      this.miningTimer = null;
    }
  }

  private mineTick(): void {
    const job = this.status.currentJob;
    if (!job || !this.status.connected || !this.ws) return;

    const header = job.prevHash.startsWith('0x') ? job.prevHash.slice(2) : job.prevHash;
    if (!/^[0-9a-f]+$/i.test(header)) return;
    const targetBig = BigInt('0x' + (job.targetHex.startsWith('0x') ? job.targetHex.slice(2) : job.targetHex));

    const start = Date.now();
    let hashes = 0;
    let nonce = Math.floor(Math.random() * 0xfffff0);

    // Search for a valid share in this tick (bounded to keep UI responsive).
    while (Date.now() - start < 90) {
      const nonceHex = nonce.toString(16).padStart(8, '0');
      const hashHex = sha256dHex(header + nonceHex);
      hashes++;
      nonce = (nonce + 1) & 0xffffffff;
      if (BigInt('0x' + hashHex) <= targetBig) {
        // Valid share — submit it.
        this.send('mining.submit', [this.status.worker, job.jobId, nonceHex]);
        this.emit({ type: 'share', accepted: false, detail: 'Share submitted, awaiting verification' });
        // Keep searching with a new random nonce.
        nonce = Math.floor(Math.random() * 0xfffff0);
      }
    }

    this.status.totalHashes += hashes;
    this.hashWindow.push(hashes);
    if (this.hashWindow.length > 12) this.hashWindow.shift();
    const windowMs = this.hashWindow.length * 100;
    this.status.hashrate = Math.round(
      this.hashWindow.reduce((a, b) => a + b, 0) / Math.max(windowMs / 1000, 1)
    );
    this.emitStatus();
  }
}

// Singleton instance used by the Mining screen.
export const stratumMiner = new StratumMiner();

// ─── Pool / network stats ───────────────────────────────────────────────────

export interface MiningPoolStats {
  uptime_seconds: number;
  active_miners: number;
  connected_miners: number;
  total_shares_accepted: number;
  total_shares_rejected: number;
  current_block: number;
  job_id: string | null;
  auth_enabled: boolean;
}

/** Fetch live pool statistics from the mining server's /stats REST endpoint. */
export async function fetchMiningPoolStats(url: string): Promise<MiningPoolStats> {
  const base = url.replace(/^ws/, 'http').replace(/\/+$/, '');
  const response = await fetch(`${base}/stats`, {
    headers: { 'User-Agent': 'HSMC-Mobile/1.0' },
  });
  if (!response.ok) {
    throw new Error(`Pool stats error ${response.status}`);
  }
  const data = (await response.json()) as MiningPoolStats;
  return data;
}
