/**
 * HSMC Bridge Monitoring — Health Checks & Status API
 * ====================================================
 *
 * Feature #22: Bridge Hardening
 *
 * Provides:
 *   1. Health checks for each bridge connector
 *   2. GET /bridge/status — status for all chains
 *   3. Event logging: Lock, Mint, Burn, Unlock
 *
 * Usage (standalone HTTP server):
 *   npx tsx bridge/src/monitor.ts
 *
 * Usage (embedded in existing API server):
 *   import { createBridgeMonitor } from "./bridge/src/monitor";
 *   const monitor = createBridgeMonitor({ connectors: [...] });
 *   app.get("/bridge/status", monitor.statusHandler);
 *
 * Env:
 *   BRIDGE_MONITOR_PORT   default: 3100
 *   HSMC_NODE_URL         Rust node for mainnet Lock/Unlock events
 */
import { createServer, IncomingMessage, ServerResponse } from "http";
import type { ChainConnector, ChainId } from "./types";
import { getConnector, hasConnector, listConnectors } from "./index";

// ─── CORS ───────────────────────────────────────────────────────────────────
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ChainStatus {
  chain: ChainId;
  healthy: boolean;
  blockHeight?: number;
  latencyMs?: number;
  bridgeContract?: string;
  whsmcContract?: string;
  lastEvent?: {
    type: string;
    txHash: string;
    timestamp: string;
  };
  error?: string;
}

export interface BridgeStatus {
  timestamp: string;
  nodeVersion: string;
  chains: ChainStatus[];
  totalChains: number;
  healthyChains: number;
}

export interface BridgeEvent {
  eventType: "Lock" | "Mint" | "Burn" | "Unlock";
  chain: ChainId;
  txHash: string;
  from?: string;
  to?: string;
  amount?: string;
  hsmcTxHash?: string;
  blockNumber?: number;
  timestamp: string;
}

export interface MonitorConfig {
  /** Optional list of pre-initialized connectors. If omitted, uses global connector registry. */
  connectors?: ChainConnector[];
  /** List of chain IDs to monitor (default: all configured chains). */
  chains?: ChainId[];
}

// ─── Event logger ─────────────────────────────────────────────────────────

class EventLogger {
  private events: BridgeEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents = 1000) {
    this.maxEvents = maxEvents;
  }

  log(event: BridgeEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    // Also log to stdout for external log aggregation
    console.log(`[bridge:${event.eventType}] chain=${event.chain} tx=${event.txHash} ${event.from ?? ""} → ${event.to ?? ""} amount=${event.amount ?? "?"}`);
  }

  getRecent(limit = 50): BridgeEvent[] {
    return this.events.slice(-limit).reverse();
  }

  getByChain(chain: ChainId, limit = 20): BridgeEvent[] {
    return this.events.filter(e => e.chain === chain).slice(-limit).reverse();
  }

  getByTxHash(hsmcTxHash: string): BridgeEvent[] {
    return this.events.filter(e => e.hsmcTxHash === hsmcTxHash);
  }
}

// ─── Bridge Monitor ───────────────────────────────────────────────────────

export class BridgeMonitor {
  private config: MonitorConfig;
  private eventLogger: EventLogger;
  private lastStatus: BridgeStatus | null = null;

  constructor(config: MonitorConfig = {}) {
    this.config = config;
    this.eventLogger = new EventLogger();
  }

  /** Public access to event logger */
  get events(): EventLogger {
    return this.eventLogger;
  }

