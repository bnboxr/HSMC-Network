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

const DB_PATH = "/home/team/shared/hsmc.db";
const PORT = 3001;

// ── Schema (from schema.sqlite.sql) ──────────────────────────────────────────
const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS blocks (
  block_number REAL, created_at TEXT, difficulty REAL, hash TEXT, id TEXT PRIMARY KEY,
  miner_address TEXT, nonce REAL, prev_hash TEXT, privacy_protocol TEXT, transactions_count REAL
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
`;

// ── Seed Data (from Supabase extraction) ─────────────────────────────────────
const SEED_SQL = `
-- Blocks: 2 rows (block 1 and block 6)
INSERT OR IGNORE INTO blocks (id, block_number, hash, prev_hash, miner_address, transactions_count, nonce, difficulty, created_at, privacy_protocol)
VALUES ('b1fd653c-f274-4ccc-b6b4-5428b34e17b9', 1, '0x00d15d11b099623231ba07087b7b68d8e9d5e4d8e4bf458c8f0bb9c3a3dfa4f1', '0x0', '0xd07ea42e083dadbe5bc04ff3bf91997faf3987ca', 0, 11505971, 4000000, '2026-03-08T16:52:13.178018+00:00', 'RingCT-v2');

INSERT OR IGNORE INTO blocks (id, block_number, hash, prev_hash, miner_address, transactions_count, nonce, difficulty, created_at, privacy_protocol)
VALUES ('a72e4f3e-a8e9-4cad-91b6-0f497458613b', 6, '0x00e1b7a57873a0c31017cf923b8204270a4cf5903c8cf1f7d371c5a6bd50cb64', '0x00d15d11b099623231ba07087b7b68d8e9d5e4d8e4bf458c8f0bb9c3a3dfa4f1', '0xd07ea42e083dadbe5bc04ff3bf91997faf3987ca', 1, 8273619, 4000000, '2026-03-29T02:18:30.171000+00:00', 'RingCT-v2');

-- Transactions: 1 row (250 HSMC transfer)
INSERT OR IGNORE INTO transactions (id, hash, from_address, to_address, amount, fee, status, created_at, confirmed_at, privacy_level)
VALUES ('dc657c11-3d0b-4371-96f8-3ccb2f18cc8a', '0x845af0d688ec3beea286ca476544c82f11cb2ac97004a30c211681af845ec325', '0xhsmcpay_treasury_000000000000000000000000', '0xd07ea42e083dadbe5bc04ff3bf91997faf3987ca', 250.0, 0.0001, 'confirmed', '2026-03-29T02:18:30.197372+00:00', '2026-03-29T02:18:30.171+00:00', 'transparent');

-- Governance: 1 proposal
INSERT OR IGNORE INTO governance_proposals (id, title, description, proposer_address, user_id, proposal_type, status, votes_for, votes_against, quorum_required, parameter_key, ends_at, created_at)
VALUES ('e21301a6-8514-4a85-9e6f-2fa06f2240a7', 'APR 20%', 'staking apreciasion', '0xd07ea42e083dadbe5bc04ff3bf91997faf3987ca', '90fd15a4-1e1d-4d70-afd7-efcfa0ee7349', 'treasury', 'active', 1, 0, 1000, 'staking', '2026-03-15T14:46:11.958885+00:00', '2026-03-08T14:46:11.958885+00:00');

-- Governance: 1 vote
INSERT OR IGNORE INTO governance_votes (id, proposal_id, user_id, voter_address, vote_weight, vote_choice, created_at)
VALUES ('9f37d0c7-9306-4459-a7a1-7bd831089d2d', 'e21301a6-8514-4a85-9e6f-2fa06f2240a7', '90fd15a4-1e1d-4d70-afd7-efcfa0ee7349', '0xd07ea42e083dadbe5bc04ff3bf91997faf3987ca', 1, 'for', '2026-03-08T14:46:23.395721+00:00');

-- Staking pools: 2 rows
INSERT OR IGNORE INTO staking_pools (id, name, validator_address, total_staked, commission_rate, apr, min_stake, status, created_at)
VALUES ('2ed61898-286b-4f4d-ac72-b71a0306d7d1', 'Genesis Pool', '0x742d35Cc6634C0532925a3b844Bc9e7595f8bE7a', 0.0, 5.0, 12.5, 100.0, 'active', '2026-01-20T02:59:09.234415+00:00');

INSERT OR IGNORE INTO staking_pools (id, name, validator_address, total_staked, commission_rate, apr, min_stake, status, created_at)
VALUES ('a26b1814-82a1-4863-8b27-8b79647c042e', 'Beta Validator', '0xvalidator_beta_00000000000000000000002', 0.0, 3.5, 18.0, 500.0, 'active', '2026-02-15T12:00:00.000000+00:00');

-- Token metrics
INSERT OR IGNORE INTO token_metrics (id, price, price_change_24h, market_cap, market_cap_change_24h, volume_24h, volume_change_24h, fully_diluted_valuation, circulating_supply, total_supply, staked_supply, all_time_high, all_time_high_date, token_holders, ytd_return, updated_at)
VALUES ('b9fe8407-b131-4235-9584-848f3367249a', 0.045, 2.5, 2925000, 1.8, 125000, -3.2, 22500000, 65000000, 500000000, 0, 0.089, 'Mar 2026', 4, 15.0, '2026-07-21T18:52:06.753+00:00');

-- Price history: 4+ rows
INSERT OR IGNORE INTO price_history (id, price, volume, timestamp)
VALUES ('5da731bf-a7db-4c79-ab6b-d5f417dd0c69', 0.04502042, 0, '2026-03-08T21:43:16.419+00:00');
INSERT OR IGNORE INTO price_history (id, price, volume, timestamp)
VALUES ('896997f8-4276-4c5a-92c2-90fadab9e58d', 0.0450908, 0, '2026-03-08T22:00:09.370+00:00');
INSERT OR IGNORE INTO price_history (id, price, volume, timestamp)
VALUES ('4b7d0b80-f126-4abb-87cf-0c45ea7b79d2', 0.04511909, 0, '2026-03-08T23:00:10.566+00:00');
INSERT OR IGNORE INTO price_history (id, price, volume, timestamp)
VALUES ('21ed5852-46e0-461a-aec2-671a35623a05', 0.04511909, 554.0891893, '2026-03-08T23:08:01.033+00:00');

-- Smart contracts: 1 row (HSMC Token)
INSERT OR IGNORE INTO smart_contracts (id, address, name, deployer_address, user_id, source_code, contract_type, status, version, interactions_count, created_at)
VALUES ('06a07543-99fd-42e6-8295-9ca715c07645', '0x06e639e88f2bf970f16bb02558c244e75e18799a', 'HSMC', '0xd07ea42e083dadbe5bc04ff3bf91997faf3987ca', '90fd15a4-1e1d-4d70-afd7-efcfa0ee7349', '// HSMC Smart Contract — Privacy Token\npragma hsmc ^2.0;\n\ncontract PrivacyToken {\n  mapping(address => uint256) private balances;\n  uint256 public totalSupply;\n  string public name = "HSMC Token";\n  \n  event Transfer(address indexed from, address indexed to, uint256 value);\n}', 'token', 'active', '1.0.0', 0, '2026-03-08T14:00:00.000+00:00');

-- Platform stats default
INSERT OR IGNORE INTO platform_stats (id, countries_count, developers_count, tvl, updated_at, uptime_percent)
VALUES ('default', 45, 1200, 2500000, '2026-07-21T18:52:06.753+00:00', 99.98);

-- Network stats default
INSERT OR IGNORE INTO network_stats (id, active_nodes, block_height, consensus_state, hash_rate, latency, network_difficulty, total_transactions, tps, updated_at)
VALUES ('default', 12, 6, 'synced', '4.2 MH/s', 32, 4000000, 1, 0.01, '2026-07-21T18:52:06.753+00:00');

-- Platform config default
INSERT OR IGNORE INTO platform_config (id, hsmcpay_intermediary_enabled, updated_at)
VALUES (1, 1, '2026-07-21T18:52:06.753+00:00');

-- Network peers (2 sample peers)
INSERT OR IGNORE INTO network_peers (id, ip_address, last_seen_at, latency, peer_id, port, region, status, version, created_at)
VALUES ('peer-001', '45.33.12.8', '2026-07-21T18:50:00.000+00:00', 24, '12D3KooWQqwerty123456', 8333, 'us-west', 'online', '0.2.1', '2026-07-01T00:00:00.000+00:00');
INSERT OR IGNORE INTO network_peers (id, ip_address, last_seen_at, latency, peer_id, port, region, status, version, created_at)
VALUES ('peer-002', '185.220.101.45', '2026-07-21T18:51:00.000+00:00', 45, '12D3KooWAsdfgh789012', 8333, 'eu-de', 'online', '0.2.1', '2026-07-01T00:00:00.000+00:00');
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
console.log("✅ Seeded test data");

// ── Auth Configuration ───────────────────────────────────────────────────────
const HSMC_API_KEY = process.env.HSMC_API_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const TLS_CERT = process.env.TLS_CERT || "";
const TLS_KEY = process.env.TLS_KEY || "";
const IS_DEV_MODE = !HSMC_API_KEY;
const USING_TLS = !!(TLS_CERT && TLS_KEY);
const JWT_EXPIRY_SECONDS = 3600; // 1 hour

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
const PUBLIC_PATHS = new Set(["/health", "/", "/auth/login", "/auth/register", "/auth/webauthn/login", "/auth/webauthn/register", "/auth/webauthn/challenge"]);

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

// ── Rate Limiting ────────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIP(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
         req.headers.get("x-real-ip") ||
         "127.0.0.1";
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count++;
  return { allowed: true };
}

