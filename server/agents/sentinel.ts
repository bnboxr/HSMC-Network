/**
 * HSMC Sentinel Agent — Security Monitor
 * Real-time transaction monitoring, anomaly detection, fraud prevention.
 */

import type { Database } from "bun:sqlite";

export const SENTINEL_SYSTEM_PROMPT = `You are HSMC Sentinel — the security monitoring and fraud detection agent.
Your job: monitor transactions in real-time, detect anomalies, and flag suspicious activity.

Rules:
1. Analyze transaction patterns for fraud indicators
2. Monitor wallet activity for unusual behavior
3. Alert on potential double-spends, unusual amounts, or rapid-fire transactions
4. Track auth failures and potential brute-force attempts
5. Report anomalies with severity, evidence, and recommended action
6. Be proactive — if something looks wrong, flag it immediately
7. Never access or expose user private keys or seed phrases

## Anomaly Types to Detect:
- **Rapid transactions**: Multiple tx from same wallet in short window
- **Unusual amounts**: Transactions significantly above user's typical pattern
- **Auth anomalies**: Repeated failed auth attempts
- **Privacy downgrades**: Switching from RingCT to transparent for no reason
- **Bridge anomalies**: Unusual cross-chain patterns
- **Timing attacks**: Transactions at unusual hours
- **Dust attacks**: Micro-transactions to many addresses
- **Mempool manipulation**: Transaction replacement patterns`;

export function buildSentinelContext(db: Database, userId?: string): string {
  const parts: string[] = [];

  try {
    // Recent transactions (last 50)
    const txs = db.query(
      "SELECT * FROM transactions ORDER BY created_at DESC LIMIT 50"
    ).all() as Array<Record<string, unknown>>;

    if (txs.length > 0) {
      parts.push(`## Recent Transactions (${txs.length})\n\`\`\`json\n${JSON.stringify(txs.slice(0, 20), null, 2)}\n\`\`\``);
    }

    // Wallet balances
    const wallets = db.query(
      "SELECT address, balance, staked_balance, user_id, label FROM wallets ORDER BY balance DESC LIMIT 20"
    ).all() as Array<Record<string, unknown>>;

    if (wallets.length > 0) {
      parts.push(`## Top Wallets\n\`\`\`json\n${JSON.stringify(wallets, null, 2)}\n\`\`\``);
    }

    // Auth-related: recent payment sessions
    const sessions = db.query(
      "SELECT id, user_id, amount_usd, status, processor, created_at FROM payment_sessions ORDER BY created_at DESC LIMIT 20"
    ).all() as Array<Record<string, unknown>>;

    if (sessions.length > 0) {
      parts.push(`## Recent Payment Sessions\n\`\`\`json\n${JSON.stringify(sessions, null, 2)}\n\`\`\``);
    }

    // Network peers
    const peers = db.query(
      "SELECT ip_address, peer_id, status, latency, region, version FROM network_peers ORDER BY last_seen_at DESC LIMIT 10"
    ).all() as Array<Record<string, unknown>>;

    if (peers.length > 0) {
      parts.push(`## Network Peers\n\`\`\`json\n${JSON.stringify(peers, null, 2)}\n\`\`\``);
    }

  } catch (e) {
    parts.push(`[Sentinel] Context build warning: ${(e as Error).message}`);
  }

  if (parts.length === 0) {
    parts.push("## Status: No transaction data available yet. System is quiet.");
  }

  return parts.join("\n\n");
}
