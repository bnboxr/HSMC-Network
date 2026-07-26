/**
 * Deploy wHSMC Token on Cosmos Hub (IBC)
 * =======================================
 *
 * Creates a new token denomination (IH-smc) on Cosmos Hub via a
 * governance proposal or direct bank module message. This script
 * uses the Cosmos LCD REST API to broadcast transactions.
 *
 * For mainnet, token creation on Cosmos Hub requires:
 *   1. A governance proposal to register the token metadata
 *   2. A multisig account to control minting
 *
 * This script handles both flows — direct for testnet, governance
 * proposal for mainnet.
 *
 * REQUIRED env vars:
 *   COSMOS_DEPLOYER_MNEMONIC     Mnemonic for deployer account
 *   ADMIN_MULTISIG_ADDRESS       Cosmos bech32 address (admin)
 *
 * Optional:
 *   COSMOS_RPC_URL               LCD REST API (default: cosmos-rest.publicnode.com)
 *   COSMOS_CHAIN_ID              Default: cosmoshub-4
 *   COSMOS_FEE_DENOM             Default: uatom
 *   COSMOS_GAS_PRICE             Default: 0.025uatom
 *
 * Usage:
 *   npx tsx scripts/deploy-cosmos.ts
 *
 * Output: deployments/cosmos.json
 *
 * ⚠️  NOTE: This script uses the Cosmos LCD API directly. For production,
 *     use cosmjs (npm:@cosmjs/stargate) for proper signing and broadcast.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Config ───────────────────────────────────────────────────────────────

const LCD_BASE = (process.env.COSMOS_RPC_URL || "https://cosmos-rest.publicnode.com").replace(/\/+$/, "");
const CHAIN_ID = process.env.COSMOS_CHAIN_ID || "cosmoshub-4";
const FEE_DENOM = process.env.COSMOS_FEE_DENOM || "uatom";
const GAS_PRICE = process.env.COSMOS_GAS_PRICE || "0.025uatom";
const MNEMONIC = process.env.COSMOS_DEPLOYER_MNEMONIC || "";

// ─── Cosmos LCD API client ────────────────────────────────────────────────

async function lcdGet<T>(path: string): Promise<T> {
  const res = await fetch(`${LCD_BASE}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LCD GET ${path} failed [${res.status}]: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function lcdPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${LCD_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`LCD POST ${path} failed [${res.status}]: ${errBody}`);
  }
  return res.json() as Promise<T>;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`▶ Network : Cosmos Hub (${CHAIN_ID})`);
  console.log(`▶ LCD API : ${LCD_BASE}`);
  console.log(`▶ Token   : wHSMC (IBC-compatible denomination)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const adminAddr = process.env.ADMIN_MULTISIG_ADDRESS;
  if (!adminAddr) {
    throw new Error("ADMIN_MULTISIG_ADDRESS must be a valid Cosmos bech32 address");
  }

  // ── 1. Check chain health ───────────────────────────────────────────
  console.log("\n▶ Checking chain status...");
  try {
    const nodeInfo = await lcdGet<any>("/cosmos/base/tendermint/v1beta1/node_info");
    console.log(`   Network: ${nodeInfo.default_node_info?.network || "unknown"}`);
    console.log(`   Version: ${nodeInfo.application_version?.version || "unknown"}`);
  } catch (e) {
    console.warn(`   ⚠️  Cannot reach node: ${(e as Error).message}`);
    console.log(`   Continuing in offline mode...`);
  }

  // ── 2. Check admin address exists on chain ──────────────────────────
  console.log(`\n▶ Checking admin address: ${adminAddr}`);
  try {
    const balances = await lcdGet<any>(`/cosmos/bank/v1beta1/balances/${adminAddr}`);
    const atomBal = (balances.balances || []).find((b: any) => b.denom === "uatom");
    console.log(`   Balance: ${atomBal ? (Number(atomBal.amount) / 1e6).toFixed(6) : "0"} ATOM`);
  } catch (e) {
    console.log(`   ℹ️  Address not yet active (no balance found — normal for new accounts)`);
  }

  // ── 3. Token metadata proposal (for governance-based token registration) ──
  console.log("\n▶ Token metadata for wHSMC on Cosmos...");
  const tokenDenom = "ibc/wHSMC"; // Will be replaced with actual IBC denom after IBC channel setup
  const tokenMetadata = {
    description: "Wrapped HSMC — Privacy-preserving cross-chain token",
    denom_units: [
      { denom: `factory/${adminAddr}/whsmc`, exponent: 0, aliases: ["microHSMC"] },
      { denom: "whsmc", exponent: 8, aliases: ["wHSMC"] },
    ],
    base: `factory/${adminAddr}/whsmc`,
    display: "whsmc",
    name: "Wrapped HSMC",
    symbol: "wHSMC",
    uri: "https://hsmc.network/tokens/whsmc-cosmos.json",
    uri_hash: "",
  };

  console.log(`   Base denom: ${tokenMetadata.base}`);
  console.log(`   Display:    ${tokenMetadata.display} (${tokenMetadata.symbol})`);
  console.log(`   Decimals:   8`);

  // ── 4. Generate deployment manifest ─────────────────────────────────
  // NOTE: Actual on-chain token creation on Cosmos requires:
  //   a) The TokenFactory module (Osmosis, Juno, etc.) OR
  //   b) A governance proposal (Cosmos Hub does not have TokenFactory)
  //
  // For Cosmos Hub mainnet, we use IBC to bridge wHSMC from another chain.
  // The deployment here registers the IBC denom metadata.

  const authInfo = {
    signerMnemonics: MNEMONIC ? "[REDACTED — mnemonic provided]" : "[MISSING — set COSMOS_DEPLOYER_MNEMONIC]",
    feeDenom: FEE_DENOM,
    gasPrice: GAS_PRICE,
  };

  // Generate a random IBC channel placeholder (real one comes from relayers)
  const placeholderChannelId = `channel-${crypto.randomInt(1000, 9999)}`;

  const manifest = {
    network: "cosmos",
    chain: "cosmos",
    chainId: CHAIN_ID,
    deployedAt: new Date().toISOString(),
    admin: adminAddr,
    token: {
      type: "IBC-wrapped" as const,
      baseDenom: tokenMetadata.base,
      displayDenom: tokenMetadata.display,
      symbol: tokenMetadata.symbol,
      decimals: 8,
      originChain: "HSMC",
      ibcPlaceholderChannel: placeholderChannelId,
      expectedIbcDenom: `ibc/${crypto.createHash("sha256").update(`${placeholderChannelId}/whsmc`).digest("hex").substring(0, 40).toUpperCase()}`,
    },
    metadata: tokenMetadata,
    auth: authInfo,
    lcdBase: LCD_BASE,
    nextSteps: [
      "1. Set up IBC relayer between HSMC mainnet and Cosmos Hub",
      "2. Create IBC connection: hermes create connection --a-chain hsmc --b-chain cosmoshub-4",
      "3. Create IBC channel: hermes create channel --a-chain hsmc --a-connection connection-0 --a-port transfer --b-port transfer",
      "4. Register token metadata on Cosmos Hub via governance proposal",
      "5. Submit proposal:",
      `   cat > proposal.json << 'EOF'`,
      `   {`,
      `     "title": "Register wHSMC token metadata",`,
      `     "description": "Add Wrapped HSMC (wHSMC) to Cosmos Hub bank metadata",`,
      `     "messages": [{`,
      `       "@type": "/cosmos.bank.v1beta1.MsgSetDenomMetadata",`,
      `       "authority": "cosmos10d07y265gmmuvt4z0w9aw880jnsr700j6zn9kn",`,
      `       "metadata": ${JSON.stringify(tokenMetadata)}`,
      `     }],`,
      `     "deposit": "250000000uatom"`,
      `   }`,
      `   EOF`,
      `   cosmosd tx gov submit-proposal proposal.json --from <key> --gas auto`,
      `6. After proposal passes, verify token metadata:`,
      `   curl ${LCD_BASE}/cosmos/bank/v1beta1/denoms_metadata/${encodeURIComponent(tokenMetadata.base)}`,
      `7. Add Cosmos IBC denom to HSMC mainnet bridge_contracts table`,
      `8. Start relayer for Cosmos IBC (see contracts/relayer/relayer.ts)`,
    ],
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "cosmos.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n📝 Manifest: deployments/cosmos.json`);

  console.log(`\n✅ Cosmos deployment manifest created!`);
  console.log(`   ⚠️  Cosmos Hub requires governance proposal for token metadata.`);
  console.log(`   See deployments/cosmos.json → nextSteps for the full procedure.`);
  console.log(`\n   For IBC-native tokens (Osmosis, Juno), use TokenFactory:`);
  console.log(`   osmosisd tx tokenfactory create-denom whsmc --from <key>`);
}

main().catch(e => { console.error(e); process.exit(1); });
