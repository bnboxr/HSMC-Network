/**
 * HSMC Bridge Relayer — Multi-chain Multi-sig (M-of-N) Production
 * ===============================================================
 *
 * Feature #22: Bridge Hardening
 *
 * Watches the HSMC mainnet for `bridge.lock` events across multiple
 * destination chains, signs the (chainId, txHash, recipient, amount)
 * tuple with this validator's key, gossips signatures via Supabase,
 * and executes mint on the destination chain when threshold is met.
 *
 * **Multi-chain support**: One relayer instance can handle all 8 EVM
 * chains simultaneously. Non-EVM chains (Solana, Cosmos) use
 * chain-specific mint flows.
 *
 * **M-of-N threshold signatures**: Each validator independently signs.
 * When M validators have signed the same (chainId, txHash, recipient,
 * amount) tuple, the relayer submits executeMint() with the collected
 * signatures sorted by signer address (ascending).
 *
 * **Fraud-proof flow (challengePeriod > 0)**:
 *   - executeMint() emits MintProposed with proposalId
 *   - Relayer tracks proposals and calls finalizeMint() after expiry
 *   - Anyone can challenge during the window
 *
 * **Backward compat (challengePeriod == 0)**:
 *   - executeMint() mints immediately
 *
 * Run one instance per validator (5 total for 3-of-5).
 * Each instance needs its own VALIDATOR_PRIVATE_KEY.
 *
 * Env:
 *   HSMC_NODE_URL               http://node:8080
 *   VALIDATOR_PRIVATE_KEY        0x… (THIS validator's signer key)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   POLL_INTERVAL_MS             default 5000
 *
 * Per-chain (set any chains you want to relay):
 *   ETH_RPC_URL / BRIDGE_MINTER_ADDRESS_ETH / WHSMC_ADDRESS_ETH
 *   BSC_RPC_URL / BRIDGE_MINTER_ADDRESS_BSC / WHSMC_ADDRESS_BSC
 *   POLYGON_RPC_URL / BRIDGE_MINTER_ADDRESS_POLYGON / WHSMC_ADDRESS_POLYGON
 *   AVALANCHE_RPC_URL / BRIDGE_MINTER_ADDRESS_AVALANCHE / WHSMC_ADDRESS_AVALANCHE
 *   ARBITRUM_RPC_URL / BRIDGE_MINTER_ADDRESS_ARBITRUM / WHSMC_ADDRESS_ARBITRUM
 *   OPTIMISM_RPC_URL / BRIDGE_MINTER_ADDRESS_OPTIMISM / WHSMC_ADDRESS_OPTIMISM
 *   BASE_RPC_URL / BRIDGE_MINTER_ADDRESS_BASE / WHSMC_ADDRESS_BASE
 */
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────

interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  bridgeMinterAddress: string;
  whsmcAddress: string;
}

interface SignatureEntry {
  signer: string;
  signature: string;
  created_at?: string;
}

interface ProposalInfo {
  proposalId: bigint;
  expiresAt: number;
  chainId: number;
}

