/**
 * HSMC Multi-Agent Gateway Server (v3 — Multi-Provider)
 * Routes requests to 7 specialized AI agents, each with their own endpoint,
 * system prompt, and context. Supports 6 AI backends via pluggable adapters:
 *
 *   hsmc-ai   — Gemini Flash (free, HSMC_AI_KEY)
 *   openai    — GPT-4o Mini (~$0.15/1M, OPENAI_API_KEY)
 *   anthropic — Claude 3 Haiku (~$0.25/1M, ANTHROPIC_API_KEY)
 *   groq      — Llama 3.1 70B (free tier, GROQ_API_KEY)
 *   mistral   — Mistral Small (~$0.20/1M, MISTRAL_API_KEY)
 *   ollama    — Llama 3.2 3B local (FREE, zero internet, no key)
 *
 * Provider selection:
 *   - Global default: set AI_PROVIDER env var (e.g., AI_PROVIDER=ollama)
 *   - Per-request: send {"provider": "ollama"} in request body
 *   - Fallback: hsmc-ai (original default)
 *
 * Usage: bun run copilot-server.ts
 * Listens on port 3002.
 *
 * Endpoints:
 *   POST /agent/redteam   — Penetration testing (scan/test/diff modes)
 *   POST /agent/sentinel  — Security monitoring & fraud detection
 *   POST /agent/auditor   — Treasury & finance
 *   POST /agent/foreman   — Mining operations
 *   POST /agent/bridge    — Cross-chain monitoring
 *   POST /agent/watcher   — Network health
 *   POST /agent/concierge — User support (preserved)
 *   POST /copilot/chat    — Backward-compatible alias for concierge
 *   GET  /health          — Health check with agent listing & active provider
 */

import { Database } from "bun:sqlite";
import { hardenFilePermissions, verifySchemaIntegrity } from "./db-security";

// ── Agent imports ────────────────────────────────────────────────────────
import {
  REDTEAM_SYSTEM_PROMPT,
  buildRedTeamContext,
} from "./agents/redteam";

import {
  SENTINEL_SYSTEM_PROMPT,
  buildSentinelContext,
} from "./agents/sentinel";

import {
  AUDITOR_SYSTEM_PROMPT,
  buildAuditorContext,
} from "./agents/auditor";

import {
  FOREMAN_SYSTEM_PROMPT,
  buildForemanContext,
} from "./agents/foreman";

import {
  BRIDGE_SYSTEM_PROMPT,
  buildBridgeContext,
} from "./agents/bridge";

import {
  WATCHER_SYSTEM_PROMPT,
  buildWatcherContext,
} from "./agents/watcher";

import {
  CONCIERGE_SYSTEM_PROMPT,
  INPUT_BLOCKLIST,
  OUTPUT_BLOCKLIST,
  buildConciergeContext,
} from "./agents/concierge";

// ── AI Provider imports ──────────────────────────────────────────────────
import {
  streamToAI,
  resolveProvider,
} from "./agents/adapters/router";
import type { AIProvider } from "./agents/adapters/types";
import {
  ALL_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_ENV_VARS,
} from "./agents/adapters/types";

// ── DB setup ─────────────────────────────────────────────────────────────
const DB_PATH = new URL("./copilot.db", import.meta.url).pathname;
const db = new Database(DB_PATH, { create: true });

