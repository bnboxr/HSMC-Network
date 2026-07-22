/**
 * HSMC Stratum V1 Mining Pool Server (Hardened)
 *
 * WebSocket server on port 3333 that accepts mining.subscribe,
 * mining.authorize, and mining.submit from the MiningRPCClient.
 * Validates SHA-256d proof-of-work shares and updates block
 * rewards in the local DB.
 *
 * Security:
 *  - API key auth via ?key= query param (MINING_API_KEY env var)
 *  - Rate limiting: 10 msg/s general, 50 msg/s for mining.submit
 *  - Max 50 concurrent connections
 *  - Input validation on wallet address, worker name, nonce, message size
 *  - Connection timeout: 30s for auth, 5min idle after auth
 *  - GET /stats HTTP endpoint (API-key protected)
 *
 * Usage: MINING_API_KEY=your-secret bun run /home/team/shared/mining-server.ts
 */

import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { ServerWebSocket, WebSocketHandler } from "bun";

const DB_PATH = "/home/team/shared/hsmc.db";
const PORT = 3333;

// ── Constants ────────────────────────────────────────────────────────────────────
const MAX_CONNECTIONS = 50;
const MAX_MESSAGE_SIZE = 4096; // 4KB
const AUTH_TIMEOUT_MS = 30_000; // 30s to authorize
const IDLE_TIMEOUT_MS = 300_000; // 5min idle after auth
const RATE_LIMIT_GENERAL = 10; // msgs/sec for non-submit
const RATE_LIMIT_SUBMIT = 50; // msgs/sec for mining.submit
const WINDOW_MS = 1000; // 1 second sliding window
const ADDRESS_MIN_LEN = 26;
const ADDRESS_MAX_LEN = 100;
const WORKER_NAME_MAX_LEN = 50;
const NONCE_MAX_LEN = 16;
const SERVER_VERSION = "HSMC-Stratum/1.1";

// ── API Key ──────────────────────────────────────────────────────────────────────
const API_KEY = typeof Bun !== "undefined" ? (Bun.env.MINING_API_KEY ?? process.env.MINING_API_KEY) : process.env.MINING_API_KEY;

if (!API_KEY) {
  console.warn("[Security] ⚠️  MINING_API_KEY not set — allowing all connections (DEV MODE)");
  console.warn("[Security] ⚠️  Set MINING_API_KEY env var to enable authentication");
}

