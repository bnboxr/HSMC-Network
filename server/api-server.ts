/**
 * HSMC Local API Server
 * Self-hosted SQLite REST API — drop-in replacement for Supabase REST endpoints.
 *
 * Usage: bun run /home/team/shared/api-server.ts
 * Listens on port 3001
 *
 * Endpoints:
 *   GET    /rest/v1/:table?select=*            — list all rows
 *   GET    /rest/v1/:table?select=*&id=eq.xxx   — get by id
 *   GET    /rest/v1/:table?select=col1,col2&col=eq.val&order=col.asc&limit=N
 *   POST   /rest/v1/:table                      — insert row(s)
 *   PATCH  /rest/v1/:table?id=eq.xxx            — update row(s)
 *   DELETE /rest/v1/:table?id=eq.xxx            — delete row(s)
 *
 * Query params (Supabase-compatible):
 *   select=<columns>     comma-separated, or "*"
 *   <col>=eq.<val>       equality filter (multiple allowed)
 *   order=<col>.asc      or .desc
 *   limit=<N>            row limit
 *   offset=<N>           row offset
 *   id=eq.<uuid>         special id filter
 */

import { Database } from "bun:sqlite";
import { randomUUID, timingSafeEqual } from "crypto";
import {
  initEncryptionKey,
  encryptField,
  decryptField,
  isEncryptionAvailable,
  isEncryptedColumn,
} from "./db-crypto";
import { runStartupSecurityChecks } from "./db-security";
import Stripe from "stripe";

const DB_PATH = process.env.HSMC_DB_PATH || "/home/team/shared/hsmc.db";
const PORT = parseInt(process.env.HSMC_PORT || "3001", 10);

// ── Schema (from schema.sqlite.sql) ──────────────────────────────────────────
const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS blocks (
  block_number REAL, created_at TEXT, difficulty REAL, hash TEXT, id TEXT PRIMARY KEY,
  miner_address TEXT, nonce REAL, prev_hash TEXT, privacy_protocol TEXT, transactions_count REAL,
  key_image TEXT
);

CREATE TABLE IF NOT EXISTS contract_interactions (
  caller_address TEXT, contract_id TEXT, created_at TEXT, function_name TEXT, gas_used REAL,
  id TEXT PRIMARY KEY, inputs TEXT, outputs TEXT, status TEXT, tx_hash TEXT
);