const COPILOT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT NOT NULL,
  address TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  staked_balance REAL NOT NULL DEFAULT 0,
  label TEXT,
  is_primary INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS transactions (
  user_id TEXT NOT NULL,
  tx_type TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS token_metrics (
  price REAL NOT NULL,
  market_cap REAL NOT NULL DEFAULT 0,
  circulating_supply REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.run("PRAGMA journal_mode=WAL");

// ── Security: file permissions ────────────────────────────────────────────
const permResults = hardenFilePermissions(DB_PATH);
for (const r of permResults) {
  if (!r.ok) {
    console.warn(`[Copilot-Security] ⚠️  Permission hardening failed for ${r.path}: ${r.error}`);
  } else if (r.permsBefore !== r.permsAfter) {
    console.log(`[Copilot-Security] 🔒 ${r.path}: ${r.permsBefore} → ${r.permsAfter}`);
  }
}

// ── Security: schema integrity (non-strict — copilot DB is auto-created) ───
const schemaCheck = await verifySchemaIntegrity(db, COPILOT_SCHEMA_SQL);
if (!schemaCheck.passed) {
  console.warn(`[Copilot-Security] ⚠️  Schema integrity check failed — may be expected for auto-created DB`);
  console.warn(`  Expected: ${schemaCheck.expectedHash.slice(0, 16)}...`);
  console.warn(`  Actual:   ${schemaCheck.actualHash.slice(0, 16)}...`);
} else {
  console.log(`[Copilot-Security] ✅ Schema integrity OK (${schemaCheck.tableCount} tables)`);
}

db.run(`
  CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT NOT NULL,
    address TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    staked_balance REAL NOT NULL DEFAULT 0,
    label TEXT,
    is_primary INTEGER DEFAULT 1
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    user_id TEXT NOT NULL,
    tx_type TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS token_metrics (
    price REAL NOT NULL,
    market_cap REAL NOT NULL DEFAULT 0,
    circulating_supply REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Seed demo data if empty
const walletCount = db.query("SELECT COUNT(*) as c FROM wallets").get() as { c: number };
if (walletCount.c === 0) {
  db.run("INSERT INTO wallets (user_id, address, balance, staked_balance, label) VALUES (?, ?, ?, ?, ?)",
    ["demo-user", "hsmc1q...abc123", 5000, 1200, "Primary"]);
  db.run("INSERT INTO transactions (user_id, tx_type, amount, status, created_at) VALUES (?, ?, ?, ?, ?)",
    ["demo-user", "stake", 500, "confirmed", "2026-07-20T10:00:00Z"]);
  db.run("INSERT INTO transactions (user_id, tx_type, amount, status, created_at) VALUES (?, ?, ?, ?, ?)",
    ["demo-user", "receive", 2500, "confirmed", "2026-07-19T14:30:00Z"]);
  db.run("INSERT INTO transactions (user_id, tx_type, amount, status, created_at) VALUES (?, ?, ?, ?, ?)",
    ["demo-user", "send", -150, "confirmed", "2026-07-18T09:15:00Z"]);
  db.run("INSERT INTO token_metrics (price, market_cap, circulating_supply) VALUES (?, ?, ?)",
    [0.042, 4_200_000, 100_000_000]);
}

// ── Agent Registry ────────────────────────────────────────────────────────

interface AgentConfig {
  name: string;
  endpoint: string;
  systemPrompt: string;
  buildContext: (db: Database, userId: string, body: Record<string, unknown>) => string;
  needsUserMessage: boolean;        // concierge needs user messages
  hasSecurityFilters: boolean;      // concierge has input/output blocklists
}

const AGENTS: Record<string, AgentConfig> = {
  redteam: {
    name: "Red Team",
    endpoint: "/agent/redteam",
    systemPrompt: REDTEAM_SYSTEM_PROMPT,
    buildContext: (_db, _userId, body) => {
      const action = (body.action as string) || "scan";
      const target = (body.target as string) || undefined;
      const changes = (body.changes as string) || undefined;
      return buildRedTeamContext(action as "scan" | "test" | "diff", target, changes);
    },
    needsUserMessage: false,
    hasSecurityFilters: false,
  },

  sentinel: {
    name: "Sentinel",
    endpoint: "/agent/sentinel",
    systemPrompt: SENTINEL_SYSTEM_PROMPT,
    buildContext: (db, userId) => buildSentinelContext(db, userId),
    needsUserMessage: true,
    hasSecurityFilters: false,
  },

  auditor: {
    name: "Auditor",
    endpoint: "/agent/auditor",
    systemPrompt: AUDITOR_SYSTEM_PROMPT,
    buildContext: (db) => buildAuditorContext(db),
    needsUserMessage: true,
    hasSecurityFilters: false,
  },

  foreman: {
    name: "Foreman",
    endpoint: "/agent/foreman",
    systemPrompt: FOREMAN_SYSTEM_PROMPT,
    buildContext: (db) => buildForemanContext(db),
    needsUserMessage: true,
    hasSecurityFilters: false,
  },

  bridge: {
    name: "Bridge Keeper",
    endpoint: "/agent/bridge",
    systemPrompt: BRIDGE_SYSTEM_PROMPT,
    buildContext: (db) => buildBridgeContext(db),
    needsUserMessage: true,
    hasSecurityFilters: false,
  },

  watcher: {
    name: "Watcher",
    endpoint: "/agent/watcher",
    systemPrompt: WATCHER_SYSTEM_PROMPT,
    buildContext: (db) => buildWatcherContext(db),
    needsUserMessage: true,
    hasSecurityFilters: false,
  },

  concierge: {
    name: "Concierge",
    endpoint: "/agent/concierge",
    systemPrompt: CONCIERGE_SYSTEM_PROMPT,
    buildContext: (db, userId) => buildConciergeContext(db, userId),
    needsUserMessage: true,
    hasSecurityFilters: true,
  },
};

// ── CORS headers ─────────────────────────────────────────────────────────
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

// ── Helpers ──────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function safeMessages(messages: unknown[]): Array<{ role: "user" | "assistant"; content: string }> {
  return messages.slice(-12).flatMap((m) => {
    const row = m as { role?: unknown; content?: unknown };
    const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
    if (!role || typeof row.content !== "string") return [];
    const content = row.content.slice(0, 4_000);
    if (role === "user") {
      return [{ role, content: `<USER_QUERY_DATA>\n${content}\n</USER_QUERY_DATA>` }];
    }
    return [{ role, content }];
  });
}

function filteredSseStream(body: ReadableStream<Uint8Array> | null): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let scanBuffer = "";
  let blocked = false;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (blocked) return;
        const text = decoder.decode(chunk, { stream: true });
        scanBuffer = (scanBuffer + text).slice(-8_000);
        if (OUTPUT_BLOCKLIST.test(scanBuffer)) {
          blocked = true;
          const refusal =
            "I can't help with that because it violates HSMC safety policy. I can explain the defensive concept at a high level instead.";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: refusal } }] })}\n\ndata: [DONE]\n\n`
            )
          );
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
}