interface LockEvent {
  hsmc_tx_hash: string;
  dest_chain: string;
  dest_address: string;
  amount: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const HSMC_NODE_URL    = process.env.HSMC_NODE_URL!;
const VALIDATOR_PK     = process.env.VALIDATOR_PRIVATE_KEY!;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ─── Chain configs ────────────────────────────────────────────────────────

function buildChainConfigs(): ChainConfig[] {
  const configs: ChainConfig[] = [];

  const chains: Array<{ name: string; chainId: number; rpcEnv: string; bridgeEnv: string; whsmcEnv: string }> = [
    { name: "ethereum",  chainId: 1,     rpcEnv: "ETH_RPC_URL",       bridgeEnv: "BRIDGE_MINTER_ADDRESS_ETH",       whsmcEnv: "WHSMC_ADDRESS_ETH" },
    { name: "bsc",       chainId: 56,    rpcEnv: "BSC_RPC_URL",       bridgeEnv: "BRIDGE_MINTER_ADDRESS_BSC",       whsmcEnv: "WHSMC_ADDRESS_BSC" },
    { name: "polygon",   chainId: 137,   rpcEnv: "POLYGON_RPC_URL",   bridgeEnv: "BRIDGE_MINTER_ADDRESS_POLYGON",   whsmcEnv: "WHSMC_ADDRESS_POLYGON" },
    { name: "avalanche", chainId: 43114, rpcEnv: "AVALANCHE_RPC_URL",  bridgeEnv: "BRIDGE_MINTER_ADDRESS_AVALANCHE",  whsmcEnv: "WHSMC_ADDRESS_AVALANCHE" },
    { name: "arbitrum",  chainId: 42161, rpcEnv: "ARBITRUM_RPC_URL",   bridgeEnv: "BRIDGE_MINTER_ADDRESS_ARBITRUM",   whsmcEnv: "WHSMC_ADDRESS_ARBITRUM" },
    { name: "optimism",  chainId: 10,    rpcEnv: "OPTIMISM_RPC_URL",   bridgeEnv: "BRIDGE_MINTER_ADDRESS_OPTIMISM",   whsmcEnv: "WHSMC_ADDRESS_OPTIMISM" },
    { name: "base",      chainId: 8453,  rpcEnv: "BASE_RPC_URL",       bridgeEnv: "BRIDGE_MINTER_ADDRESS_BASE",       whsmcEnv: "WHSMC_ADDRESS_BASE" },
  ];

  for (const c of chains) {
    const rpcUrl = process.env[c.rpcEnv];
    const bridgeAddr = process.env[c.bridgeEnv];
    const whsmcAddr = process.env[c.whsmcEnv];
    if (rpcUrl && bridgeAddr && whsmcAddr) {
      configs.push({ name: c.name, chainId: c.chainId, rpcUrl, bridgeMinterAddress: bridgeAddr, whsmcAddress: whsmcAddr });
    }
  }

  return configs;
}

// ─── Bridge ABI ───────────────────────────────────────────────────────────

const BRIDGE_ABI = [
  "function threshold() view returns (uint256)",
  "function processed(bytes32) view returns (bool)",
  "function challengePeriod() view returns (uint256)",
  "function executeMint(bytes32,address,uint256,bytes[])",
  "function finalizeMint(uint256)",
  "function canFinalize(uint256) view returns (bool)",
  "function getProposalId(bytes32) view returns (uint256)",
  "event MintProposed(uint256 indexed proposalId, bytes32 indexed hsmcTxHash, address indexed to, uint256 amount, uint256 expiresAt, address[] signers)",
  "event MintFinalized(uint256 indexed proposalId, bytes32 indexed hsmcTxHash)",
  "event Minted(bytes32 indexed hsmcTxHash, address indexed to, uint256 amount)",
  "event MintChallenged(uint256 indexed proposalId, bytes32 indexed hsmcTxHash, address indexed challenger, bytes proof)",
];

// ─── Signing ──────────────────────────────────────────────────────────────

/**
 * Compute the EIP-191 digest a validator signs for a bridge event.
 * Mirrors BridgeMinter.sol: keccak256(abi.encode(chainId, bridgeAddr, txHash, to, amount)).toEthSignedMessageHash()
 */
function bridgeDigest(
  chainId: number,
  bridgeAddr: string,
  hsmcTxHash: string,
  to: string,
  amount: bigint,
): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "bytes32", "address", "uint256"],
    [chainId, bridgeAddr, hsmcTxHash, to, amount],
  );
  return ethers.keccak256(encoded);
}

// ─── Chain relay context ──────────────────────────────────────────────────

interface RelayContext {
  config: ChainConfig;
  provider: ethers.JsonRpcProvider;
  wallet: ethers.Wallet;
  bridge: ethers.Contract;
  pendingProposals: Map<string, ProposalInfo>;
}

async function createRelayContext(config: ChainConfig): Promise<RelayContext> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(VALIDATOR_PK, provider);
  const bridge = new ethers.Contract(config.bridgeMinterAddress, BRIDGE_ABI, wallet);

  return {
    config,
    provider,
    wallet,
    bridge,
    pendingProposals: new Map(),
  };
}

// ─── Load pending proposals from DB ───────────────────────────────────────

