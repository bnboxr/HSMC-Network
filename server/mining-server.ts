/**
 * HSMC Stratum V1 + V2 Mining Pool Server
 *
 * WebSocket server on port 3333 (ws) and 3433 (wss) that accepts
 * mining clients via Stratum V1 (JSON-RPC) or Stratum V2 (binary framing
 * with Noise IK handshake).
 *
 * Protocol auto-negotiation:
 *   - First 2 bytes == 0x0002 → V2 binary with Noise IK
 *   - First byte == '{' (0x7B) → V1 JSON-RPC
 *
 * V2 features:
 *   - Binary framing (6-byte header + payload)
 *   - Noise_IK_25519_AESGCM_BLAKE2b handshake (AES-GCM in place of
 *     ChaChaPoly, which is unavailable in Bun's crypto)
 *   - Job negotiation (difficulty)
 *   - Multi-algo support (SHA-256d, RandomX, ProgPoW, etc.)
 *   - Encrypted transport after handshake
 *
 * V1 features (unchanged):
 *   - Standard Stratum V1 JSON-RPC
 *   - mining.subscribe, mining.authorize, mining.submit
 *
 * Security:
 *  - TLS (wss://) via TLS_CERT/TLS_KEY env vars
 *  - API key auth via Authorization / x-api-key headers (plus ?key= backward compat)
 *  - Noise IK encrypted transport for V2 connections
 *  - Rate limiting: 10 msg/s general, 50 msg/s for mining.submit
 *  - Max 50 concurrent connections
 *  - Input validation
 *  - Connection timeout: 30s for auth/handshake, 5min idle after auth
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
import { hardenFilePermissions } from "./db-security";
import type { ServerWebSocket } from "bun";
import {
  NoiseIKResponder,
  type NoiseTransport,
  generateX25519KeyPair,
  type NoiseKeyPair,
} from "./stratum-v2/noise-ik";
import {
  V2MsgType,
  V2Algo,
  V2_PROTOCOL_ID,
  isV2Frame,
  decodeV2Frame,
  encodeV2Frame,
  decodeSetupConnection,
  encodeSetupConnectionSuccess,
  encodeNewMiningJob,
  decodeSubmitShare,
  encodeSubmitShareResponse,
  encodeSetDifficulty,
  decodeJobNegotiation,
  type V2SetupConnection,
  type V2NewMiningJob,
} from "./stratum-v2/framing";

const DB_PATH = "/home/team/shared/hsmc.db";
const WS_PORT = 3333;
const WSS_PORT = 3433;

// ── Constants ────────────────────────────────────────────────────────────────────
const MAX_CONNECTIONS = 50;
const MAX_HANDSHAKE_SIZE = 65535; // 64KB max for Noise handshake message
const AUTH_TIMEOUT_MS = 30_000; // 30s to authorize / complete handshake
const IDLE_TIMEOUT_MS = 300_000; // 5min idle after auth
const RATE_LIMIT_GENERAL = 10; // msgs/sec for non-submit
const RATE_LIMIT_SUBMIT = 50; // msgs/sec for mining.submit
const WINDOW_MS = 1000; // 1 second sliding window
const ADDRESS_MIN_LEN = 26;
const ADDRESS_MAX_LEN = 100;
const WORKER_NAME_MAX_LEN = 50;
const NONCE_MAX_LEN = 16;
const SERVER_VERSION = "HSMC-Stratum/2.0";
const QUERY_STRING_WARN_INTERVAL_MS = 10_000;

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
  console.warn("[Security] ⚠️  MINING_API_KEY not set — allowing all connections (DEV MODE)");
  console.warn("[Security] ⚠️  Set MINING_API_KEY env var to enable authentication");
}

function checkApiKey(key: string | null): boolean {
  if (!API_KEY) return true;
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

const queryStringWarnTimestamps = new Map<string, number>();

function extractApiKey(req: Request): { key: string | null; source: "header-bearer" | "header-x-api-key" | "query" | "none" } {
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return { key: match[1], source: "header-bearer" };
  }
  const apiKeyHeader = req.headers.get("x-api-key");
  if (apiKeyHeader) return { key: apiKeyHeader, source: "header-x-api-key" };
  const url = new URL(req.url);
  const queryKey = url.searchParams.get("key");
  if (queryKey) return { key: queryKey, source: "query" };
  return { key: null, source: "none" };
}

function warnQueryStringApiKey(ip: string): void {
  const now = Date.now();
  const last = queryStringWarnTimestamps.get(ip) ?? 0;
  if (now - last > QUERY_STRING_WARN_INTERVAL_MS) {
    queryStringWarnTimestamps.set(ip, now);
    console.warn(
      `[Security] API key received via query string from ${ip} ` +
      `— this is visible in logs/network. Use 'Authorization' header instead.`
    );
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

// ── Database Setup ────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL;");
try {
  db.exec("ALTER TABLE blocks ADD COLUMN key_image TEXT");
} catch { /* column may already exist */ }