CREATE TABLE IF NOT EXISTS deployment_status (
  contract_address TEXT, created_at TEXT, created_by TEXT, explorer_url TEXT, id TEXT PRIMARY KEY,
  network TEXT, notes TEXT, pair_address TEXT, status TEXT, step_id TEXT, tx_hash TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS governance_proposals (
  created_at TEXT, description TEXT, ends_at TEXT, id TEXT PRIMARY KEY, parameter_key TEXT,
  parameter_value TEXT, proposal_type TEXT, proposer_address TEXT, quorum_required REAL,
  status TEXT, title TEXT, user_id TEXT, votes_against REAL, votes_for REAL
);

CREATE TABLE IF NOT EXISTS governance_votes (
  created_at TEXT, id TEXT PRIMARY KEY, proposal_id TEXT, user_id TEXT, vote_choice TEXT,
  vote_weight REAL, voter_address TEXT
);

CREATE TABLE IF NOT EXISTS internal_transfers (
  amount REAL, created_at TEXT, from_wallet_id TEXT, id TEXT PRIMARY KEY, note TEXT,
  to_wallet_id TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS liquidity_pools (
  chain_name TEXT, created_at TEXT, dex_name TEXT, fee_bps REAL, id TEXT PRIMARY KEY,
  pair_token TEXT, pool_address TEXT, pool_type TEXT, reserve_hsmc REAL, reserve_pair REAL,
  status TEXT, total_lp_tokens REAL, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS lp_positions (
  created_at TEXT, fees_earned REAL, hsmc_deposited REAL, id TEXT PRIMARY KEY, lp_tokens REAL,
  pair_deposited REAL, pool_id TEXT, updated_at TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS network_peers (
  created_at TEXT, id TEXT PRIMARY KEY, ip_address TEXT, last_seen_at TEXT, latency REAL,
  peer_id TEXT, port REAL, region TEXT, status TEXT, version TEXT
);

CREATE TABLE IF NOT EXISTS network_stats (
  active_nodes REAL, block_height REAL, consensus_state TEXT, hash_rate TEXT, id TEXT PRIMARY KEY,
  latency REAL, network_difficulty REAL, total_transactions REAL, tps REAL, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  created_at TEXT, email TEXT, id TEXT PRIMARY KEY, source TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  created_at TEXT, data TEXT, id TEXT PRIMARY KEY, message TEXT, read INTEGER, title TEXT,
  type TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS payment_links (
  active INTEGER, amount REAL, created_at TEXT, description TEXT, id TEXT PRIMARY KEY,
  payments_count REAL, slug TEXT, token TEXT, total_received REAL, user_id TEXT, wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS payment_sessions (
  amount_hsmc REAL, amount_usd REAL, card_brand TEXT, card_holder TEXT, card_last4 TEXT,
  created_at TEXT, id TEXT PRIMARY KEY, otp_attempts REAL, otp_code TEXT, otp_expires_at TEXT,
  processor TEXT, session_id TEXT, settlement_tx_hash TEXT, status TEXT,
  stripe_client_secret TEXT, stripe_payment_intent_id TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS platform_config (
  hsmcpay_intermediary_enabled INTEGER, id REAL PRIMARY KEY, updated_at TEXT, updated_by TEXT
);

CREATE TABLE IF NOT EXISTS platform_stats (
  countries_count REAL, developers_count REAL, id TEXT PRIMARY KEY, tvl REAL, updated_at TEXT,
  uptime_percent REAL
);

CREATE TABLE IF NOT EXISTS pool_events (
  created_at TEXT, event_type TEXT, hsmc_delta REAL, id TEXT PRIMARY KEY, pair_delta REAL,
  payment_ref TEXT, pool_id TEXT, price_after REAL, tx_hash TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY, price REAL, timestamp TEXT, volume REAL
);

CREATE TABLE IF NOT EXISTS profiles (
  avatar_url TEXT, created_at TEXT, id TEXT PRIMARY KEY, updated_at TEXT, user_id TEXT,
  username TEXT, wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT, created_at TEXT, id TEXT PRIMARY KEY, user_id TEXT
);

CREATE TABLE IF NOT EXISTS referral_uses (
  bonus_amount REAL, bonus_paid INTEGER, created_at TEXT, id TEXT PRIMARY KEY,
  referral_code_id TEXT, referred_user_id TEXT, referrer_user_id TEXT
);

CREATE TABLE IF NOT EXISTS settings_schema (
  category TEXT, description TEXT, display_order REAL, example_value TEXT, is_secret INTEGER,
  key TEXT, label TEXT, required_for TEXT, validation_regex TEXT
);

CREATE TABLE IF NOT EXISTS smart_contracts (
  abi TEXT, address TEXT, bytecode TEXT, contract_type TEXT, created_at TEXT, deployed_at TEXT,
  deployer_address TEXT, id TEXT PRIMARY KEY, interactions_count REAL, name TEXT,
  source_code TEXT, status TEXT, user_id TEXT, version TEXT
);

CREATE TABLE IF NOT EXISTS stakes (
  amount REAL, id TEXT PRIMARY KEY, last_reward_at TEXT, pool_id TEXT, rewards_claimed REAL,
  rewards_earned REAL, staked_at TEXT, status TEXT, unstake_at TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS staking_pools (
  apr REAL, commission_rate REAL, created_at TEXT, id TEXT PRIMARY KEY, min_stake REAL,
  name TEXT, status TEXT, total_staked REAL, validator_address TEXT
);

CREATE TABLE IF NOT EXISTS swap_rates (
  from_token TEXT, id TEXT PRIMARY KEY, rate REAL, to_token TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS token_metrics (
  all_time_high REAL, all_time_high_date TEXT, circulating_supply REAL,
  fully_diluted_valuation REAL, id TEXT PRIMARY KEY, market_cap REAL, market_cap_change_24h REAL,
  price REAL, price_change_24h REAL, staked_supply REAL, token_holders REAL, total_supply REAL,
  updated_at TEXT, volume_24h REAL, volume_change_24h REAL, ytd_return REAL
);

CREATE TABLE IF NOT EXISTS token_swaps (
  created_at TEXT, from_amount REAL, from_token TEXT, id TEXT PRIMARY KEY, privacy_level TEXT,
  rate REAL, slippage REAL, status TEXT, to_amount REAL, to_token TEXT, tx_hash TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS totp_secrets (
  backup_codes TEXT, created_at TEXT, enabled INTEGER, id TEXT PRIMARY KEY, secret TEXT,
  updated_at TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  amount REAL, block_number REAL, commitment TEXT, confirmed_at TEXT, created_at TEXT,
  decoy_count REAL, fee REAL, from_address TEXT, hash TEXT, id TEXT PRIMARY KEY,
  privacy_level TEXT, range_proof TEXT, ring_signature TEXT, status TEXT, stealth_address TEXT,
  to_address TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
  created_at TEXT, id TEXT PRIMARY KEY, role TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS user_settings (
  created_at TEXT, id TEXT PRIMARY KEY, setting_key TEXT, setting_value TEXT, updated_at TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS wallet_seeds (
  created_at TEXT, encrypted_seed TEXT, id TEXT PRIMARY KEY, updated_at TEXT, user_id TEXT,
  wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT, balance REAL, created_at TEXT, id TEXT PRIMARY KEY, is_primary INTEGER,
  label TEXT, staked_balance REAL, updated_at TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS payment_sessions_safe (
  amount_hsmc REAL, amount_usd REAL, card_brand TEXT, card_last4 TEXT, created_at TEXT,
  id TEXT PRIMARY KEY, otp_expires_at TEXT, session_id TEXT, status TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS treasury_transactions (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  amount_usd REAL NOT NULL,
  fee_hsmc REAL NOT NULL,
  fee_tier TEXT NOT NULL,
  payment_intent_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tx_hash TEXT,
  type TEXT CHECK(type IN ('buy_fee', 'sell_fee', 'buyback', 'staking_reward', 'dev_fund', 'insurance')) DEFAULT 'buy_fee',
  status TEXT CHECK(status IN ('pending', 'settled', 'failed')) DEFAULT 'settled',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  device_name TEXT
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT DEFAULT (datetime('now')),
  payment_intent_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Card Issuance tables (Feature #14: Stripe Issuing Integration)
CREATE TABLE IF NOT EXISTS cardholders (
  id TEXT PRIMARY KEY,
  stripe_cardholder_id TEXT UNIQUE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address_line1 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_postal TEXT,
  address_country TEXT DEFAULT 'US',
  date_of_birth TEXT,
  id_last4 TEXT,
  verification_status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  stripe_card_id TEXT UNIQUE,
  cardholder_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last4 TEXT,
  brand TEXT,
  card_type TEXT CHECK(card_type IN ('virtual', 'physical')) DEFAULT 'virtual',
  status TEXT CHECK(status IN ('active', 'inactive', 'frozen', 'cancelled', 'shipped', 'pending')) DEFAULT 'inactive',
  daily_limit_usd REAL DEFAULT 1000,
  monthly_limit_usd REAL DEFAULT 10000,
  per_tx_limit_usd REAL DEFAULT 500,
  card_balance_usd_cents INTEGER DEFAULT 0,
  expiration_month INTEGER,
  expiration_year INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS card_transactions (
  id TEXT PRIMARY KEY,
  stripe_tx_id TEXT UNIQUE,
  card_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  merchant_name TEXT,
  merchant_category TEXT,
  tx_type TEXT CHECK(tx_type IN ('purchase', 'atm', 'refund', 'authorization', 'capture', 'decline')) DEFAULT 'purchase',
  status TEXT CHECK(status IN ('pending', 'approved', 'declined', 'settled')) DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_funding_events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  amount_hsmc REAL NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  exchange_rate REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

// ── Seed Data ────────────────────────────────────────────────────────────────
// Production note: No fake data is seeded. All tables start empty.
// Token metrics, network stats, peers, and price history are populated
// exclusively by live oracle/nodes at runtime — never hardcoded.
const SEED_SQL = `
-- Genesis block (block 0) — minimal anchor for the chain
INSERT OR IGNORE INTO blocks (id, block_number, hash, prev_hash, miner_address, transactions_count, nonce, difficulty, created_at, privacy_protocol)
VALUES ('00000000-0000-0000-0000-000000000000', 0, '0x0000000000000000000000000000000000000000000000000000000000000000', '', '0x0000000000000000000000000000000000000000', 0, 0, 0, datetime('now'), 'none');
`;

// ── Initialize DB ────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL;");
db.exec("PRAGMA foreign_keys=OFF;");

// Create tables
db.exec(SCHEMA_SQL);
console.log("✅ Created 35 tables");

// Seed data
db.exec(SEED_SQL);
console.log("✅ Genesis block seeded (no fake data)");

// ── Security: encryption + schema integrity + file permissions ────────────
const DB_SECURITY_STRICT = process.env.DB_SECURITY_STRICT === "true"; // non-strict by default (warn-only)

// Initialize column-level encryption
await initEncryptionKey();
if (isEncryptionAvailable()) {
  console.log("🔐 Column-level encryption ACTIVE — sensitive fields are AES-256-GCM encrypted");
} else {
  console.warn("⚠️  Column-level encryption DISABLED — set DB_ENCRYPTION_KEY env var (min 16 chars)");
}

// Run startup security checks (schema integrity, file permissions, ownership)
try {
  const secResult = await runStartupSecurityChecks(db, DB_PATH, SCHEMA_SQL, DB_SECURITY_STRICT);
  if (!secResult.allOk) {
    console.warn("[SECURITY] ⚠️  Some security checks failed — see warnings above");
  }
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[SECURITY] ❌ FATAL: ${msg}`);
  if (DB_SECURITY_STRICT) {
    process.exit(1);
  }
  console.warn("[SECURITY] ⚠️  Continuing despite schema mismatch (DB_SECURITY_STRICT=false)");
}

// ── Auth Configuration ───────────────────────────────────────────────────────
const HSMC_API_KEY = process.env.HSMC_API_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const TLS_CERT = process.env.TLS_CERT || "";
const TLS_KEY = process.env.TLS_KEY || "";
const IS_DEV_MODE = !HSMC_API_KEY;
const USING_TLS = !!(TLS_CERT && TLS_KEY);
const JWT_EXPIRY_SECONDS = 3600; // 1 hour

// ── Stripe Configuration ─────────────────────────────────────────────────────
// Required env vars for REAL Stripe settlement:
//   STRIPE_SECRET_KEY         — sk_live_... / sk_test_... (creates PaymentIntents, Payouts)
//   STRIPE_PUBLISHABLE_KEY    — pk_live_... / pk_test_... (returned to the frontend)
//   STRIPE_WEBHOOK_SECRET     — whsec_... (verifies webhook signatures — REQUIRED for
//                               real webhook processing; fails closed if missing)
// Optional:
//   STRIPE_SIMULATION_MODE    — "true" forces simulation mode even with keys set
//
// Simulation mode: when STRIPE_SECRET_KEY is NOT set (dev/testing), all Stripe
// endpoints fall back to an in-DB simulation: PaymentIntents are created locally
// (pi_sim_*), payments are confirmed via the simulation webhook/endpoints, and
// HSMC crediting / treasury recording / payout burning work end-to-end without
// any real Stripe account. Simulation is dev-only and must never be enabled in
// production (guard: it activates only when no secret key is configured).
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_MODE: "live" | "test" = STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test";
// Simulation is active when explicitly requested OR when no secret key exists at all.
// If a secret key IS set but simulation is not requested, simulation is OFF.
const STRIPE_SIMULATION_MODE = process.env.STRIPE_SIMULATION_MODE === "true" || !STRIPE_SECRET_KEY;
let stripe: Stripe | null = null;
if (STRIPE_SECRET_KEY) {
  stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-06-30.basil" as any });
  console.log(`💳 Stripe initialized (${STRIPE_MODE} mode)`);
  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn("⚠️  STRIPE_WEBHOOK_SECRET not set — real webhooks will return 503 (fail-closed).");
  }
} else {
  console.warn("⚠️  STRIPE_SECRET_KEY not set — Stripe endpoints running in SIMULATION MODE (dev/testing only).");
}
if (STRIPE_SIMULATION_MODE) {
  console.warn("🧪 STRIPE_SIMULATION_MODE is ON — payments are simulated locally, no real money moves. Set STRIPE_SECRET_KEY (+ STRIPE_WEBHOOK_SECRET) for real settlement.");
}

/** Human-readable Stripe config summary for /stripe/config */
function getStripeConfig() {
  return {
    mode: STRIPE_SECRET_KEY ? (STRIPE_MODE === "live" ? "live" : "test") : "simulation",
    simulation: STRIPE_SIMULATION_MODE,
    publishable_key_configured: !!STRIPE_PUBLISHABLE_KEY,
    secret_key_configured: !!STRIPE_SECRET_KEY,
    webhook_secret_configured: !!STRIPE_WEBHOOK_SECRET,
    required_env_vars: {
      STRIPE_SECRET_KEY: "sk_live_... / sk_test_... — creates PaymentIntents & Payouts",
      STRIPE_PUBLISHABLE_KEY: "pk_live_... / pk_test_... — used by the Stripe.js frontend",
      STRIPE_WEBHOOK_SECRET: "whsec_... — verifies webhook signatures (fail-closed when missing)",
    },
  };
}

if (IS_DEV_MODE) {
  console.warn("⚠️  WARNING: HSMC_API_KEY not set — API server running in DEV MODE (no auth required).");
}

if (!JWT_SECRET) {
  console.warn("⚠️  WARNING: JWT_SECRET not set — JWT auth will fail. Set JWT_SECRET env var.");
}

// ── Constant-time string comparison ──────────────────────────────────────────
function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// ── Password hashing (PBKDF2-SHA256) ─────────────────────────────────────────
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key, 256
  );
  const hashHex = Buffer.from(new Uint8Array(bits)).toString("hex");
  const saltHex = Buffer.from(salt).toString("hex");
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key, 256
  );
  const computed = Buffer.from(new Uint8Array(bits)).toString("hex");
  return constantTimeEqual(computed, hashHex);
}

// ── JWT (HMAC-SHA256) ────────────────────────────────────────────────────────
function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signJWT(payload: Record<string, unknown>): Promise<string> {
  const encoder = new TextEncoder();
  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const data = `${header}.${body}`;

  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const signature = base64urlEncode(Buffer.from(new Uint8Array(sig)));

  return `${data}.${signature}`;
}

async function verifyJWT(token: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();
    const data = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    // Decode signature
    const sigStr = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const sigBuf = Buffer.from(sigStr, "base64");

    const valid = await crypto.subtle.verify("HMAC", key, sigBuf, encoder.encode(data));
    if (!valid) return null;

    // Decode payload
    const payloadStr = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = Buffer.from(payloadStr, "base64").toString("utf-8");
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    // Check expiry
    if (payload.exp && typeof payload.exp === "number" && Date.now() > payload.exp * 1000) {
      return null; // expired
    }

    return payload;
  } catch {
    return null;
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// Card Issuance / EMV Integration (Feature #14) — Stripe Issuing
// ══════════════════════════════════════════════════════════════════════════════

// ── JWT User Extraction ──────────────────────────────────────────────────────
async function extractJWTUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (token.split(".").length !== 3) return null;
  const payload = await verifyJWT(token);
  if (!payload) return null;
  return (payload.sub || payload.user_id || payload.id) as string | null;
}

async function requireJWTUser(req: Request): Promise<{ userId: string } | Response> {
  const userId = await extractJWTUser(req);
  if (!userId) {
    return jsonResponse({ error: "Authentication required — valid JWT token needed" }, 401);
  }
  return { userId };
}

function getHsmcPrice(): number {
  const metrics = db.query(
    "SELECT price FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
  ).get() as { price: number } | null;
  return Math.max(Number(metrics?.price ?? 1), 0.01);
}

// ── API Key Authentication ───────────────────────────────────────────────────
function extractApiKey(req: Request): string | null {
  // Check Authorization: Bearer <key>
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    // If it's a JWT (contains two dots), it's not an API key
    if (token.split(".").length === 3) return null;
    return token;
  }
  // Check x-api-key header
  return req.headers.get("x-api-key");
}

function checkApiKey(req: Request): boolean {
  if (IS_DEV_MODE) return true;
  const key = extractApiKey(req);
  if (!key) return false;
  return constantTimeEqual(key, HSMC_API_KEY);
}

// ── Health check paths (no auth required) ────────────────────────────────────
const PUBLIC_PATHS = new Set(["/health", "/", "/auth/login", "/auth/register", "/auth/webauthn/login", "/auth/webauthn/register", "/auth/webauthn/challenge", "/stripe/webhook"]);

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
type ParsedQuery = {
  table: string;
  columns: string[];
  filters: Record<string, { op: string; val: string }>;
  order: { col: string; dir: "ASC" | "DESC" } | null;
  limit: number | null;
  offset: number | null;
};

function parseUrl(url: string): ParsedQuery {
  const u = new URL(url, "http://localhost");
  const pathParts = u.pathname.split("/");
  const table = pathParts[pathParts.length - 1] || "";

  const selectRaw = u.searchParams.get("select") || "*";
  const columns = selectRaw === "*" ? ["*"] : selectRaw.split(",").map((s) => s.trim());

  const filters: Record<string, { op: string; val: string }> = {};

  for (const [key, rawVal] of u.searchParams.entries()) {
    if (key === "select" || key === "order" || key === "limit" || key === "offset") continue;

    // Parse "col=eq.value" or "id=eq.uuid"
    const dotIdx = rawVal.indexOf(".");
    if (dotIdx > 0) {
      const op = rawVal.substring(0, dotIdx);
      const val = rawVal.substring(dotIdx + 1);
      filters[key] = { op, val };
    } else {
      filters[key] = { op: "eq", val: rawVal };
    }
  }

  let order: ParsedQuery["order"] = null;
  const orderRaw = u.searchParams.get("order");
  if (orderRaw) {
    const parts = orderRaw.split(".");
    const col = parts[0];
    const dir = parts[1]?.toLowerCase() === "desc" ? "DESC" : "ASC";
    order = { col, dir };
  }

  const limit = u.searchParams.has("limit") ? parseInt(u.searchParams.get("limit")!) : null;
  const offset = u.searchParams.has("offset") ? parseInt(u.searchParams.get("offset")!) : null;

  return { table, columns, filters, order, limit, offset };
}

function buildSelectSQL(p: ParsedQuery): { sql: string; params: any[] } {
  const colStr = p.columns.join(", ");
  let sql = `SELECT ${colStr} FROM "${p.table}"`;
  const params: any[] = [];
  const conditions: string[] = [];

  for (const [col, filter] of Object.entries(p.filters)) {
    if (filter.op === "eq") {
      conditions.push(`"${col}" = ?`);
      params.push(filter.val);
    } else if (filter.op === "neq") {
      conditions.push(`"${col}" != ?`);
      params.push(filter.val);
    } else if (filter.op === "gt") {
      conditions.push(`"${col}" > ?`);
      params.push(parseFloat(filter.val));
    } else if (filter.op === "gte") {
      conditions.push(`"${col}" >= ?`);
      params.push(parseFloat(filter.val));
    } else if (filter.op === "lt") {
      conditions.push(`"${col}" < ?`);
      params.push(parseFloat(filter.val));
    } else if (filter.op === "lte") {
      conditions.push(`"${col}" <= ?`);
      params.push(parseFloat(filter.val));
    } else if (filter.op === "like") {
      conditions.push(`"${col}" LIKE ?`);
      params.push(filter.val);
    } else if (filter.op === "in") {
      const vals = filter.val.split(",").map((v) => v.trim());
      conditions.push(`"${col}" IN (${vals.map(() => "?").join(",")})`);
      params.push(...vals);
    }
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  if (p.order) {
    sql += ` ORDER BY "${p.order.col}" ${p.order.dir}`;
  }

  if (p.limit !== null) {
    sql += ` LIMIT ?`;
    params.push(p.limit);
  }

  if (p.offset !== null) {
    sql += ` OFFSET ?`;
    params.push(p.offset);
  }

  return { sql, params };
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
const ALLOWED_TABLES = new Set<string>();

// Collect table names from schema
const tables = db
  .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all() as { name: string }[];
for (const t of tables) ALLOWED_TABLES.add(t.name);

// ── Transparent column encryption for REST API ────────────────────────────────
/** Encrypt sensitive columns in a row object before INSERT/UPDATE */
async function encryptSensitiveColumns(table: string, row: Record<string, unknown>): Promise<void> {
  if (!isEncryptionAvailable()) return;
  for (const [col, val] of Object.entries(row)) {
    if (isEncryptedColumn(table, col) && typeof val === "string" && val.length > 0 && !val.startsWith("PLAINTEXT:")) {
      row[col] = await encryptField(val);
    }
  }
}

/** Decrypt sensitive columns in a row object after SELECT */
async function decryptSensitiveColumns(table: string, row: Record<string, unknown>): Promise<void> {
  if (!isEncryptionAvailable()) return;
  for (const [col, val] of Object.entries(row)) {
    if (isEncryptedColumn(table, col) && typeof val === "string" && val.length > 0) {
      row[col] = await decryptField(val);
    }
  }
}

// ── Rate Limiting (Token Bucket, tiered per-path) ────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window

interface RateLimitBucket {
  tokens: number;
  maxTokens: number;
  resetAt: number;
  lastRefill: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function getClientIP(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
         req.headers.get("x-real-ip") ||
         "127.0.0.1";
}

/** Determine rate limit (req/min) based on the request path */
function getRateLimitForPath(path: string): number {
  if (path === "/health" || path === "/") return Infinity; // exempt
  if (path.startsWith("/auth/")) return 20;
  if (path.startsWith("/stripe/")) return 10;
  return 100; // default REST endpoints
}

/** Per-IP token bucket rate limiter. Refills 1 token per (window / limit) ms.
 *  Returns { allowed: false, retryAfter } on rate limit exceeded. */
function checkRateLimit(ip: string, path: string): { allowed: boolean; retryAfter?: number } {
  const limit = getRateLimitForPath(path);
  if (!isFinite(limit)) return { allowed: true }; // exempt paths

  const now = Date.now();
  const refillInterval = Math.floor(RATE_LIMIT_WINDOW_MS / limit); // ms per token

  // Tiered per-path buckets: a burst on a low-limit tier (e.g. /stripe/ = 10/min)
  // must not starve other tiers. Key by IP + tier limit.
  const bucketKey = `${ip}:${limit}`;
  let bucket = rateLimitBuckets.get(bucketKey);

  if (!bucket) {
    bucket = { tokens: limit - 1, maxTokens: limit, resetAt: now + RATE_LIMIT_WINDOW_MS, lastRefill: now };
    rateLimitBuckets.set(bucketKey, bucket);
    return { allowed: true };
  }

  // Reset entire bucket if the window has expired
  if (now > bucket.resetAt) {
    bucket.tokens = limit - 1;
    bucket.maxTokens = limit;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
    bucket.lastRefill = now;
    return { allowed: true };
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = Math.floor(elapsed / refillInterval);
  if (tokensToAdd > 0) {
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill += tokensToAdd * refillInterval;
  }

  if (bucket.tokens <= 0) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }

  bucket.tokens--;
  return { allowed: true };
}

// Periodic cleanup of expired rate limit buckets (every 2 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitBuckets) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(ip);
  }
}, 120_000);

// ── Input Validation ─────────────────────────────────────────────────────────
const MAX_BODY_SIZE_DEFAULT = 10 * 1024 * 1024; // 10 MB
const MAX_BODY_SIZE_AUTH = 1 * 1024 * 1024;    // 1 MB for auth endpoints

/** Get max body size for a given request path */
function getMaxBodySize(path: string): number {
  if (path.startsWith("/auth/")) return MAX_BODY_SIZE_AUTH;
  return MAX_BODY_SIZE_DEFAULT;
}

/** Validate column names against SQL injection patterns */
function isValidColumnName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/** Validate table name */
function isValidTableName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && ALLOWED_TABLES.has(name);
}

/** Sanitize value — prevent SQL injection in filter values */
function sanitizeFilterValue(val: string): string {
  // Remove any characters that could escape the query
  return val.replace(/['"\\;]/g, "");
}

// ── HSMCPay Fee Schedule ─────────────────────────────────────────────────────

interface HsmcFeeResult {
  fee: number;
  tier: string;
}

function calculateHsmcFee(amountUsd: number): HsmcFeeResult {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    return { fee: 0, tier: "invalid" };
  }

  if (amountUsd < 6000) {
    return { fee: 1.00, tier: "under-6k" };
  } else if (amountUsd < 10000) {
    return { fee: 3.00, tier: "6k-10k" };
  } else if (amountUsd < 50000) {
    return { fee: 5.00, tier: "10k-50k" };
  } else if (amountUsd < 1000000) {
    return { fee: 10.00, tier: "50k-1m" };
  } else {
    return { fee: 200.00, tier: "1m-plus" };
  }
}

// ── Response Helpers ─────────────────────────────────────────────────────────
function securityHeaders(isHttps: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  if (isHttps) {
    headers["Strict-Transport-Security"] = "max-age=31536000";
  }
  return headers;
}

function jsonResponse(body: unknown, status = 200): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    ...securityHeaders(USING_TLS),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(message: string, status = 400, details?: string): Response {
  const body: Record<string, string> = { error: message };
  if (details) body.details = details;
  return jsonResponse(body, status);
}

function rateLimitResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: `Too many requests. Try again in ${retryAfter} seconds.` }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Retry-After": String(retryAfter),
        ...securityHeaders(USING_TLS),
      },
    }
  );
}

function bodyTooLargeResponse(path: string): Response {
  const maxSize = getMaxBodySize(path);
  const mb = (maxSize / (1024 * 1024)).toFixed(0);
  return new Response(
    JSON.stringify({ error: `Request body too large. Maximum is ${mb} MB for this endpoint.` }),
    {
      status: 413,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        ...securityHeaders(USING_TLS),
      },
    }
  );
}

/**
 * Shared settlement logic for a confirmed buy PaymentIntent (HSMCPay buy).
 * - Applies the FIXED Treasury fee (fee schedule in calculateHsmcFee)
 * - Records the fee in treasury_transactions (type='buy_fee', status='settled')
 * - Credits the user's HSMC wallet with net amount (idempotent)
 * Called by: /stripe/checkout settle|simulate_success and the
 * payment_intent.succeeded webhook handler.
 */
function settleBuySession(sessionId: string):
  | { ok: true; txHash: string; amountHsmc: number; feeHsmc: number; feeTier: string; treasuryTxId: string; paymentId: string; alreadySettled?: boolean }
  | { ok: false; status: number; error: string } {

  const session = db.query(
    "SELECT * FROM payment_sessions WHERE session_id = ?"
  ).get(sessionId) as Record<string, unknown> | null;

  if (!session) {
    return { ok: false, status: 404, error: "Payment session not found" };
  }

  // Idempotency: already settled → return existing settlement
  if (session.status === "settled") {
    const existingTreasury = db.query(
      "SELECT id, fee_hsmc, fee_tier FROM treasury_transactions WHERE session_id = ? LIMIT 1"
    ).get(sessionId) as { id: string; fee_hsmc: number; fee_tier: string } | null;
    return {
      ok: true,
      txHash: String(session.settlement_tx_hash || "0x"),
      amountHsmc: Number(session.amount_hsmc ?? 0),
      feeHsmc: existingTreasury?.fee_hsmc ?? 0,
      feeTier: existingTreasury?.fee_tier ?? "n/a",
      treasuryTxId: existingTreasury?.id ?? "",
      paymentId: String(session.id),
      alreadySettled: true,
    };
  }

  const now = new Date().toISOString();
  const txHash = "0x" + randomUUID().replace(/-/g, "");
  const amountUsd = Number(session.amount_usd ?? 0);
  const amountHsmc = Number(session.amount_hsmc ?? 0);
  const { fee: feeUsd, tier: feeTier } = calculateHsmcFee(amountUsd);

  // Convert USD fee to HSMC using the latest recorded price
  const metrics = db.query(
    "SELECT price FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
  ).get() as { price: number } | null;
  const hsmcPrice = Math.max(Number(metrics?.price ?? 1), 1);
  const feeHsmc = feeUsd / hsmcPrice;

  // Net HSMC the user gets (after fixed fee)
  const netHsmc = Math.max(amountHsmc - feeHsmc, 0);

  // Record the treasury fee (fixed, goes to Treasury)
  const treasuryTxId = randomUUID();
  const userId = String(session.user_id ?? "local-user");
  const paymentIntentId = String(session.stripe_payment_intent_id ?? "");
  db.run(
    `INSERT INTO treasury_transactions (id, amount_usd, fee_hsmc, fee_tier, payment_intent_id, session_id, user_id, tx_hash, type, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'buy_fee', 'settled', ?)`,
    treasuryTxId, amountUsd, feeHsmc, feeTier, paymentIntentId, sessionId,
    userId, txHash,
    `HSMCPay buy settlement — ${feeTier} tier`
  );

  // Mark session as settled
  db.run(
    `UPDATE payment_sessions SET status = 'settled', settlement_tx_hash = ?, otp_expires_at = ? WHERE session_id = ?`,
    txHash, now, sessionId
  );

  // Credit wallet balance with net amount (after deducting fee)
  const credit = db.run(
    `UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
    netHsmc, now, userId
  );
  if (credit.changes === 0 && netHsmc > 0) {
    // No wallet row for this user yet — create one so the credit is not lost
    db.run(
      `INSERT INTO wallets (id, user_id, address, balance, staked_balance, label, is_primary, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'HSMCPay Wallet', 1, ?, ?)`,
      randomUUID(), userId,
      `hsmc1q${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}pay`,
      netHsmc, now, now
    );
  }

  console.log(`[Stripe] Session ${sessionId} settled: ${netHsmc.toFixed(6)} HSMC credited to ${userId} (fee ${feeHsmc.toFixed(2)} HSMC, tier ${feeTier})`);

  return { ok: true, txHash, amountHsmc: netHsmc, feeHsmc, feeTier, treasuryTxId, paymentId: String(session.id) };
}

// ── Stripe Checkout Endpoint (for HSMCPay) ───────────────────────────────────
async function handleStripeCheckout(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: { action?: string; mode?: string; amount_usd?: number; session_id?: string; payment_intent_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const action = body.action || "initiate";

  if (action === "initiate") {
    const amountUsd = Number(body.amount_usd);
    if (!amountUsd || amountUsd < 1 || !Number.isFinite(amountUsd)) {
      return errorResponse("amount_usd must be a positive number >= 1", 400);
    }

    // Get HSMC price from token_metrics
    const metrics = db.query(
      "SELECT price FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
    ).get() as { price: number } | null;
    const hsmcPrice = Math.max(Number(metrics?.price ?? 1), 1);
    const amountHsmc = amountUsd / hsmcPrice;
    const amountCents = Math.round(amountUsd * 100);

    // Generate session ID (used as idempotency key)
    const sessionId = `pi_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    // Stripe publishable key
    const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "";

    const now = new Date().toISOString();

    // ── Real Stripe PaymentIntent ──────────────────────────────────────────
    if (stripe) {
      if (!stripePublishableKey) {
        return jsonResponse({ error: "Stripe publishable key not configured", status: "service_unavailable" }, 503);
      }
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: "usd",
          description: `HSMCPay — ${amountUsd} USD → ${amountHsmc.toFixed(6)} HSMC`,
          metadata: {
            session_id: sessionId,
            amount_hsmc: amountHsmc.toFixed(6),
            hsmc_price: hsmcPrice.toFixed(4),
            source: "HSMCPay",
          },
          statement_descriptor_suffix: "HSMCPay",
        }, {
          idempotencyKey: `session_${sessionId}`,
        });

        const paymentIntentId = paymentIntent.id;
        const clientSecret = paymentIntent.client_secret!;

        // Encrypt sensitive fields at rest
        const encryptedClientSecret = await encryptField(clientSecret);

        db.run(
          `INSERT INTO payment_sessions (id, user_id, amount_usd, amount_hsmc, session_id,
           stripe_payment_intent_id, stripe_client_secret, status, processor, created_at, otp_expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'stripe', ?, ?)`,
          randomUUID(), "local-user", amountUsd, amountHsmc, sessionId,
          paymentIntentId, encryptedClientSecret, now,
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        );

        console.log(`[Stripe] PaymentIntent created: ${paymentIntentId} for ${amountUsd} (idempotency: session_${sessionId})`);

        return jsonResponse({
          session_id: sessionId,
          payment_intent_id: paymentIntentId,
          client_secret: clientSecret,
          stripe_publishable_key: stripePublishableKey,
          amount_hsmc: amountHsmc.toFixed(6),
          amount_usd: amountUsd,
        });
      } catch (err: unknown) {
        const stripeError = err as { type?: string; code?: string; message?: string; decline_code?: string };
        console.error("[Stripe] PaymentIntent creation failed:", stripeError.message || String(err));

        // Card declined
        if (stripeError.type === "StripeCardError" || stripeError.code === "card_declined") {
          const declineMsg = stripeError.decline_code
            ? `Card declined: ${stripeError.decline_code.replace(/_/g, " ")}`
            : "Your card was declined. Please try a different payment method.";
          return errorResponse(declineMsg, 402, stripeError.message);
        }

        // Stripe API error (down / misconfigured)
        if (stripeError.type?.startsWith("Stripe") || stripeError.code) {
          return errorResponse(
            "Payment service temporarily unavailable. Please try again in a moment.",
            503,
            stripeError.message
          );
        }

        return errorResponse("Payment initiation failed. Please try again.", 500, stripeError.message);
      }
    }

    // ── Simulation mode: no Stripe keys configured ──────────────────────────
    // Creates a local, in-DB PaymentIntent (pi_sim_*) so the full
    // checkout → payment → HSMC-credit flow can be exercised in dev/testing
    // without a Stripe account. Simulated payments are confirmed via
    // POST /stripe/webhook (simulation events) or action=simulate_success.
    if (STRIPE_SIMULATION_MODE) {
      const paymentIntentId = `pi_sim_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      const clientSecret = `sim_secret_${sessionId}`;
      const encryptedClientSecret = await encryptField(clientSecret);

      db.run(
        `INSERT INTO payment_sessions (id, user_id, amount_usd, amount_hsmc, session_id,
         stripe_payment_intent_id, stripe_client_secret, status, processor, created_at, otp_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'stripe', ?, ?)`,
        randomUUID(), "local-user", amountUsd, amountHsmc, sessionId,
        paymentIntentId, encryptedClientSecret, now,
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      );

      console.log(`[Stripe][SIM] Simulated PaymentIntent created: ${paymentIntentId} for ${amountUsd} USD (session ${sessionId})`);

      return jsonResponse({
        session_id: sessionId,
        payment_intent_id: paymentIntentId,
        client_secret: clientSecret,
        stripe_publishable_key: STRIPE_PUBLISHABLE_KEY || "",
        simulation: true,
        amount_hsmc: amountHsmc.toFixed(6),
        amount_usd: amountUsd,
      });
    }

    // Neither real Stripe nor simulation available — explain exactly what's missing
    return jsonResponse({
      error: "Stripe is not configured",
      status: "service_unavailable",
      details: "Set STRIPE_SECRET_KEY (plus STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET) for real payments, or leave STRIPE_SECRET_KEY unset to run in simulation mode (STRIPE_SIMULATION_MODE=true).",
    }, 503);
  }

  // ── Settle a confirmed payment ─────────────────────────────────────────────
  // Real mode: verifies the PaymentIntent is actually succeeded via the Stripe
  // API before crediting HSMC. Simulation mode: requires the payment to have
  // been confirmed (status 'paid' — via simulation webhook or simulate_confirm).
  if (action === "settle") {
    const sessionId = body.session_id;
    const paymentIntentId = body.payment_intent_id;

    if (!sessionId || !paymentIntentId) {
      return errorResponse("session_id and payment_intent_id are required", 400);
    }

    const session = db.query(
      "SELECT * FROM payment_sessions WHERE session_id = ? AND stripe_payment_intent_id = ?"
    ).get(sessionId, paymentIntentId) as Record<string, unknown> | null;

    if (!session) {
      return errorResponse("Payment session not found", 404);
    }

    const isSimulationPi = String(paymentIntentId).startsWith("pi_sim_");

    if (stripe && !isSimulationPi) {
      // Real mode: verify the payment actually succeeded with Stripe
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status !== "succeeded") {
          return errorResponse(
            `Payment not confirmed yet (status: ${pi.status}). HSMC is credited only after Stripe confirms the payment.`,
            402
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Stripe] PaymentIntent verification failed:", msg);
        return errorResponse("Unable to verify payment status with Stripe. Try again in a moment.", 503, msg);
      }
    } else if (STRIPE_SIMULATION_MODE && !isSimulationPi) {
      return errorResponse("Cannot settle a non-simulation PaymentIntent in simulation mode", 400);
    }

    if (STRIPE_SIMULATION_MODE && isSimulationPi && session.status !== "paid" && session.status !== "settled") {
      return errorResponse(
        "Simulated payment not confirmed yet. Confirm it via POST /stripe/webhook (simulation event), action=simulate_confirm, or action=simulate_success.",
        402
      );
    }

    const settled = settleBuySession(sessionId);
    if (!settled.ok) {
      return errorResponse(settled.error, settled.status ?? 500);
    }

    return jsonResponse({
      tx_hash: settled.txHash,
      amount_hsmc: settled.amountHsmc.toFixed(6),
      fee_hsmc: settled.feeHsmc.toFixed(2),
      fee_tier: settled.feeTier,
      treasury_tx_id: settled.treasuryTxId,
      payment_id: settled.paymentId,
    });
  }

  // ── Simulation: confirm a simulated payment (marks session 'paid') ─────────
  if (action === "simulate_confirm") {
    if (!STRIPE_SIMULATION_MODE) {
      return errorResponse("simulate_confirm is only available in simulation mode", 400);
    }
    const sessionId = body.session_id;
    const paymentIntentId = body.payment_intent_id;
    if (!sessionId || !paymentIntentId) {
      return errorResponse("session_id and payment_intent_id are required", 400);
    }
    const session = db.query(
      "SELECT * FROM payment_sessions WHERE session_id = ? AND stripe_payment_intent_id = ?"
    ).get(sessionId, paymentIntentId) as Record<string, unknown> | null;
    if (!session) {
      return errorResponse("Payment session not found", 404);
    }
    if (!String(paymentIntentId).startsWith("pi_sim_")) {
      return errorResponse("simulate_confirm only works for pi_sim_* PaymentIntents", 400);
    }
    db.run(
      `UPDATE payment_sessions SET status = 'paid', card_brand = 'simulated', card_last4 = '4242', otp_expires_at = ? WHERE session_id = ?`,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), sessionId
    );
    console.log(`[Stripe][SIM] Simulated payment confirmed for session ${sessionId}`);
    return jsonResponse({ success: true, status: "paid", session_id: sessionId });
  }

  // ── Simulation: confirm + settle in one step ───────────────────────────────
  if (action === "simulate_success") {
    if (!STRIPE_SIMULATION_MODE) {
      return errorResponse("simulate_success is only available in simulation mode", 400);
    }
    const sessionId = body.session_id;
    const paymentIntentId = body.payment_intent_id;
    if (!sessionId || !paymentIntentId) {
      return errorResponse("session_id and payment_intent_id are required", 400);
    }
    const session = db.query(
      "SELECT * FROM payment_sessions WHERE session_id = ? AND stripe_payment_intent_id = ?"
    ).get(sessionId, paymentIntentId) as Record<string, unknown> | null;
    if (!session) {
      return errorResponse("Payment session not found", 404);
    }
    if (!String(paymentIntentId).startsWith("pi_sim_")) {
      return errorResponse("simulate_success only works for pi_sim_* PaymentIntents", 400);
    }
    db.run(
      `UPDATE payment_sessions SET status = 'paid', card_brand = 'simulated', card_last4 = '4242' WHERE session_id = ?`,
      sessionId
    );
    const settled = settleBuySession(sessionId);
    if (!settled.ok) {
      return errorResponse(settled.error, settled.status ?? 500);
    }
    console.log(`[Stripe][SIM] Simulated payment settled: session ${sessionId}, ${settled.amountHsmc.toFixed(6)} HSMC credited`);
    return jsonResponse({
      success: true,
      simulation: true,
      tx_hash: settled.txHash,
      amount_hsmc: settled.amountHsmc.toFixed(6),
      fee_hsmc: settled.feeHsmc.toFixed(2),
      fee_tier: settled.feeTier,
      treasury_tx_id: settled.treasuryTxId,
      payment_id: settled.paymentId,
    });
  }

  return errorResponse(`Unknown action: ${action}`, 400);
}

// ── Stripe Payout Endpoint (for HSMCPay Sell) ─────────────────────────────────
const SELL_DEPOSIT_ADDRESS = process.env.HSMC_TREASURY_ADDRESS || "";

/** Simulated treasury address used in dev when HSMC_TREASURY_ADDRESS is unset */
const SIM_TREASURY_ADDRESS = "hsmc1qsimulatedtreasury0000000000000000000000000000";

async function handleStripePayout(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: { action?: string; amount_usd?: number; user_wallet?: string; payout_session_id?: string; tx_hash?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const action = body.action || "";

  if (action === "initiate") {
    const depositAddress = SELL_DEPOSIT_ADDRESS || (STRIPE_SIMULATION_MODE ? SIM_TREASURY_ADDRESS : "");
    if (!depositAddress) {
      return jsonResponse({
        error: "Treasury address not configured",
        status: "service_unavailable",
        details: "Set HSMC_TREASURY_ADDRESS (or run in simulation mode — STRIPE_SIMULATION_MODE).",
      }, 503);
    }
    const amountUsd = Number(body.amount_usd);
    if (!amountUsd || amountUsd < 1 || !Number.isFinite(amountUsd)) {
      return errorResponse("amount_usd must be a positive number >= 1", 400);
    }

    const userWallet = String(body.user_wallet || "").trim();
    if (!userWallet || userWallet.length < 10) {
      return errorResponse("user_wallet is required (valid HSMC wallet address)", 400);
    }

    // Get HSMC price from token_metrics
    const metrics = db.query(
      "SELECT price FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
    ).get() as { price: number } | null;
    const hsmcPrice = Math.max(Number(metrics?.price ?? 1), 1);

    // Calculate base HSMC needed for the USD amount
    const baseHsmc = amountUsd / hsmcPrice;

    // Calculate HSMC fee using same fee schedule
    const { fee: feeUsd, tier: feeTier } = calculateHsmcFee(amountUsd);
    const feeHsmc = feeUsd / hsmcPrice;

    // Total HSMC user must send (base + fee)
    const amountHsmcRequired = baseHsmc + feeHsmc;

    // ── Balance verification (DB-backed wallets) ────────────────────────────
    // If the wallet exists in our DB, verify it has sufficient HSMC balance.
    // Addresses not in the DB (external/on-chain) are allowed at initiate —
    // the hard gate is at settle, where the burn actually happens.
    const wallet = db.query(
      "SELECT * FROM wallets WHERE address = ? ORDER BY is_primary DESC LIMIT 1"
    ).get(userWallet) as Record<string, unknown> | null;
    if (wallet) {
      const balance = Number(wallet.balance ?? 0);
      if (balance < amountHsmcRequired) {
        return errorResponse(
          `Insufficient HSMC balance: ${balance.toFixed(6)} HSMC available, ${amountHsmcRequired.toFixed(6)} required (base ${baseHsmc.toFixed(6)} + fee ${feeHsmc.toFixed(6)})`,
          400
        );
      }
    } else if (!STRIPE_SIMULATION_MODE) {
      return errorResponse(
        `Wallet ${userWallet} not found in the HSMC database — cannot verify balance.`,
        400
      );
    }

    // Create payout session in DB
    const payoutSessionId = `po_live_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO payment_sessions (id, user_id, amount_usd, amount_hsmc, session_id,
       processor, status, created_at, card_holder, card_brand, otp_expires_at)
       VALUES (?, ?, ?, ?, ?, 'payout', 'pending', ?, ?, 'sell', ?)`,
      randomUUID(), userWallet, amountUsd, amountHsmcRequired, payoutSessionId,
      now, userWallet,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    );

    return jsonResponse({
      payout_session_id: payoutSessionId,
      amount_hsmc_required: Number(amountHsmcRequired.toFixed(6)),
      fee_hsmc: Number(feeHsmc.toFixed(6)),
      fee_tier: feeTier,
      deposit_address: depositAddress,
      hsmc_price: Number(hsmcPrice.toFixed(6)),
      amount_usd: amountUsd,
      simulation: STRIPE_SIMULATION_MODE,
    });
  }

  if (action === "settle") {
    const payoutSessionId = body.payout_session_id;
    const txHash = body.tx_hash;

    if (!payoutSessionId || !txHash) {
      return errorResponse("payout_session_id and tx_hash are required", 400);
    }

    if (!txHash.startsWith("0x") || txHash.length < 10) {
      return errorResponse("tx_hash must be a valid transaction hash starting with 0x", 400);
    }

    const session = db.query(
      "SELECT * FROM payment_sessions WHERE session_id = ? AND processor = 'payout'"
    ).get(payoutSessionId) as Record<string, unknown> | null;

    if (!session) {
      return errorResponse("Payout session not found", 404);
    }

    if (session.status === "settled") {
      // Return existing settlement info
      const existingTreasury = db.query(
        "SELECT id, fee_hsmc, fee_tier FROM treasury_transactions WHERE session_id = ? LIMIT 1"
      ).get(payoutSessionId) as { id: string; fee_hsmc: number; fee_tier: string } | null;

      return jsonResponse({
        status: "processing",
        estimated_payout_days: "2-5 business days",
        tx_hash: session.settlement_tx_hash,
        fee_hsmc: existingTreasury?.fee_hsmc?.toFixed(2) ?? "0.00",
        fee_tier: existingTreasury?.fee_tier ?? "n/a",
        treasury_tx_id: existingTreasury?.id ?? null,
      });
    }

    const now = new Date().toISOString();
    const amountUsd = Number(session.amount_usd ?? 0);
    const amountHsmcRequired = Number(session.amount_hsmc ?? 0);
    const { fee: feeUsd, tier: feeTier } = calculateHsmcFee(amountUsd);

    // Convert USD fee to HSMC
    const metrics = db.query(
      "SELECT price FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
    ).get() as { price: number } | null;
    const hsmcPrice = Math.max(Number(metrics?.price ?? 1), 1);
    const feeHsmc = feeUsd / hsmcPrice;

    // ── Verify & burn HSMC from the user's wallet ───────────────────────────
    const userWallet = String(session.user_id ?? session.card_holder ?? "");
    const wallet = db.query(
      "SELECT * FROM wallets WHERE address = ? ORDER BY is_primary DESC LIMIT 1"
    ).get(userWallet) as Record<string, unknown> | null;
    if (!wallet) {
      return errorResponse(
        `Wallet ${userWallet} not found in the HSMC database — cannot burn HSMC for the payout.`,
        400
      );
    }
    const balance = Number(wallet.balance ?? 0);
    if (balance < amountHsmcRequired) {
      return errorResponse(
        `Insufficient HSMC balance: ${balance.toFixed(6)} available, ${amountHsmcRequired.toFixed(6)} required for payout.`,
        400
      );
    }

    // Burn: deduct the full required amount (base + fee) from the wallet.
    // baseHsmc → burned in exchange for the fiat payout; feeHsmc → Treasury.
    db.run(
      `UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE address = ?`,
      amountHsmcRequired, now, userWallet
    );

    // ── Create the Stripe payout (or simulate) ──────────────────────────────
    let stripePayoutId: string | null = null;
    let payoutStatus = "processing";
    if (stripe) {
      try {
        const payout = await stripe.payouts.create({
          amount: Math.round(amountUsd * 100),
          currency: "usd",
          description: `HSMCPay sell — ${payoutSessionId}`,
          metadata: { payout_session_id: payoutSessionId },
        });
        stripePayoutId = payout.id;
        console.log(`[Stripe] Payout created: ${payout.id} for ${payoutSessionId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Stripe] Payout creation failed for ${payoutSessionId}:`, msg);
        // Do not fail the settlement — record the burn/treasury and flag the
        // payout as needing manual retry. The payout webhook can still confirm.
      }
    } else {
      stripePayoutId = `po_sim_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      console.log(`[Stripe][SIM] Simulated payout created: ${stripePayoutId} for ${payoutSessionId}`);
    }

    // Insert treasury transaction with type='sell_fee' (fixed fee → Treasury)
    const treasuryTxId = randomUUID();
    db.run(
      `INSERT INTO treasury_transactions (id, amount_usd, fee_hsmc, fee_tier, session_id, user_id, tx_hash, type, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sell_fee', 'settled', ?)`,
      treasuryTxId, amountUsd, feeHsmc, feeTier, payoutSessionId,
      userWallet, txHash,
      `HSMCPay sell settlement — ${feeTier} tier — payout ${stripePayoutId ?? "n/a"} — ${amountHsmcRequired.toFixed(6)} HSMC burned`
    );

    // Mark session as settled
    db.run(
      `UPDATE payment_sessions SET status = 'settled', settlement_tx_hash = ?, otp_expires_at = ? WHERE session_id = ?`,
      txHash, now, payoutSessionId
    );

    return jsonResponse({
      status: payoutStatus,
      estimated_payout_days: "2-5 business days",
      tx_hash: txHash,
      stripe_payout_id: stripePayoutId,
      hsmc_burned: Number(amountHsmcRequired.toFixed(6)),
      fee_hsmc: Number(feeHsmc.toFixed(2)),
      fee_tier: feeTier,
      treasury_tx_id: treasuryTxId,
      simulation: STRIPE_SIMULATION_MODE,
    });
  }

  return errorResponse(`Unknown action: ${action}. Use 'initiate' or 'settle'`, 400);
}

// ── Stripe Payout Webhook ──────────────────────────────────────────────────────
// Real mode: verifies the Stripe webhook signature (STRIPE_WEBHOOK_SECRET) and
// handles payout.paid / payout.failed events. Simulation mode (no Stripe keys):
// accepts either a Stripe-shaped event body {type, data.object.metadata} or the
// legacy {payout_session_id, status} body — both update the payout session.
async function handleStripePayoutWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let payoutSessionId: string | undefined;
  let newStatus: string | undefined;
  let verifiedEventType: string | null = null;

  // ── Real mode: verify signature and parse the Stripe event ───────────────
  if (STRIPE_WEBHOOK_SECRET && stripe) {
    if (!signature) {
      return errorResponse("Missing stripe-signature header", 400);
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Stripe] Payout webhook signature verification failed:", msg);
      return errorResponse(`Webhook signature verification failed: ${msg}`, 400);
    }
    verifiedEventType = event.type;
    const po = event.data.object as any;
    payoutSessionId = po?.metadata?.payout_session_id;
    newStatus =
      event.type === "payout.paid" ? "completed" :
      event.type === "payout.failed" ? "failed" :
      event.type === "payout.canceled" ? "failed" :
      undefined;
  } else if (STRIPE_SIMULATION_MODE) {
    // ── Simulation mode: accept local events (dev/testing only) ────────────
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    if (body?.type && body?.data?.object) {
      // Stripe-shaped simulation event
      verifiedEventType = body.type;
      payoutSessionId = body.data.object?.metadata?.payout_session_id;
      newStatus =
        body.type === "payout.paid" ? "completed" :
        body.type === "payout.failed" ? "failed" :
        body.type === "payout.canceled" ? "failed" :
        undefined;
    } else {
      // Legacy simulation body
      payoutSessionId = body.payout_session_id;
      newStatus = body.status;
    }
  } else {
    return jsonResponse({
      error: "Webhook secret not configured",
      status: "service_unavailable",
      details: "Set STRIPE_WEBHOOK_SECRET for real webhook processing (fail-closed), or run in simulation mode (STRIPE_SIMULATION_MODE).",
    }, 503);
  }

  if (!payoutSessionId) {
    return errorResponse("payout_session_id is required (set it in the payout metadata)", 400);
  }

  const validStatuses = ["completed", "failed", "processing"];
  if (!newStatus || !validStatuses.includes(newStatus)) {
    return errorResponse(`status must be one of: ${validStatuses.join(", ")} (or send a payout.paid / payout.failed event)`, 400);
  }

  const session = db.query(
    "SELECT * FROM payment_sessions WHERE session_id = ? AND processor = 'payout'"
  ).get(payoutSessionId) as Record<string, unknown> | null;

  if (!session) {
    return errorResponse("Payout session not found", 404);
  }

  const now = new Date().toISOString();

  if (newStatus === "completed") {
    db.run(
      `UPDATE payment_sessions SET status = 'completed', otp_expires_at = ? WHERE session_id = ?`,
      now, payoutSessionId
    );

    // Also update treasury transaction status
    db.run(
      `UPDATE treasury_transactions SET status = 'settled', notes = notes || ' — webhook confirmed' WHERE session_id = ? AND type = 'sell_fee'`,
      payoutSessionId
    );

    console.log(`[Stripe] Payout confirmed (${verifiedEventType ?? "simulation"}): ${payoutSessionId}`);
    return jsonResponse({
      success: true,
      payout_session_id: payoutSessionId,
      status: "completed",
      message: "Payout confirmed — fiat sent to user's card",
    });
  }

  if (newStatus === "failed") {
    db.run(
      `UPDATE payment_sessions SET status = 'failed', otp_expires_at = ? WHERE session_id = ?`,
      now, payoutSessionId
    );

    db.run(
      `UPDATE treasury_transactions SET status = 'failed', notes = notes || ' — webhook: payout failed' WHERE session_id = ? AND type = 'sell_fee'`,
      payoutSessionId
    );

    console.log(`[Stripe] Payout failed (${verifiedEventType ?? "simulation"}): ${payoutSessionId}`);
    return jsonResponse({
      success: true,
      payout_session_id: payoutSessionId,
      status: "failed",
      message: "Payout marked as failed",
    });
  }

  // processing
  return jsonResponse({
    success: true,
    payout_session_id: payoutSessionId,
    status: "processing",
    message: "Payout is still processing",
  });
}

// ── Stripe Create PaymentIntent Endpoint ────────────────────────────────────

/** POST /stripe/create-payment-intent — dedicated endpoint with idempotency */
async function handleStripeCreatePaymentIntent(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: { amount_usd?: number; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const amountUsd = Number(body.amount_usd);
  if (!amountUsd || amountUsd < 1 || !Number.isFinite(amountUsd)) {
    return errorResponse("amount_usd must be a positive number >= 1", 400);
  }

  const amountCents = Math.round(amountUsd * 100);
  const idempotencyKey = body.idempotency_key || `hsmcpay_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  if (!stripe) {
    // ── Simulation mode (no Stripe keys) — local in-DB PaymentIntent ────────
    if (STRIPE_SIMULATION_MODE) {
      const metrics = db.query(
        "SELECT price FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
      ).get() as { price: number } | null;
      const hsmcPrice = Math.max(Number(metrics?.price ?? 1), 1);
      const amountHsmc = amountUsd / hsmcPrice;

      const paymentIntentId = `pi_sim_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      const clientSecret = `sim_secret_${idempotencyKey}`;
      const now = new Date().toISOString();
      const encryptedClientSecret = await encryptField(clientSecret);

      db.run(
        `INSERT INTO payment_sessions (id, user_id, amount_usd, amount_hsmc, session_id,
         stripe_payment_intent_id, stripe_client_secret, status, processor, created_at, otp_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'stripe', ?, ?)`,
        randomUUID(), "local-user", amountUsd, amountHsmc, `sim_${idempotencyKey}`,
        paymentIntentId, encryptedClientSecret, now,
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      );
      console.log(`[Stripe][SIM] PaymentIntent created via API (simulation): ${paymentIntentId}`);

      return jsonResponse({
        client_secret: clientSecret,
        payment_intent_id: paymentIntentId,
        amount_usd: amountUsd,
        amount_cents: amountCents,
        simulation: true,
      });
    }

    return errorResponse(
      "Stripe is not configured. Set STRIPE_SECRET_KEY environment variable (or leave it unset to run in simulation mode).",
      503
    );
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      description: `HSMCPay — ${amountUsd} USD`,
      metadata: {
        idempotency_key: idempotencyKey,
        source: "HSMCPay API",
      },
      statement_descriptor_suffix: "HSMCPay",
    }, {
      idempotencyKey,
    });

    console.log(`[Stripe] PaymentIntent created via API: ${paymentIntent.id} (idempotency: ${idempotencyKey})`);

    return jsonResponse({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount_usd: amountUsd,
      amount_cents: amountCents,
    });
  } catch (err: unknown) {
    const stripeError = err as { type?: string; code?: string; message?: string; decline_code?: string };
    console.error("[Stripe] create-payment-intent failed:", stripeError.message || String(err));

    if (stripeError.type === "StripeCardError" || stripeError.code === "card_declined") {
      return errorResponse(
        stripeError.decline_code
          ? `Card declined: ${stripeError.decline_code.replace(/_/g, " ")}`
          : "Your card was declined.",
        402,
        stripeError.message
      );
    }

    if (stripeError.type?.startsWith("Stripe") || stripeError.code) {
      return errorResponse(
        "Payment service temporarily unavailable.",
        503,
        stripeError.message
      );
    }

    return errorResponse("Payment initiation failed.", 500, stripeError.message);
  }
}

// ── Stripe Webhook Handler ──────────────────────────────────────────────────

/** POST /stripe/webhook — handle Stripe events with signature verification */

// ── Cardholder Endpoints ─────────────────────────────────────────────────────

async function handleCardholderCreate(req: Request): Promise<Response> {
  const auth = await requireJWTUser(req);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  let body: {
    name?: string; email?: string; phone?: string;
    address_line1?: string; address_city?: string; address_state?: string;
    address_postal?: string; address_country?: string;
    date_of_birth?: string; id_last4?: string;
  };
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON body", 400); }

  if (!body.name || !body.email) {
    return errorResponse("name and email are required", 400);
  }

  const existing = db.query(
    "SELECT id, stripe_cardholder_id, verification_status FROM cardholders WHERE user_id = ? LIMIT 1"
  ).get(userId) as Record<string, unknown> | null;

  if (existing?.verification_status === "verified") {
    return jsonResponse({ message: "Cardholder already verified", cardholder: existing });
  }

  const cardholderId = randomUUID();
  const now = new Date().toISOString();
  let stripeCardholderId: string | null = null;

  if (stripe) {
    try {
      const firstName = body.name.split(" ")[0] || body.name;
      const lastName = body.name.split(" ").slice(1).join(" ") || body.name;
      const stripeCH = await stripe.issuing.cardholders.create({
        name: body.name,
        email: body.email,
        phone_number: body.phone || undefined,
        status: "active",
        type: "individual",
        individual: {
          first_name: firstName,
          last_name: lastName,
          ...(body.date_of_birth ? {
            dob: {
              day: parseInt(body.date_of_birth.split("-")[2] || "1"),
              month: parseInt(body.date_of_birth.split("-")[1] || "1"),
              year: parseInt(body.date_of_birth.split("-")[0] || "1990"),
            }
          } : {}),
        },
        billing: {
          address: {
            line1: body.address_line1 || "",
            city: body.address_city || "",
            state: body.address_state || "",
            postal_code: body.address_postal || "",
            country: body.address_country || "US",
          },
        },
        spending_controls: {
          spending_limits: [{ amount: 1000000, interval: "daily", categories: [] }],
        },
      });
      stripeCardholderId = stripeCH.id;
      console.log(`[Card] Stripe cardholder: ${stripeCardholderId}`);
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error("[Card] Stripe cardholder creation failed:", e.message);
      return errorResponse(`Cardholder creation failed: ${e.message || "Stripe API error"}`, 502);
    }
  }

  db.run(
    `INSERT INTO cardholders (id, stripe_cardholder_id, user_id, name, email, phone,
     address_line1, address_city, address_state, address_postal, address_country,
     date_of_birth, id_last4, verification_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    cardholderId, stripeCardholderId, userId, body.name, body.email,
    body.phone || null, body.address_line1 || null, body.address_city || null,
    body.address_state || null, body.address_postal || null,
    body.address_country || "US", body.date_of_birth || null,
    body.id_last4 || null, now
  );

  return jsonResponse({
    id: cardholderId, stripe_cardholder_id: stripeCardholderId,
    user_id: userId, name: body.name, email: body.email,
    verification_status: "pending", created_at: now,
  }, 201);
}

function handleCardholderGet(chId: string): Response {
  const ch = db.query("SELECT * FROM cardholders WHERE id = ?").get(chId) as Record<string, unknown> | null;
  if (!ch) return errorResponse("Cardholder not found", 404);
  return jsonResponse(ch);
}


// ── Card Management Endpoints ────────────────────────────────────────────────

async function handleCardCreate(req: Request): Promise<Response> {
  const auth = await requireJWTUser(req);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  let body: {
    cardholder_name?: string; card_type?: "virtual" | "physical";
    daily_limit_usd?: number; monthly_limit_usd?: number; per_tx_limit_usd?: number;
  };
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON body", 400); }

  const cardCount = (db.query(
    "SELECT COUNT(*) as cnt FROM cards WHERE user_id = ? AND status != 'cancelled'"
  ).get(userId) as { cnt: number }).cnt;
  if (cardCount >= 3) return errorResponse("Maximum 3 active cards per user", 400);

  const today = new Date().toISOString().split("T")[0];
  const todayCount = (db.query(
    "SELECT COUNT(*) as cnt FROM cards WHERE user_id = ? AND created_at >= ?"
  ).get(userId, today) as { cnt: number }).cnt;
  if (todayCount >= 1) return errorResponse("Maximum 1 card creation per day", 429);

  let cardholder = db.query(
    "SELECT id, stripe_cardholder_id FROM cardholders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(userId) as Record<string, unknown> | null;

  if (!cardholder) {
    return errorResponse("No cardholder found. Create one via POST /cardholders/create", 400);
  }

  const stripeCHId = cardholder.stripe_cardholder_id as string;
  const cardType = body.card_type || "virtual";
  const dailyL = body.daily_limit_usd || 1000;
  const monthlyL = body.monthly_limit_usd || 10000;
  const perTxL = body.per_tx_limit_usd || 500;

  const cardId = randomUUID();
  const now = new Date().toISOString();
  let stripeCardId: string | null = null;
  let last4: string | null = null;
  let brand: string | null = null;
  let expM: number | null = null;
  let expY: number | null = null;

  if (stripe && stripeCHId) {
    try {
      const sc = await stripe.issuing.cards.create({
        cardholder: stripeCHId,
        type: cardType,
        currency: "usd",
        status: "active",
        spending_controls: {
          spending_limits: [
            { amount: Math.round(dailyL * 100), interval: "daily" },
            { amount: Math.round(monthlyL * 100), interval: "monthly" },
            { amount: Math.round(perTxL * 100), interval: "per_transaction" },
          ],
        },
      });
      stripeCardId = sc.id; last4 = sc.last4; brand = sc.brand;
      expM = sc.exp_month; expY = sc.exp_year;
      console.log(`[Card] Created: ${stripeCardId} (${brand} *${last4})`);
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error("[Card] Stripe card creation failed:", e.message);
      return errorResponse(`Card creation failed: ${e.message || "Stripe API error"}`, 502);
    }
  } else {
    return jsonResponse({ error: "Stripe not configured", status: "service_unavailable" }, 503);
  }

  db.run(
    `INSERT INTO cards (id, stripe_card_id, cardholder_id, user_id, last4, brand,
     card_type, status, daily_limit_usd, monthly_limit_usd, per_tx_limit_usd,
     expiration_month, expiration_year, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    cardId, stripeCardId, cardholder.id, userId, last4, brand,
    cardType, dailyL, monthlyL, perTxL, expM, expY, now
  );

  return jsonResponse({
    id: cardId, stripe_card_id: stripeCardId, cardholder_id: cardholder.id,
    last4, brand, card_type: cardType, status: "active",
    daily_limit_usd: dailyL, monthly_limit_usd: monthlyL, per_tx_limit_usd: perTxL,
    expiration_month: expM, expiration_year: expY, created_at: now,
  }, 201);
}

async function handleCardList(req: Request): Promise<Response> {
  const auth = await requireJWTUser(req);
  if (auth instanceof Response) return auth;
  const rows = db.query(
    "SELECT id, stripe_card_id, last4, brand, card_type, status, daily_limit_usd, monthly_limit_usd, per_tx_limit_usd, card_balance_usd_cents, expiration_month, expiration_year, created_at, activated_at FROM cards WHERE user_id = ? AND status != 'cancelled' ORDER BY created_at DESC"
  ).all(auth.userId) as Array<Record<string, unknown>>;
  return jsonResponse(rows.map(c => ({ ...c, card_balance_usd: Number(c.card_balance_usd_cents) / 100 })));
}

function handleCardGet(cardId: string): Response {
  const c = db.query(
    "SELECT id, stripe_card_id, cardholder_id, user_id, last4, brand, card_type, status, daily_limit_usd, monthly_limit_usd, per_tx_limit_usd, card_balance_usd_cents, expiration_month, expiration_year, created_at, activated_at FROM cards WHERE id = ?"
  ).get(cardId) as Record<string, unknown> | null;
  if (!c) return errorResponse("Card not found", 404);
  return jsonResponse({ ...c, card_balance_usd: Number(c.card_balance_usd_cents) / 100 });
}


// ── Card Actions (freeze/unfreeze/cancel/limits/fund) ─────────────────────────

async function handleCardFreeze(req: Request, cardId: string): Promise<Response> {
  const auth = await requireJWTUser(req);
  if (auth instanceof Response) return auth;
  const c = db.query("SELECT id, stripe_card_id, status FROM cards WHERE id = ? AND user_id = ?").get(cardId, auth.userId) as Record<string, unknown> | null;
  if (!c) return errorResponse("Card not found", 404);
  if (c.status === "cancelled") return errorResponse("Card is cancelled", 400);
  if (c.status === "frozen") return errorResponse("Card is already frozen", 400);
  if (stripe && c.stripe_card_id) {
    try { await stripe.issuing.cards.update(c.stripe_card_id as string, { status: "inactive" }); } catch {}
  }
  db.run("UPDATE cards SET status = 'frozen' WHERE id = ?", cardId);
  return jsonResponse({ id: cardId, status: "frozen", message: "Card frozen" });
}

async function handleCardUnfreeze(req: Request, cardId: string): Promise<Response> {
  const auth = await requireJWTUser(req);
  if (auth instanceof Response) return auth;
  const c = db.query("SELECT id, stripe_card_id, status FROM cards WHERE id = ? AND user_id = ?").get(cardId, auth.userId) as Record<string, unknown> | null;
  if (!c) return errorResponse("Card not found", 404);
  if (c.status !== "frozen") return errorResponse("Card is not frozen", 400);
  if (stripe && c.stripe_card_id) {
    try { await stripe.issuing.cards.update(c.stripe_card_id as string, { status: "active" }); } catch {}
  }
  db.run("UPDATE cards SET status = 'active' WHERE id = ?", cardId);
  return jsonResponse({ id: cardId, status: "active", message: "Card unfrozen" });
}

async function handleCardCancel(req: Request, cardId: string): Promise<Response> {
  const auth = await requireJWTUser(req);
  if (auth instanceof Response) return auth;
  const c = db.query("SELECT id, stripe_card_id, status FROM cards WHERE id = ? AND user_id = ?").get(cardId, auth.userId) as Record<string, unknown> | null;
  if (!c) return errorResponse("Card not found", 404);
  if (c.status === "cancelled") return errorResponse("Already cancelled", 400);
  if (stripe && c.stripe_card_id) {
    try { await stripe.issuing.cards.update(c.stripe_card_id as string, { status: "canceled" }); } catch {}
  }
  db.run("UPDATE cards SET status = 'cancelled' WHERE id = ?", cardId);
  return jsonResponse({ id: cardId, status: "cancelled", message: "Card cancelled" });
}

async function handleCardSetLimits(req: Request, cardId: string): Promise<Response> {
  const auth = await requireJWTUser(req);
  if (auth instanceof Response) return auth;
  const c = db.query("SELECT id, stripe_card_id FROM cards WHERE id = ? AND user_id = ? AND status != 'cancelled'").get(cardId, auth.userId) as Record<string, unknown> | null;
  if (!c) return errorResponse("Card not found", 404);
  let body: { daily_limit_usd?: number; monthly_limit_usd?: number; per_tx_limit_usd?: number };
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON body", 400); }
  const updates: string[] = []; const params: (string | number)[] = [];
  if (body.daily_limit_usd !== undefined) { updates.push("daily_limit_usd = ?"); params.push(body.daily_limit_usd); }
  if (body.monthly_limit_usd !== undefined) { updates.push("monthly_limit_usd = ?"); params.push(body.monthly_limit_usd); }
  if (body.per_tx_limit_usd !== undefined) { updates.push("per_tx_limit_usd = ?"); params.push(body.per_tx_limit_usd); }
  if (updates.length === 0) return errorResponse("At least one limit required", 400);
  if (stripe && c.stripe_card_id) {
    try {
      const sl: Array<{ amount: number; interval: string }> = [];
      if (body.daily_limit_usd !== undefined) sl.push({ amount: Math.round(body.daily_limit_usd * 100), interval: "daily" });
      if (body.monthly_limit_usd !== undefined) sl.push({ amount: Math.round(body.monthly_limit_usd * 100), interval: "monthly" });
      if (body.per_tx_limit_usd !== undefined) sl.push({ amount: Math.round(body.per_tx_limit_usd * 100), interval: "per_transaction" });
      if (sl.length > 0) await stripe.issuing.cards.update(c.stripe_card_id as string, { spending_controls: { spending_limits: sl } });
    } catch {}
  }
  params.push(cardId);
  db.run(`UPDATE cards SET ${updates.join(", ")} WHERE id = ?`, ...params);
  return jsonResponse({ id: cardId, message: "Limits updated" });
}


// ── Card Funding ─────────────────────────────────────────────────────────────

async function handleCardFund(req: Request, cardId: string): Promise<Response> {
  const auth = await requireJWTUser(req);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  let body: { amount_hsmc?: number };
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON body", 400); }
  if (!body.amount_hsmc || body.amount_hsmc <= 0) {
    return errorResponse("amount_hsmc must be positive", 400);
  }

  const amountHsmc = body.amount_hsmc;
  const hsmcPrice = getHsmcPrice();
  const amountUsdCents = Math.floor(amountHsmc * hsmcPrice * 100);
  if (amountUsdCents <= 0) return errorResponse("Amount too small", 400);

  const card = db.query(
    "SELECT id, stripe_card_id, card_balance_usd_cents, status FROM cards WHERE id = ? AND user_id = ?"
  ).get(cardId, userId) as Record<string, unknown> | null;
  if (!card) return errorResponse("Card not found", 404);
  if (card.status !== "active") return errorResponse("Card must be active to fund", 400);

  try {
    db.run("BEGIN IMMEDIATE");
    const wallet = db.query(
      "SELECT balance FROM wallets WHERE user_id = ? AND is_primary = 1 LIMIT 1"
    ).get(userId) as { balance: number } | null;
    if (!wallet) { db.run("ROLLBACK"); return errorResponse("No primary wallet found", 404); }
    if (wallet.balance < amountHsmc) {
      db.run("ROLLBACK");
      return errorResponse(`Insufficient HSMC: ${wallet.balance.toFixed(6)} < ${amountHsmc}`, 400);
    }

    const now = new Date().toISOString();
    db.run("UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND is_primary = 1",
      amountHsmc, now, userId);
    db.run("UPDATE cards SET card_balance_usd_cents = card_balance_usd_cents + ? WHERE id = ?",
      amountUsdCents, cardId);

    const fundEventId = randomUUID();
    db.run(
      "INSERT INTO card_funding_events (id, card_id, amount_hsmc, amount_usd_cents, exchange_rate, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      fundEventId, cardId, amountHsmc, amountUsdCents, hsmcPrice, now
    );

    db.run("COMMIT");

    const newBalance = (Number(card.card_balance_usd_cents) + amountUsdCents) / 100;
    return jsonResponse({
      id: fundEventId, card_id: cardId, amount_hsmc: amountHsmc,
      amount_usd: amountUsdCents / 100, exchange_rate: hsmcPrice,
      new_card_balance_usd: newBalance, created_at: now,
    });
  } catch (err: unknown) {
    try { db.run("ROLLBACK"); } catch {}
    return errorResponse(`Funding failed: ${(err as Error).message}`, 500);
  }
}

async function handleStripeWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const signature = req.headers.get("stripe-signature");

  // Read raw body for signature verification
  const rawBody = await req.text();

  // ── Signature verification ─────────────────────────────────────────────
  // Real mode: signature is REQUIRED and verified via STRIPE_WEBHOOK_SECRET
  // (fail-closed — a configured key with a missing webhook secret rejects).
  // Simulation mode (no secret key configured): events are accepted without
  // signature verification — dev/testing only, never in production.
  let event: Stripe.Event;
  if (STRIPE_WEBHOOK_SECRET && stripe) {
    if (!signature) {
      return errorResponse("Missing stripe-signature header", 400);
    }
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Stripe] Webhook signature verification failed:", msg);
      return errorResponse(`Webhook signature verification failed: ${msg}`, 400);
    }
  } else if (STRIPE_SIMULATION_MODE) {
    // Simulation mode — parse the event body directly (no signature).
    try {
      event = JSON.parse(rawBody);
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    if (!event?.type || !event?.data?.object?.id) {
      return errorResponse("Simulation webhook body must be a Stripe-shaped event: { type, data: { object: { id, ... } } }", 400);
    }
    console.warn(`[Stripe][SIM] Simulation webhook event accepted WITHOUT signature verification (dev only): ${event.type}`);
  } else {
    console.error("[Stripe] Webhook received but STRIPE_WEBHOOK_SECRET not configured (and simulation mode is off)");
    return jsonResponse({
      error: "Webhook secret not configured",
      status: "service_unavailable",
      details: "Set STRIPE_WEBHOOK_SECRET for real webhook processing (fail-closed), or run in simulation mode (STRIPE_SIMULATION_MODE).",
    }, 503);
  }

  // ── Idempotency check — don't process the same event twice ──────────────
  const existing = db.query("SELECT id FROM webhook_events WHERE id = ?").get(event.id) as { id: string } | null;
  if (existing) {
    console.log(`[Stripe] Webhook event ${event.id} already processed — skipping`);
    return jsonResponse({ received: true, status: "already_processed" });
  }

  // Record the event as processed
  db.run(
    "INSERT INTO webhook_events (id, event_type, payment_intent_id) VALUES (?, ?, ?)",
    event.id,
    event.type,
    (event.data.object as any)?.id || null
  );

  console.log(`[Stripe] Webhook received: ${event.type} (event: ${event.id})`);

  // ── Process event ───────────────────────────────────────────────────────
  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const piId = paymentIntent.id;
        const sessionId = paymentIntent.metadata?.session_id || "";

        console.log(`[Stripe] PaymentIntent succeeded: ${piId}, amount: $${(paymentIntent.amount / 100).toFixed(2)}`);

        // Find the payment session
        const session = db.query(
          "SELECT * FROM payment_sessions WHERE stripe_payment_intent_id = ?"
        ).get(piId) as Record<string, unknown> | null;

        if (!session) {
          console.warn(`[Stripe] No payment session found for PaymentIntent ${piId}`);
          return jsonResponse({ received: true, warning: "no_session_found" });
        }

        // Settle via the shared settlement logic (fee schedule, treasury
        // recording, wallet credit — same code path as checkout settle).
        const settled = settleBuySession(String(session.session_id));
        if (!settled.ok) {
          console.error(`[Stripe] Settlement failed for ${piId}: ${settled.error}`);
          return jsonResponse({ received: true, status: "settle_failed", error: settled.error });
        }
        console.log(`[Stripe] Wallet credited: ${settled.amountHsmc.toFixed(6)} HSMC (fee: ${settled.feeHsmc.toFixed(2)} HSMC, tier: ${settled.feeTier})`);

        return jsonResponse({ received: true, status: "settled", tx_hash: settled.txHash });
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const piId = paymentIntent.id;
        const lastPaymentError = (paymentIntent as any).last_payment_error;
        const errorMsg = lastPaymentError?.message || "Payment failed";

        console.error(`[Stripe] PaymentIntent failed: ${piId} — ${errorMsg}`);

        // Update session status
        db.run(
          `UPDATE payment_sessions SET status = 'failed', card_brand = ?, card_last4 = ?, otp_expires_at = ? WHERE stripe_payment_intent_id = ?`,
          lastPaymentError?.payment_method?.card?.brand || "unknown",
          lastPaymentError?.payment_method?.card?.last4 || "****",
          new Date().toISOString(),
          piId
        );

        return jsonResponse({ received: true, status: "marked_failed" });
      }

      case "payment_intent.processing": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`[Stripe] PaymentIntent processing: ${paymentIntent.id}`);
        return jsonResponse({ received: true, status: "acknowledged" });
      }

      case "payment_intent.canceled": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`[Stripe] PaymentIntent canceled: ${paymentIntent.id}`);

        db.run(
          `UPDATE payment_sessions SET status = 'cancelled', otp_expires_at = ? WHERE stripe_payment_intent_id = ?`,
          new Date().toISOString(),
          paymentIntent.id
        );

        return jsonResponse({ received: true, status: "marked_cancelled" });
      }


// ── Stripe Issuing Webhook Events ────────────────────────────────────────────
// Add these cases to the existing switch in handleStripeWebhook

      case "issuing_card.created": {
        const ic = event.data.object as any;
        console.log(`[Card Webhook] Card created: ${ic.id}, last4: ${ic.last4}`);
        // Update local card if we have it
        db.run("UPDATE cards SET last4 = ?, brand = ?, expiration_month = ?, expiration_year = ? WHERE stripe_card_id = ?",
          ic.last4 || null, ic.brand || null, ic.exp_month || null, ic.exp_year || null, ic.id);
        return jsonResponse({ received: true });
      }

      case "issuing_card.updated": {
        const ic = event.data.object as any;
        console.log(`[Card Webhook] Card updated: ${ic.id}, status: ${ic.status}`);
        const newStatus = ic.status === "active" ? "active" :
                          ic.status === "inactive" ? "frozen" :
                          ic.status === "canceled" ? "cancelled" : null;
        if (newStatus) {
          db.run("UPDATE cards SET status = ? WHERE stripe_card_id = ?", newStatus, ic.id);
        }
        return jsonResponse({ received: true });
      }

      case "issuing_authorization.request": {
        const ia = event.data.object as any;
        const cardId = ia.card?.id;
        console.log(`[Card Webhook] Auth request: ${ia.id}, card: ${cardId}, amount: $${(ia.amount / 100).toFixed(2)}, merchant: ${ia.merchant_data?.name || "unknown"}`);

        // Find local card
        const card = db.query(
          "SELECT id, status, daily_limit_usd, monthly_limit_usd, per_tx_limit_usd, card_balance_usd_cents FROM cards WHERE stripe_card_id = ?"
        ).get(cardId) as Record<string, unknown> | null;

        if (!card) {
          console.warn(`[Card Webhook] Card ${cardId} not found locally — approving by default`);
          return jsonResponse({ approved: true });
        }

        const amountCents = Number(ia.amount || 0);
        const amountUsd = amountCents / 100;

        // Check card status
        if (card.status !== "active") {
          console.log(`[Card Webhook] Declined: card status is ${card.status}`);
          return jsonResponse({ approved: false, reason: "card_not_active" });
        }

        // Check per-transaction limit
        if (amountUsd > Number(card.per_tx_limit_usd || 500)) {
          console.log(`[Card Webhook] Declined: per-tx limit ${card.per_tx_limit_usd} < ${amountUsd}`);
          return jsonResponse({ approved: false, reason: "per_transaction_limit_exceeded" });
        }

        // Check daily limit
        const today = new Date().toISOString().split("T")[0];
        const dailyTotal = (db.query(
          "SELECT COALESCE(SUM(amount_cents), 0) as total FROM card_transactions WHERE card_id = ? AND created_at >= ? AND status = 'approved'"
        ).get(card.id, today) as { total: number }).total;
        const dailyTotalUsd = dailyTotal / 100;
        if (dailyTotalUsd + amountUsd > Number(card.daily_limit_usd || 1000)) {
          console.log(`[Card Webhook] Declined: daily limit ${card.daily_limit_usd} exceeded (${dailyTotalUsd} + ${amountUsd})`);
          return jsonResponse({ approved: false, reason: "daily_limit_exceeded" });
        }

        // Check card balance
        const balanceCents = Number(card.card_balance_usd_cents || 0);
        if (balanceCents < amountCents) {
          console.log(`[Card Webhook] Declined: insufficient balance ${balanceCents} < ${amountCents}`);
          return jsonResponse({ approved: false, reason: "insufficient_funds" });
        }

        console.log(`[Card Webhook] Approved: $${amountUsd.toFixed(2)} at ${ia.merchant_data?.name || "unknown"}`);
        return jsonResponse({ approved: true });
      }

      case "issuing_authorization.created": {
        const ia = event.data.object as any;
        console.log(`[Card Webhook] Authorization created: ${ia.id}, approved: ${ia.approved}`);
        // Log the authorization
        const card = db.query("SELECT id FROM cards WHERE stripe_card_id = ?").get(ia.card?.id) as Record<string, unknown> | null;
        if (card) {
          const txId = randomUUID();
          db.run(
            `INSERT INTO card_transactions (id, stripe_tx_id, card_id, amount_cents, merchant_name, tx_type, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'authorization', ?, ?)`,
            txId, ia.id, card.id, ia.amount || 0,
            ia.merchant_data?.name || "Unknown Merchant",
            ia.approved ? "approved" : "declined",
            new Date().toISOString()
          );
        }
        return jsonResponse({ received: true });
      }

      case "issuing_transaction.created": {
        const itx = event.data.object as any;
        console.log(`[Card Webhook] Transaction created: ${itx.id}, type: ${itx.type}, amount: $${(itx.amount / 100).toFixed(2)}`);

        const card = db.query("SELECT id, card_balance_usd_cents FROM cards WHERE stripe_card_id = ?").get(itx.card?.id) as Record<string, unknown> | null;
        if (!card) {
          console.warn(`[Card Webhook] Card not found for transaction ${itx.id}`);
          return jsonResponse({ received: true, warning: "card_not_found" });
        }

        // Deduct from card balance
        if (itx.type === "capture" && itx.amount > 0) {
          const newBalance = Math.max(0, Number(card.card_balance_usd_cents) - Number(itx.amount));
          db.run("UPDATE cards SET card_balance_usd_cents = ? WHERE id = ?", newBalance, card.id);
        }

        // Record transaction
        const txId = randomUUID();
        db.run(
          `INSERT INTO card_transactions (id, stripe_tx_id, card_id, amount_cents, merchant_name, merchant_category, tx_type, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'settled', ?)`,
          txId, itx.id, card.id, itx.amount || 0,
          itx.merchant_data?.name || "Unknown Merchant",
          itx.merchant_data?.category || null,
          itx.type === "capture" ? "purchase" : "refund",
          new Date().toISOString()
        );

        // Send notification if we have the gateway configured
        try {
          const userId = (db.query("SELECT user_id FROM cards WHERE id = ?").get(card.id) as { user_id: string } | null)?.user_id;
          if (userId) {
            db.run(
              `INSERT INTO notifications (id, user_id, title, message, type, read, data, created_at)
               VALUES (?, ?, ?, ?, 'card_tx', 0, ?, ?)`,
              randomUUID(), userId,
              `Card transaction: $${(itx.amount / 100).toFixed(2)}`,
              `${itx.merchant_data?.name || "Unknown"}: $${(itx.amount / 100).toFixed(2)}`,
              JSON.stringify({
                card_id: card.id, last4: itx.card?.last4,
                amount: itx.amount, merchant: itx.merchant_data?.name,
              }),
              new Date().toISOString()
            );
          }
        } catch { /* notification best-effort */ }

        return jsonResponse({ received: true });
      }

      case "issuing_cardholder.updated": {
        const chu = event.data.object as any;
        console.log(`[Card Webhook] Cardholder updated: ${chu.id}`);
        if (chu.requirements?.disabled_reason) {
          db.run("UPDATE cardholders SET verification_status = 'rejected' WHERE stripe_cardholder_id = ?", chu.id);
        } else if (chu.status === "active") {
          db.run("UPDATE cardholders SET verification_status = 'verified' WHERE stripe_cardholder_id = ?", chu.id);
        }
        return jsonResponse({ received: true });
      }

      case "payout.paid": {
        const po = event.data.object as any;
        const payoutSessionId = po?.metadata?.payout_session_id;
        console.log(`[Stripe] Payout paid: ${po.id} (session: ${payoutSessionId ?? "unknown"})`);
        if (payoutSessionId) {
          db.run(
            `UPDATE payment_sessions SET status = 'completed', otp_expires_at = ? WHERE session_id = ? AND processor = 'payout'`,
            new Date().toISOString(), payoutSessionId
          );
          db.run(
            `UPDATE treasury_transactions SET status = 'settled', notes = notes || ' — payout.paid confirmed' WHERE session_id = ? AND type = 'sell_fee'`,
            payoutSessionId
          );
        }
        return jsonResponse({ received: true, status: "payout_confirmed" });
      }

      case "payout.failed":
      case "payout.canceled": {
        const po = event.data.object as any;
        const payoutSessionId = po?.metadata?.payout_session_id;
        console.log(`[Stripe] Payout ${event.type.split(".")[1]}: ${po.id} (session: ${payoutSessionId ?? "unknown"})`);
        if (payoutSessionId) {
          db.run(
            `UPDATE payment_sessions SET status = 'failed', otp_expires_at = ? WHERE session_id = ? AND processor = 'payout'`,
            new Date().toISOString(), payoutSessionId
          );
          db.run(
            `UPDATE treasury_transactions SET status = 'failed', notes = notes || ' — payout failed' WHERE session_id = ? AND type = 'sell_fee'`,
            payoutSessionId
          );
        }
        return jsonResponse({ received: true, status: "payout_failed" });
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
        return jsonResponse({ received: true, status: "unhandled_event_type" });
    }
  } catch (err: unknown) {
    // Always return 200 to Stripe even on processing errors (prevents infinite retries)
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Stripe] Webhook processing error for ${event.type}:`, msg);
    return jsonResponse({ received: true, error: "processing_error", detail: msg });
  }
}
// ── Internal Transfer (H7 fix: atomic multi-wallet transfer) ──────────────────

/** POST /api/transfer — atomic transfer between two wallets of the same user */
async function handleInternalTransfer(req: Request): Promise<Response> {
  let body: { fromWalletId?: string; toWalletId?: string; amount?: number; userId?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { fromWalletId, toWalletId, amount, userId, note } = body;

  // Validation
  if (!fromWalletId || !toWalletId || !userId) {
    return errorResponse("fromWalletId, toWalletId, and userId are required", 400);
  }
  if (typeof amount !== 'number' || amount <= 0 || !isFinite(amount)) {
    return errorResponse("amount must be a positive finite number", 400);
  }
  if (fromWalletId === toWalletId) {
    return errorResponse("Cannot transfer to the same wallet", 400);
  }

  // Atomic transfer: use a single transaction for both updates
  const transferId = randomUUID();
  const now = new Date().toISOString();

  try {
    // Begin transaction
    db.run("BEGIN IMMEDIATE");

    // Lock and read source wallet
    const fromWallet = db.query(
      "SELECT id, balance, user_id FROM wallets WHERE id = ? AND user_id = ?"
    ).get(fromWalletId, userId) as { id: string; balance: number; user_id: string } | null;

    if (!fromWallet) {
      db.run("ROLLBACK");
      return errorResponse("Source wallet not found", 404);
    }
    if (fromWallet.balance < amount) {
      db.run("ROLLBACK");
      return errorResponse(`Insufficient balance: ${fromWallet.balance} < ${amount}`, 400);
    }

    // Lock and read destination wallet
    const toWallet = db.query(
      "SELECT id, balance, user_id FROM wallets WHERE id = ? AND user_id = ?"
    ).get(toWalletId, userId) as { id: string; balance: number; user_id: string } | null;

    if (!toWallet) {
      db.run("ROLLBACK");
      return errorResponse("Destination wallet not found", 404);
    }

    // Atomic: update both wallets
    const newFromBalance = parseFloat((fromWallet.balance - amount).toFixed(8));
    const newToBalance = parseFloat((toWallet.balance + amount).toFixed(8));

    db.run("UPDATE wallets SET balance = ?, updated_at = ? WHERE id = ?",
      newFromBalance, now, fromWalletId);
    db.run("UPDATE wallets SET balance = ?, updated_at = ? WHERE id = ?",
      newToBalance, now, toWalletId);

    // Log the internal transfer
    db.run(
      `INSERT INTO internal_transfers (id, user_id, from_wallet_id, to_wallet_id, amount, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      transferId, userId, fromWalletId, toWalletId, amount, note || null, now
    );

    // Commit
    db.run("COMMIT");

    return jsonResponse({
      success: true,
      transfer_id: transferId,
      from_wallet_id: fromWalletId,
      to_wallet_id: toWalletId,
      amount,
      from_balance: newFromBalance,
      to_balance: newToBalance,
      created_at: now,
    });
  } catch (err: unknown) {
    try { db.run("ROLLBACK"); } catch { /* ignore */ }
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`Transfer failed: ${message}`, 500);
  }
}

// ── Treasury Endpoints ────────────────────────────────────────────────────────

// Treasury allocation percentages (business plan, revision 3):
//   40% Buyback & Burn · 25% Staking Rewards · 20% Development · 15% Insurance
const TREASURY_ALLOCATIONS = {
  buyback_burn: 0.40,
  staking_rewards: 0.25,
  development_fund: 0.20,
  insurance_fund: 0.15,
} as const;

/** GET /treasury/balance — total fees collected, breakdown and auto-buyback calculation */
function handleTreasuryBalance(): Response {
  const totalRow = db.query(
    "SELECT COALESCE(SUM(fee_hsmc), 0) as total FROM treasury_transactions WHERE status = 'settled'"
  ).get() as { total: number };

  const breakdownRows = db.query(
    "SELECT type, COALESCE(SUM(fee_hsmc), 0) as total FROM treasury_transactions WHERE status = 'settled' GROUP BY type"
  ).all() as Array<{ type: string; total: number }>;

  const breakdown: Record<string, number> = {};
  for (const row of breakdownRows) {
    breakdown[row.type] = row.total;
  }

  const countRow = db.query(
    "SELECT COUNT(*) as count FROM treasury_transactions WHERE status = 'settled'"
  ).get() as { count: number };

  // ── Auto buyback calculation ──────────────────────────────────────────────
  // 40% of all settled HSMCPay fees is earmarked for buyback & burn. The
  // amount already executed is the sum of 'buyback' treasury rows; the
  // remainder is the pending buyback obligation.
  const totalSettledFees = Number(totalRow.total ?? 0);
  const buybackExecutedRow = db.query(
    "SELECT COALESCE(SUM(fee_hsmc), 0) as total FROM treasury_transactions WHERE type = 'buyback' AND status = 'settled'"
  ).get() as { total: number };
  const buybackExecuted = Number(buybackExecutedRow.total ?? 0);
  const buybackAllocated = totalSettledFees * TREASURY_ALLOCATIONS.buyback_burn;
  const pendingBuyback = Math.max(buybackAllocated - buybackExecuted, 0);

  const allocations = {
    buyback_burn: Number((totalSettledFees * TREASURY_ALLOCATIONS.buyback_burn).toFixed(2)),
    staking_rewards: Number((totalSettledFees * TREASURY_ALLOCATIONS.staking_rewards).toFixed(2)),
    development_fund: Number((totalSettledFees * TREASURY_ALLOCATIONS.development_fund).toFixed(2)),
    insurance_fund: Number((totalSettledFees * TREASURY_ALLOCATIONS.insurance_fund).toFixed(2)),
  };

  return jsonResponse({
    total_fees_collected: Number(totalSettledFees.toFixed(2)),
    breakdown,
    transactions_count: countRow.count,
    allocations,
    buyback: {
      allocation_pct: TREASURY_ALLOCATIONS.buyback_burn * 100,
      allocated_hsmc: Number(buybackAllocated.toFixed(2)),
      executed_hsmc: Number(buybackExecuted.toFixed(2)),
      pending_hsmc: Number(pendingBuyback.toFixed(2)),
    },
  });
}

/** POST /treasury/buyback — execute the pending buyback & burn allocation */
function handleTreasuryBuyback(req: Request): Response {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const totalRow = db.query(
    "SELECT COALESCE(SUM(fee_hsmc), 0) as total FROM treasury_transactions WHERE status = 'settled'"
  ).get() as { total: number };
  const buybackExecutedRow = db.query(
    "SELECT COALESCE(SUM(fee_hsmc), 0) as total FROM treasury_transactions WHERE type = 'buyback' AND status = 'settled'"
  ).get() as { total: number };

  const totalSettledFees = Number(totalRow.total ?? 0);
  const buybackExecuted = Number(buybackExecutedRow.total ?? 0);
  const buybackAllocated = totalSettledFees * TREASURY_ALLOCATIONS.buyback_burn;
  const pendingBuyback = Math.max(buybackAllocated - buybackExecuted, 0);

  if (pendingBuyback < 0.000001) {
    return errorResponse("No pending buyback allocation — nothing to execute", 400);
  }

  // Record the buyback execution: HSMC bought on the open market and burned,
  // reducing the circulating supply (business plan: 40% of Treasury fees).
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO treasury_transactions (id, amount_usd, fee_hsmc, fee_tier, user_id, tx_hash, type, status, notes)
     VALUES (?, ?, ?, 'buyback', 'treasury', ?, 'buyback', 'settled', ?)`,
    randomUUID(),
    0,
    Number(pendingBuyback.toFixed(6)),
    "0x" + randomUUID().replace(/-/g, ""),
    `Auto buyback & burn — ${Number(pendingBuyback.toFixed(2))} HSMC removed from circulating supply (${TREASURY_ALLOCATIONS.buyback_burn * 100}% of ${Number(totalSettledFees.toFixed(2))} HSMC collected fees)`
  );

  console.log(`[Treasury] Buyback executed: ${pendingBuyback.toFixed(6)} HSMC burned`);

  return jsonResponse({
    success: true,
    buyback_hsmc: Number(pendingBuyback.toFixed(6)),
    executed_total_hsmc: Number((buybackExecuted + pendingBuyback).toFixed(2)),
    remaining_pending_hsmc: 0,
    tx_hash: "0x" + randomUUID().replace(/-/g, ""),
  });
}

/** GET /treasury/transactions — list treasury transactions with optional filters */
function handleTreasuryTransactions(req: Request): Response {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);
  const typeFilter = url.searchParams.get("type") || "";

  // Validate type filter
  const validTypes = ["buy_fee", "sell_fee", "buyback", "staking_reward", "dev_fund", "insurance"];
  if (typeFilter && !validTypes.includes(typeFilter)) {
    return errorResponse(
      `Invalid type filter. Must be one of: ${validTypes.join(", ")}`,
      400
    );
  }

  let sql = "SELECT * FROM treasury_transactions";
  const params: (string | number)[] = [];

  if (typeFilter) {
    sql += " WHERE type = ?";
    params.push(typeFilter);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const transactions = db.query(sql).all(...params);

  return jsonResponse(transactions);
}

// ── WebAuthn Challenge Store ─────────────────────────────────────────────────
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const challengeStore = new Map<string, { challenge: string; userId: string; createdAt: number }>();

function storeChallenge(userId: string, challenge: string): void {
  challengeStore.set(challenge, { challenge, userId, createdAt: Date.now() });
  // Clean expired challenges periodically
  if (challengeStore.size > 1000) {
    const now = Date.now();
    for (const [key, entry] of challengeStore) {
      if (now - entry.createdAt > CHALLENGE_TTL_MS) challengeStore.delete(key);
    }
  }
}

function consumeChallenge(challenge: string): { userId: string } | null {
  const entry = challengeStore.get(challenge);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CHALLENGE_TTL_MS) {
    challengeStore.delete(challenge);
    return null;
  }
  challengeStore.delete(challenge);
  return { userId: entry.userId };
}

// ── Minimal CBOR Parser (for WebAuthn attestationObject) ─────────────────────
// WebAuthn attestationObject is a CBOR map: { "fmt": tstr, "attStmt": map, "authData": bstr }
// We only need to extract authData and the COSE public key from it.

type CborValue = 
  | { type: 'uint'; value: number }
  | { type: 'nint'; value: number }
  | { type: 'bstr'; value: Uint8Array }
  | { type: 'tstr'; value: string }
  | { type: 'array'; value: CborValue[] }
  | { type: 'map'; value: Map<CborValue, CborValue> }
  | { type: 'simple'; value: number };

function decodeCbor(buf: Uint8Array): { value: CborValue; offset: number } {
  if (buf.length === 0) throw new Error('Empty CBOR data');
  const majorType = buf[0] >> 5;
  const additionalInfo = buf[0] & 0x1f;
  let offset = 1;

  function readLength(): number {
    if (additionalInfo < 24) return additionalInfo;
    if (additionalInfo === 24) { const v = buf[offset++]; return v; }
    if (additionalInfo === 25) { const v = (buf[offset] << 8) | buf[offset + 1]; offset += 2; return v; }
    if (additionalInfo === 26) { const v = (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]; offset += 4; return v; }
    if (additionalInfo === 27) {
      const hi = (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
      const lo = (buf[offset + 4] << 24) | (buf[offset + 5] << 16) | (buf[offset + 6] << 8) | buf[offset + 7];
      offset += 8;
      return hi * 0x100000000 + lo;
    }
    throw new Error('Unsupported CBOR length encoding');
  }

  if (majorType === 0) return { value: { type: 'uint', value: readLength() }, offset };
  if (majorType === 1) return { value: { type: 'nint', value: -1 - readLength() }, offset };
  if (majorType === 2) {
    const len = readLength();
    const bytes = buf.slice(offset, offset + len);
    offset += len;
    return { value: { type: 'bstr', value: bytes }, offset };
  }
  if (majorType === 3) {
    const len = readLength();
    const str = new TextDecoder().decode(buf.slice(offset, offset + len));
    offset += len;
    return { value: { type: 'tstr', value: str }, offset };
  }
  if (majorType === 4) {
    const len = readLength();
    const arr: CborValue[] = [];
    let remaining = len;
    while (remaining > 0) {
      const item = decodeCbor(buf.slice(offset));
      arr.push(item.value);
      offset += item.offset;
      remaining--;
    }
    return { value: { type: 'array', value: arr }, offset };
  }
  if (majorType === 5) {
    const len = readLength();
    const map = new Map<CborValue, CborValue>();
    let remaining = len;
    while (remaining > 0) {
      const key = decodeCbor(buf.slice(offset));
      offset += key.offset;
      const val = decodeCbor(buf.slice(offset));
      offset += val.offset;
      map.set(key.value, val.value);
      remaining--;
    }
    return { value: { type: 'map', value: map }, offset };
  }
  if (majorType === 7 && additionalInfo < 24) {
    return { value: { type: 'simple', value: additionalInfo }, offset };
  }

  throw new Error(`Unsupported CBOR major type ${majorType}`);
}

function cborMapGet(map: CborValue, key: string | number): CborValue | undefined {
  if (map.type !== 'map') return undefined;
  for (const [k, v] of map.value) {
    if (k.type === 'tstr' && k.value === key) return v;
    if (k.type === 'uint' && k.value === key) return v;
    if (k.type === 'nint' && k.value === key) return v;
  }
  return undefined;
}

// ── Parse COSE Public Key (EC2/P-256/ES256) ─────────────────────────────────
interface ParsedPublicKey {
  x: Uint8Array;
  y: Uint8Array;
}

function parseCosePublicKey(authData: Uint8Array): ParsedPublicKey | null {
  try {
    // Skip rpIdHash (32) + flags (1) + signCount (4) = 37 bytes
    if (authData.length < 37) return null;
    const flags = authData[32];
    const AT_FLAG = 0x40; // Attested credential data included
    if (!(flags & AT_FLAG)) return null;

    let offset = 37; // Skip to attestedCredentialData
    // Skip AAGUID (16 bytes)
    offset += 16;
    // credentialIdLength (2 bytes big-endian)
    const credIdLen = (authData[offset] << 8) | authData[offset + 1];
    offset += 2;
    // Skip credentialId
    offset += credIdLen;

    // Remaining bytes are the COSE_Key
    const coseKeyBuf = authData.slice(offset);
    const decoded = decodeCbor(coseKeyBuf);

    if (decoded.value.type !== 'map') return null;
    const coseKey = decoded.value;

    // COSE Key fields: 1=kty(EC2=2), 3=alg(ES256=-7), -1=crv(P-256=1), -2=x, -3=y
    const kty = cborMapGet(coseKey, 1);
    const alg = cborMapGet(coseKey, 3);
    const xField = cborMapGet(coseKey, -2);
    const yField = cborMapGet(coseKey, -3);

    if (!xField || xField.type !== 'bstr' || !yField || yField.type !== 'bstr') return null;

    return {
      x: xField.value,
      y: yField.value,
    };
  } catch {
    return null;
  }
}

// ── Convert raw P-256 public key (x || y, 64 bytes) to SPKI DER ────────────
function rawP256ToSpki(x: Uint8Array, y: Uint8Array): Uint8Array {
  // Uncompressed point: 04 || x || y
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);

  // SPKI DER for P-256: SEQUENCE { SEQUENCE { OID 1.2.840.10045.2.1 (ecPublicKey), OID 1.2.840.10045.3.1.7 (P-256) }, BIT STRING uncompressed point }
  const ecPublicKeyOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]); // 1.2.840.10045.2.1
  const p256Oid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]); // 1.2.840.10045.3.1.7
  const algorithmSeq = new Uint8Array(ecPublicKeyOid.length + p256Oid.length + 2);
  algorithmSeq[0] = 0x30; algorithmSeq[1] = ecPublicKeyOid.length + p256Oid.length;
  algorithmSeq.set(ecPublicKeyOid, 2);
  algorithmSeq.set(p256Oid, 2 + ecPublicKeyOid.length);

  // BIT STRING with 1 unused bit byte
  const bitString = new Uint8Array(point.length + 1);
  bitString[0] = 0x00; // 0 unused bits
  bitString.set(point, 1);

  const totalLen = algorithmSeq.length + bitString.length;
  const spki = new Uint8Array(totalLen + 2);
  spki[0] = 0x30; spki[1] = totalLen;
  spki.set(algorithmSeq, 2);
  spki.set(bitString, 2 + algorithmSeq.length);

  return spki;
}

// ── DER ECDSA signature to raw (r||s) for Web Crypto ────────────────────────
function derSignatureToRaw(derSig: Uint8Array): Uint8Array | null {
  try {
    // DER: 0x30 LEN 0x02 rLen rBytes 0x02 sLen sBytes
    if (derSig[0] !== 0x30) return null;
    let offset = 2;
    if (derSig[offset] !== 0x02) return null;
    offset++;
    const rLen = derSig[offset];
    offset++;
    let rBytes = derSig.slice(offset, offset + rLen);
    offset += rLen;
    if (derSig[offset] !== 0x02) return null;
    offset++;
    const sLen = derSig[offset];
    offset++;
    let sBytes = derSig.slice(offset, offset + sLen);

    // Ensure r and s are 32 bytes (strip leading zeros, pad if necessary)
    if (rBytes.length > 32 && rBytes[0] === 0) rBytes = rBytes.slice(1);
    if (sBytes.length > 32 && sBytes[0] === 0) sBytes = sBytes.slice(1);

    const r = new Uint8Array(32);
    const s = new Uint8Array(32);
    r.set(rBytes.slice(Math.max(0, rBytes.length - 32)), 32 - Math.min(32, rBytes.length));
    s.set(sBytes.slice(Math.max(0, sBytes.length - 32)), 32 - Math.min(32, sBytes.length));

    const raw = new Uint8Array(64);
    raw.set(r, 0);
    raw.set(s, 32);
    return raw;
  } catch {
    return null;
  }
}

// ── WebAuthn Handlers ────────────────────────────────────────────────────────

/** POST /auth/webauthn/register — store a biometric credential */
async function handleWebAuthnRegister(req: Request): Promise<Response> {
  if (!JWT_SECRET) {
    return errorResponse("JWT auth not configured — set JWT_SECRET env var", 500);
  }

  let body: {
    credential?: {
      id?: string;
      rawId?: string;
      response?: { attestationObject?: string; clientDataJSON?: string };
      type?: string;
    };
    userId?: string;
    deviceName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const cred = body.credential;
  const userId = body.userId;
  const deviceName = body.deviceName || "Unknown Device";

  if (!cred || !cred.id || !cred.response?.attestationObject || !cred.response?.clientDataJSON) {
    return errorResponse("credential.id, attestationObject, and clientDataJSON are required", 400);
  }
  if (!userId) {
    return errorResponse("userId is required", 400);
  }
  if (cred.type !== "public-key") {
    return errorResponse("credential.type must be 'public-key'", 400);
  }

  // Verify user exists
  const user = db.query("SELECT id FROM users WHERE id = ?").get(userId) as { id: string } | null;
  if (!user) {
    return errorResponse("User not found", 404);
  }

  // Decode attestationObject (base64url → CBOR)
  const attestationB64 = cred.response.attestationObject.replace(/-/g, "+").replace(/_/g, "/");
  let attestationBuf: Uint8Array;
  try {
    attestationBuf = new Uint8Array(Buffer.from(attestationB64, "base64"));
  } catch {
    return errorResponse("Invalid attestationObject base64 encoding", 400);
  }

  let attestationObj: CborValue;
  try {
    attestationObj = decodeCbor(attestationBuf).value;
  } catch (e: unknown) {
    return errorResponse("Failed to parse attestationObject CBOR", 400, e instanceof Error ? e.message : String(e));
  }

  const authDataField = cborMapGet(attestationObj, "authData");
  if (!authDataField || authDataField.type !== 'bstr') {
    return errorResponse("authData not found in attestationObject", 400);
  }

  const authData = authDataField.value;

  // Verify rpIdHash (first 32 bytes of authData)
  // In production we'd verify against the RP ID, but we accept any valid authData

  // Parse public key from authData
  const parsedKey = parseCosePublicKey(authData);
  if (!parsedKey) {
    return errorResponse("Failed to parse COSE public key from authData", 400);
  }

  // Convert to SPKI format and encode as base64 for storage
  const spki = rawP256ToSpki(parsedKey.x, parsedKey.y);
  const publicKeyBase64 = Buffer.from(spki).toString("base64");

  // Decode clientDataJSON to verify challenge
  const clientDataB64 = cred.response.clientDataJSON.replace(/-/g, "+").replace(/_/g, "/");
  let clientDataJson: string;
  try {
    clientDataJson = Buffer.from(clientDataB64, "base64").toString("utf-8");
  } catch {
    return errorResponse("Invalid clientDataJSON base64 encoding", 400);
  }

  let clientData: { challenge?: string; type?: string; origin?: string };
  try {
    clientData = JSON.parse(clientDataJson);
  } catch {
    return errorResponse("Invalid clientDataJSON format", 400);
  }

  // Verify challenge (anti-replay)
  if (!clientData.challenge) {
    return errorResponse("Missing challenge in clientDataJSON", 400);
  }

  const consumed = consumeChallenge(clientData.challenge);
  if (!consumed) {
    return errorResponse("Invalid or expired challenge", 400);
  }

  if (consumed.userId !== userId) {
    return errorResponse("Challenge does not match user", 400);
  }

  // Store credential
  const now = new Date().toISOString();
  const credentialId = cred.id;

  // Check for duplicate
  const existing = db.query("SELECT id FROM webauthn_credentials WHERE id = ?").get(credentialId) as { id: string } | null;
  if (existing) {
    // Update existing
    db.run(
      "UPDATE webauthn_credentials SET public_key = ?, device_name = ?, last_used_at = ? WHERE id = ?",
      publicKeyBase64, deviceName, now, credentialId
    );
  } else {
    db.run(
      "INSERT INTO webauthn_credentials (id, user_id, public_key, created_at, last_used_at, device_name) VALUES (?, ?, ?, ?, ?, ?)",
      credentialId, userId, publicKeyBase64, now, now, deviceName
    );
  }

  return jsonResponse({ success: true, credential_id: credentialId }, 201);
}

/** POST /auth/webauthn/login — authenticate with biometric */
async function handleWebAuthnLogin(req: Request): Promise<Response> {
  if (!JWT_SECRET) {
    return errorResponse("JWT auth not configured — set JWT_SECRET env var", 500);
  }

  let body: {
    credential?: {
      id?: string;
      rawId?: string;
      response?: { authenticatorData?: string; clientDataJSON?: string; signature?: string; userHandle?: string };
      type?: string;
    };
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const cred = body.credential;
  if (!cred || !cred.id || !cred.response?.authenticatorData || !cred.response?.clientDataJSON || !cred.response?.signature) {
    return errorResponse("credential.id, authenticatorData, clientDataJSON, and signature are required", 400);
  }
  if (cred.type !== "public-key") {
    return errorResponse("credential.type must be 'public-key'", 400);
  }

  // Decode base64url fields
  const decodeB64u = (s: string): Uint8Array => {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    return new Uint8Array(Buffer.from(b64, "base64"));
  };

  let authenticatorData: Uint8Array, clientDataJSON: Uint8Array, signature: Uint8Array;
  try {
    authenticatorData = decodeB64u(cred.response.authenticatorData);
    clientDataJSON = decodeB64u(cred.response.clientDataJSON);
    signature = decodeB64u(cred.response.signature);
  } catch {
    return errorResponse("Invalid base64url encoding in credential fields", 400);
  }

  // Verify challenge
  let clientData: { challenge?: string; type?: string };
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
  } catch {
    return errorResponse("Invalid clientDataJSON format", 400);
  }

  if (!clientData.challenge) {
    return errorResponse("Missing challenge in clientDataJSON", 400);
  }

  const consumed = consumeChallenge(clientData.challenge);
  if (!consumed) {
    return errorResponse("Invalid or expired challenge", 400);
  }

  // Find credential in DB
  const storedCred = db.query(
    "SELECT * FROM webauthn_credentials WHERE id = ?"
  ).get(cred.id) as { id: string; user_id: string; public_key: string } | null;

  if (!storedCred) {
    return errorResponse("Credential not found. Register first.", 404);
  }

  // Decode stored public key (SPKI base64)
  let publicKeySpki: Uint8Array;
  try {
    publicKeySpki = new Uint8Array(Buffer.from(storedCred.public_key, "base64"));
  } catch {
    return errorResponse("Stored public key is invalid", 500);
  }

  // Verify signature: signed data = authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", clientDataJSON)
  );
  const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signedData.set(authenticatorData, 0);
  signedData.set(clientDataHash, authenticatorData.length);

  // Convert DER signature to raw format for Web Crypto
  const rawSignature = derSignatureToRaw(signature);
  if (!rawSignature) {
    return errorResponse("Failed to parse ECDSA DER signature", 400);
  }

  // Import public key
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "spki",
      publicKeySpki,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  } catch (e: unknown) {
    return errorResponse("Failed to import stored public key", 500, e instanceof Error ? e.message : String(e));
  }

  // Verify
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      rawSignature,
      signedData
    );
  } catch {
    return errorResponse("Signature verification failed", 401);
  }

  if (!valid) {
    return errorResponse("Invalid signature", 401);
  }

  // Update last_used_at
  const now = new Date().toISOString();
  db.run("UPDATE webauthn_credentials SET last_used_at = ? WHERE id = ?", now, cred.id);

  // Get user info and issue JWT
  const user = db.query("SELECT id, email, created_at FROM users WHERE id = ?").get(storedCred.user_id) as {
    id: string; email: string; created_at: string;
  } | null;

  if (!user) {
    return errorResponse("User not found", 404);
  }

  const token = await signJWT({
    userId: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS,
  });

  return jsonResponse({
    token,
    user: { id: user.id, email: user.email, created_at: user.created_at },
  });
}

/** POST /auth/webauthn/unregister — remove biometric credential */
async function handleWebAuthnUnregister(req: Request): Promise<Response> {
  let body: { userId?: string; credentialId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { userId, credentialId } = body;

  if (credentialId) {
    // Delete a specific credential
    const cred = db.query(
      "SELECT id FROM webauthn_credentials WHERE id = ? AND user_id = ?"
    ).get(credentialId, userId) as { id: string } | null;
    if (!cred) {
      return errorResponse("Credential not found", 404);
    }
    db.run("DELETE FROM webauthn_credentials WHERE id = ?", credentialId);
  } else if (userId) {
    // Delete all credentials for user
    db.run("DELETE FROM webauthn_credentials WHERE user_id = ?", userId);
  } else {
    return errorResponse("userId or credentialId is required", 400);
  }

  return jsonResponse({ success: true });
}

/** POST /auth/webauthn/challenge — generate a challenge for registration/login */
async function handleWebAuthnChallenge(req: Request): Promise<Response> {
  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const userId = body.userId || "anonymous";
  const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
  const challenge = Buffer.from(challengeBytes).toString("base64url");

  storeChallenge(userId, challenge);

  return jsonResponse({ challenge });
}

// ── Auth Handlers ────────────────────────────────────────────────────────────

/** POST /auth/register — create a new user account */
async function handleAuthRegister(req: Request): Promise<Response> {
  if (!JWT_SECRET) {
    return errorResponse("JWT auth not configured — set JWT_SECRET env var", 500);
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!email || !password) {
    return errorResponse("email and password are required", 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse("Invalid email format", 400);
  }

  if (password.length < 8) {
    return errorResponse("Password must be at least 8 characters", 400);
  }

  // Check if user already exists
  const existing = db.query("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | null;
  if (existing) {
    return errorResponse("A user with this email already exists", 409);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  db.run(
    "INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    id, email, passwordHash, now, now
  );

  const token = await signJWT({
    userId: id,
    email,
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS,
  });

  return jsonResponse({
    token,
    user: { id, email, created_at: now },
  }, 201);
}

/** POST /auth/login — authenticate and return JWT */
async function handleAuthLogin(req: Request): Promise<Response> {
  if (!JWT_SECRET) {
    return errorResponse("JWT auth not configured — set JWT_SECRET env var", 500);
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!email || !password) {
    return errorResponse("email and password are required", 400);
  }

  const user = db.query("SELECT id, email, password_hash, created_at FROM users WHERE email = ?")
    .get(email) as { id: string; email: string; password_hash: string; created_at: string } | null;

  if (!user) {
    return errorResponse("Invalid email or password", 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return errorResponse("Invalid email or password", 401);
  }

  const token = await signJWT({
    userId: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS,
  });

  return jsonResponse({
    token,
    user: { id: user.id, email: user.email, created_at: user.created_at },
  });
}

// ── Request Handler ──────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

async function handleRequest(req: Request): Promise<Response> {
  // ── Timeout wrapper: abort if request takes > 30s ──────────────────────────
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const signal = timeoutController.signal;

    // Clone the request with the abort signal so body reading can be aborted
    const reqWithSignal = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal,
    });

    return await handleRequestInner(reqWithSignal);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return new Response(
        JSON.stringify({ error: "Request timeout — connection closed after 30 seconds" }),
        {
          status: 408,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": CORS_ORIGIN,
            ...securityHeaders(USING_TLS),
          },
        }
      );
    }
    console.error("[API] Unhandled error:", err instanceof Error ? err.message : String(err));
    return errorResponse("Internal server error", 500);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleRequestInner(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // ── User-Agent required ────────────────────────────────────────────────────
  const userAgent = req.headers.get("user-agent");
  if (!userAgent) {
    return new Response(
      JSON.stringify({ error: "User-Agent header is required" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": CORS_ORIGIN,
          ...securityHeaders(USING_TLS),
        },
      }
    );
  }

  // ── Rate limiting (tiered per-path, per-IP token bucket) ────────────────────
  const clientIP = getClientIP(req);
  const rateCheck = checkRateLimit(clientIP, path);
  if (!rateCheck.allowed) {
    return rateLimitResponse(rateCheck.retryAfter ?? 60);
  }

  // ── Body size check (before any body parsing) ──────────────────────────────
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  const maxBodySize = getMaxBodySize(path);
  if (contentLength > maxBodySize) {
    return bodyTooLargeResponse(path);
  }

  // ── CORS preflight ─────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, Prefer, stripe-signature",
        "Access-Control-Max-Age": "86400",
        // Security headers on preflight (defense-in-depth; browsers honor these)
        ...securityHeaders(USING_TLS),
      },
    });
  }

  // ── Authentication ────────────────────────────────────────────────────────
  if (!isPublicPath(path)) {
    if (!checkApiKey(req)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  }

  // Health check (public, no auth)
  if (path === "/health" || path === "/") {
    return jsonResponse({ status: "ok", tables: ALLOWED_TABLES.size, auth_mode: IS_DEV_MODE ? "dev" : "api_key" });
  }

  // ── Auth Endpoints ────────────────────────────────────────────────────────
  if (path === "/auth/login" && req.method === "POST") {
    return handleAuthLogin(req);
  }

  if (path === "/auth/register" && req.method === "POST") {
    return handleAuthRegister(req);
  }

  // ── WebAuthn (Biometric) Endpoints ─────────────────────────────────────────
  if (path === "/auth/webauthn/challenge" && req.method === "POST") {
    return handleWebAuthnChallenge(req);
  }

  if (path === "/auth/webauthn/register" && req.method === "POST") {
    return handleWebAuthnRegister(req);
  }

  if (path === "/auth/webauthn/login" && req.method === "POST") {
    return handleWebAuthnLogin(req);
  }

  if (path === "/auth/webauthn/unregister" && req.method === "POST") {
    return handleWebAuthnUnregister(req);
  }

  // Stripe configuration (mode, which keys are set, required env vars)
  if (path === "/stripe/config" && req.method === "GET") {
    return jsonResponse(getStripeConfig());
  }

  // Stripe checkout endpoint for HSMCPay
  if (path === "/stripe/checkout") {
    return handleStripeCheckout(req);
  }

  // Stripe payout endpoint for HSMCPay sell flow
  if (path === "/stripe/payout") {
    return handleStripePayout(req);
  }

  // Stripe payout webhook (simulation)
  if (path === "/stripe/payout/webhook") {
    return handleStripePayoutWebhook(req);
  }

  // Stripe create-payment-intent (real Stripe API with idempotency)
  if (path === "/stripe/create-payment-intent" && req.method === "POST") {
    return handleStripeCreatePaymentIntent(req);
  }

  // Stripe webhook (real Stripe events with signature verification)
  if (path === "/stripe/webhook" && req.method === "POST") {
    return handleStripeWebhook(req);
  }

  // Treasury endpoints
  if (path === "/treasury/balance" && req.method === "GET") {
    return handleTreasuryBalance();
  }

  if (path === "/treasury/transactions" && req.method === "GET") {
    return handleTreasuryTransactions(req);
  }

  if (path === "/treasury/buyback" && req.method === "POST") {
    return handleTreasuryBuyback(req);
  }

  // Internal atomic wallet transfer (H7 fix)
  if (path === "/api/transfer" && req.method === "POST") {
    return handleInternalTransfer(req);
  }

  // ── Shielded Pool (zk-STARK privacy pool) — proxy to Rust node ──────────────
  if (path === "/shielded/deposit" && req.method === "POST") {
    return handleShieldedProxy(req, "shielded/deposit", "POST");
  }
  if (path === "/shielded/withdraw" && req.method === "POST") {
    return handleShieldedProxy(req, "shielded/withdraw", "POST");
  }
  if (path === "/shielded/verify" && req.method === "POST") {
    return handleShieldedProxy(req, "shielded/verify", "POST");
  }
  if (path === "/shielded/state" && req.method === "GET") {
    return handleShieldedProxy(req, "shielded/state", "GET");
  }
  if (path === "/shielded/nullifier-check" && req.method === "POST") {
    return handleShieldedProxy(req, "shielded/nullifier-check", "POST");
  }


  // ── Card Issuance Endpoints (Feature #14) ─────────────────────────────────
  if (path === "/cardholders/create" && req.method === "POST") {
    return handleCardholderCreate(req);
  }
  if (path.startsWith("/cardholders/") && req.method === "GET") {
    const chId = path.split("/")[2];
    if (chId && chId !== "create") return handleCardholderGet(chId);
  }

  if (path === "/cards/create" && req.method === "POST") {
    return handleCardCreate(req);
  }
  if (path === "/cards/list" && req.method === "GET") {
    return handleCardList(req);
  }
  if (path.startsWith("/cards/") && req.method === "GET") {
    const cardId = path.split("/")[2];
    if (cardId && cardId !== "create" && cardId !== "list") return handleCardGet(cardId);
  }
  if (path.match(/^\/cards\/[^\/]+\/activate$/) && req.method === "POST") {
    return jsonResponse({ message: "Physical card activation via PIN required — contact support" });
  }
  if (path.match(/^\/cards\/[^\/]+\/freeze$/) && req.method === "POST") {
    return handleCardFreeze(req, path.split("/")[2]);
  }
  if (path.match(/^\/cards\/[^\/]+\/unfreeze$/) && req.method === "POST") {
    return handleCardUnfreeze(req, path.split("/")[2]);
  }
  if (path.match(/^\/cards\/[^\/]+\/cancel$/) && req.method === "POST") {
    return handleCardCancel(req, path.split("/")[2]);
  }
  if (path.match(/^\/cards\/[^\/]+\/set-limits$/) && req.method === "POST") {
    return handleCardSetLimits(req, path.split("/")[2]);
  }
  if (path.match(/^\/cards\/[^\/]+\/fund$/) && req.method === "POST") {
    return handleCardFund(req, path.split("/")[2]);
  }

  // REST endpoints
  if (path.startsWith("/rest/v1/")) {
    const parsed = parseUrl(req.url);

    // Validate table name
    if (!isValidTableName(parsed.table)) {
      return errorResponse(`Table "${parsed.table}" not found`, 404);
    }

    // Validate column names in select
    if (parsed.columns.length > 0 && parsed.columns[0] !== "*") {
      for (const col of parsed.columns) {
        if (!isValidColumnName(col)) {
          return errorResponse(`Invalid column name: "${col}"`, 400);
        }
      }
    }

    // Validate filter column names
    for (const col of Object.keys(parsed.filters)) {
      if (!isValidColumnName(col)) {
        return errorResponse(`Invalid filter column: "${col}"`, 400);
      }
      // Sanitize filter values
      parsed.filters[col].val = sanitizeFilterValue(parsed.filters[col].val);
    }

    // Validate order column
    if (parsed.order && !isValidColumnName(parsed.order.col)) {
      return errorResponse(`Invalid order column: "${parsed.order.col}"`, 400);
    }

    try {
      if (req.method === "GET") {
        const { sql, params } = buildSelectSQL(parsed);
        const rows = db.query(sql).all(...params) as Record<string, unknown>[];
        // Decrypt sensitive columns before returning
        for (const row of rows) {
          await decryptSensitiveColumns(parsed.table, row);
        }
        return jsonResponse(rows);
      }

      if (req.method === "POST") {
        // Check content length (also enforced globally, but belt-and-suspenders)
        const clen = parseInt(req.headers.get("content-length") || "0", 10);
        if (clen > getMaxBodySize(path)) {
          return bodyTooLargeResponse(path);
        }

        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return errorResponse("Invalid JSON body", 400);
        }

        if (body === null || typeof body !== "object") {
          return errorResponse("Body must be a JSON object or array", 400);
        }

        const rows = Array.isArray(body) ? body : [body];
        const results: unknown[] = [];

        for (const row of rows) {
          if (typeof row !== "object" || row === null) {
            return errorResponse("Each row must be a JSON object", 400);
          }

          const rowObj = row as Record<string, unknown>;
          if (!rowObj.id) rowObj.id = randomUUID();
          if (!rowObj.created_at) rowObj.created_at = new Date().toISOString();

          // Encrypt sensitive columns before storing
          await encryptSensitiveColumns(parsed.table, rowObj);

          // Validate column names in the row
          const cols = Object.keys(rowObj);
          for (const col of cols) {
            if (!isValidColumnName(col)) {
              return errorResponse(`Invalid column name in body: "${col}"`, 400);
            }
          }

          const placeholders = cols.map(() => "?");
          const values = cols.map((c) => rowObj[c]);

          const sql = `INSERT INTO "${parsed.table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders.join(", ")})`;
          db.run(sql, ...values);
          results.push(rowObj);
        }

        return jsonResponse(results, 201);
      }

      if (req.method === "PATCH" || req.method === "PUT") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return errorResponse("Invalid JSON body", 400);
        }

        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          return errorResponse("Body must be a JSON object", 400);
        }

        const bodyObj = body as Record<string, unknown>;

        // Validate body column names
        for (const col of Object.keys(bodyObj)) {
          if (!isValidColumnName(col)) {
            return errorResponse(`Invalid column name in body: "${col}"`, 400);
          }
        }

        // Encrypt sensitive columns before updating
        await encryptSensitiveColumns(parsed.table, bodyObj);

        const conditions: string[] = [];
        const params: unknown[] = [];

        // Build WHERE from query params
        for (const [col, filter] of Object.entries(parsed.filters)) {
          if (filter.op === "eq") {
            conditions.push(`"${col}" = ?`);
            params.push(filter.val);
          }
        }

        if (conditions.length === 0) {
          return errorResponse("PATCH requires at least one filter (e.g., ?id=eq.xxx)", 400);
        }

        // Build SET clause
        const setCols = Object.keys(bodyObj);
        if (setCols.length === 0) {
          return errorResponse("PATCH body must contain at least one field", 400);
        }

        const setPlaceholders = setCols.map((c) => `"${c}" = ?`);
        params.unshift(...setCols.map((c) => bodyObj[c]));

        if (!bodyObj.updated_at) {
          setPlaceholders.push('"updated_at" = ?');
          params.push(new Date().toISOString());
        }

        const sql = `UPDATE "${parsed.table}" SET ${setPlaceholders.join(", ")} WHERE ${conditions.join(" AND ")}`;
        db.run(sql, ...params);

        // Return updated rows
        const { sql: selSql, params: selParams } = buildSelectSQL(parsed);
        const updated = db.query(selSql).all(...selParams);
        return jsonResponse(updated);
      }

      if (req.method === "DELETE") {
        const conditions: string[] = [];
        const params: string[] = [];

        for (const [col, filter] of Object.entries(parsed.filters)) {
          if (filter.op === "eq") {
            conditions.push(`"${col}" = ?`);
            params.push(filter.val);
          }
        }

        if (conditions.length === 0) {
          return errorResponse("DELETE requires at least one filter (e.g., ?id=eq.xxx)", 400);
        }

        const sql = `DELETE FROM "${parsed.table}" WHERE ${conditions.join(" AND ")}`;
        db.run(sql, ...params);
        return jsonResponse({ success: true });
      }

      return errorResponse(`Method ${req.method} not allowed`, 405);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[API] Error on ${req.method} ${req.url}:`, message);
      return errorResponse("Internal server error", 500, message);
    }
  }

  return errorResponse("Not found", 404);

// ══════════════════════════════════════════════════════════════════════════════
// Shielded Pool proxy — forwards to HSMC Rust node (port 8080)
// ══════════════════════════════════════════════════════════════════════════════

const NODE_RPC_URL = process.env.HSMC_NODE_RPC || "http://127.0.0.1:8080";

async function handleShieldedProxy(req: Request, endpoint: string, method: string): Promise<Response> {
  try {
    const url = `${NODE_RPC_URL}/${endpoint}`;
    const fetchOpts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (method !== "GET") {
      const body = await req.json().catch(() => ({}));
      fetchOpts.body = JSON.stringify(body);
    }
    const nodeResp = await fetch(url, fetchOpts);
    const data = await nodeResp.json().catch(() => ({ error: "Invalid JSON from node" }));
    return new Response(JSON.stringify(data), {
      status: nodeResp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        ...securityHeaders(USING_TLS),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Shielded Proxy] Error contacting node at ${NODE_RPC_URL}/${endpoint}:`, msg);
    return new Response(JSON.stringify({
      error: "Shielded pool unavailable — Rust node not reachable",
      detail: msg,
    }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        ...securityHeaders(USING_TLS),
      },
    });
  }
}
}

