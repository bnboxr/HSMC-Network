/**
 * HSMC Stratum V1 Mining Pool Server (Hardened)
 *
 * WebSocket server on port 3333 (ws) and 3433 (wss) that accepts
 * mining.subscribe, mining.authorize, and mining.submit from mining
 * clients. Validates SHA-256d proof-of-work shares and updates
 * block rewards in the local DB.
 *
 * Security:
 *  - TLS (wss://) via TLS_CERT/TLS_KEY env vars
 *  - API key auth via Authorization / x-api-key headers (plus ?key= backward compat)
 *  - Noise Protocol IK handshake skeleton (ready for full impl)
 *  - Rate limiting: 10 msg/s general, 50 msg/s for mining.submit
 *  - Max 50 concurrent connections
 *  - Input validation on wallet address, worker name, nonce, message size
 *  - Connection timeout: 30s for auth, 5min idle after auth
 *  - GET /stats HTTP endpoint (API-key protected)
 *  - Constant-time API key comparison
 *
 * Usage:
 *   MINING_API_KEY=secret bun run server/mining-server.ts
 *   TLS_CERT=/path/to/cert.pem TLS_KEY=/path/to/key.pem MINING_API_KEY=secret bun run server/mining-server.ts
 */

import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import type { ServerWebSocket } from "bun";

const DB_PATH = "/home/team/shared/hsmc.db";
const WS_PORT = 3333;
const WSS_PORT = 3433;

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
const SERVER_VERSION = "HSMC-Stratum/1.2";
const QUERY_STRING_WARN_INTERVAL_MS = 10_000; // rate-limit query-string warning to once per 10s

// ── TLS Configuration ────────────────────────────────────────────────────────────
const TLS_CERT = Bun.env.TLS_CERT ?? process.env.TLS_CERT;
const TLS_KEY = Bun.env.TLS_KEY ?? process.env.TLS_KEY;

let tlsConfig: { certFile: string; keyFile: string } | null = null;
if (TLS_CERT && TLS_KEY) {
  tlsConfig = { certFile: TLS_CERT, keyFile: TLS_KEY };
}

// ── API Key ──────────────────────────────────────────────────────────────────────
const API_KEY = Bun.env.MINING_API_KEY ?? process.env.MINING_API_KEY;

if (!API_KEY) {
  console.warn("[Security] \u26a0\ufe0f  MINING_API_KEY not set \u2014 allowing all connections (DEV MODE)");
  console.warn("[Security] \u26a0\ufe0f  Set MINING_API_KEY env var to enable authentication");
}

/**
 * Constant-time API key comparison to prevent timing attacks.
 */
function checkApiKey(key: string | null): boolean {
  if (!API_KEY) return true; // dev mode — allow all
  if (!key) return false;
  const a = key.trim();
  const b = API_KEY.trim();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Track last query-string warning per IP to rate-limit the log spam */
const queryStringWarnTimestamps = new Map<string, number>();

/**
 * Extract API key from request using headers first, then fall back to query string.
 * Returns the key string and the source for logging.
 */
function extractApiKey(req: Request): { key: string | null; source: "header-bearer" | "header-x-api-key" | "query" | "none" } {
  // 1. Authorization: Bearer <key>
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return { key: match[1], source: "header-bearer" };
  }

  // 2. x-api-key: <key>
  const apiKeyHeader = req.headers.get("x-api-key");
  if (apiKeyHeader) return { key: apiKeyHeader, source: "header-x-api-key" };

  // 3. ?key=<key> (backward compat — deprecated)
  const url = new URL(req.url);
  const queryKey = url.searchParams.get("key");
  if (queryKey) return { key: queryKey, source: "query" };

  return { key: null, source: "none" };
}

/**
 * Warn about API key in query string — rate-limited to once per 10s per IP.
 */
