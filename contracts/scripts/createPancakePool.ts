/**
 * Creates the wHSMC/WBNB liquidity pair on PancakeSwap V2 (BSC mainnet)
 * and seeds it with initial liquidity.
 *
 * REQUIRED env:
 *   DEPLOYER_PRIVATE_KEY       Funded with WHSMC + BNB
 *   WHSMC_ADDRESS              From deployments/bsc.json
 *   INITIAL_WHSMC              How much wHSMC to seed (human units, e.g. "1000000")
 *   INITIAL_BNB                How much BNB to seed (e.g. "10")
 *
 * Pancake V2 Router: 0x10ED43C718714eb63d5aA57B78B54704E256024E
 * Pancake V2 Factory: 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73
 * WBNB:               0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
 */
import { ethers } from "hardhat";

const PANCAKE_ROUTER  = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const PANCAKE_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
const WBNB            = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

const ROUTER_ABI = [
  "function addLiquidityETH(address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) external payable returns (uint256,uint256,uint256)"
];
const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
const ERC20_ABI   = ["function approve(address,uint256) returns (bool)", "function decimals() view returns (uint8)"];

async function main() {
  const whsmc = process.env.WHSMC_ADDRESS;
  if (!whsmc || !ethers.isAddress(whsmc)) throw new Error("WHSMC_ADDRESS missing/invalid");

  const [signer] = await ethers.getSigners();
  console.log(`Deployer: ${signer.address}`);

  const factory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, signer);
  const existing: string = await factory.getPair(whsmc, WBNB);
  if (existing !== ethers.ZeroAddress) {
    console.log(`Pool already exists at ${existing}. Adding liquidity to existing pool.`);
  }

  const token  = new ethers.Contract(whsmc, ERC20_ABI, signer);
  const router = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, signer);

  const decimals: number = Number(await token.decimals());
  const tokenAmt = ethers.parseUnits(process.env.INITIAL_WHSMC ?? "1000000", decimals);
  const bnbAmt   = ethers.parseEther(process.env.INITIAL_BNB ?? "10");

  console.log(`Approving ${process.env.INITIAL_WHSMC} wHSMC to router…`);
  await (await token.approve(PANCAKE_ROUTER, tokenAmt)).wait();

  console.log(`Adding liquidity (${process.env.INITIAL_WHSMC} wHSMC + ${process.env.INITIAL_BNB} BNB)…`);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const tx = await router.addLiquidityETH(
    whsmc,
    tokenAmt,
    (tokenAmt * 95n) / 100n, // 5% slippage
    (bnbAmt   * 95n) / 100n,
    signer.address,
    deadline,
    { value: bnbAmt }
  );
  const rcpt = await tx.wait();
  console.log(`✅ Liquidity added. Tx: ${rcpt?.hash}`);
  const pair: string = await factory.getPair(whsmc, WBNB);
  console.log(`📊 Pair address: ${pair}`);
  console.log(`🔗 PancakeSwap UI: https://pancakeswap.finance/info/v2/pair/${pair}`);
}

main().catch(e => { console.error(e); process.exit(1); });
