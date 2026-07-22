/**
 * HSMC Foreman Agent — Mining Operations
 * Mining optimization: hash rate, difficulty, block notifications.
 */

import type { Database } from "bun:sqlite";

export const FOREMAN_SYSTEM_PROMPT = `You are HSMC Foreman — the Mining Operations agent.
Your job: monitor and optimize mining operations across the HSMC network.

Rules:
1. Monitor hash rate, difficulty, and block production
2. Track miner addresses and their contributions
3. Alert on difficulty adjustments needed
4. Report on block rewards distributed
5. Monitor Stratum server health and miner connections
6. Analyze mining profitability based on current token price
7. Identify mining pool issues: orphaned blocks, stale shares, rejected submissions
8. Be technical — use mining terminology correctly

## Mining Specs:
- Algorithm: SHA-256d Proof-of-Work
- Stratum: V1 protocol on port 3333 (WebSocket)
- Current difficulty: 4,000,000
- Target block time: configurable
- Privacy protocol: RingCT-v2 (blocks include privacy metadata)`;

export function buildForemanContext(db: Database): string {
  const parts: string[] = [];

  try {
    // Blocks
    const blocks = db.query(
      "SELECT block_number, hash, miner_address, transactions_count, difficulty, nonce, created_at, privacy_protocol FROM blocks ORDER BY block_number DESC LIMIT 10"
    ).all() as Array<Record<string, unknown>>;

    if (blocks.length > 0) {
      parts.push(`## Recent Blocks\n\`\`\`json\n${JSON.stringify(blocks, null, 2)}\n\`\`\``);
    }

    // Network stats
    const netStats = db.query(
      "SELECT active_nodes, block_height, hash_rate, network_difficulty, tps, latency, consensus_state, updated_at FROM network_stats ORDER BY updated_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | null;

    if (netStats) {
      parts.push(`## Network Stats
Active Nodes: ${netStats.active_nodes}
Block Height: ${netStats.block_height}
Hash Rate: ${netStats.hash_rate}
Difficulty: ${netStats.network_difficulty}
TPS: ${netStats.tps}
Latency: ${netStats.latency}ms
State: ${netStats.consensus_state}
Updated: ${netStats.updated_at}`);
    }

    // Token metrics (for profitability)
    const metrics = db.query(
      "SELECT price, market_cap FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | null;

    if (metrics) {
      parts.push(`## Token Price: $${Number(metrics.price).toFixed(4)}`);
    }

    // Staking pools (miners may also stake)
    const pools = db.query(
      "SELECT name, total_staked, apr, commission_rate, status FROM staking_pools WHERE status = 'active'"
    ).all() as Array<Record<string, unknown>>;

    if (pools.length > 0) {
      parts.push(`## Active Staking Pools\n\`\`\`json\n${JSON.stringify(pools, null, 2)}\n\`\`\``);
    }

  } catch (e) {
    parts.push(`[Foreman] Context build warning: ${(e as Error).message}`);
  }

  if (parts.length === 0) {
    parts.push("## Status: No mining data available yet.");
  }

  return parts.join("\n\n");
}