async function loadPendingProposals(ctx: RelayContext): Promise<void> {
  const { data } = await supabase
    .from("bridge_proposals")
    .select("hsmc_tx_hash, proposal_id, expires_at, chain_id")
    .eq("finalized", false)
    .eq("chain_id", ctx.config.chainId);

  for (const row of data ?? []) {
    ctx.pendingProposals.set(row.hsmc_tx_hash, {
      proposalId: BigInt(row.proposal_id),
      expiresAt: Number(row.expires_at),
      chainId: Number(row.chain_id),
    });
  }
  console.log(`[${ctx.config.name}] Loaded ${ctx.pendingProposals.size} pending proposals from DB`);
}

// ─── Main relay loop for a single chain ───────────────────────────────────

async function relayLoop(ctx: RelayContext): Promise<void> {
  const { config, wallet, bridge } = ctx;

  while (true) {
    try {
      await pollLockEvents(ctx);
      await finalizeExpiredProposals(ctx);
    } catch (e) {
      console.error(`[${config.name}] Relay loop error:`, (e as Error).message);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ─── Poll lock events from HSMC mainnet ───────────────────────────────────

async function pollLockEvents(ctx: RelayContext): Promise<void> {
  const { config, bridge } = ctx;

  let events: LockEvent[] = [];
  try {
    const res = await fetch(`${HSMC_NODE_URL}/bridge/pending`);
    if (!res.ok) return;
    events = (await res.json()) ?? [];
  } catch {
    return; // Node unreachable — skip this round
  }

  for (const ev of events) {
    const { hsmc_tx_hash, dest_address, amount } = ev;
    if (await bridge.processed(hsmc_tx_hash)) continue;

    const amountBn = BigInt(amount);
    const digest = bridgeDigest(config.chainId, config.bridgeMinterAddress, hsmc_tx_hash, dest_address, amountBn);

    // Sign with this validator's key
    const sig = await wallet.signMessage(ethers.getBytes(digest));

    // ── Gossip signature to shared queue ──────────────────────────────
    await supabase.from("bridge_signatures").upsert({
      hsmc_tx_hash,
      chain_id: config.chainId,
      dest_address,
      amount: amount.toString(),
      signer: wallet.address,
      signature: sig,
    }, { onConflict: "hsmc_tx_hash,chain_id,signer" });

    // ── Check if enough signatures accumulated ────────────────────────
    const { data: sigs } = await supabase
      .from("bridge_signatures")
      .select("signer,signature")
      .eq("hsmc_tx_hash", hsmc_tx_hash)
      .eq("chain_id", config.chainId);

    const thresh = Number(await bridge.threshold());
    if ((sigs?.length ?? 0) >= thresh) {
      // Sort by signer address (ascending) — required by BridgeMinter
      const sorted = sigs!.sort((a, b) =>
        a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1
      );

      try {
        const tx = await bridge.executeMint(
          hsmc_tx_hash,
          dest_address,
          amountBn,
          sorted.slice(0, thresh).map(s => s.signature),
        );
        const receipt = await tx.wait();

        console.log(`[${config.name}] executeMint tx: ${tx.hash}`);

        // ── Check if challenge period is active ────────────────────────
        const challengePeriod = await bridge.challengePeriod();
        if (challengePeriod > 0n) {
          const iface = new ethers.Interface(BRIDGE_ABI);
          for (const log of receipt.logs) {
            try {
              const parsed = iface.parseLog(log);
              if (parsed?.name === "MintProposed") {
                const proposalId = parsed.args.proposalId;
                const expiresAt = Number(parsed.args.expiresAt);
                console.log(
                  `[${config.name}] Proposed: ${hsmc_tx_hash} proposalId=${proposalId} expires=${new Date(expiresAt * 1000).toISOString()}`
                );
                ctx.pendingProposals.set(hsmc_tx_hash, { proposalId, expiresAt, chainId: config.chainId });

                await supabase.from("bridge_proposals").upsert({
                  hsmc_tx_hash,
                  chain_id: config.chainId,
                  proposal_id: proposalId.toString(),
                  expires_at: expiresAt,
                  finalized: false,
                  created_at: new Date().toISOString(),
                }, { onConflict: "hsmc_tx_hash,chain_id" });
              }
            } catch { /* ignore unparseable */ }
          }
        } else {
          console.log(`[${config.name}] Minted (instant): ${hsmc_tx_hash}`);

          // Log the mint event
          await supabase.from("bridge_events").insert({
            event_type: "Minted",
            hsmc_tx_hash,
            chain_id: config.chainId,
            chain_name: config.name,
            dest_address,
            amount: amount.toString(),
            tx_hash: tx.hash,
            block_number: receipt.blockNumber,
            created_at: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.warn(`[${config.name}] executeMint failed for ${hsmc_tx_hash}:`, (e as Error).message);
      }
    }
  }
}

// ─── Finalize expired proposals ───────────────────────────────────────────

async function finalizeExpiredProposals(ctx: RelayContext): Promise<void> {
  const { config, bridge } = ctx;

  for (const [hsmcTxHash, info] of ctx.pendingProposals) {
    if (Date.now() / 1000 < info.expiresAt) continue;

    try {
      const canFin = await bridge.canFinalize(info.proposalId);
      if (!canFin) {
        console.log(`[${config.name}] Skip finalize proposalId=${info.proposalId} — canFinalize=false`);
        ctx.pendingProposals.delete(hsmcTxHash);
        await supabase.from("bridge_proposals").update({ finalized: true }).eq("hsmc_tx_hash", hsmcTxHash).eq("chain_id", config.chainId);
        continue;
      }

      const tx = await bridge.finalizeMint(info.proposalId);
      console.log(`[${config.name}] Finalizing proposalId=${info.proposalId} tx=${tx.hash}`);
      await tx.wait();
      console.log(`[${config.name}] Finalized: ${hsmcTxHash}`);

      ctx.pendingProposals.delete(hsmcTxHash);
      await supabase.from("bridge_proposals").update({ finalized: true }).eq("hsmc_tx_hash", hsmcTxHash).eq("chain_id", config.chainId);

      // Log finalized event
      await supabase.from("bridge_events").insert({
        event_type: "MintFinalized",
        hsmc_tx_hash: hsmcTxHash,
        chain_id: config.chainId,
        chain_name: config.name,
        tx_hash: tx.hash,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn(`[${config.name}] Finalize failed proposalId=${info.proposalId}:`, (e as Error).message);
    }
  }
}

// ─── Health reporting ─────────────────────────────────────────────────────

async function reportHealth(ctx: RelayContext): Promise<void> {
  const { config, provider, wallet } = ctx;
  try {
    const blockNumber = await provider.getBlockNumber();
    const nativeBalance = await provider.getBalance(wallet.address);

    await supabase.from("relayer_health").upsert({
      validator_address: wallet.address,
      chain_name: config.name,
      chain_id: config.chainId,
      last_block: blockNumber,
      native_balance: nativeBalance.toString(),
      last_heartbeat: new Date().toISOString(),
    }, { onConflict: "validator_address,chain_name" });
  } catch (e) {
    console.warn(`[${config.name}] Health report failed:`, (e as Error).message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

(async () => {
  const chainConfigs = buildChainConfigs();

  if (chainConfigs.length === 0) {
    console.error("❌ No chain configurations found. Set at least one EVM chain's env vars.");
    console.error("   Example: ETH_RPC_URL, BRIDGE_MINTER_ADDRESS_ETH, WHSMC_ADDRESS_ETH");
    process.exit(1);
  }

  const contexts: RelayContext[] = [];
  for (const config of chainConfigs) {
    const ctx = await createRelayContext(config);
    await loadPendingProposals(ctx);
    contexts.push(ctx);
  }

  console.log(`\n🔄 HSMC Multi-chain Relayer Started`);
  console.log(`   Validator: ${contexts[0].wallet.address}`);
  console.log(`   Chains (${contexts.length}): ${contexts.map(c => c.config.name).join(", ")}`);
  console.log(`   Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`   HSMC Node: ${HSMC_NODE_URL}\n`);

  // Start relay loops for each chain (concurrent)
  const loops = contexts.map(ctx => relayLoop(ctx));

  // Heartbeat reporting every 60s
  const heartbeat = async () => {
    while (true) {
      await Promise.all(contexts.map(ctx => reportHealth(ctx)));
      await new Promise(r => setTimeout(r, 60_000));
    }
  };

  await Promise.all([...loops, heartbeat()]);
})();
