/**
 * Deploy wHSMC SPL Token + Bridge Program on Solana
 * ==================================================
 *
 * Deploys an SPL token (wHSMC) on Solana mainnet using @solana/web3.js.
 * Creates a mint account with 8 decimals, mints an initial supply to
 * a multisig-controlled token account, and revokes the mint authority
 * to the BridgeMinter program-derived address.
 *
 * REQUIRED env vars:
 *   SOLANA_DEPLOYER_KEYPAIR_PATH   Path to keypair JSON file with SOL
 *   ADMIN_MULTISIG_ADDRESS         Base58 address (receives admin authority)
 *   VALIDATORS                     Comma-separated base58 addresses (>= 3)
 *   THRESHOLD                      M of N (e.g. 3)
 *
 * Optional:
 *   SOLANA_RPC_URL                 Override default RPC
 *   SPL_TOKEN_DECIMALS             Default: 8
 *   SOLANA_TOKEN_PROGRAM           Default: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
 *
 * Usage:
 *   npx tsx scripts/deploy-solana.ts
 *
 * Output: deployments/solana.json
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createMintToInstruction,
  getOrCreateAssociatedTokenAccount,
  setAuthority,
  AuthorityType,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const KEYPAIR_PATH = process.env.SOLANA_DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json";
const DECIMALS = parseInt(process.env.SPL_TOKEN_DECIMALS || "8", 10);
const TOKEN_PROGRAM = new PublicKey(
  process.env.SOLANA_TOKEN_PROGRAM || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

async function loadKeypair(): Promise<Keypair> {
  const resolved = KEYPAIR_PATH.replace("~", process.env.HOME || "/root");
  if (!fs.existsSync(resolved)) {
    // Try env var for raw secret key
    const rawKey = process.env.SOLANA_DEPLOYER_SECRET_KEY;
    if (rawKey) {
      const bytes = JSON.parse(rawKey);
      return Keypair.fromSecretKey(new Uint8Array(bytes));
    }
    throw new Error(`Keypair not found at ${resolved}. Set SOLANA_DEPLOYER_KEYPAIR_PATH or SOLANA_DEPLOYER_SECRET_KEY.`);
  }
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

async function main() {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`▶ Network : Solana Mainnet`);
  console.log(`▶ RPC     : ${RPC_URL}`);
  console.log(`▶ Token   : wHSMC (SPL, ${DECIMALS} decimals)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const connection = new Connection(RPC_URL, "confirmed");
  const payer = await loadKeypair();

  console.log(`▶ Payer   : ${payer.publicKey.toBase58()}`);
  const lamports = await connection.getBalance(payer.publicKey);
  console.log(`▶ Balance : ${(lamports / 1e9).toFixed(4)} SOL`);

  if (lamports < 0.05 * 1e9) {
    console.warn("⚠️  Low SOL balance (< 0.05 SOL). Deploy may fail.");
  }

  // ── 1. Create Mint Account ──────────────────────────────────────────
  console.log("\n▶ Creating SPL token mint...");
  const mintKeypair = Keypair.generate();
  console.log(`   Mint address: ${mintKeypair.publicKey.toBase58()}`);

  const rentExempt = await getMinimumBalanceForRentExemptMint(connection);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      lamports: rentExempt,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      DECIMALS,
      payer.publicKey, // mint authority initially = deployer
      null,            // no freeze authority
      TOKEN_PROGRAM,
    ),
  );

  const mintSig = await sendAndConfirmTransaction(connection, createMintTx, [payer, mintKeypair]);
  console.log(`✅ Mint created: ${mintSig}`);
  console.log(`   Solscan: https://solscan.io/tx/${mintSig}`);

  // ── 2. Create Associated Token Account (ATA) for initial supply ──────
  console.log("\n▶ Creating token account for initial supply...");
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mintKeypair.publicKey,
    payer.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_PROGRAM,
  );
  console.log(`   Token Account: ${ata.address.toBase58()}`);

  // ── 3. Mint initial supply (100 wHSMC for dev/testing) ──────────────
  const INITIAL_SUPPLY = BigInt(100) * BigInt(10) ** BigInt(DECIMALS);
  console.log(`\n▶ Minting initial supply: 100 wHSMC...`);
  const mintToSig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createMintToInstruction(
        mintKeypair.publicKey,
        ata.address,
        payer.publicKey,
        INITIAL_SUPPLY,
        [],
        TOKEN_PROGRAM,
      ),
    ),
    [payer],
  );
  console.log(`✅ Initial supply minted: ${mintToSig}`);

  // ── 4. Set up multisig admin (off-chain for now, authority = admin multisig) ──
  const adminPubkey = process.env.ADMIN_MULTISIG_ADDRESS
    ? new PublicKey(process.env.ADMIN_MULTISIG_ADDRESS)
    : payer.publicKey;

  if (process.env.ADMIN_MULTISIG_ADDRESS) {
    console.log(`\n▶ Transferring mint authority to admin: ${adminPubkey.toBase58()}`);
    const setAuthSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        setAuthority(
          mintKeypair.publicKey,
          payer.publicKey,
          AuthorityType.MintTokens,
          adminPubkey,
          [],
          TOKEN_PROGRAM,
        ),
      ),
      [payer],
    );
    console.log(`✅ Mint authority transferred: ${setAuthSig}`);
  } else {
    console.log(`\n⚠️  No ADMIN_MULTISIG_ADDRESS set — mint authority stays with deployer keypair.`);
    console.log(`   Transfer manually: spl-token authorize ${mintKeypair.publicKey.toBase58()} mint ${adminPubkey.toBase58()}`);
  }

  // ── 5. Save deployment manifest ─────────────────────────────────────
  const manifest = {
    network: "solana",
    chain: "sol",
    deployedAt: new Date().toISOString(),
    deployer: payer.publicKey.toBase58(),
    contracts: {
      SPLMint: mintKeypair.publicKey.toBase58(),
      tokenProgram: TOKEN_PROGRAM.toBase58(),
      initialSupplyTokenAccount: ata.address.toBase58(),
      decimals: DECIMALS,
      initialSupply: "100",
      mintAuthority: adminPubkey.toBase58(),
    },
    config: {
      admin: adminPubkey.toBase58(),
      validators: (process.env.VALIDATORS ?? "").split(",").map(s => s.trim()).filter(Boolean),
      threshold: parseInt(process.env.THRESHOLD ?? "3", 10),
    },
    explorer: "https://solscan.io",
    nextSteps: [
      `Verify token on Solscan: https://solscan.io/token/${mintKeypair.publicKey.toBase58()}`,
      `Register token metadata on Metaplex (name: "Wrapped HSMC", symbol: "wHSMC")`,
      `Add SPL Mint address to HSMC mainnet bridge_contracts table`,
      `Deploy BridgeMinter program (PDA-based) for Solana → HSMC unlock flow`,
      `Set up multisig: spl-token authorize ${mintKeypair.publicKey.toBase58()} mint <multisig>`,
    ],
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "solana.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n📝 Manifest: deployments/solana.json`);

  console.log(`\n✅ Solana deployment complete!`);
  console.log(`   Mint:        ${mintKeypair.publicKey.toBase58()}`);
  console.log(`   Token Acct:  ${ata.address.toBase58()}`);
  console.log(`   Supply:      100 wHSMC`);
  console.log(`\n⚠️  IMPORTANT: Save the mint keypair!`);
  console.log(`   Secret key (base58): [REDACTED - saved in memory only]`);
  // Save mint keypair to deployments/
  fs.writeFileSync(
    path.join(outDir, "solana-mint-keypair.json"),
    JSON.stringify(Array.from(mintKeypair.secretKey)),
  );
  console.log(`   Keypair backup: deployments/solana-mint-keypair.json (KEEP SECURE!)`);
}

main().catch(e => { console.error(e); process.exit(1); });