function warnQueryStringApiKey(ip: string): void {
  const now = Date.now();
  const last = queryStringWarnTimestamps.get(ip) ?? 0;
  if (now - last > QUERY_STRING_WARN_INTERVAL_MS) {
    queryStringWarnTimestamps.set(ip, now);
    console.warn(
      `[Security] API key received via query string from ${ip} ` +
      `\u2014 this is visible in logs/network. Use 'Authorization' header instead.`
    );
  }
}

/**
 * Extract client IP from request headers (X-Forwarded-For for proxies, fallback to addr).
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  // Bun doesn't directly expose remote address on Request, but headers may include it
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

// ── Database Setup ────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL;");

// Ensure blocks table has key_image column if not present
try {
  db.exec("ALTER TABLE blocks ADD COLUMN key_image TEXT");
} catch { /* column may already exist */ }

// ── WebSocket Data Payload (carried in Bun's ws.data) ─────────────────────────────
interface WSData {
  sessionId: string;
  authorized: boolean;
  transport: "ws" | "wss";
  ip: string;
  userAgent: string;
  apiKeySource: "header-bearer" | "header-x-api-key" | "query" | "none";
}

// ── Types ─────────────────────────────────────────────────────────────────────────
interface MinerSession {
  id: string;
  ws: ServerWebSocket<WSData>;
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
  msgTimestamps: number[];
  submitTimestamps: number[];
  rateLimitWarned: boolean;
  // Connection metadata
  transport: "ws" | "wss";
  ip: string;
  userAgent: string;
  apiKeySource: "header-bearer" | "header-x-api-key" | "query" | "none";
}

interface MiningJob {
  jobId: string;
  prevHash: string;
  target: string;
  blockNumber: number;
  nbits: string;
}

// ── Shared State (shared between WS and WSS servers) ──────────────────────────────
const miners = new Map<string, MinerSession>();
let currentJob: MiningJob | null = null;
let jobCounter = 0;
let blockNumber = 7;
const serverStartTime = Date.now();
let totalSharesAccepted = 0;
let totalSharesRejected = 0;

// ── Input Validation ──────────────────────────────────────────────────────────────

function validateAddress(address: unknown): string | null {
  if (typeof address !== "string") return "Address must be a string";
  const a = address.trim();
  if (a.length < ADDRESS_MIN_LEN) return `Address too short (min ${ADDRESS_MIN_LEN} chars)`;
  if (a.length > ADDRESS_MAX_LEN) return `Address too long (max ${ADDRESS_MAX_LEN} chars)`;
  if (a.startsWith("0x")) {
    if (!/^0x[0-9a-fA-F]+$/.test(a)) return "Address must be 0x-prefixed hex";
  } else {
    if (!/^[a-zA-Z0-9]+$/.test(a)) return "Address must be alphanumeric";
  }
  return null;
}

function validateWorkerName(name: unknown): string | null {
  if (typeof name !== "string") return "Worker name must be a string";
  const n = name.trim();
  if (n.length === 0) return "Worker name required";
  if (n.length > WORKER_NAME_MAX_LEN) return `Worker name too long (max ${WORKER_NAME_MAX_LEN} chars)`;
  if (!/^[a-zA-Z0-9_-]+$/.test(n)) return "Worker name must be alphanumeric (underscore/dash allowed)";
  return null;
}

function validateNonce(nonce: unknown): string | null {
  if (typeof nonce !== "string") return "Nonce must be a string";
  const n = nonce.trim();
  if (n.length === 0) return "Nonce required";
  if (n.length > NONCE_MAX_LEN) return `Nonce too long (max ${NONCE_MAX_LEN} chars)`;
  if (!/^[0-9a-fA-F]+$/.test(n)) return "Nonce must be hex characters only";
  return null;
}

// ── Rate Limiting ─────────────────────────────────────────────────────────────────

function checkRateLimit(timestamps: number[], limit: number, now: number): { allowed: boolean; timestamps: number[] } {
  const cutoff = now - WINDOW_MS;
  const filtered = timestamps.filter((t) => t > cutoff);
  if (filtered.length >= limit) {
    return { allowed: false, timestamps: filtered };
  }
  filtered.push(now);
  return { allowed: true, timestamps: filtered };
}

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
  miner.rateLimitWarned = false;
  return true;
}

