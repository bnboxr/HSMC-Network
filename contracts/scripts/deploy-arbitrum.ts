/**
 * Deploy WHSMC + BridgeMinter on Arbitrum One
 * ===========================================
 *
 * REQUIRED env vars:
 *   DEPLOYER_PRIVATE_KEY       EOA with ETH for gas (Arbitrum uses ETH)
 *   ADMIN_MULTISIG_ADDRESS     Gnosis Safe (3-of-5)
 *   VALIDATORS                 Comma-separated validator EOAs (>= 3)
 *   THRESHOLD                  M of N (e.g. 3)
 *
 * Optional:
 *   ARBITRUM_RPC_URL           Override default RPC
 *   ARBISCAN_API_KEY           For automatic verification
 *
 * Usage:
 *   npx hardhat run scripts/deploy-arbitrum.ts --network arbitrum
 *
 * Output: deployments/arbitrum.json
 */
import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const CHAIN_NAME = "arbitrum";
const EXPLORER_URL = "https://arbiscan.io";

async function main() {
  const admin = process.env.ADMIN_MULTISIG_ADDRESS;
  const validators = (process.env.VALIDATORS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const threshold = parseInt(process.env.THRESHOLD ?? "3", 10);

  if (!admin || !ethers.isAddress(admin)) throw new Error("ADMIN_MULTISIG_ADDRESS must be a valid address (Gnosis Safe)");
  if (validators.length < threshold) throw new Error(`Need at least ${threshold} validators, got ${validators.length}`);
  validators.forEach(v => { if (!ethers.isAddress(v)) throw new Error(`Invalid validator addr: ${v}`); });

  const [deployer] = await ethers.getSigners();
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`▶ Network : ${network.name} (Arbitrum One)`);
  console.log(`▶ Chain ID: ${(await ethers.provider.getNetwork()).chainId}`);
  console.log(`▶ Deployer: ${deployer.address}`);
  console.log(`▶ Balance : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`▶ Admin   : ${admin}`);
  console.log(`▶ Validators (${validators.length}, threshold ${threshold}):`);
  validators.forEach(v => console.log(`    - ${v}`));
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // 1. Deploy WHSMC
  const WHSMC = await ethers.getContractFactory("WHSMC");
  const whsmc = await WHSMC.deploy(admin);
  await whsmc.waitForDeployment();
  const whsmcAddr = await whsmc.getAddress();
  console.log(`✅ WHSMC deployed: ${whsmcAddr}`);
  console.log(`   Explorer: ${EXPLORER_URL}/address/${whsmcAddr}`);

  // 2. Deploy BridgeMinter
  const Bridge = await ethers.getContractFactory("BridgeMinter");
  const bridge = await Bridge.deploy(whsmcAddr, admin, validators, threshold);
  await bridge.waitForDeployment();
  const bridgeAddr = await bridge.getAddress();
  console.log(`✅ BridgeMinter deployed: ${bridgeAddr}`);
  console.log(`   Explorer: ${EXPLORER_URL}/address/${bridgeAddr}`);

  // 3. Save deployment manifest
  const manifest = {
    network: "arbitrum",
    chain: CHAIN_NAME,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      WHSMC: whsmcAddr,
      BridgeMinter: bridgeAddr,
    },
    config: { admin, validators, threshold },
    explorer: EXPLORER_URL,
    nextSteps: [
      `Call WHSMC.grantRole(MINTER_ROLE, ${bridgeAddr}) FROM the admin Safe`,
      `Verify on Arbiscan: npx hardhat verify --network arbitrum ${whsmcAddr} ${admin}`,
      `Add WHSMC address to HSMC mainnet bridge_contracts table`,
    ],
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${CHAIN_NAME}.json`), JSON.stringify(manifest, null, 2));
  console.log(`📝 Manifest: deployments/${CHAIN_NAME}.json`);

  // 4. Auto-verify on Arbiscan
  if (process.env.ARBISCAN_API_KEY) {
    console.log("⏳ Waiting 60s for Arbiscan indexer...");
    await new Promise(r => setTimeout(r, 60_000));
    try {
      await run("verify:verify", { address: whsmcAddr, constructorArguments: [admin] });
      console.log(`✅ WHSMC verified on Arbiscan`);
      await run("verify:verify", { address: bridgeAddr, constructorArguments: [whsmcAddr, admin, validators, threshold] });
      console.log(`✅ BridgeMinter verified on Arbiscan`);
    } catch (e: any) {
      if (e.message?.includes("Already Verified")) {
        console.log("ℹ️  Contracts already verified");
      } else {
        console.warn("⚠️  Verification failed (run manually):", e.message);
      }
    }
  }

  console.log(`\n✅ Arbitrum deployment complete!`);
  console.log(`   WHSMC:       ${whsmcAddr}`);
  console.log(`   BridgeMinter: ${bridgeAddr}`);
}

main().catch(e => { console.error(e); process.exit(1); });