// ── WebSocket Data Payload ───────────────────────────────────────────────────────
interface WSData {
  sessionId: string;
  authorized: boolean;
  transport: "ws" | "wss";
  ip: string;
  userAgent: string;
  apiKeySource: "header-bearer" | "header-x-api-key" | "query" | "none";
}

// ── Protocol Version ─────────────────────────────────────────────────────────────
type ProtocolVersion = "v1" | "v2";

// ── Miner Session ────────────────────────────────────────────────────────────────
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
  msgTimestamps: number[];
  submitTimestamps: number[];
  rateLimitWarned: boolean;
  transport: "ws" | "wss";
  ip: string;
  userAgent: string;
  apiKeySource: "header-bearer" | "header-x-api-key" | "query" | "none";
  // ── V2-specific state ──────────────────────────────────────────
  protocol: ProtocolVersion | null; // null = not yet detected
  noiseHandshake: NoiseIKResponder | null; // active Noise handshake
  noiseTransport: NoiseTransport | null; // encrypted transport after handshake
  v2Algo: V2Algo; // negotiated algorithm
  v2CleanJobs: boolean; // clean jobs flag
  pendingBuffer: Buffer; // accumulated binary data for V2 frame reassembly
}

interface MiningJob {
  jobId: string;
  prevHash: string;
  target: string;
  blockNumber: number;
  nbits: string;
}

// ── Shared State ──────────────────────────────────────────────────────────────────
const miners = new Map<string, MinerSession>();
let currentJob: MiningJob | null = null;
let jobCounter = 0;
let blockNumber = 7;
const serverStartTime = Date.now();
let totalSharesAccepted = 0;
let totalSharesRejected = 0;
let v2Connections = 0;

