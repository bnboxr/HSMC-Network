/**
 * HSMC Auditor Agent — Treasury & Finance Monitor
 * Treasury balance tracking, fee collection, buyback opportunities, daily reports.
 */

import type { Database } from "bun:sqlite";

export const AUDITOR_SYSTEM_PROMPT = `You are HSMC Auditor — the Treasury and Finance monitoring agent.
Your job: track all treasury activity, fee collection, and provide financial analytics.

Rules:
1. Monitor treasury_transactions table for all fee collections
2. Track HSMCPay fee tiers and revenue breakdown
3. Identify buyback opportunities based on treasury balance
4. Generate daily/weekly revenue summaries
5. Flag anomalies in fee collection (missing fees, incorrect tiers)
6. Track the 40/25/20/15 treasury allocation ratio
7. Monitor token metrics (price, market cap, volume, circulating supply)
8. Be precise with numbers — always cite actual DB values

## Treasury Allocation (from business plan):
- 40% Buyback & Burn
- 25% Staking Rewards
- 20% Development Fund
- 15% Insurance Fund

## HSMCPay Fee Tiers (FIXED, not percentage):
- Under $6,000 → $1.00
- $6,000–$10,000 → $3.00
- $10,000–$50,000 → $5.00
- $50,000–$1,000,000 → $10.00
- Over $1,000,000 → $200.00`;

export function buildAuditorContext(db: Database): string {
  const parts: string[] = [];

  try {
    // Treasury balance summary
    const totalRow = db.query(
      "SELECT COALESCE(SUM(fee_hsmc), 0) as total FROM treasury_transactions WHERE status = 'settled'"
    ).get() as { total: number };

    const breakdownRows = db.query(
      "SELECT type, COALESCE(SUM(fee_hsmc), 0) as total FROM treasury_transactions WHERE status = 'settled' GROUP BY type"
    ).all() as Array<{ type: string; total: number }>;

    const countRow = db.query(
      "SELECT COUNT(*) as count FROM treasury_transactions WHERE status = 'settled'"
    ).get() as { count: number };

    const breakdown: Record<string, number> = {};
    for (const row of breakdownRows) {
      breakdown[row.type] = Number(row.total.toFixed(6));
    }

    parts.push(`## Treasury Balance
Total Fees Collected: ${Number(totalRow.total).toFixed(2)} HSMC
Transactions: ${countRow.count}
Breakdown: ${JSON.stringify(breakdown)}`);

    // Allocation targets
    const total = Number(totalRow.total);
    if (total > 0) {
      parts.push(`## Recommended Allocation
Buyback & Burn (40%): ${(total * 0.4).toFixed(2)} HSMC
Staking Rewards (25%): ${(total * 0.25).toFixed(2)} HSMC
Development Fund (20%): ${(total * 0.2).toFixed(2)} HSMC
Insurance Fund (15%): ${(total * 0.15).toFixed(2)} HSMC`);
    }

    // Recent treasury transactions
    const recentTreasury = db.query(
      "SELECT * FROM treasury_transactions ORDER BY created_at DESC LIMIT 20"
    ).all() as Array<Record<string, unknown>>;

    if (recentTreasury.length > 0) {
      parts.push(`## Recent Treasury Transactions\n\`\`\`json\n${JSON.stringify(recentTreasury, null, 2)}\n\`\`\``);
    }

    // Token metrics
    const metrics = db.query(
      "SELECT price, market_cap, volume_24h, circulating_supply, total_supply, price_change_24h, updated_at FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | null;

    if (metrics) {
      parts.push(`## Token Metrics
Price: $${Number(metrics.price).toFixed(4)}
Market Cap: $${Number(metrics.market_cap).toLocaleString()}
24h Volume: $${Number(metrics.volume_24h).toLocaleString()}
24h Change: ${Number(metrics.price_change_24h).toFixed(2)}%
Circulating Supply: ${Number(metrics.circulating_supply).toLocaleString()}
Total Supply: ${Number(metrics.total_supply).toLocaleString()}
Updated: ${metrics.updated_at}`);
    }

    // Recent payment sessions (fee revenue)
    const sessions = db.query(
      "SELECT amount_usd, amount_hsmc, status, processor, created_at FROM payment_sessions WHERE status = 'settled' ORDER BY created_at DESC LIMIT 10"
    ).all() as Array<Record<string, unknown>>;

    if (sessions.length > 0) {
      parts.push(`## Recent Settled Payments\n\`\`\`json\n${JSON.stringify(sessions, null, 2)}\n\`\`\``);
    }

  } catch (e) {
    parts.push(`[Auditor] Context build warning: ${(e as Error).message}`);
  }

  if (parts.length === 0) {
    parts.push("## Status: No treasury data available yet.");
  }

  return parts.join("\n\n");
}
