/**
 * HSMC Watcher Agent — Network Health Monitor
 * Node health, peer count, uptime, latency, alerts.
 */

import type { Database } from "bun:sqlite";

export const WATCHER_SYSTEM_PROMPT = `You are HSMC Watcher — the Network Health monitoring agent.
Your job: monitor node health, peer connectivity, uptime, and latency across the HSMC network.

Rules:
1. Track all network peers: status, latency, region, version
2. Monitor node uptime and alert on disconnections
3. Track block propagation times
4. Monitor consensus state (synced / desynced / forked)
5. Alert on node version mismatches or outdated peers
6. Report network topology — which regions have coverage
7. Track TPS and overall network performance
8. Flag suspicious peer behavior (Sybil indicators)`;

export function buildWatcherContext(db: Database): string {
  const parts: string[] = [];

  try {
    // Network peers
    const peers = db.query(
      "SELECT ip_address, peer_id, status, latency, region, version, port, last_seen_at FROM network_peers ORDER BY last_seen_at DESC"
    ).all() as Array<Record<string, unknown>>;

    if (peers.length > 0) {
      const onlineCount = peers.filter((p) => p.status === "online").length;
      const offlineCount = peers.filter((p) => p.status !== "online").length;
      const regions = [...new Set(peers.map((p) => p.region).filter(Boolean))];
      const avgLatency = peers
        .filter((p) => typeof p.latency === "number")
        .reduce((sum, p) => sum + (p.latency as number), 0) / (peers.filter((p) => typeof p.latency === "number").length || 1);
      const versions = [...new Set(peers.map((p) => p.version).filter(Boolean))];

      parts.push(`## Network Peers
Online: ${onlineCount} / Offline: ${offlineCount} / Total: ${peers.length}
Regions Covered: ${regions.join(", ") || "none"}
Avg Latency: ${avgLatency.toFixed(1)}ms
Versions: ${versions.join(", ") || "unknown"}

\`\`\`json
${JSON.stringify(peers.slice(0, 15), null, 2)}
\`\`\``);
    }

    // Network stats
    const netStats = db.query(
      "SELECT active_nodes, block_height, hash_rate, network_difficulty, tps, latency, consensus_state, total_transactions, updated_at FROM network_stats ORDER BY updated_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | null;

    if (netStats) {
      parts.push(`## Network Stats
Active Nodes: ${netStats.active_nodes}
Block Height: ${netStats.block_height}
Consensus: ${netStats.consensus_state}
Hash Rate: ${netStats.hash_rate}
Difficulty: ${netStats.network_difficulty}
TPS: ${netStats.tps}
Avg Latency: ${netStats.latency}ms
Total Transactions: ${netStats.total_transactions}
Updated: ${netStats.updated_at}`);
    }

    // Platform stats
    const platformStats = db.query(
      "SELECT countries_count, developers_count, tvl, uptime_percent, updated_at FROM platform_stats ORDER BY updated_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | null;

    if (platformStats) {
      parts.push(`## Platform Stats
Countries: ${platformStats.countries_count}
Developers: ${platformStats.developers_count}
TVL: $${Number(platformStats.tvl).toLocaleString()}
Uptime: ${platformStats.uptime_percent}%`);
    }

    // Blocks for propagation analysis
    const blocks = db.query(
      "SELECT block_number, created_at, transactions_count FROM blocks ORDER BY block_number DESC LIMIT 5"
    ).all() as Array<Record<string, unknown>>;

    if (blocks.length > 1) {
      parts.push(`## Recent Block Production\n\`\`\`json\n${JSON.stringify(blocks, null, 2)}\n\`\`\``);
    }

  } catch (e) {
    parts.push(`[Watcher] Context build warning: ${(e as Error).message}`);
  }

  if (parts.length === 0) {
    parts.push("## Status: No network data available yet.");
  }

  return parts.join("\n\n");
}