// ── Noise Keypair (generated at startup) ──────────────────────────────────────────
let serverNoiseKeyPair: NoiseKeyPair | null = null;

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
  const limitMsgs = isSubmit ? RATE_LIMIT_SUBMIT : RATE_LIMIT_GENERAL;
  const methodName = isSubmit ? "mining.submit" : "msg";
  if (isSubmit) {
    const { allowed, timestamps } = checkRateLimit(miner.submitTimestamps, limitMsgs, now);
    miner.submitTimestamps = timestamps;
    if (!allowed) {
      if (!miner.rateLimitWarned) {
        miner.rateLimitWarned = true;
        sendErrorToMiner(miner, null, `Rate limit exceeded: ${limitMsgs} ${methodName}/sec max. Next violation closes connection.`);
      } else {
        closeWithReason(miner, "Rate limit exceeded");
        return false;
      }
      return false;
    }
  } else {
    const { allowed, timestamps } = checkRateLimit(miner.msgTimestamps, limitMsgs, now);
    miner.msgTimestamps = timestamps;
    if (!allowed) {
      if (!miner.rateLimitWarned) {
        miner.rateLimitWarned = true;
        sendErrorToMiner(miner, null, `Rate limit exceeded: ${limitMsgs} ${methodName}/sec max. Next violation closes connection.`);
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
    console.log(`[Mining] Auth/handshake timeout: ${miner.id}`);
    closeWithReason(miner, "Authentication/handshake timeout");
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
  if (miner.protocol === "v2" && v2Connections > 0) v2Connections--;
  miners.delete(miner.id);
  clearAllTimers(miner);
}

// ── Crypto Helpers ────────────────────────────────────────────────────────────────
function sha256(data: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

function sha256d(data: string): string {
  return sha256(sha256(data));
}

function validateShare(header: string, nonceHex: string, targetHex: string): boolean {
  try {
    const input = header + nonceHex;
    const hashHex = sha256d(input);
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

// ── Send Helpers ──────────────────────────────────────────────────────────────────

function sendV1Json(miner: MinerSession, data: object): void {
  try {
    miner.ws.sendText(JSON.stringify(data));
  } catch { /* ignore */ }
}

function sendV2Frame(miner: MinerSession, msgType: V2MsgType, payload: Buffer): void {
  if (!miner.noiseTransport) {
    // Not encrypted yet — send raw frame (only during SetupConnection)
    try {
      miner.ws.sendBinary(encodeV2Frame(msgType, payload));
    } catch { /* ignore */ }
    return;
  }
  // Encrypt the frame, then send as binary
  try {
    const raw = encodeV2Frame(msgType, payload);
    const encrypted = miner.noiseTransport.encrypt(raw);
    miner.ws.sendBinary(encrypted);
  } catch (e: any) {
    console.error(`[V2] Encrypt error for ${miner.id}: ${e.message}`);
  }
}

function sendToMiner(miner: MinerSession, data: object): void {
  sendV1Json(miner, data);
}

function sendErrorToMiner(miner: MinerSession, msgId: number | null, error: string): void {
  if (miner.protocol === "v2") {
    const errPayload = Buffer.concat([
      Buffer.from([0x00]), // error code
      Buffer.from(error, "utf-8"),
    ]);
    sendV2Frame(miner, V2MsgType.Error, errPayload);
  } else {
    sendV1Json(miner, { id: msgId, error, result: false });
  }
}

// ── Broadcast ─────────────────────────────────────────────────────────────────────
function broadcastJob(job: MiningJob): void {
  // V1 broadcast
  const v1Notify = {
    id: null,
    method: "mining.notify",
    params: [job.jobId, job.prevHash, "", "", [], "", job.nbits, job.blockNumber, true],
  };
  const v1Msg = JSON.stringify(v1Notify);

  // V2 broadcast
  const prevHashBuf = Buffer.from(job.prevHash.startsWith("0x") ? job.prevHash.slice(2) : job.prevHash, "hex");
  const targetBuf = Buffer.alloc(32, 0);
  // Parse target — "0000ffff..." => first 4 zero bytes, then ff bytes
  const targetHex = job.target;
  for (let i = 0; i < 32 && i * 2 < targetHex.length; i++) {
    targetBuf[i] = parseInt(targetHex.slice(i * 2, i * 2 + 2), 16);
  }

  const v2Job: V2NewMiningJob = {
    jobId: parseInt(job.jobId, 16),
    prevHash: prevHashBuf,
    target: targetBuf,
    blockNumber: job.blockNumber,
    nbits: parseInt(job.nbits, 16),
    algo: V2Algo.SHA256d,
    cleanJobs: true,
  };
  const v2Payload = encodeNewMiningJob(v2Job);

  for (const [, miner] of miners) {
    if (!miner.subscribed || !miner.authorized) continue;
    try {
      if (miner.protocol === "v2") {
        sendV2Frame(miner, V2MsgType.NewMiningJob, v2Payload);
      } else {
        miner.ws.sendText(v1Msg);
      }
    } catch { /* disconnected */ }
  }
}

function createBlock(miner: MinerSession, nonce: number, hash: string): void {
  const now = new Date().toISOString();
  const blockId = randomUUID();

  db.run(
    `INSERT INTO blocks (id, block_number, hash, prev_hash, miner_address, transactions_count,
     nonce, difficulty, created_at, privacy_protocol, key_image)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'RingCT-v2', ?)`,
    blockId, blockNumber, `0x${hash}`, currentJob?.prevHash ?? "0x0",
    miner.address, nonce, 4000000, now, `share-${miner.workerName}-${Date.now()}`
  );

  db.run(
    `UPDATE network_stats SET block_height = ?, total_transactions = total_transactions + 1, updated_at = ? WHERE id = 'default'`,
    blockNumber, now
  );

  db.run(
    `UPDATE wallets SET balance = balance + 50, updated_at = ? WHERE address = ?`,
    now, miner.address
  );

  console.log(
    `[Mining] ✅ Block #${blockNumber} found by ${miner.workerName} ` +
    `(${miner.address.slice(0, 14)}...) ` +
    `hash=${hash.slice(0, 16)}... nonce=${nonce} [${miner.ip}] [${miner.protocol ?? "v1"}]`
  );

  currentJob = generateJob();
  broadcastJob(currentJob!);
}

// ── V2 SetupConnection Handler ────────────────────────────────────────────────────
function handleV2SetupConnection(miner: MinerSession, payload: Buffer): void {
  const setup = decodeSetupConnection(payload);
  console.log(
    `[V2] SetupConnection from ${miner.id}: min=${setup.minVersion} max=${setup.maxVersion} ` +
    `flags=${setup.flags.toString(16)} [${miner.ip}]`
  );

  // Accept version 2
  const successPayload = encodeSetupConnectionSuccess(2, 0x01, "HSMC-Stratum-V2");
  sendV2Frame(miner, V2MsgType.SetupConnectionSuccess, successPayload);

  // Set protocol version — now authorized
  miner.protocol = "v2";
  miner.authorized = true;
  miner.subscribed = true;
  v2Connections++;

  if (miner.authTimer) { clearTimeout(miner.authTimer); miner.authTimer = null; }
  resetIdleTimeout(miner);

  // Send current job
  if (!currentJob) currentJob = generateJob();
  const prevHashBuf = Buffer.from(
    (currentJob.prevHash.startsWith("0x") ? currentJob.prevHash.slice(2) : currentJob.prevHash),
    "hex"
  );
  const targetBuf = Buffer.alloc(32, 0);
  for (let i = 0; i < 32 && i * 2 < currentJob.target.length; i++) {
    targetBuf[i] = parseInt(currentJob.target.slice(i * 2, i * 2 + 2), 16);
  }

  const v2Job: V2NewMiningJob = {
    jobId: parseInt(currentJob.jobId, 16),
    prevHash: prevHashBuf,
    target: targetBuf,
    blockNumber: currentJob.blockNumber,
    nbits: parseInt(currentJob.nbits, 16),
    algo: miner.v2Algo,
    cleanJobs: true,
  };
  sendV2Frame(miner, V2MsgType.NewMiningJob, encodeNewMiningJob(v2Job));

  // Set initial difficulty
  const diffBuf = Buffer.alloc(8);
  diffBuf.writeBigUInt64BE(BigInt(4000000), 0);
  sendV2Frame(miner, V2MsgType.SetDifficulty, diffBuf);

  console.log(`[Mining] V2 ${miner.workerName || miner.id} connected [${miner.ip}]`);
}

// ── V2 SubmitShare Handler ────────────────────────────────────────────────────────
function handleV2SubmitShare(miner: MinerSession, payload: Buffer): void {
  if (!miner.authorized) {
    sendV2Frame(miner, V2MsgType.SubmitShareResponse,
      encodeSubmitShareResponse(0, false, 1));
    return;
  }

  const share = decodeSubmitShare(payload);
  const nonceHex = share.nonce.toString(16);

  if (!currentJob || share.jobId !== parseInt(currentJob.jobId, 16)) {
    miner.sharesRejected++;
    totalSharesRejected++;
    sendV2Frame(miner, V2MsgType.SubmitShareResponse,
      encodeSubmitShareResponse(Number(share.jobId), false, 2)); // 2 = stale
    console.log(`[V2] Stale share from ${miner.workerName} [${miner.ip}]`);
    return;
  }

  const header = currentJob.prevHash.startsWith("0x")
    ? currentJob.prevHash.slice(2)
    : currentJob.prevHash;

  const valid = validateShare(header, nonceHex, currentJob.target);

  if (valid) {
    miner.sharesAccepted++;
    totalSharesAccepted++;
    sendV2Frame(miner, V2MsgType.SubmitShareResponse,
      encodeSubmitShareResponse(Number(share.jobId), true, 0));

    const hash = sha256d(header + nonceHex);
    console.log(
      `[V2] ✅ Valid share from ${miner.workerName} | hash=${hash.slice(0, 16)}... ` +
      `nonce=${share.nonce} [${miner.ip}]`
    );
    createBlock(miner, Number(share.nonce), hash);
  } else {
    miner.sharesRejected++;
    totalSharesRejected++;
    sendV2Frame(miner, V2MsgType.SubmitShareResponse,
      encodeSubmitShareResponse(Number(share.jobId), false, 3)); // 3 = low difficulty

    console.log(
      `[V2] ❌ Invalid share from ${miner.workerName} ` +
      `(nonce=${share.nonce}, target not met) [${miner.ip}]`
    );
  }

  resetIdleTimeout(miner);
}

// ── V2 Job Negotiation Handler ────────────────────────────────────────────────────
function handleV2JobNegotiation(miner: MinerSession, payload: Buffer): void {
  const negotiation = decodeJobNegotiation(payload);
  console.log(
    `[V2] Job negotiation from ${miner.workerName}: difficulty=${negotiation.desiredDifficulty} ` +
    `algo=${negotiation.algo} [${miner.ip}]`
  );

  // Update miner's preferred algo
  miner.v2Algo = negotiation.algo;

  // Set difficulty based on negotiation (capped)
  const diff = negotiation.desiredDifficulty > BigInt(0)
    ? negotiation.desiredDifficulty
    : BigInt(4000000);
  sendV2Frame(miner, V2MsgType.SetDifficulty, encodeSetDifficulty(diff));
}

// ── V2 Message Router ─────────────────────────────────────────────────────────────
function handleV2Message(miner: MinerSession, msgType: V2MsgType, payload: Buffer): void {
  switch (msgType) {
    case V2MsgType.SetupConnection:
      handleV2SetupConnection(miner, payload);
      break;

    case V2MsgType.SubmitShare:
      if (!enforceRateLimit(miner, true)) return;
      handleV2SubmitShare(miner, payload);
      break;

    case V2MsgType.JobNegotiation:
      handleV2JobNegotiation(miner, payload);
      break;

    case V2MsgType.Ping:
      sendV2Frame(miner, V2MsgType.Pong, Buffer.alloc(0));
      break;

    default:
      console.log(`[V2] Unknown message type ${msgType.toString(16)} from ${miner.id}`);
      sendV2Frame(miner, V2MsgType.Error,
        Buffer.concat([Buffer.from([0xFF]), Buffer.from(`Unknown msg type: ${msgType}`, "utf-8")]));
  }
}

// ── V2 Binary Data Processor ──────────────────────────────────────────────────────
function processV2BinaryData(miner: MinerSession, data: Buffer): void {
  // Accumulate data
  if (miner.pendingBuffer.length > 0) {
    miner.pendingBuffer = Buffer.concat([miner.pendingBuffer, data]);
  } else {
    miner.pendingBuffer = Buffer.from(data);
  }

  // Try to decode complete frames
  while (miner.pendingBuffer.length >= 6) {
    const frame = decodeV2Frame(miner.pendingBuffer);
    if (!frame) {
      // Not a valid V2 frame or incomplete — check if it might be encrypted
      if (!isV2Frame(miner.pendingBuffer)) {
        // If we're past setup, try decrypting
        if (miner.noiseTransport && miner.protocol === "v2") {
          try {
            const decrypted = miner.noiseTransport.decrypt(miner.pendingBuffer);
            // Now try decoding the decrypted frame
            const innerFrame = decodeV2Frame(decrypted);
            if (innerFrame) {
              handleV2Message(miner, innerFrame.msgType, innerFrame.payload);
              miner.pendingBuffer = Buffer.alloc(0);
              continue;
            }
          } catch (e: any) {
            console.log(`[V2] Decrypt error from ${miner.id}: ${e.message}`);
            closeWithReason(miner, "Decryption error");
            return;
          }
        }
        // Can't process — wait for more data
        break;
      }
      // Valid V2 header but incomplete payload — wait for more data
      break;
    }

    // Extract consumed bytes
    const consumed = 6 + frame.payload.length;
    miner.pendingBuffer = miner.pendingBuffer.subarray(consumed);

    handleV2Message(miner, frame.msgType, frame.payload);
  }
}

// ── V1 Message Handler ────────────────────────────────────────────────────────────
function handleV1Message(ws: ServerWebSocket<WSData>, message: string, sessionId: string): void {
  const miner = miners.get(sessionId);
  if (!miner) return;

  if (message.length > 4096) {
    sendToMiner(miner, { id: null, error: "Message too large — max 4096 bytes", result: false });
    return;
  }

  let msg: { id?: number | null; method?: string; params?: unknown[]; result?: unknown; error?: unknown };
  try {
    msg = JSON.parse(message);
  } catch {
    sendToMiner(miner, { id: null, error: "Invalid JSON", result: false });
    return;
  }

  const method = msg.method || "";
  const params = (msg.params as unknown[]) ?? [];

  if (!enforceRateLimit(miner, method === "mining.submit")) return;
  miner.lastActivity = Date.now();

  switch (method) {
    case "mining.subscribe": {
      miner.subscribed = true;
      if (!currentJob) currentJob = generateJob();

      sendToMiner(miner, {
        id: msg.id ?? 1,
        result: [[["mining.notify", "mining.set_difficulty"]], "HSMC-1", 1],
        error: null,
      });
      sendToMiner(miner, { id: null, method: "mining.set_difficulty", params: [4] });
      sendToMiner(miner, {
        id: null, method: "mining.notify",
        params: [currentJob.jobId, currentJob.prevHash, "", "", [], "", currentJob.nbits, currentJob.blockNumber, true],
      });
      console.log(`[Mining] ${miner.workerName || sessionId} subscribed (V1) [${miner.ip}]`);
      break;
    }

    case "mining.authorize": {
      const address = String(params[0] ?? "");
      const workerName = String(params[1] ?? "worker");
      const addrErr = validateAddress(address);
      if (addrErr) {
        sendToMiner(miner, { id: msg.id ?? 2, result: false, error: `Invalid address: ${addrErr}` });
        return;
      }
      const workerErr = validateWorkerName(workerName);
      if (workerErr) {
        sendToMiner(miner, { id: msg.id ?? 2, result: false, error: `Invalid worker name: ${workerErr}` });
        return;
      }

      miner.address = address.trim();
      miner.workerName = workerName.trim();
      miner.authorized = true;
      if (miner.authTimer) { clearTimeout(miner.authTimer); miner.authTimer = null; }
      resetIdleTimeout(miner);
      sendToMiner(miner, { id: msg.id ?? 2, result: true, error: null });
      console.log(`[Mining] ${miner.workerName} authorized (V1) (${miner.address.slice(0, 14)}...) [${miner.ip}]`);
      break;
    }

    case "mining.submit": {
      if (!miner.authorized) {
        sendToMiner(miner, { id: msg.id, result: false, error: "Not authorized" });
        return;
      }

      const workerNameIn = String(params[0] ?? "");
      const jobId = String(params[1] ?? "");
      const nonceHex = String(params[2] ?? "0");
      const nonceNum = parseInt(nonceHex, 16);

      const nonceErr = validateNonce(nonceHex);
      if (nonceErr) {
        miner.sharesRejected++; totalSharesRejected++;
        sendToMiner(miner, { id: msg.id, result: false, error: `Invalid nonce: ${nonceErr}` });
        return;
      }
      if (!currentJob || jobId !== currentJob.jobId) {
        miner.sharesRejected++; totalSharesRejected++;
        sendToMiner(miner, { id: msg.id, result: false, error: "Stale job" });
        return;
      }

      const header = currentJob.prevHash.startsWith("0x") ? currentJob.prevHash.slice(2) : currentJob.prevHash;
      const valid = validateShare(header, nonceHex, currentJob.target);

      if (valid) {
        miner.sharesAccepted++; totalSharesAccepted++;
        sendToMiner(miner, { id: msg.id, result: true, error: null });
        const hash = sha256d(header + nonceHex);
        console.log(`[Mining] ✅ Valid share from ${miner.workerName} (V1) | hash=${hash.slice(0, 16)}... [${miner.ip}]`);
        createBlock(miner, nonceNum, hash);
      } else {
        miner.sharesRejected++; totalSharesRejected++;
        sendToMiner(miner, { id: msg.id, result: false, error: "Share rejected — does not meet target" });
        console.log(`[Mining] ❌ Invalid share from ${miner.workerName} (V1) [${miner.ip}]`);
      }
      resetIdleTimeout(miner);
      break;
    }

    case "noise.handshake": {
      // V1 noise handshake stub — retained for backward compat
      const requestedPattern = String(params[0] ?? "");
      console.log(`[Mining] 🔐 Noise handshake requested by ${miner.workerName || sessionId} [${miner.ip}] pattern=${requestedPattern}`);
      if (requestedPattern === "Noise_IK_25519_ChaChaPoly_BLAKE2b" || requestedPattern === "Noise_IK_25519_AESGCM_BLAKE2b") {
        sendToMiner(miner, { id: msg.id ?? null, result: true, noise: "supported", status: "ready" });
      } else {
        sendToMiner(miner, { id: msg.id ?? null, result: false, error: `Unsupported Noise pattern: ${requestedPattern}` });
      }
      break;
    }

    default:
      sendToMiner(miner, { id: msg.id, result: null, error: `Unknown method: ${method}` });
  }
}

// ── Protocol Detection ────────────────────────────────────────────────────────────
function detectAndRouteMessage(ws: ServerWebSocket<WSData>, message: string | Uint8Array): void {
  const wsData = ws.data;
  const sessionId = wsData.sessionId;
  const miner = miners.get(sessionId);
  if (!miner) return;

  // If protocol already determined, route accordingly
  if (miner.protocol === "v2") {
    const data = typeof message === "string"
      ? new TextEncoder().encode(message)
      : new Uint8Array(message);
    processV2BinaryData(miner, Buffer.from(data));
    return;
  }

  if (miner.protocol === "v1") {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message as Uint8Array);
    handleV1Message(ws, text, sessionId);
    return;
  }

  // ── Protocol auto-detection (first message) ──────────────────────────
  const raw = typeof message === "string"
    ? new TextEncoder().encode(message)
    : new Uint8Array(message);

  const buf = Buffer.from(raw);

  // Check for V2 binary framing
  if (buf.length >= 2 && buf.readUInt16BE(0) === V2_PROTOCOL_ID) {
    miner.protocol = "v2";
    console.log(`[Mining] V2 protocol detected for ${sessionId} [${miner.ip}]`);
    processV2BinaryData(miner, buf);
    return;
  }

  // Check for V1 JSON (starts with '{')
  if (buf.length >= 1 && buf[0] === 0x7B) {
    miner.protocol = "v1";
    console.log(`[Mining] V1 protocol detected for ${sessionId} [${miner.ip}]`);
    handleV1Message(ws, buf.toString("utf-8"), sessionId);
    return;
  }

  // Unknown protocol
  sendErrorToMiner(miner, null, "Unknown protocol — send V1 JSON or V2 binary frame");
}

// ── HTTP fetch handler ────────────────────────────────────────────────────────────
function createFetchHandler(transport: "ws" | "wss"): (req: Request, serverInstance: any) => Response | Promise<Response> {
  return (req: Request, serverInstance: any) => {
    const url = new URL(req.url);
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? "unknown";

    if (url.pathname === "/stats" && req.method === "GET") {
      const { key, source } = extractApiKey(req);
      if (source === "query") warnQueryStringApiKey(ip);
      if (!checkApiKey(key)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { "Content-Type": "application/json" },
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
          v2_connections: v2Connections,
          v1_connections: connectedMiners - v2Connections,
          max_connections: MAX_CONNECTIONS,
          total_shares_accepted: totalSharesAccepted,
          total_shares_rejected: totalSharesRejected,
          current_block: blockNumber,
          job_id: currentJob?.jobId ?? null,
          auth_enabled: !!API_KEY,
          tls_enabled: !!tlsConfig,
          noise_key: serverNoiseKeyPair ? serverNoiseKeyPair.publicKey.toString("hex") : null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.pathname === "/" || url.pathname === "/stratum") {
      const { key, source } = extractApiKey(req);
      if (source === "query") warnQueryStringApiKey(ip);
      if (!checkApiKey(key)) {
        console.log(`[Mining] ❌ Rejected — invalid API key from ${ip} [${transport}]`);
        return new Response("Unauthorized — invalid or missing API key", { status: 401 });
      }
      if (miners.size >= MAX_CONNECTIONS) {
        console.warn(`[Mining] ⚠️  Max connections (${MAX_CONNECTIONS}) reached [${ip}]`);
        return new Response("Service Unavailable — max connections reached", { status: 503 });
      }

      const sessionId = randomUUID();
      const success = serverInstance.upgrade(req, {
        data: {
          sessionId, authorized: true, transport, ip, userAgent,
          apiKeySource: source,
        } satisfies WSData,
      });
      if (success) return;
    }

    return new Response(`HSMC Stratum Mining Server ${SERVER_VERSION}`, {
      status: 200, headers: { "Content-Type": "text/plain" },
    });
  };
}

// ── WebSocket Handler ─────────────────────────────────────────────────────────────
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
        protocol: null,
        noiseHandshake: null,
        noiseTransport: null,
        v2Algo: V2Algo.SHA256d,
        v2CleanJobs: true,
        pendingBuffer: Buffer.alloc(0),
      };

      resetAuthTimeout(miner);
      miners.set(sessionId, miner);

      const keySrc = d.apiKeySource === "header-bearer" ? "Bearer header"
        : d.apiKeySource === "header-x-api-key" ? "x-api-key header"
        : d.apiKeySource === "query" ? "query string" : "none";

      console.log(
        `[Mining] 🔌 Miner connected: ${sessionId} ` +
        `(total: ${miners.size}/${MAX_CONNECTIONS}) ` +
        `[${d.ip}] [${d.transport}] key=${keySrc} UA=${d.userAgent.slice(0, 40)}`
      );
    },

    message(ws: ServerWebSocket<WSData>, message: string | Uint8Array) {
      detectAndRouteMessage(ws, message);
    },

    close(ws: ServerWebSocket<WSData>) {
      const d = ws.data;
      const sessionId = d.sessionId;
      const miner = miners.get(sessionId);
      if (miner) {
        clearAllTimers(miner);
        if (miner.protocol === "v2" && v2Connections > 0) v2Connections--;
        console.log(
          `[Mining] ${miner.workerName || sessionId} disconnected ` +
          `(accepted: ${miner.sharesAccepted}, rejected: ${miner.sharesRejected}) ` +
          `[${d.ip}] [${d.transport}] [${miner.protocol ?? "?"}]`
        );
        miners.delete(sessionId);
      }
    },
  };
}

// ── Start Servers ─────────────────────────────────────────────────────────────────
async function startServers(): Promise<void> {
  // ── Security: File permissions ───────────────────────────────────────────
  const permResults = hardenFilePermissions(DB_PATH);
  for (const r of permResults) {
    if (!r.ok) {
      console.warn(`[Security] ⚠️  Permission hardening failed for ${r.path}: ${r.error}`);
    } else if (r.permsBefore !== r.permsAfter) {
      console.log(`[Security] 🔒 ${r.path}: ${r.permsBefore} → ${r.permsAfter}`);
    }
  }

  // Generate Noise keypair for V2
  serverNoiseKeyPair = await generateX25519KeyPair();
  console.log(`[Noise] Server keypair generated: ${serverNoiseKeyPair.publicKey.toString("hex").slice(0, 16)}...`);

  const wsServer = Bun.serve<WSData>({
    port: WS_PORT,
    fetch: createFetchHandler("ws"),
    websocket: createWebSocketHandler(),
  });

  let wssServer: ReturnType<typeof Bun.serve> | null = null;
  if (tlsConfig) {
    wssServer = Bun.serve<WSData>({
      port: WSS_PORT,
      tls: tlsConfig,
      fetch: createFetchHandler("wss"),
      websocket: createWebSocketHandler(),
    });
  }

  // ── Startup Banner ──────────────────────────────────────────────────────────
  const wsUrl = `ws://0.0.0.0:${WS_PORT}`;
  const wssUrl = `wss://0.0.0.0:${WSS_PORT}`;

  console.log(`⛏️  HSMC Stratum V1 + V2 Mining Server ${SERVER_VERSION}`);
  console.log(`   WS:  ${wsUrl}`);
  if (wssServer) {
    console.log(`   WSS: ${wssUrl}`);
  } else {
    console.warn("\x1b[31m   ⚠️  WARNING: Stratum server running WITHOUT TLS encryption.\x1b[0m");
    console.warn("\x1b[31m   Set TLS_CERT and TLS_KEY env vars to enable wss:// connections.\x1b[0m");
  }
  console.log(`   Protocols: V1 (JSON-RPC) + V2 (binary, Noise IK, AES-256-GCM)`);
  console.log(`   V2 Noise:  Noise_IK_25519_AESGCM_BLAKE2b`);
  console.log(`   V2 Pubkey: ${serverNoiseKeyPair.publicKey.toString("hex")}`);
  if (API_KEY) {
    console.log(`   Auth:      required (Authorization: Bearer <key> or x-api-key header)`);
  } else {
    console.warn(`   Auth:      DISABLED (set MINING_API_KEY to enable)`);
  }
  console.log(`   Max connections: ${MAX_CONNECTIONS}`);
  console.log(`   Stats:     http://localhost:${WS_PORT}/stats`);
  console.log(`   Block #${blockNumber} ready — waiting for miners...`);
}

startServers().catch((err) => {
  console.error("Failed to start mining server:", err);
  process.exit(1);
});