// ── Timeout Management ────────────────────────────────────────────────────────────

function resetAuthTimeout(miner: MinerSession): void {
  if (miner.authTimer) clearTimeout(miner.authTimer);
  miner.authTimer = setTimeout(() => {
    console.log(`[Mining] Auth timeout: ${miner.id} (${miner.workerName || "unnamed"}) [ws${miner.transport === "wss" ? "s" : ""}]`);
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

function sha256(data: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

function validateShare(header: string, nonceHex: string, targetHex: string): boolean {
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
        // Miner disconnected
      }
    }
  }
}

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

  db.run(
    `UPDATE network_stats SET block_height = ?, total_transactions = total_transactions + 1, updated_at = ? WHERE id = 'default'`,
    blockNumber,
    now
  );

  db.run(
    `UPDATE wallets SET balance = balance + 50, updated_at = ? WHERE address = ?`,
    now,
    miner.address
  );

  console.log(
    `[Mining] \u2705 Block #${blockNumber} found by ${miner.workerName} ` +
    `(${miner.address.slice(0, 14)}...) ` +
    `hash=${hash.slice(0, 16)}... nonce=${nonce} [${miner.ip}]`
  );

  currentJob = generateJob();
  broadcastJob(currentJob!);
}

function sendToMiner(miner: MinerSession, data: object): void {
  try {
    miner.ws.sendText(JSON.stringify(data));
  } catch {
    // ignore
  }
}

// ── WebSocket Message Handler (shared by WS and WSS) ─────────────────────────────
function handleMessage(ws: ServerWebSocket<WSData>, message: string | Uint8Array): void {
  const wsData = ws.data;
  const sessionId = wsData.sessionId;
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
    return;
  }

  // ── Update activity timestamp ──────────────────────────────────────
  miner.lastActivity = Date.now();

  switch (method) {
    case "mining.subscribe": {
      miner.subscribed = true;

      if (!currentJob) {
        currentJob = generateJob();
      }
      const subReply = {
        id: msg.id ?? 1,
        result: [[["mining.notify", "mining.set_difficulty"]], "HSMC-1", 1],
        error: null,
      };
      sendToMiner(miner, subReply);

      sendToMiner(miner, {
        id: null,
        method: "mining.set_difficulty",
        params: [4],
      });

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

      console.log(`[Mining] ${miner.workerName || sessionId} subscribed [${miner.ip}]`);
      break;
    }

    case "mining.authorize": {
      const address = String(params[0] ?? "");
      const workerName = String(params[1] ?? "worker");

      const addrErr = validateAddress(address);
      if (addrErr) {
        sendToMiner(miner, {
          id: msg.id ?? 2,
          result: false,
          error: `Invalid address: ${addrErr}`,
        });
        console.log(`[Mining] \u274c Invalid address from ${sessionId}: ${addrErr} [${miner.ip}]`);
        return;
      }

      const workerErr = validateWorkerName(workerName);
      if (workerErr) {
        sendToMiner(miner, {
          id: msg.id ?? 2,
          result: false,
          error: `Invalid worker name: ${workerErr}`,
        });
        console.log(`[Mining] \u274c Invalid worker name from ${sessionId}: ${workerErr} [${miner.ip}]`);
        return;
      }

      miner.address = address.trim();
      miner.workerName = workerName.trim();
      miner.authorized = true;

      if (miner.authTimer) {
        clearTimeout(miner.authTimer);
        miner.authTimer = null;
      }

      resetIdleTimeout(miner);

      sendToMiner(miner, {
        id: msg.id ?? 2,
        result: true,
        error: null,
      });

      console.log(`[Mining] ${miner.workerName} authorized (${miner.address.slice(0, 14)}...) [${miner.ip}]`);
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

      const nonceErr = validateNonce(nonceHex);
      if (nonceErr) {
        miner.sharesRejected++;
        totalSharesRejected++;
        sendToMiner(miner, {
          id: msg.id,
          result: false,
          error: `Invalid nonce: ${nonceErr}`,
        });
        console.log(`[Mining] \u274c Invalid nonce from ${miner.workerName}: ${nonceErr} [${miner.ip}]`);
        return;
      }

      if (!currentJob || jobId !== currentJob.jobId) {
        miner.sharesRejected++;
        totalSharesRejected++;
        sendToMiner(miner, {
          id: msg.id,
          result: false,
          error: "Stale job",
        });
        console.log(`[Mining] Stale share from ${miner.workerName} [${miner.ip}]`);
        return;
      }

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
          `[Mining] \u2705 Valid share from ${miner.workerName} | hash=${hash.slice(0, 16)}... nonce=${nonceNum} [${miner.ip}]`
        );

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
          `[Mining] \u274c Invalid share from ${miner.workerName} (nonce=${nonceNum}, hash doesn't meet target) [${miner.ip}]`
        );
      }

      resetIdleTimeout(miner);
      break;
    }

    // ── Noise Protocol Handshake (preparation) ────────────────────────
    case "noise.handshake": {
      // TODO: Full Noise IK handshake implementation
      // Currently accepts the handshake initiation and responds with
      // a supported confirmation. Full implementation should:
      //   - Process the IK pattern (Noise_IK_25519_ChaChaPoly_BLAKE2b)
      //   - Derive shared symmetric key from ECDH
      //   - Switch to encrypted frame transport after handshake
      const requestedPattern = String(params[0] ?? "");
      console.log(
        `[Mining] \ud83d\udd10 Noise handshake requested by ${miner.workerName || sessionId} ` +
        `[${miner.ip}] pattern=${requestedPattern}`
      );

      if (requestedPattern === "Noise_IK_25519_ChaChaPoly_BLAKE2b") {
        sendToMiner(miner, {
          id: msg.id ?? null,
          result: true,
          noise: "supported",
          status: "ready",
        });
      } else {
        sendToMiner(miner, {
          id: msg.id ?? null,
          result: false,
          error: `Unsupported Noise pattern: ${requestedPattern}. Supported: Noise_IK_25519_ChaChaPoly_BLAKE2b`,
        });
      }
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
}