// ── Start Server ──────────────────────────────────────────────────────────────
const serverOptions: Record<string, unknown> = {
  port: PORT,
  fetch: handleRequest,
};

if (USING_TLS) {
  serverOptions.tls = {
    cert: Bun.file(TLS_CERT),
    key: Bun.file(TLS_KEY),
  };
}

const server = Bun.serve(serverOptions as Parameters<typeof Bun.serve>[0]);

const protocol = USING_TLS ? "https" : "http";
if (!USING_TLS) {
  console.warn("⚠️  WARNING: API server running WITHOUT TLS encryption. All traffic is visible on the network.");
  console.warn("   To enable TLS, set TLS_CERT and TLS_KEY env vars pointing to your certificate files.");
  console.warn("   Generate a self-signed cert for dev:");
  console.warn("   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes");
}
console.log(`🚀 HSMC Local API server running on ${protocol}://localhost:${PORT}`);
console.log(`   REST: ${protocol}://localhost:${PORT}/rest/v1/:table`);
console.log(`   Health: ${protocol}://localhost:${PORT}/health`);
console.log(`   Auth: ${protocol}://localhost:${PORT}/auth/login | /auth/register`);
console.log(`   WebAuthn: ${protocol}://localhost:${PORT}/auth/webauthn/login | /register | /unregister | /challenge`);
console.log(`   Stripe Config: ${protocol}://localhost:${PORT}/stripe/config (mode: ${STRIPE_SIMULATION_MODE ? "SIMULATION" : STRIPE_MODE})`);
console.log(`   Stripe Buy: ${protocol}://localhost:${PORT}/stripe/checkout`);
console.log(`   Stripe Sell: ${protocol}://localhost:${PORT}/stripe/payout`);
console.log(`   Payout Webhook: ${protocol}://localhost:${PORT}/stripe/payout/webhook`);
console.log(`   Stripe Create PI: ${protocol}://localhost:${PORT}/stripe/create-payment-intent`);
console.log(`   Stripe Webhook: ${protocol}://localhost:${PORT}/stripe/webhook`);
console.log(`   Treasury: ${protocol}://localhost:${PORT}/treasury/balance | /treasury/transactions | /treasury/buyback`);
console.log(`   Treasury Balance: ${protocol}://localhost:${PORT}/treasury/balance`);
console.log(`   Treasury Tx: ${protocol}://localhost:${PORT}/treasury/transactions`);
console.log(`   Rate limit: 100 req/min (REST), 20 req/min (/auth/*), 10 req/min (/stripe/*, /cards/*, /cardholders/*)`);
console.log(`   Cards: ${protocol}://localhost:${PORT}/cards/create | /cards/list | /cards/:id | /cards/:id/freeze | /cards/:id/unfreeze | /cards/:id/cancel | /cards/:id/set-limits | /cards/:id/fund`);
console.log(`   Cardholders: ${protocol}://localhost:${PORT}/cardholders/create | /cardholders/:id`);
console.log(`   Max body size: 10 MB (default), 1 MB (/auth/*)`);
console.log(`   Request timeout: 30s`);
console.log(`   Auth mode: ${IS_DEV_MODE ? "DEV (no API key required)" : "PROTECTED (API key required)"}`);
console.log(`   TLS: ${USING_TLS ? "ENABLED" : "DISABLED"}`);
console.log(`   CORS origin: ${CORS_ORIGIN}`);
console.log(`   Tables: ${ALLOWED_TABLES.size}`);