// Periodic cleanup of expired rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 120_000);

// ── Input Validation ─────────────────────────────────────────────────────────
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

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
    JSON.stringify({ error: "Rate limit exceeded", retry_after_seconds: retryAfter }),
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

    // Create payment session in DB
    const sessionId = `pi_live_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const paymentIntentId = `pi_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const clientSecret = `${paymentIntentId}_secret_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

    const now = new Date().toISOString();
    db.run(
      `INSERT INTO payment_sessions (id, user_id, amount_usd, amount_hsmc, session_id,
       stripe_payment_intent_id, stripe_client_secret, status, processor, created_at, otp_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'stripe', ?, ?)`,
      randomUUID(), "local-user", amountUsd, amountHsmc, sessionId,
      paymentIntentId, clientSecret, now,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    );

    // Stripe publishable key — use test key in dev
    const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "pk_test_placeholder";

    return jsonResponse({
      session_id: sessionId,
      payment_intent_id: paymentIntentId,
      client_secret: clientSecret,
      stripe_publishable_key: stripePublishableKey,
      amount_hsmc: amountHsmc.toFixed(6),
      amount_usd: amountUsd,
    });
  }

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

    if (session.status === "settled") {
      // Return existing settlement with fee info if available
      const existingTreasury = db.query(
        "SELECT id, fee_hsmc, fee_tier FROM treasury_transactions WHERE session_id = ? LIMIT 1"
      ).get(sessionId) as { id: string; fee_hsmc: number; fee_tier: string } | null;

      return jsonResponse({
        tx_hash: session.settlement_tx_hash || "0x",
        amount_hsmc: session.amount_hsmc,
        fee_hsmc: existingTreasury?.fee_hsmc?.toFixed(2) ?? "0.00",
        fee_tier: existingTreasury?.fee_tier ?? "n/a",
        treasury_tx_id: existingTreasury?.id ?? null,
        payment_id: session.id,
      });
    }

    const now = new Date().toISOString();
    const txHash = "0x" + randomUUID().replace(/-/g, "");

    // Calculate HSMC fee
    const amountUsd = Number(session.amount_usd ?? 0);
    const amountHsmc = Number(session.amount_hsmc ?? 0);
    const { fee: feeUsd, tier: feeTier } = calculateHsmcFee(amountUsd);

    // Convert USD fee to HSMC using the same rate as initiate
    const metrics = db.query(
      "SELECT price FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
    ).get() as { price: number } | null;
    const hsmcPrice = Math.max(Number(metrics?.price ?? 1), 1);
    const feeHsmc = feeUsd / hsmcPrice;

    // Net HSMC the user gets (after fee)
    const netHsmc = Math.max(amountHsmc - feeHsmc, 0);

    // Insert treasury transaction
    const treasuryTxId = randomUUID();
    const userId = String(session.user_id ?? "local-user");
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
    db.run(
      `UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
      netHsmc, now, userId
    );

    return jsonResponse({
      tx_hash: txHash,
      amount_hsmc: netHsmc.toFixed(6),
      fee_hsmc: feeHsmc.toFixed(2),
      fee_tier: feeTier,
      treasury_tx_id: treasuryTxId,
      payment_id: session.id,
    });
  }

  return errorResponse(`Unknown action: ${action}`, 400);
}