function checkApiKey(key: string | null): boolean {
  if (!API_KEY) return true; // dev mode — allow all
  if (!key) return false;
  // Constant-time comparison to prevent timing attacks
  const a = key.trim();
  const b = API_KEY.trim();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Database Setup ────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL;");

// Ensure blocks table has key_image column if not present
try {
  db.exec("ALTER TABLE blocks ADD COLUMN key_image TEXT");
} catch { /* column may already exist */ }

// ── Types ─────────────────────────────────────────────────────────────────────────
interface MinerSession {
  id: string;
  ws: ServerWebSocket<{ sessionId: string }>;
  workerName: string;
  address: string;
  subscribed: boolean;
  authorized: boolean;
  connectedAt: number;
  lastActivity: number;
  sharesAccepted: number;
  sharesRejected: number;
  authTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  // Rate limiting
  msgTimestamps: number[]; // sliding window timestamps
  submitTimestamps: number[]; // separate window for mining.submit
  rateLimitWarned: boolean;
}

interface MiningJob {
  jobId: string;
  prevHash: string;
  target: string;
  blockNumber: number;
  nbits: string;
}

// ── State ─────────────────────────────────────────────────────────────────────────
const miners = new Map<string, MinerSession>();
let currentJob: MiningJob | null = null;
let jobCounter = 0;
let blockNumber = 7; // Starting from last known block
const serverStartTime = Date.now();
let totalSharesAccepted = 0;
let totalSharesRejected = 0;

// ── Input Validation ──────────────────────────────────────────────────────────────

/** Validate wallet address: min ADDRESS_MIN_LEN chars, max ADDRESS_MAX_LEN,
 *  starts with 0x (hex) or alphanumeric only. */
function validateAddress(address: unknown): string | null {
  if (typeof address !== "string") return "Address must be a string";
  const a = address.trim();
  if (a.length < ADDRESS_MIN_LEN) return `Address too short (min ${ADDRESS_MIN_LEN} chars)`;
  if (a.length > ADDRESS_MAX_LEN) return `Address too long (max ${ADDRESS_MAX_LEN} chars)`;
  // Allow 0x-prefixed hex addresses or plain alphanumeric
  if (a.startsWith("0x")) {
    if (!/^0x[0-9a-fA-F]+$/.test(a)) return "Address must be 0x-prefixed hex";
  } else {
    if (!/^[a-zA-Z0-9]+$/.test(a)) return "Address must be alphanumeric";
  }
  return null;
}

/** Validate worker name: max WORKER_NAME_MAX_LEN, alphanumeric + underscore + dash */
function validateWorkerName(name: unknown): string | null {
  if (typeof name !== "string") return "Worker name must be a string";
  const n = name.trim();
  if (n.length === 0) return "Worker name required";
  if (n.length > WORKER_NAME_MAX_LEN) return `Worker name too long (max ${WORKER_NAME_MAX_LEN} chars)`;
  if (!/^[a-zA-Z0-9_-]+$/.test(n)) return "Worker name must be alphanumeric (underscore/dash allowed)";
  return null;
}

/** Validate nonce hex: max NONCE_MAX_LEN chars, hex only */
function validateNonce(nonce: unknown): string | null {
  if (typeof nonce !== "string") return "Nonce must be a string";
  const n = nonce.trim();
  if (n.length === 0) return "Nonce required";
  if (n.length > NONCE_MAX_LEN) return `Nonce too long (max ${NONCE_MAX_LEN} chars)`;
  if (!/^[0-9a-fA-F]+$/.test(n)) return "Nonce must be hex characters only";
  return null;
}

// ── Rate Limiting ─────────────────────────────────────────────────────────────────

/** Check sliding-window rate limit. Returns true if allowed, false if blocked. */
function checkRateLimit(timestamps: number[], limit: number, now: number): { allowed: boolean; timestamps: number[] } {
  // Purge old entries outside the window
  const cutoff = now - WINDOW_MS;
  const filtered = timestamps.filter((t) => t > cutoff);
  if (filtered.length >= limit) {
    return { allowed: false, timestamps: filtered };
  }
  filtered.push(now);
  return { allowed: true, timestamps: filtered };
}

/** Enforce rate limit on a miner. Returns true if message should be processed. */
function enforceRateLimit(miner: MinerSession, isSubmit: boolean): boolean {
  const now = Date.now();
  if (isSubmit) {
    const { allowed, timestamps } = checkRateLimit(miner.submitTimestamps, RATE_LIMIT_SUBMIT, now);
    miner.submitTimestamps = timestamps;
    if (!allowed) {
      if (!miner.rateLimitWarned) {
        miner.rateLimitWarned = true;
        sendToMiner(miner, {
          id: null,
          method: "mining.error",
          params: [`Rate limit exceeded: ${RATE_LIMIT_SUBMIT} mining.submit/sec max. Next violation closes connection.`],
        });
      } else {
        sendToMiner(miner, {
          id: null,
          method: "mining.error",
          params: ["Rate limit exceeded — closing connection."],
        });
        closeWithReason(miner, "Rate limit exceeded");
        return false;
      }
      return false;
    }
  } else {
    const { allowed, timestamps } = checkRateLimit(miner.msgTimestamps, RATE_LIMIT_GENERAL, now);
    miner.msgTimestamps = timestamps;
    if (!allowed) {
      if (!miner.rateLimitWarned) {
        miner.rateLimitWarned = true;
        sendToMiner(miner, {
          id: null,
          method: "mining.error",
          params: [`Rate limit exceeded: ${RATE_LIMIT_GENERAL} msg/sec max. Next violation closes connection.`],
        });
      } else {
        closeWithReason(miner, "Rate limit exceeded");
        return false;
      }
      return false;
    }
  }
  // Reset warned flag if they're within limits
  miner.rateLimitWarned = false;
  return true;
}

// ── Timeout Management ────────────────────────────────────────────────────────────

function resetAuthTimeout(miner: MinerSession): void {
  if (miner.authTimer) clearTimeout(miner.authTimer);
  miner.authTimer = setTimeout(() => {
    console.log(`[Mining] Auth timeout: ${miner.id} (${miner.workerName || "unnamed"})`);
    closeWithReason(miner, "Authentication timeout — send mining.authorize within 30s");
  }, AUTH_TIMEOUT_MS);
}

function resetIdleTimeout(miner: MinerSession): void {
  if (miner.idleTimer) clearTimeout(miner.idleTimer);
  miner.idleTimer = setTimeout(() => {
    console.log(`[Mining] Idle timeout: ${miner.workerName} (${miner.id})`);
    closeWithReason(miner, "Idle timeout — no shares submitted for 5 minutes");
  }, IDLE_TIMEOUT_MS);
}

function clearAllTimers(miner: MinerSession): void {
  if (miner.authTimer) { clearTimeout(miner.authTimer); miner.authTimer = null; }
  if (miner.idleTimer) { clearTimeout(miner.idleTimer); miner.idleTimer = null; }
}

function closeWithReason(miner: MinerSession, reason: string): void {
  try {
    miner.ws.close(4000, reason);
  } catch {
    // Already closed
  }
  miners.delete(miner.id);
  clearAllTimers(miner);
}

// ── Crypto Helpers ────────────────────────────────────────────────────────────────

/** SHA-256 hash, returns hex string without 0x prefix */
function sha256(data: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

/** Validate share: hash(header + nonceHex) <= target */
function validateShare(
  header: string,
  nonceHex: string,
  targetHex: string
): boolean {
  try {
    const input = header + nonceHex;
    const hashHex = sha256(input);
    const hashBig = BigInt("0x" + hashHex);
    const targetBig = BigInt("0x" + targetHex);
    return hashBig <= targetBig;
  } catch {
    return false;
  }
}

/** Generate a new mining job */
function generateJob(): MiningJob {
  const jobId = (++jobCounter).toString(16);
  const lastBlock = db
    .query("SELECT hash, block_number FROM blocks ORDER BY block_number DESC LIMIT 1")
    .get() as { hash: string; block_number: number } | null;

  const prevHash = lastBlock?.hash ?? "0x00d15d11b099623231ba07087b7b68d8e9d5e4d8e4bf458c8f0bb9c3a3dfa4f1";
  blockNumber = (lastBlock?.block_number ?? 6) + 1;

  const target = "0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const nbits = "1f00ffff";

  return { jobId, prevHash, target, blockNumber, nbits };
}

/** Broadcast mining.notify to all subscribed miners */
function broadcastJob(job: MiningJob): void {
  const notify = {
    id: null,
    method: "mining.notify",
    params: [job.jobId, job.prevHash, "", "", [], "", job.nbits, job.blockNumber, true],
  };
  const msg = JSON.stringify(notify);
  for (const [, miner] of miners) {
    if (miner.subscribed && miner.authorized) {
      try {
        miner.ws.sendText(msg);
      } catch {
        // Miner disconnected — will be cleaned up by onclose
      }
    }
  }
}

/** Create a new block when a valid share is found */
function createBlock(miner: MinerSession, nonce: number, hash: string): void {
  const now = new Date().toISOString();
  const blockId = randomUUID();

  db.run(
    `INSERT INTO blocks (id, block_number, hash, prev_hash, miner_address, transactions_count,
     nonce, difficulty, created_at, privacy_protocol, key_image)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'RingCT-v2', ?)`,
    blockId,
    blockNumber,
    `0x${hash}`,
    currentJob?.prevHash ?? "0x0",
    miner.address,
    nonce,
    4000000,
    now,
    `share-${miner.workerName}-${Date.now()}`
  );

  // Update network stats
  db.run(
    `UPDATE network_stats SET block_height = ?, total_transactions = total_transactions + 1, updated_at = ? WHERE id = 'default'`,
    blockNumber,
    now
  );

  // Reward miner: 50 HSMC
  db.run(
    `UPDATE wallets SET balance = balance + 50, updated_at = ? WHERE address = ?`,
    now,
    miner.address
  );

  console.log(
    `[Mining] ✅ Block #${blockNumber} found by ${miner.workerName} (${miner.address.slice(0, 14)}...) ` +
    `hash=${hash.slice(0, 16)}... nonce=${nonce}`
  );

  // Generate next job
  currentJob = generateJob();
  broadcastJob(currentJob!);
}

/** Send to a single miner */
function sendToMiner(miner: MinerSession, data: object): void {
  try {
    miner.ws.sendText(JSON.stringify(data));
  } catch {
    // ignore
  }
}

// ── WebSocket Server ──────────────────────────────────────────────────────────────

const server = Bun.serve<{ sessionId: string; authorized: boolean }>({
  port: PORT,
  fetch(req, serverInstance) {
    const url = new URL(req.url);

    // ── GET /stats ──────────────────────────────────────────────────────────
    if (url.pathname === "/stats" && req.method === "GET") {
      const key = url.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!checkApiKey(key)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const activeMiners = [...miners.values()].filter((m) => m.authorized).length;
      const connectedMiners = miners.size;
      const uptimeMs = Date.now() - serverStartTime;
      const uptimeSeconds = Math.floor(uptimeMs / 1000);

      return new Response(
        JSON.stringify({
          server: SERVER_VERSION,
          uptime_seconds: uptimeSeconds,
          uptime_human: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
          active_miners: activeMiners,
          connected_miners: connectedMiners,
          max_connections: MAX_CONNECTIONS,
          total_shares_accepted: totalSharesAccepted,
          total_shares_rejected: totalSharesRejected,
          current_block: blockNumber,
          job_id: currentJob?.jobId ?? null,
          auth_enabled: !!API_KEY,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // ── WebSocket Upgrade ───────────────────────────────────────────────────
    if (url.pathname === "/" || url.pathname === "/stratum") {
      // API key authentication
      const key = url.searchParams.get("key");
      if (!checkApiKey(key)) {
        console.log(`[Mining] ❌ Rejected connection — invalid API key from ${req.headers.get("x-forwarded-for") ?? "unknown"}`);
        return new Response("Unauthorized — invalid or missing API key", { status: 401 });
      }

      // Max connections check
      if (miners.size >= MAX_CONNECTIONS) {
        console.warn(`[Mining] ⚠️  Max connections (${MAX_CONNECTIONS}) reached — rejecting new connection`);
        return new Response("Service Unavailable — max connections reached", { status: 503 });
      }

      const success = serverInstance.upgrade(req, {
        data: { sessionId: randomUUID(), authorized: true },
      });
      if (success) return;
    }

    return new Response(`HSMC Stratum Mining Server ${SERVER_VERSION}`, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  },

  websocket: {
    open(ws) {
      const sessionId = ws.data.sessionId;
      const miner: MinerSession = {
        id: sessionId,
        ws,
        workerName: "",
        address: "",
        subscribed: false,
        authorized: false,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        sharesAccepted: 0,
        sharesRejected: 0,
        authTimer: null,
        idleTimer: null,
        msgTimestamps: [],
        submitTimestamps: [],
        rateLimitWarned: false,
      };

      // Start auth timeout
      resetAuthTimeout(miner);

      miners.set(sessionId, miner);
      console.log(`[Mining] Miner connected: ${sessionId} (total: ${miners.size}/${MAX_CONNECTIONS})`);
    },

    message(ws, message) {
      const sessionId = ws.data.sessionId;
      const miner = miners.get(sessionId);
      if (!miner) return;

      // ── Message size check ──────────────────────────────────────────────
      const rawMsg = typeof message === "string" ? message : new TextDecoder().decode(message as Uint8Array);
      if (rawMsg.length > MAX_MESSAGE_SIZE) {
        console.log(`[Mining] Message too large (${rawMsg.length} bytes) from ${miner.workerName || sessionId}`);
        sendToMiner(miner, { id: null, error: `Message too large — max ${MAX_MESSAGE_SIZE} bytes`, result: false });
        return;
      }

      // Parse JSON
      let msg: { id?: number | null; method?: string; params?: unknown[]; result?: unknown; error?: unknown };
      try {
        msg = JSON.parse(rawMsg);
      } catch {
        sendToMiner(miner, { id: null, error: "Invalid JSON", result: false });
        return;
      }

      const method = msg.method || "";
      const params = (msg.params as unknown[]) ?? [];

      // ── Rate limiting ──────────────────────────────────────────────────
      if (!enforceRateLimit(miner, method === "mining.submit")) {
        return; // Rate limited — connection may be closed
      }

      // ── Update activity timestamp ──────────────────────────────────────
      miner.lastActivity = Date.now();

      switch (method) {
        case "mining.subscribe": {
          miner.subscribed = true;

          // Generate first job if needed
          if (!currentJob) {
            currentJob = generateJob();
          }
          const subReply = {
            id: msg.id ?? 1,
            result: [[["mining.notify", "mining.set_difficulty"]], "HSMC-1", 1],
            error: null,
          };
          sendToMiner(miner, subReply);

          // Send initial difficulty
          sendToMiner(miner, {
            id: null,
            method: "mining.set_difficulty",
            params: [4],
          });

          // Send initial job
          sendToMiner(miner, {
            id: null,
            method: "mining.notify",
            params: [
              currentJob.jobId,
              currentJob.prevHash,
              "",
              "",
              [],
              "",
              currentJob.nbits,
              currentJob.blockNumber,
              true,
            ],
          });

          console.log(`[Mining] ${miner.workerName || sessionId} subscribed`);
          break;
        }

        case "mining.authorize": {
          const address = String(params[0] ?? "");
          const workerName = String(params[1] ?? "worker");

          // ── Input validation ──────────────────────────────────────────
          const addrErr = validateAddress(address);
          if (addrErr) {
            sendToMiner(miner, {
              id: msg.id ?? 2,
              result: false,
              error: `Invalid address: ${addrErr}`,
            });
            console.log(`[Mining] ❌ Invalid address from ${sessionId}: ${addrErr}`);
            return;
          }

          const workerErr = validateWorkerName(workerName);
          if (workerErr) {
            sendToMiner(miner, {
              id: msg.id ?? 2,
              result: false,
              error: `Invalid worker name: ${workerErr}`,
            });
            console.log(`[Mining] ❌ Invalid worker name from ${sessionId}: ${workerErr}`);
            return;
          }

          miner.address = address.trim();
          miner.workerName = workerName.trim();
          miner.authorized = true;

          // Clear auth timeout — miner has authorized
          if (miner.authTimer) {
            clearTimeout(miner.authTimer);
            miner.authTimer = null;
          }

          // Start idle timeout
          resetIdleTimeout(miner);

          sendToMiner(miner, {
            id: msg.id ?? 2,
            result: true,
            error: null,
          });

          console.log(`[Mining] ${miner.workerName} authorized (${miner.address.slice(0, 14)}...)`);
          break;
        }

        case "mining.submit": {
          if (!miner.authorized) {
            sendToMiner(miner, {
              id: msg.id,
              result: false,
              error: "Not authorized. Send mining.authorize first.",
            });
            return;
          }

          const workerNameIn = String(params[0] ?? "");
          const jobId = String(params[1] ?? "");
          const nonceHex = String(params[2] ?? "0");
          const nonceNum = parseInt(nonceHex, 16);

          // ── Input validation ──────────────────────────────────────────
          const nonceErr = validateNonce(nonceHex);
          if (nonceErr) {
            miner.sharesRejected++;
            totalSharesRejected++;
            sendToMiner(miner, {
              id: msg.id,
              result: false,
              error: `Invalid nonce: ${nonceErr}`,
            });
            console.log(`[Mining] ❌ Invalid nonce from ${miner.workerName}: ${nonceErr}`);
            return;
          }

          if (!currentJob || jobId !== currentJob.jobId) {
            // Stale share
            miner.sharesRejected++;
            totalSharesRejected++;
            sendToMiner(miner, {
              id: msg.id,
              result: false,
              error: "Stale job",
            });
            console.log(`[Mining] Stale share from ${miner.workerName}`);
            return;
          }

          // Build header: prevHash without 0x prefix
          const header = currentJob.prevHash.startsWith("0x")
            ? currentJob.prevHash.slice(2)
            : currentJob.prevHash;

          const valid = validateShare(header, nonceHex, currentJob.target);

          if (valid) {
            miner.sharesAccepted++;
            totalSharesAccepted++;
            sendToMiner(miner, {
              id: msg.id,
              result: true,
              error: null,
            });

            const hash = sha256(header + nonceHex);
            console.log(
              `[Mining] ✅ Valid share from ${miner.workerName} | hash=${hash.slice(0, 16)}... nonce=${nonceNum}`
            );

            // Found a block!
            createBlock(miner, nonceNum, hash);
          } else {
            miner.sharesRejected++;
            totalSharesRejected++;
            sendToMiner(miner, {
              id: msg.id,
              result: false,
              error: "Share rejected — does not meet target difficulty",
            });
            console.log(
              `[Mining] ❌ Invalid share from ${miner.workerName} (nonce=${nonceNum}, hash doesn't meet target)`
            );
          }

          // Reset idle timeout on every submit
          resetIdleTimeout(miner);
          break;
        }

        default: {
          sendToMiner(miner, {
            id: msg.id,
            result: null,
            error: `Unknown method: ${method}`,
          });
        }
      }
    },

    close(ws) {
      const sessionId = ws.data.sessionId;
      const miner = miners.get(sessionId);
      if (miner) {
        clearAllTimers(miner);
        console.log(
          `[Mining] ${miner.workerName || sessionId} disconnected ` +
          `(accepted: ${miner.sharesAccepted}, rejected: ${miner.sharesRejected})`
        );
        miners.delete(sessionId);
      }
    },
  },
});

console.log(`⛏️  HSMC Stratum V1 Mining Server ${SERVER_VERSION} running on ws://0.0.0.0:${PORT}`);
console.log(`   Connect your MiningRPCClient to ws://localhost:${PORT}`);
if (API_KEY) {
  console.log(`   Auth: required (add ?key=MINING_API_KEY to connect)`);
} else {
  console.warn(`   Auth: DISABLED (set MINING_API_KEY to enable)`);
}
console.log(`   Max connections: ${MAX_CONNECTIONS}`);
console.log(`   Stats: http://localhost:${PORT}/stats?key=MINING_API_KEY`);
console.log(`   Block #${blockNumber} ready — waiting for miners...`);
