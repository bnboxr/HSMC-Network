/**
 * Deploys WHSMC + BridgeMinter to the selected network.
 *
 * REQUIRED env vars:
 *   DEPLOYER_PRIVATE_KEY    EOA with native gas (BNB/ETH/MATIC)
 *   ADMIN_MULTISIG_ADDRESS  Gnosis Safe (3-of-5) — receives admin role
 *   VALIDATORS              Comma-separated validator EOAs (>= 3)
 *   THRESHOLD               M of N (e.g. 3)
 *
 * Output: writes deployment.<network>.json with addresses + abi hashes.
 */
import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const admin = process.env.ADMIN_MULTISIG_ADDRESS;
  const validators = (process.env.VALIDATORS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const threshold = parseInt(process.env.THRESHOLD ?? "3", 10);

  if (!admin || !ethers.isAddress(admin)) throw new Error("ADMIN_MULTISIG_ADDRESS must be a valid address (Gnosis Safe)");
  if (validators.length < threshold) throw new Error(`Need at least ${threshold} validators, got ${validators.length}`);
  validators.forEach(v => { if (!ethers.isAddress(v)) throw new Error(`Invalid validator addr: ${v}`); });

  const [deployer] = await ethers.getSigners();
  console.log(`▶ Network : ${network.name}`);
  console.log(`▶ Deployer: ${deployer.address}`);
  console.log(`▶ Balance : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);
  console.log(`▶ Admin   : ${admin}`);
  console.log(`▶ Validators (${validators.length}, threshold ${threshold}):`);
  validators.forEach(v => console.log(`    - ${v}`));

  // 1. Deploy WHSMC
  const WHSMC = await ethers.getContractFactory("WHSMC");
  const whsmc = await WHSMC.deploy(admin);
  await whsmc.waitForDeployment();
  const whsmcAddr = await whsmc.getAddress();
  console.log(`✅ WHSMC deployed: ${whsmcAddr}`);

  // 2. Deploy BridgeMinter
  const Bridge = await ethers.getContractFactory("BridgeMinter");
  const bridge = await Bridge.deploy(whsmcAddr, admin, validators, threshold);
  await bridge.waitForDeployment();
  const bridgeAddr = await bridge.getAddress();
  console.log(`✅ BridgeMinter deployed: ${bridgeAddr}`);

  // 3. Save deployment manifest
  const manifest = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      WHSMC: whsmcAddr,
      BridgeMinter: bridgeAddr,
    },
    config: { admin, validators, threshold },
    nextSteps: [
      "Call WHSMC.grantRole(MINTER_ROLE, BridgeMinter) FROM the admin Safe",
      "Call WHSMC.renounceRole(DEFAULT_ADMIN_ROLE, deployer) IF deployer accidentally got admin",
      "Verify both contracts on the chain explorer (npm run verify:<network>)",
      "Add WHSMC address to HSMC mainnet `bridge_contracts` table",
    ],
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify(manifest, null, 2));
  console.log(`📝 Manifest: deployments/${network.name}.json`);

  // 4. Auto-verify if explorer key present
  if (process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || process.env.POLYGONSCAN_API_KEY) {
    console.log("⏳ Waiting 30s for indexer before verification...");
    await new Promise(r => setTimeout(r, 30_000));
    try {
      await run("verify:verify", { address: whsmcAddr, constructorArguments: [admin] });
      await run("verify:verify", { address: bridgeAddr, constructorArguments: [whsmcAddr, admin, validators, threshold] });
    } catch (e) { console.warn("Verification failed (run manually):", e); }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