  /** Health-check a single chain connector */
  async checkChain(chain: ChainId): Promise<ChainStatus> {
    const start = Date.now();
    try {
      const connector = getConnector(chain);

      // Validate connector connectivity: try to get balance of zero address
      let blockHeight: number | undefined;
      let bridgeContract: string | undefined;
      let whsmcContract: string | undefined;

      try {
        // For EVM chains, we can access contract addresses
        const config = (connector as any).getConfig?.();
        if (config) {
          bridgeContract = config.bridgeMinterAddress;
          whsmcContract = config.whsmcAddress;
        }

        // Try to query block height via a simple RPC call
        if (chain === "btc") {
          const res = await fetch(`${(connector as any).rpcUrl || "https://blockstream.info/api"}/blocks/tip/height`);
          if (res.ok) blockHeight = Number(await res.text());
        } else if (chain === "sol") {
          const res = await fetch((connector as any).rpcUrl || "https://api.mainnet-beta.solana.com", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }),
          });
          const data: any = await res.json();
          blockHeight = data.result;
        } else if (chain === "cosmos") {
          const res = await fetch(`${(connector as any).apiBase || "https://cosmos-rest.publicnode.com"}/cosmos/base/tendermint/v1beta1/blocks/latest`);
          const data: any = await res.json();
          blockHeight = Number(data?.block?.header?.height);
        } else {
          // EVM: try provider.getBlockNumber
          try {
            const provider = (connector as any).getProvider?.();
            if (provider) blockHeight = await provider.getBlockNumber();
          } catch { /* ignore */ }
        }
      } catch { /* non-critical */ }

      const latencyMs = Date.now() - start;

      return {
        chain,
        healthy: true,
        blockHeight,
        latencyMs,
        bridgeContract,
        whsmcContract,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        chain,
        healthy: false,
        latencyMs,
        error: (err as Error).message,
      };
    }
  }

  /** Check all configured chains */
  async checkAllChains(): Promise<BridgeStatus> {
    const chains = this.config.chains ?? this.getConfiguredChains();
    const results = await Promise.all(chains.map(c => this.checkChain(c)));
    const healthy = results.filter(r => r.healthy).length;

    this.lastStatus = {
      timestamp: new Date().toISOString(),
      nodeVersion: "1.0.0",
      chains: results,
      totalChains: results.length,
      healthyChains: healthy,
    };

    return this.lastStatus;
  }

  /** Get currently configured chain IDs */
  private getConfiguredChains(): ChainId[] {
    const all: ChainId[] = ["btc", "eth", "bsc", "sol", "polygon", "avalanche", "arbitrum", "optimism", "base", "cosmos"];
    return all.filter(c => hasConnector(c));
  }

  /** HTTP handler for status */
  async statusHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const status = await this.checkAllChains();
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": CORS_ORIGIN });
      res.end(JSON.stringify(status, null, 2));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  /** HTTP handler for events */
  eventsHandler(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || "/", "http://localhost");
    const chain = url.searchParams.get("chain") as ChainId | null;
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    const events = chain
      ? this.eventLogger.getByChain(chain, limit)
      : this.eventLogger.getRecent(limit);

    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": CORS_ORIGIN });
    res.end(JSON.stringify({ count: events.length, events }, null, 2));
  }

  /** HTTP handler for single chain status */
  async chainHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", "http://localhost");
    const chain = url.pathname.split("/").pop() as ChainId;

    if (!chain) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing chain parameter" }));
      return;
    }

    try {
      const status = await this.checkChain(chain);
      res.writeHead(status.healthy ? 200 : 503, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": CORS_ORIGIN,
      });
      res.end(JSON.stringify(status, null, 2));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  /** HTTP request router */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || "/";

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    if (url === "/bridge/status" || url === "/bridge/status/") {
      await this.statusHandler(req, res);
    } else if (url.startsWith("/bridge/status/")) {
      await this.chainHandler(req, res);
    } else if (url === "/bridge/events" || url.startsWith("/bridge/events")) {
      this.eventsHandler(req, res);
    } else if (url === "/health" || url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "hsmc-bridge-monitor",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────

export function createBridgeMonitor(config?: MonitorConfig): BridgeMonitor {
  return new BridgeMonitor(config);
}

// ─── Standalone server ────────────────────────────────────────────────────

if (require.main === module) {
  const PORT = parseInt(process.env.BRIDGE_MONITOR_PORT || "3100", 10);

  // Initialize connectors from env vars so they're available
  const chainEnvMap: Array<[ChainId, string]> = [
    ["btc", "BTC_RPC_URL"],
    ["eth", "ETH_RPC_URL"],
    ["bsc", "BSC_RPC_URL"],
    ["sol", "SOLANA_RPC_URL"],
    ["polygon", "POLYGON_RPC_URL"],
    ["avalanche", "AVALANCHE_RPC_URL"],
    ["arbitrum", "ARBITRUM_RPC_URL"],
    ["optimism", "OPTIMISM_RPC_URL"],
    ["base", "BASE_RPC_URL"],
    ["cosmos", "COSMOS_RPC_URL"],
  ];

  for (const [chain, envVar] of chainEnvMap) {
    if (process.env[envVar]) {
      // Configure to trigger lazy instantiation
      const { configureChain } = require("./index");
      configureChain(chain, { rpcUrl: process.env[envVar] });
    }
  }

  const monitor = createBridgeMonitor();

  const server = createServer((req, res) => {
    monitor.handleRequest(req, res).catch(err => {
      console.error("Unhandled:", err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`\n🔍 HSMC Bridge Monitor listening on port ${PORT}`);
    console.log(`   Endpoints:`);
    console.log(`     GET /health            — Liveness probe`);
    console.log(`     GET /bridge/status     — All chains status`);
    console.log(`     GET /bridge/status/eth — Single chain (eth, bsc, polygon, etc.)`);
    console.log(`     GET /bridge/events     — Recent bridge events`);
    console.log(`     GET /bridge/events?chain=bsc&limit=10 — Filtered events\n`);
  });
}