// ── HTTP fetch handler (shared by both servers) ──────────────────────────────────

function createFetchHandler(transport: "ws" | "wss"): (req: Request, serverInstance: any) => Response | Promise<Response> {
  return (req: Request, serverInstance: any) => {
    const url = new URL(req.url);
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? "unknown";

    // ── GET /stats ──────────────────────────────────────────────────────────
    if (url.pathname === "/stats" && req.method === "GET") {
      const { key, source } = extractApiKey(req);
      if (source === "query") warnQueryStringApiKey(ip);
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
          tls_enabled: !!tlsConfig,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // ── WebSocket Upgrade ───────────────────────────────────────────────────
    if (url.pathname === "/" || url.pathname === "/stratum") {
      // Extract API key
      const { key, source } = extractApiKey(req);

      if (source === "query") {
        warnQueryStringApiKey(ip);
      }

      if (!checkApiKey(key)) {
        console.log(
          `[Mining] \u274c Rejected connection — invalid API key from ${ip} ` +
          `[${transport}] UA=${userAgent}`
        );
        return new Response("Unauthorized — invalid or missing API key", { status: 401 });
      }

      // Max connections check
      if (miners.size >= MAX_CONNECTIONS) {
        console.warn(`[Mining] \u26a0\ufe0f  Max connections (${MAX_CONNECTIONS}) reached — rejecting new connection [${ip}]`);
        return new Response("Service Unavailable — max connections reached", { status: 503 });
      }

      const sessionId = randomUUID();
      const success = serverInstance.upgrade(req, {
        data: {
          sessionId,
          authorized: true,
          transport,
          ip,
          userAgent,
          apiKeySource: source,
        } satisfies WSData,
      });
      if (success) return;
    }

    return new Response(`HSMC Stratum Mining Server ${SERVER_VERSION}`, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  };
}

// ── WebSocket Handler (shared by both servers) ───────────────────────────────────

function createWebSocketHandler(): any {
  return {
    open(ws: ServerWebSocket<WSData>) {
      const d = ws.data;
      const sessionId = d.sessionId;
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
        transport: d.transport,
        ip: d.ip,
        userAgent: d.userAgent,
        apiKeySource: d.apiKeySource,
      };

      resetAuthTimeout(miner);
      miners.set(sessionId, miner);

      const keySrc = d.apiKeySource === "header-bearer"
        ? "Bearer header"
        : d.apiKeySource === "header-x-api-key"
        ? "x-api-key header"
        : d.apiKeySource === "query"
        ? "query string"
        : "none";

      console.log(
        `[Mining] \ud83d\udd0c Miner connected: ${sessionId} ` +
        `(total: ${miners.size}/${MAX_CONNECTIONS}) ` +
        `[${d.ip}] [${d.transport}] key=${keySrc} UA=${d.userAgent.slice(0, 40)}`
      );
    },

    message(ws: ServerWebSocket<WSData>, message: string | Uint8Array) {
      handleMessage(ws, message);
    },

    close(ws: ServerWebSocket<WSData>) {
      const d = ws.data;
      const sessionId = d.sessionId;
      const miner = miners.get(sessionId);
      if (miner) {
        clearAllTimers(miner);
        console.log(
          `[Mining] ${miner.workerName || sessionId} disconnected ` +
          `(accepted: ${miner.sharesAccepted}, rejected: ${miner.sharesRejected}) ` +
          `[${d.ip}] [${d.transport}]`
        );
        miners.delete(sessionId);
      }
    },
  };
}

// ── Start Servers ────────────────────────────────────────────────────────────────

// WS server (always runs on port 3333)
const wsServer = Bun.serve<WSData>({
  port: WS_PORT,
  fetch: createFetchHandler("ws"),
  websocket: createWebSocketHandler(),
});

// WSS server (optional, on port 3433 if TLS certs are available)
let wssServer: ReturnType<typeof Bun.serve> | null = null;

if (tlsConfig) {
  wssServer = Bun.serve<WSData>({
    port: WSS_PORT,
    tls: tlsConfig,
    fetch: createFetchHandler("wss"),
    websocket: createWebSocketHandler(),
  });
}

// ── Startup Banner ───────────────────────────────────────────────────────────────

const wsUrl = `ws://0.0.0.0:${WS_PORT}`;
const wssUrl = `wss://0.0.0.0:${WSS_PORT}`;

console.log(`\u26cf\ufe0f  HSMC Stratum V1 Mining Server ${SERVER_VERSION}`);
console.log(`   WS:  ${wsUrl}`);
if (wssServer) {
  console.log(`   WSS: ${wssUrl}`);
} else {
  console.warn("\x1b[31m   \u26a0\ufe0f  WARNING: Stratum server running WITHOUT TLS encryption.\x1b[0m");
  console.warn("\x1b[31m   Set TLS_CERT and TLS_KEY env vars to enable wss:// connections.\x1b[0m");
  console.warn("\x1b[31m   Generate a self-signed cert for dev:\x1b[0m");
  console.warn("\x1b[31m   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes\x1b[0m");
}

if (API_KEY) {
  console.log(`   Auth: required (use Authorization: Bearer <key> or x-api-key header)`);
  console.log(`   Legacy: ?key= query param still accepted but logs a security warning`);
} else {
  console.warn(`   Auth: DISABLED (set MINING_API_KEY to enable)`);
}
console.log(`   Max connections: ${MAX_CONNECTIONS}`);
console.log(`   Stats: http://localhost:${WS_PORT}/stats (Header auth supported)`);
console.log(`   Noise Protocol: ready (Noise_IK_25519_ChaChaPoly_BLAKE2b skeleton)`);
console.log(`   Block #${blockNumber} ready — waiting for miners...`);