// ── Provider info for health/status ──────────────────────────────────────

function getProviderStatus(): {
  active: string;
  label: string;
  available: Array<{ id: string; label: string; hasKey: boolean; envVar: string | null }>;
} {
  const active = resolveProvider();
  const available = ALL_PROVIDERS.map((p) => {
    const envVar = PROVIDER_ENV_VARS[p];
    const hasKey = envVar ? !!Bun.env[envVar] : true; // ollama always "has key" (no key needed)
    return {
      id: p,
      label: PROVIDER_LABELS[p],
      hasKey,
      envVar,
    };
  });

  return {
    active,
    label: PROVIDER_LABELS[active],
    available,
  };
}

// ── Agent Router ─────────────────────────────────────────────────────────

async function routeAgent(
  agentName: string,
  req: Request
): Promise<Response> {
  const agent = AGENTS[agentName];
  if (!agent) {
    return jsonError(
      `Unknown agent: "${agentName}". Available: ${Object.keys(AGENTS).join(", ")}`,
      404
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const userId = (body.user_id as string) ?? req.headers.get("x-user-id") ?? "demo-user";
  const messages = body.messages as unknown[] | undefined;

  // Resolve provider: per-request override > env var > default (hsmc-ai)
  const provider = resolveProvider(body.provider as string | undefined);

  // For concierge, we need messages with actual user content
  if (agent.needsUserMessage) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonError("messages[] array required for this agent");
    }

    const normalizedMessages = safeMessages(messages);

    // Security filters (only for concierge)
    if (agent.hasSecurityFilters) {
      const latestUserText =
        [...normalizedMessages].reverse().find((m) => m.role === "user")?.content ?? "";

      if (INPUT_BLOCKLIST.test(latestUserText)) {
        return jsonError(
          "I can't process secrets, seed phrases, attack instructions, or bypass requests. Ask about HSMC security at a documentation level instead.",
          422
        );
      }
    }

    // Build full messages array: system prompt + context + user messages
    const contextStr = agent.buildContext(db, userId, body);

    const fullMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: agent.systemPrompt },
    ];

    if (contextStr) {
      fullMessages.push({ role: "system", content: contextStr });
    }

    fullMessages.push(...normalizedMessages);

    return streamToAgentProvider(provider, fullMessages, agent.hasSecurityFilters);
  }

  // For redteam (no user messages needed — action-driven)
  const contextStr = agent.buildContext(db, userId, body);

  const fullMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: agent.systemPrompt },
    { role: "system", content: contextStr },
  ];

  // If user provided additional instructions
  if (Array.isArray(messages) && messages.length > 0) {
    const normalized = safeMessages(messages);
    fullMessages.push(...normalized);
  } else {
    // For scan mode without messages, use a default prompt
    const action = (body.action as string) || "scan";
    if (action === "scan") {
      fullMessages.push({
        role: "user",
        content: "Perform a full security scan. Analyze all context provided and report every vulnerability found. Be thorough — check SQL injection surfaces, auth bypass opportunities, race conditions, crypto weaknesses, input validation gaps, and API abuse vectors. Output each finding in the structured format.",
      });
    } else if (action === "test" && body.target) {
      fullMessages.push({
        role: "user",
        content: `Focus exclusively on testing: ${body.target}. Analyze deeply for vulnerabilities specific to this target.`,
      });
    } else if (action === "diff" && body.changes) {
      fullMessages.push({
        role: "user",
        content: "Review the provided code changes for newly introduced vulnerabilities. Compare with known patterns from the previous audit.",
      });
    }
  }

  return streamToAgentProvider(provider, fullMessages, agent.hasSecurityFilters);
}

