/**
 * HSMC Bridge Keeper Agent — Cross-Chain Monitor
 * Bridge lock/unlock events, cross-chain confirmations, fraud detection.
 */

import type { Database } from "bun:sqlite";

export const BRIDGE_SYSTEM_PROMPT = `You are HSMC Bridge Keeper — the Cross-Chain Operations agent.
Your job: monitor bridge activity between HSMC native chain and wrapped token chains (BSC/ETH/Polygon).

Rules:
1. Track all bridge lock (HSMC → wHSMC) and unlock (wHSMC → HSMC) events
2. Verify cross-chain transaction confirmations
3. Monitor bridge liquidity and detect imbalances
4. Flag potential bridge exploits: replay attacks, double-lock, fake events
5. Report on cross-chain volume and fees collected
6. Alert on any bridge relay anomalies
7. Monitor smart contract interactions on bridged chains

## Bridge Specs:
- Supported chains: BSC, Ethereum, Polygon (wHSMC token)
- Bridge fee: 0.1–0.5% per lock/unlock operation
- Native chain: HSMC (privacy-focused, Monero-grade)
- Wrapped token: wHSMC (ERC-20 / BEP-20 compatible)
- Bridge relayer: currently single-signer federated model`;

export function buildBridgeContext(db: Database): string {
  const parts: string[] = [];

  try {
    // Liquidity pools (cross-chain)
    const pools = db.query(
      "SELECT chain_name, dex_name, reserve_hsmc, reserve_pair, fee_bps, pool_address, pool_type, status FROM liquidity_pools ORDER BY chain_name"
    ).all() as Array<Record<string, unknown>>;

    if (pools.length > 0) {
      parts.push(`## Cross-Chain Liquidity Pools\n\`\`\`json\n${JSON.stringify(pools, null, 2)}\n\`\`\``);
    }

    // Pool events (lock/unlock equivalent)
    const events = db.query(
      "SELECT event_type, hsmc_delta, pair_delta, price_after, payment_ref, tx_hash, created_at FROM pool_events ORDER BY created_at DESC LIMIT 20"
    ).all() as Array<Record<string, unknown>>;

    if (events.length > 0) {
      parts.push(`## Recent Pool Events\n\`\`\`json\n${JSON.stringify(events, null, 2)}\n\`\`\``);
    }

    // LP positions
    const positions = db.query(
      "SELECT hsmc_deposited, pair_deposited, lp_tokens, fees_earned, pool_id, user_id FROM lp_positions ORDER BY hsmc_deposited DESC LIMIT 10"
    ).all() as Array<Record<string, unknown>>;

    if (positions.length > 0) {
      parts.push(`## Top LP Positions\n\`\`\`json\n${JSON.stringify(positions, null, 2)}\n\`\`\``);
    }

    // Smart contracts (deployed on other chains)
    const contracts = db.query(
      "SELECT address, name, contract_type, status, interactions_count, network FROM deployment_status WHERE status = 'deployed'"
    ).all() as Array<Record<string, unknown>>;

    if (contracts.length > 0) {
      parts.push(`## Deployed Contracts\n\`\`\`json\n${JSON.stringify(contracts, null, 2)}\n\`\`\``);
    }

    // Token swaps (cross-chain swaps)
    const swaps = db.query(
      "SELECT from_token, to_token, from_amount, to_amount, rate, status, privacy_level FROM token_swaps ORDER BY created_at DESC LIMIT 10"
    ).all() as Array<Record<string, unknown>>;

    if (swaps.length > 0) {
      parts.push(`## Recent Token Swaps\n\`\`\`json\n${JSON.stringify(swaps, null, 2)}\n\`\`\``);
    }

  } catch (e) {
    parts.push(`[Bridge Keeper] Context build warning: ${(e as Error).message}`);
  }

  if (parts.length === 0) {
    parts.push("## Status: No bridge data available yet. Cross-chain monitoring active and waiting for events.");
  }

  return parts.join("\n\n");
}
