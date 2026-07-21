/**
 * HSMC Bridge Relayer — production-ready with fraud proof support.
 *
 * Watches the HSMC mainnet for `bridge.lock` events, signs the
 * (txHash, recipient, amount) tuple with this validator's key, and
 * gossips the signature to other validators via a shared Postgres
 * queue. When `threshold` signatures collected, calls
 * BridgeMinter.executeMint() on the destination EVM chain.
 *
 * **Fraud-proof flow (challengePeriod > 0)**:
 *   1. executeMint() emits MintProposed with proposalId
 *   2. Relayer watches for MintProposed events and stores proposalId
 *   3. After challengePeriod expires, calls finalizeMint(proposalId)
 *
 * **Backward compat (challengePeriod == 0)**:
 *   executeMint() mints immediately — relayer works unchanged.
 *
 * Run one of these per validator (5 total for 3-of-5 multisig).
 * Distinct VALIDATOR_PRIVATE_KEY per instance.
 *
 * Env:
 *   HSMC_NODE_URL              http://node:8080         (Rust node JSON-RPC)
 *   EVM_RPC_URL                https://bsc-dataseed.…   (destination chain)
 *   BRIDGE_MINTER_ADDRESS      0x… (from contracts/deployments/<net>.json)
 *   VALIDATOR_PRIVATE_KEY      0x… (THIS validator's signer)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (signature gossip table)
 *   POLL_INTERVAL_MS           default 5000
 */
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";

const HSMC_NODE_URL    = process.env.HSMC_NODE_URL!;
const EVM_RPC_URL      = process.env.EVM_RPC_URL!;
const BRIDGE_ADDRESS   = process.env.BRIDGE_MINTER_ADDRESS!;
const VALIDATOR_PK     = process.env.VALIDATOR_PRIVATE_KEY!;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const provider = new ethers.JsonRpcProvider(EVM_RPC_URL);
const wallet   = new ethers.Wallet(VALIDATOR_PK, provider);

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
const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, wallet);

async function digest(hsmcTx: string, to: string, amount: bigint): Promise<string> {
  const chainId = (await provider.getNetwork()).chainId;
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "bytes32", "address", "uint256"],
      [chainId, BRIDGE_ADDRESS, hsmcTx, to, amount]
    )
  );
}

// Track proposals pending finalization (in-memory + DB for persistence)
const pendingProposals = new Map<string, { proposalId: bigint; expiresAt: number }>();

async function loadPendingProposals() {
  const { data } = await supabase
    .from("bridge_proposals")
    .select("hsmc_tx_hash, proposal_id, expires_at")
    .eq("finalized", false);
  for (const row of data ?? []) {
    pendingProposals.set(row.hsmc_tx_hash, {
      proposalId: BigInt(row.proposal_id),
      expiresAt: Number(row.expires_at),
    });
  }
  console.log(`Loaded ${pendingProposals.size} pending proposals from DB`);
}

async function checkChallengePeriod(): Promise<bigint> {
  return bridge.challengePeriod();
}

async function pollLockEvents() {
  const r = await fetch(`${HSMC_NODE_URL}/bridge/pending`).then(r => r.json()).catch(() => []);
  for (const ev of r ?? []) {
    const { hsmc_tx_hash, dest_address, amount } = ev;
    if (await bridge.processed(hsmc_tx_hash)) continue;

    const d = await digest(hsmc_tx_hash, dest_address, BigInt(amount));
    const sig = await wallet.signMessage(ethers.getBytes(d));

    // Gossip signature
    await supabase.from("bridge_signatures").upsert({
      hsmc_tx_hash, dest_address, amount: amount.toString(),
      signer: wallet.address, signature: sig,
    }, { onConflict: "hsmc_tx_hash,signer" });

    // Try to assemble & submit
    const { data: sigs } = await supabase
      .from("bridge_signatures").select("signer,signature")
      .eq("hsmc_tx_hash", hsmc_tx_hash);

    const thresh = Number(await bridge.threshold());
    if ((sigs?.length ?? 0) >= thresh) {
      const sorted = sigs!.sort((a, b) => a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1);
      try {
        const tx = await bridge.executeMint(
          hsmc_tx_hash, dest_address, BigInt(amount),
          sorted.slice(0, thresh).map(s => s.signature)
        );
        const receipt = await tx.wait();

        // Check if challenge period is active → extract proposalId from event
        const challengePeriod = await checkChallengePeriod();
        if (challengePeriod > 0n) {
          // Parse MintProposed event from receipt
          const iface = new ethers.Interface(BRIDGE_ABI);
          for (const log of receipt.logs) {
            try {
              const parsed = iface.parseLog(log);
              if (parsed?.name === "MintProposed") {
                const proposalId = parsed.args.proposalId;
                const expiresAt = Number(parsed.args.expiresAt);
                console.log(
                  `[proposed] tx=${hsmc_tx_hash} proposalId=${proposalId} expires=${new Date(expiresAt * 1000).toISOString()}`
                );
                pendingProposals.set(hsmc_tx_hash, { proposalId, expiresAt });

                // Persist to DB
                await supabase.from("bridge_proposals").upsert({
                  hsmc_tx_hash,
                  proposal_id: proposalId.toString(),
                  expires_at: expiresAt,
                  finalized: false,
                }, { onConflict: "hsmc_tx_hash" });
              }
            } catch { /* ignore unparseable logs */ }
          }
        } else {
          console.log(`[minted] ${hsmc_tx_hash} → ${tx.hash} (instant, no challenge period)`);
        }
      } catch (e) {
        console.warn(`[mint failed] ${hsmc_tx_hash}:`, (e as Error).message);
      }
    }
  }
}

/**
 * Poll pending proposals and finalize any whose challenge period has expired.
 */
async function finalizeExpiredProposals() {
  for (const [hsmcTxHash, info] of pendingProposals) {
    if (Date.now() / 1000 < info.expiresAt) continue; // not yet expired

    try {
      // Double-check on-chain state
      const canFin = await bridge.canFinalize(info.proposalId);
      if (!canFin) {
        // May have been challenged or already finalized by another relayer
        console.log(`[skip-finalize] proposalId=${info.proposalId} canFinalize=false`);
        pendingProposals.delete(hsmcTxHash);
        await supabase.from("bridge_proposals").update({ finalized: true }).eq("hsmc_tx_hash", hsmcTxHash);
        continue;
      }

      const tx = await bridge.finalizeMint(info.proposalId);
      console.log(`[finalizing] proposalId=${info.proposalId} tx=${tx.hash}`);
      await tx.wait();
      console.log(`[finalized] proposalId=${info.proposalId} hsmcTxHash=${hsmcTxHash}`);

      pendingProposals.delete(hsmcTxHash);
      await supabase.from("bridge_proposals").update({ finalized: true }).eq("hsmc_tx_hash", hsmcTxHash);
    } catch (e) {
      console.warn(`[finalize failed] proposalId=${info.proposalId}:`, (e as Error).message);
    }
  }
}

(async () => {
  console.log(`Relayer started. Validator: ${wallet.address}`);
  const cp = await checkChallengePeriod();
  console.log(`Challenge period: ${cp}s (${cp > 0n ? 'enabled' : 'disabled — instant mint'})`);

  await loadPendingProposals();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollLockEvents();
      await finalizeExpiredProposals();
    } catch (e) { console.error(e); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
})();