/**
 * Stream messages to the selected AI provider.
 * Handles errors from missing API keys, rate limits, etc.
 */
async function streamToAgentProvider(
  provider: AIProvider,
  messages: Array<{ role: string; content: string }>,
  applyOutputFilter: boolean
): Promise<Response> {
  // Check if the provider's API key is available (skip for ollama)
  const envVar = PROVIDER_ENV_VARS[provider];
  if (envVar && !Bun.env[envVar]) {
    return jsonError(
      `${envVar} environment variable is required for provider "${provider}". ` +
      `Set it or use a different provider (available: ${ALL_PROVIDERS.join(", ")}). ` +
      `For zero-config local AI, use provider: "ollama".`,
      500
    );
  }

  const result = await streamToAI(provider, messages);

  if (result.error || !result.body) {
    return jsonResponse(
      { error: result.error ?? "Unknown error", provider },
      result.status || 502
    );
  }

  const streamBody = applyOutputFilter
    ? filteredSseStream(result.body)
    : result.body;

  return new Response(streamBody, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-AI-Provider": provider,
    },
  });
}

// ── Server ───────────────────────────────────────────────────────────────

const PORT = 3002;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check — list all agents + provider status
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      const agentList = Object.entries(AGENTS).map(([key, a]) => ({
        name: key,
        label: a.name,
        endpoint: a.endpoint,
        hasSecurityFilters: a.hasSecurityFilters,
        needsUserMessage: a.needsUserMessage,
      }));

      const providerStatus = getProviderStatus();

      return jsonResponse({
        status: "ok",
        version: "3.0.0",
        mode: "multi-agent-gateway",
        provider: providerStatus,
        agents: agentList,
        agent_count: agentList.length,
        db: DB_PATH,
      });
    }

    // Provider info endpoint
    if (req.method === "GET" && url.pathname === "/providers") {
      return jsonResponse(getProviderStatus());
    }

    // POST /agent/:name — Route to specific agent
    if (req.method === "POST" && url.pathname.startsWith("/agent/")) {
      const agentName = url.pathname.replace("/agent/", "");
      return routeAgent(agentName, req);
    }

    // POST /copilot/chat — Backward compatibility alias for concierge
    if (req.method === "POST" && url.pathname === "/copilot/chat") {
      return routeAgent("concierge", req);
    }

    return jsonError("Not found", 404);
  },
});

// ── Startup banner ───────────────────────────────────────────────────────

const activeProvider = resolveProvider();

console.log(`🚀 HSMC Multi-Agent Gateway v3 running on http://localhost:${PORT}`);
console.log(`   AI Provider: ${PROVIDER_LABELS[activeProvider]} (set AI_PROVIDER to change)`);
console.log(`   Providers available:`);
for (const p of ALL_PROVIDERS) {
  const envVar = PROVIDER_ENV_VARS[p];
  const hasKey = envVar ? (Bun.env[envVar] ? "✅" : "❌") : "✅ (no key)";
  console.log(`     ${hasKey} ${p.padEnd(12)} ${PROVIDER_LABELS[p]}`);
}
console.log(`   Agents:`);
for (const [key, agent] of Object.entries(AGENTS)) {
  console.log(`     POST http://localhost:${PORT}${agent.endpoint}  → ${agent.name}`);
}
console.log(`   Legacy: POST http://localhost:${PORT}/copilot/chat  → Concierge (compat)`);
console.log(`   Health: GET  http://localhost:${PORT}/health`);
console.log(`   Providers: GET  http://localhost:${PORT}/providers`);
console.log(`   DB:     ${DB_PATH}`);

// Warn if no provider has a key configured
const anyCloudAvailable = ALL_PROVIDERS.some(p => {
  if (p === "ollama") return true; // always available
  const envVar = PROVIDER_ENV_VARS[p];
  return envVar ? !!Bun.env[envVar] : false;
});

if (!anyCloudAvailable) {
  console.log(`\n   ⚠️  No cloud API keys found. Only "ollama" (local) will work.`);
  console.log(`   Set one of: HSMC_AI_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY`);
  console.log(`   Or run: ollama pull llama3.2:3b && ollama serve`);
}