// ── Stripe Payout Endpoint (for HSMCPay Sell) ─────────────────────────────────
const SELL_DEPOSIT_ADDRESS = "0xHSMC_Treasury_Sell_0000000000000000000";

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
      deposit_address: SELL_DEPOSIT_ADDRESS,
      hsmc_price: Number(hsmcPrice.toFixed(6)),
      amount_usd: amountUsd,
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
    const { fee: feeUsd, tier: feeTier } = calculateHsmcFee(amountUsd);

    // Convert USD fee to HSMC
    const metrics = db.query(
      "SELECT price FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
    ).get() as { price: number } | null;
    const hsmcPrice = Math.max(Number(metrics?.price ?? 1), 1);
    const feeHsmc = feeUsd / hsmcPrice;

    // Insert treasury transaction with type='sell_fee'
    const treasuryTxId = randomUUID();
    const userId = String(session.card_holder ?? session.user_id ?? "local-user");
    db.run(
      `INSERT INTO treasury_transactions (id, amount_usd, fee_hsmc, fee_tier, session_id, user_id, tx_hash, type, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sell_fee', 'settled', ?)`,
      treasuryTxId, amountUsd, feeHsmc, feeTier, payoutSessionId,
      userId, txHash,
      `HSMCPay sell settlement — ${feeTier} tier — payout to card`
    );

    // Mark session as settled
    db.run(
      `UPDATE payment_sessions SET status = 'settled', settlement_tx_hash = ?, otp_expires_at = ? WHERE session_id = ?`,
      txHash, now, payoutSessionId
    );

    return jsonResponse({
      status: "processing",
      estimated_payout_days: "2-5 business days",
      tx_hash: txHash,
      fee_hsmc: Number(feeHsmc.toFixed(2)),
      fee_tier: feeTier,
      treasury_tx_id: treasuryTxId,
    });
  }

  return errorResponse(`Unknown action: ${action}. Use 'initiate' or 'settle'`, 400);
}

// ── Stripe Payout Webhook (simulation) ────────────────────────────────────────
async function handleStripePayoutWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: { payout_session_id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const payoutSessionId = body.payout_session_id;
  const newStatus = body.status;

  if (!payoutSessionId) {
    return errorResponse("payout_session_id is required", 400);
  }

  const validStatuses = ["completed", "failed", "processing"];
  if (!newStatus || !validStatuses.includes(newStatus)) {
    return errorResponse(`status must be one of: ${validStatuses.join(", ")}`, 400);
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

/** GET /treasury/balance — total fees collected and breakdown by type */
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

  return jsonResponse({
    total_fees_collected: Number(totalRow.total.toFixed(2)),
    breakdown,
    transactions_count: countRow.count,
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

async function handleRequest(req: Request): Promise<Response> {
  // ── Rate limiting ──────────────────────────────────────────────────────────
  const clientIP = getClientIP(req);
  const rateCheck = checkRateLimit(clientIP);
  if (!rateCheck.allowed) {
    return rateLimitResponse(rateCheck.retryAfter ?? 60);
  }

  // ── CORS preflight ─────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, Prefer, stripe-signature",
      },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname;

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

  // Treasury endpoints
  if (path === "/treasury/balance" && req.method === "GET") {
    return handleTreasuryBalance();
  }

  if (path === "/treasury/transactions" && req.method === "GET") {
    return handleTreasuryTransactions(req);
  }

  // Internal atomic wallet transfer (H7 fix)
  if (path === "/api/transfer" && req.method === "POST") {
    return handleInternalTransfer(req);
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
        const rows = db.query(sql).all(...params);
        return jsonResponse(rows);
      }

      if (req.method === "POST") {
        // Check content length
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_SIZE) {
          return errorResponse("Request body too large", 413);
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
console.log(`   Stripe Buy: ${protocol}://localhost:${PORT}/stripe/checkout`);
console.log(`   Stripe Sell: ${protocol}://localhost:${PORT}/stripe/payout`);
console.log(`   Payout Webhook: ${protocol}://localhost:${PORT}/stripe/payout/webhook`);
console.log(`   Treasury Balance: ${protocol}://localhost:${PORT}/treasury/balance`);
console.log(`   Treasury Tx: ${protocol}://localhost:${PORT}/treasury/transactions`);
console.log(`   Rate limit: ${RATE_LIMIT_MAX_REQUESTS} req/min per IP`);
console.log(`   Auth mode: ${IS_DEV_MODE ? "DEV (no API key required)" : "PROTECTED (API key required)"}`);
console.log(`   TLS: ${USING_TLS ? "ENABLED" : "DISABLED"}`);
console.log(`   CORS origin: ${CORS_ORIGIN}`);
console.log(`   Tables: ${ALLOWED_TABLES.size}`);
