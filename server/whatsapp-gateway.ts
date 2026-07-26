/**
 * HSMC WhatsApp Gateway — Feature #12
 *
 * Privacy-focused HSMC Network WhatsApp gateway with wallet linking, balance checks,
 * HSMC transfers, price tracking, and real-time notifications.
 *
 * Uses Meta WhatsApp Cloud API (Graph API v22.0).
 *
 * Usage: WHATSAPP_PHONE_NUMBER_ID=xxx WHATSAPP_ACCESS_TOKEN=xxx WHATSAPP_VERIFY_TOKEN=xxx bun run server/whatsapp-gateway.ts
 *
 * Webhook: Meta sends messages to POST /webhook on this server.
 * Webhook verification: Meta sends GET /webhook?hub.mode=subscribe&hub.verify_token=xxx&hub.challenge=xxx
 *
 * Commands (text-based, typed into WhatsApp):
 *   /start   — Welcome message + link wallet prompt
 *   /help    — Command list
 *   /link    — Generate OTP to link WhatsApp with HSMC account
 *   /verify  — Verify OTP (usage: /verify <code>)
 *   /balance — Show HSMC wallet balances
 *   /deposit — Show deposit wallet address
 *   /send    — Send HSMC (usage: /send <address> <amount>)
 *   /price   — Current HSMC price from token_metrics
 *
 * Notifications:
 *   - Incoming transaction alerts for linked users
 *   - Kill-switch activation broadcast
 */

import { Database } from "bun:sqlite";
import { randomUUID, randomInt } from "crypto";

// ── Types ───────────────────────────────────────────────────────────────────────────

interface WhatsAppSession {
  /** User is in the middle of linking flow — awaiting user ID */
  awaitingLinkUserId: boolean;
  /** User is entering a send address */
  awaitingSendAddress: boolean;
  /** User is entering a send amount (address already captured) */
  awaitingSendAmount: boolean;
  /** The captured send-to address */
  sendAddress: string;
}

interface WhatsAppIncomingMessage {
  from: string;       // sender WhatsApp ID (e.g. "12345678901")
  id: string;         // message ID
  timestamp: string;
  type: "text" | "button" | "interactive";
  text: { body: string };
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      messages?: WhatsAppIncomingMessage[];
    };
  }>;
}

// ── Configuration ───────────────────────────────────────────────────────────────────

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || Bun.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || Bun.env.WHATSAPP_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || Bun.env.WHATSAPP_VERIFY_TOKEN;
const WEBHOOK_PORT = parseInt(process.env.WHATSAPP_WEBHOOK_PORT || Bun.env.WHATSAPP_WEBHOOK_PORT || "3002", 10);

if (!PHONE_NUMBER_ID) {
  console.error("[WhatsApp] FATAL: WHATSAPP_PHONE_NUMBER_ID not set. Set it in .env or environment.");
  process.exit(1);
}
if (!ACCESS_TOKEN) {
  console.error("[WhatsApp] FATAL: WHATSAPP_ACCESS_TOKEN not set. Set it in .env or environment.");
  process.exit(1);
}
if (!VERIFY_TOKEN) {
  console.error("[WhatsApp] FATAL: WHATSAPP_VERIFY_TOKEN not set. Set it in .env or environment.");
  process.exit(1);
}

const META_API_BASE = "https://graph.facebook.com/v22.0";
const META_MESSAGES_URL = `${META_API_BASE}/${PHONE_NUMBER_ID}/messages`;

// ── Database ────────────────────────────────────────────────────────────────────────

const DB_PATH = process.env.HSMC_DB_PATH || "/home/team/shared/hsmc.db";
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL;");

// ── Migration: create WhatsApp-specific tables ───────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_users (
    id TEXT PRIMARY KEY,
    whatsapp_id TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    whatsapp_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS whatsapp_otp (
    id TEXT PRIMARY KEY,
    whatsapp_id TEXT NOT NULL,
    user_id TEXT,
    otp_code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_whatsapp_users_user_id ON whatsapp_users(user_id);
  CREATE INDEX IF NOT EXISTS idx_whatsapp_otp_whatsapp_id ON whatsapp_otp(whatsapp_id);
`);

console.log("[WhatsApp] Database migration complete.");

// ── In-Memory Session Store ─────────────────────────────────────────────────────────

/** Per-user session state for multi-step flows. Keyed by WhatsApp ID. */
const sessions = new Map<string, WhatsAppSession>();

function getSession(whatsappId: string): WhatsAppSession {
  const existing = sessions.get(whatsappId);
  if (existing) return existing;
  const fresh: WhatsAppSession = {
    awaitingLinkUserId: false,
    awaitingSendAddress: false,
    awaitingSendAmount: false,
    sendAddress: "",
  };
  sessions.set(whatsappId, fresh);
  return fresh;
}

// ── Helper Functions ─────────────────────────────────────────────────────────────────

/** Get linked HSMC user for a WhatsApp ID */
function getLinkedUser(whatsappId: string): { userId: string; whatsappName: string | null } | null {
  const row = db.query(
    "SELECT user_id, whatsapp_name FROM whatsapp_users WHERE whatsapp_id = ?"
  ).get(whatsappId) as { user_id: string; whatsapp_name: string | null } | undefined;
  return row ? { userId: row.user_id, whatsappName: row.whatsapp_name } : null;
}

/** Get wallets for a user */
function getUserWallets(userId: string): Array<{ address: string; balance: number; label: string | null; is_primary: number }> {
  return db.query(
    "SELECT address, balance, label, is_primary FROM wallets WHERE user_id = ? ORDER BY is_primary DESC, created_at ASC"
  ).all(userId) as Array<{ address: string; balance: number; label: string | null; is_primary: number }>;
}

/** Get primary wallet address for a user */
function getPrimaryWallet(userId: string): string | null {
  const row = db.query(
    "SELECT address FROM wallets WHERE user_id = ? AND is_primary = 1 LIMIT 1"
  ).get(userId) as { address: string } | undefined;
  return row?.address ?? null;
}

/** Format HSMC amount */
function fmtHSMC(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + " HSMC";
}

/** Check if user is linked */
function requireLinkedUser(whatsappId: string): { userId: string } | null {
  const linked = getLinkedUser(whatsappId);
  if (!linked) {
    sendWhatsAppMessage(whatsappId,
      "⚠️ *Wallet not linked*\n\n" +
      "You need to link your HSMC wallet first.\n" +
      "Send *link* to get started."
    );
    return null;
  }
  return { userId: linked.userId };
}

/** Generate a 6-digit OTP */
function generateOTP(): string {
  return String(randomInt(100000, 999999));
}

/** Create and store an OTP */
function createOTP(whatsappId: string, userId: string | null = null): { code: string; expiresAt: string } {
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min expiry
  db.query(
    "INSERT INTO whatsapp_otp (id, whatsapp_id, user_id, otp_code, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(randomUUID(), whatsappId, userId, code, expiresAt);
  return { code, expiresAt };
}

/** Verify an OTP */
function verifyOTP(whatsappId: string, code: string): boolean {
  const row = db.query(
    "SELECT id FROM whatsapp_otp WHERE whatsapp_id = ? AND otp_code = ? AND used = 0 AND expires_at > datetime('now')"
  ).get(whatsappId, code) as { id: string } | undefined;
  if (!row) return false;
  db.query("UPDATE whatsapp_otp SET used = 1 WHERE id = ?").run(row.id);
  return true;
}

/** Get current HSMC price */
function getHSMCPrice(): { price: number; change24h: number; marketCap: number } | null {
  const row = db.query(
    "SELECT price, price_change_24h, market_cap FROM token_metrics ORDER BY updated_at DESC LIMIT 1"
  ).get() as { price: number; price_change_24h: number; market_cap: number } | undefined;
  return row ?? null;
}

/** Get kill-switch status */
function getKillSwitchStatus(): { active: boolean; updatedAt: string } {
  const row = db.query(
    "SELECT kill_switch_active, updated_at FROM platform_config WHERE id = 1"
  ).get() as { kill_switch_active: number; updated_at: string } | undefined;
  return {
    active: row?.kill_switch_active === 1,
    updatedAt: row?.updated_at ?? "unknown",
  };
}

/** Create a new transaction record */
function createTransaction(
  fromAddress: string,
  toAddress: string,
  amount: number,
  userId: string
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO transactions (id, from_address, to_address, amount, fee, status, created_at,
      privacy_level, decoy_count, user_id)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, 'standard', 11, ?)
  `).run(id, fromAddress, toAddress, amount, 0.001, now, userId);
  return id;
}

// ── WhatsApp Messaging (Meta Graph API) ─────────────────────────────────────────────

/**
 * Send a text message to a WhatsApp user via Meta Cloud API.
 * Returns true on success.
 */
async function sendWhatsAppMessage(to: string, body: string): Promise<boolean> {
  try {
    const response = await fetch(META_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[WhatsApp] Failed to send message to ${to}: HTTP ${response.status} — ${errBody}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[WhatsApp] Error sending message to ${to}:`, err);
    return false;
  }
}

/**
 * Mark a WhatsApp message as "read".
 */
async function markMessageRead(messageId: string): Promise<void> {
  try {
    await fetch(META_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch (err) {
    // Non-critical
    console.error("[WhatsApp] Error marking read:", err);
  }
}

// ── Notification Helpers ────────────────────────────────────────────────────────────

/** Send notification to linked WhatsApp users */
async function notifyUser(userId: string, message: string): Promise<void> {
  const rows = db.query(
    "SELECT whatsapp_id FROM whatsapp_users WHERE user_id = ?"
  ).all(userId) as Array<{ whatsapp_id: string }>;
  for (const row of rows) {
    try {
      await sendWhatsAppMessage(row.whatsapp_id, message);
    } catch (err) {
      console.error(`[WhatsApp] Failed to notify whatsapp_id=${row.whatsapp_id}:`, err);
    }
  }
}

/** Broadcast message to all linked WhatsApp users */
async function broadcastAll(message: string): Promise<void> {
  const rows = db.query("SELECT whatsapp_id FROM whatsapp_users").all() as Array<{ whatsapp_id: string }>;
  for (const row of rows) {
    try {
      await sendWhatsAppMessage(row.whatsapp_id, message);
    } catch (err) {
      console.error(`[WhatsApp] Failed to broadcast to whatsapp_id=${row.whatsapp_id}:`, err);
    }
  }
}

// ── Command Handlers ────────────────────────────────────────────────────────────────

/** /start — Welcome message */
async function handleStart(from: string, senderName: string): Promise<void> {
  const linked = getLinkedUser(from);
  const name = senderName || "there";

  if (linked) {
    await sendWhatsAppMessage(from,
      `👋 Welcome back, *${name}*!\n\n` +
      `✅ Your WhatsApp is linked to HSMC account.\n\n` +
      `*Quick commands:*\n` +
      `💰 balance — Check your balance\n` +
      `💎 deposit — Get deposit address\n` +
      `💸 send — Send HSMC\n` +
      `📈 price — Current HSMC price\n` +
      `❓ help — All commands`
    );
  } else {
    await sendWhatsAppMessage(from,
      `👋 Welcome to *HSMC Network*, ${name}!\n\n` +
      `🔒 *Privacy-first blockchain* with Monero-grade privacy (RingCT, stealth addresses).\n\n` +
      `*Get started:*\n` +
      `1️⃣ Send *link* to connect your HSMC wallet\n` +
      `2️⃣ Then use *balance*, *send*, *deposit*, *price*\n\n` +
      `🌐 https://hsmc.network`
    );
  }
}

/** /help — Command list */
async function handleHelp(from: string): Promise<void> {
  await sendWhatsAppMessage(from,
    `🤖 *HSMC Network — Commands*\n\n` +
    `🔗 *link* — Link your WhatsApp with HSMC account\n` +
    `✅ *verify <code>* — Verify OTP code\n` +
    `💰 *balance* — Check your HSMC balance\n` +
    `💎 *deposit* — Show deposit wallet address\n` +
    `💸 *send <address> <amount>* — Send HSMC\n` +
    `📈 *price* — Current HSMC price & market data\n` +
    `❓ *help* — Show this help message\n` +
    `👋 *start* — Welcome message\n\n` +
    `🔒 *Privacy-first.* All transactions use RingCT + stealth addresses.\n\n` +
    `Need support? Visit https://hsmc.network`
  );
}

/** /link — Generate OTP for authentication */
async function handleLink(from: string, senderName: string): Promise<void> {
  const alreadyLinked = getLinkedUser(from);
  if (alreadyLinked) {
    await sendWhatsAppMessage(from,
      "✅ Your WhatsApp is already linked to an HSMC account.\n\n" +
      "Use *balance*, *deposit*, or *send* to interact with your wallet."
    );
    return;
  }

  const name = senderName || "there";

  // Generate OTP
  const { code, expiresAt } = createOTP(from);
  const expiryTime = new Date(expiresAt).toLocaleTimeString();

  await sendWhatsAppMessage(from,
    `🔐 *Link Your HSMC Account*, ${name}\n\n` +
    `Your OTP code is: *${code}*\n` +
    `⏰ Expires at: ${expiryTime}\n\n` +
    `*To complete linking:*\n` +
    `1. Open the HSMC web app at https://hsmc.network\n` +
    `2. Go to *Settings → WhatsApp Link*\n` +
    `3. Enter your WhatsApp number and this OTP\n\n` +
    `Or send *verify ${code}* here if you've already generated it on the web app.\n\n` +
    `⚠️ This code expires in 10 minutes. Do not share it.`
  );
}

/** /verify <otp_code> — Verify OTP and link account */
async function handleVerify(from: string, code: string, senderName: string): Promise<void> {
  const alreadyLinked = getLinkedUser(from);
  if (alreadyLinked) {
    await sendWhatsAppMessage(from, "✅ Your WhatsApp is already linked to an HSMC account.");
    return;
  }

  if (!code || !/^\d{6}$/.test(code)) {
    await sendWhatsAppMessage(from,
      "⚠️ *Usage:* *verify 123456*\n\n" +
      "Enter the 6-digit OTP code you received.\n" +
      "Send *link* to generate a new code."
    );
    return;
  }

  // Check if OTP is valid
  const otpRow = db.query(
    "SELECT id, user_id FROM whatsapp_otp WHERE whatsapp_id = ? AND otp_code = ? AND used = 0 AND expires_at > datetime('now')"
  ).get(from, code) as { id: string; user_id: string | null } | undefined;

  if (!otpRow) {
    await sendWhatsAppMessage(from,
      "❌ *Invalid or expired OTP.*\n\n" +
      "Send *link* to generate a new code."
    );
    return;
  }

  // If OTP was created without user_id (from /link), prompt for user ID
  if (!otpRow.user_id) {
    const session = getSession(from);
    session.awaitingLinkUserId = true;
    await sendWhatsAppMessage(from,
      "🔗 *Almost there!*\n\n" +
      "Your OTP is valid. Now please send me your HSMC *User ID* or *wallet address* to complete the link.\n\n" +
      "You can find your User ID in the HSMC web app under Settings."
    );
    return;
  }

  // OTP has user_id pre-set — link directly
  db.query("UPDATE whatsapp_otp SET used = 1 WHERE id = ?").run(otpRow.id);
  db.query(
    "INSERT INTO whatsapp_users (id, whatsapp_id, user_id, whatsapp_name) VALUES (?, ?, ?, ?)"
  ).run(randomUUID(), from, otpRow.user_id, senderName);

  await sendWhatsAppMessage(from,
    "✅ *Account Linked!*\n\n" +
    "Your WhatsApp is now connected to your HSMC account.\n\n" +
    "Try these commands:\n" +
    "💰 *balance* — Check your balance\n" +
    "💎 *deposit* — Get your deposit address\n" +
    "📈 *price* — HSMC price"
  );
}

/** /balance — Show HSMC balance */
async function handleBalance(from: string): Promise<void> {
  const linked = requireLinkedUser(from);
  if (!linked) return;

  const wallets = getUserWallets(linked.userId);

  if (wallets.length === 0) {
    await sendWhatsAppMessage(from,
      "💰 *Balance: 0 HSMC*\n\n" +
      "You don't have any wallets yet. Create one in the HSMC web app."
    );
    return;
  }

  let message = `💰 *Your HSMC Balance*\n\n`;
  for (const w of wallets) {
    const isPrimary = w.is_primary ? " 🔑" : "";
    const label = w.label ? ` (${w.label})` : "";
    message += `• ${fmtHSMC(w.balance)}${label}${isPrimary}\n`;
  }

  const totalBalance = wallets.reduce((sum, w) => sum + w.balance, 0);
  message += `\n*Total: ${fmtHSMC(totalBalance)}*`;

  const price = getHSMCPrice();
  if (price && price.price > 0) {
    const usdValue = totalBalance * price.price;
    message += `\n≈ $${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD (@ $${price.price.toFixed(4)}/HSMC)`;
  }

  await sendWhatsAppMessage(from, message);
}

/** /deposit — Show deposit address */
async function handleDeposit(from: string): Promise<void> {
  const linked = requireLinkedUser(from);
  if (!linked) return;

  const address = getPrimaryWallet(linked.userId);

  if (!address) {
    await sendWhatsAppMessage(from,
      "💎 *No wallet found*\n\n" +
      "You need to create a wallet first. Visit the HSMC web app to create one."
    );
    return;
  }

  await sendWhatsAppMessage(from,
    `💎 *Your Deposit Address*\n\n` +
    `${address}\n\n` +
    `🔒 Send HSMC to this address. All transactions use RingCT + stealth addresses for maximum privacy.\n\n` +
    `⚠️ Only send HSMC tokens to this address. Sending other tokens may result in permanent loss.`
  );
}

/** /send — Send HSMC */
async function handleSend(from: string, args: string[], senderName: string): Promise<void> {
  const linked = requireLinkedUser(from);
  if (!linked) return;

  if (args.length === 0) {
    await sendWhatsAppMessage(from,
      "💸 *Send HSMC*\n\n" +
      "Usage: *send <address> <amount>*\n\n" +
      "Example: *send hx1abc... 100*\n\n" +
      "Or just reply with the recipient address first and I'll guide you step by step."
    );
    return;
  }

  // Handle multi-step send flow
  if (args.length === 1) {
    // Single argument — could be address or amount
    const session = getSession(from);

    // If already have an address, this is the amount
    if (session.sendAddress && !session.awaitingSendAmount) {
      session.awaitingSendAmount = true;
      const amount = parseFloat(args[0]);
      await processSendTransaction(from, linked.userId, session.sendAddress, amount, session, senderName);
      return;
    }

    // Otherwise, treat as address and ask for amount
    const toAddress = args[0];
    if (toAddress.length < 26 || toAddress.length > 100) {
      await sendWhatsAppMessage(from, "❌ Invalid address format. HSMC addresses are 26-100 characters.");
      return;
    }

    session.sendAddress = toAddress;
    session.awaitingSendAddress = false;
    await sendWhatsAppMessage(from,
      `📤 Sending to: ${toAddress.slice(0, 12)}...\n\n` +
      `Now send me the *amount* in HSMC:`
    );
    return;
  }

  // Full command: send <address> <amount>
  const toAddress = args[0];
  const amount = parseFloat(args[1]);

  if (toAddress.length < 26 || toAddress.length > 100) {
    await sendWhatsAppMessage(from, "❌ Invalid address format. HSMC addresses are 26-100 characters.");
    return;
  }

  const session = getSession(from);
  await processSendTransaction(from, linked.userId, toAddress, amount, session, senderName);
}

async function processSendTransaction(
  from: string,
  userId: string,
  toAddress: string,
  amount: number,
  session: WhatsAppSession,
  senderName: string
): Promise<void> {
  if (isNaN(amount) || amount <= 0) {
    await sendWhatsAppMessage(from, "❌ Invalid amount. Please enter a positive number.\nExample: *100*");
    // Reset send state
    session.sendAddress = "";
    session.awaitingSendAmount = false;
    return;
  }

  // Get sender's primary wallet
  const fromAddress = getPrimaryWallet(userId);
  if (!fromAddress) {
    await sendWhatsAppMessage(from, "❌ No wallet found. Create a wallet in the HSMC web app first.");
    session.sendAddress = "";
    session.awaitingSendAmount = false;
    return;
  }

  // Check balance
  const wallets = getUserWallets(userId);
  const totalBalance = wallets.reduce((sum, w) => sum + w.balance, 0);

  if (totalBalance < amount) {
    await sendWhatsAppMessage(from,
      `❌ *Insufficient balance*\n\n` +
      `You have ${fmtHSMC(totalBalance)} but trying to send ${fmtHSMC(amount)}.`
    );
    session.sendAddress = "";
    session.awaitingSendAmount = false;
    return;
  }

  // Create transaction
  const txId = createTransaction(fromAddress, toAddress, amount, userId);

  await sendWhatsAppMessage(from,
    `💸 *Transaction Created*\n\n` +
    `📤 From: ${fromAddress.slice(0, 12)}...\n` +
    `📥 To: ${toAddress.slice(0, 12)}...\n` +
    `💎 Amount: ${fmtHSMC(amount)}\n` +
    `🔢 TX ID: ${txId.slice(0, 8)}...\n` +
    `🔒 Privacy: RingCT + Stealth Addresses\n\n` +
    `⏳ Status: Pending confirmation...\n\n` +
    `Track your transaction in the HSMC web app.`
  );

  // Reset send state
  session.sendAddress = "";
  session.awaitingSendAmount = false;

  // Notify recipient if they have linked WhatsApp
  const recipientRow = db.query(
    "SELECT user_id FROM wallets WHERE address = ? LIMIT 1"
  ).get(toAddress) as { user_id: string } | undefined;

  if (recipientRow) {
    await notifyUser(
      recipientRow.user_id,
      `📥 *Incoming Transaction!*\n\n` +
      `💎 Amount: ${fmtHSMC(amount)}\n` +
      `📤 From: ${fromAddress.slice(0, 12)}...\n` +
      `🔢 TX ID: ${txId.slice(0, 8)}...\n\n` +
      `Send *balance* to check your updated balance.`
    );
  }
}

/** /price — Current HSMC price */
async function handlePrice(from: string): Promise<void> {
  const price = getHSMCPrice();

  if (!price) {
    await sendWhatsAppMessage(from, "📈 *HSMC Price*\n\nNo price data available yet.");
    return;
  }

  const changeEmoji = price.change24h >= 0 ? "🟢" : "🔴";
  const changeSign = price.change24h >= 0 ? "+" : "";

  await sendWhatsAppMessage(from,
    `📈 *HSMC Price*\n\n` +
    `💎 *$${price.price.toFixed(6)}* USD\n` +
    `${changeEmoji} 24h: ${changeSign}${price.change24h.toFixed(2)}%\n` +
    `🏦 Market Cap: $${(price.marketCap / 1_000_000).toFixed(2)}M\n\n` +
    `_Data from HSMC Network token metrics_`
  );
}

// ── Message Router ──────────────────────────────────────────────────────────────────

/**
 * Parse and route an incoming WhatsApp text message.
 */
async function handleIncomingMessage(msg: WhatsAppIncomingMessage, senderName: string): Promise<void> {
  const from = msg.from;
  const rawText = msg.text.body.trim();
  const text = rawText.toLowerCase();

  // Mark message as read
  await markMessageRead(msg.id);

  // ── Check for active multi-step session first ──────────────────────────────────

  const session = sessions.get(from);

  // Handle "awaiting user ID for linking" state
  if (session?.awaitingLinkUserId) {
    session.awaitingLinkUserId = false;

    // Try to find the user by ID or wallet address
    let userId: string | null = null;

    // Try as user ID first
    const userRow = db.query("SELECT id FROM users WHERE id = ?").get(rawText) as { id: string } | undefined;
    if (userRow) {
      userId = userRow.id;
    }

    // Try as wallet address
    if (!userId) {
      const walletRow = db.query("SELECT user_id FROM wallets WHERE address = ? LIMIT 1").get(rawText) as { user_id: string } | undefined;
      if (walletRow) {
        userId = walletRow.user_id;
      }
    }

    if (!userId) {
      await sendWhatsAppMessage(from,
        "❌ *User not found.*\n\n" +
        "Please check your User ID or wallet address and try again.\n" +
        "Send *link* to restart the process."
      );
      return;
    }

    // Link the account
    const existingLink = db.query(
      "SELECT id FROM whatsapp_users WHERE whatsapp_id = ?"
    ).get(from) as { id: string } | undefined;

    if (existingLink) {
      await sendWhatsAppMessage(from, "✅ Your WhatsApp is already linked to an HSMC account.");
      return;
    }

    db.query(
      "INSERT INTO whatsapp_users (id, whatsapp_id, user_id, whatsapp_name) VALUES (?, ?, ?, ?)"
    ).run(randomUUID(), from, userId, senderName);

    await sendWhatsAppMessage(from,
      "✅ *Account Linked!*\n\n" +
      "Your WhatsApp is now connected to your HSMC account.\n\n" +
      "Try: *balance* | *deposit* | *price*"
    );
    return;
  }

  // Handle "awaiting send amount" state
  if (session?.awaitingSendAmount && session.sendAddress) {
    session.awaitingSendAmount = false;
    const amount = parseFloat(rawText);
    const linked = getLinkedUser(from);
    if (!linked) {
      await sendWhatsAppMessage(from, "⚠️ Your session expired. Please link your account first with *link*.");
      session.sendAddress = "";
      return;
    }
    await processSendTransaction(from, linked.userId, session.sendAddress, amount, session, senderName);
    return;
  }

  // ── Command parsing ────────────────────────────────────────────────────────────

  // Support both /command and plain keyword formats
  let command: string;
  let args: string[] = [];

  if (rawText.startsWith("/")) {
    // Telegram-style: /command arg1 arg2
    const parts = rawText.slice(1).split(/\s+/);
    command = parts[0].toLowerCase();
    args = parts.slice(1);
  } else {
    // Keyword-style: command arg1 arg2 (first word is command)
    const parts = rawText.split(/\s+/);
    command = parts[0].toLowerCase();
    args = parts.slice(1);
  }

  // ── Route to handler ───────────────────────────────────────────────────────────

  switch (command) {
    case "start":
    case "hi":
    case "hello":
      await handleStart(from, senderName);
      break;

    case "help":
    case "menu":
      await handleHelp(from);
      break;

    case "link":
    case "connect":
      await handleLink(from, senderName);
      break;

    case "verify":
      await handleVerify(from, args[0] ?? "", senderName);
      break;

    case "balance":
    case "bal":
      await handleBalance(from);
      break;

    case "deposit":
    case "dep":
      await handleDeposit(from);
      break;

    case "send":
    case "transfer":
      await handleSend(from, args, senderName);
      break;

    case "price":
    case "rate":
      await handlePrice(from);
      break;

    default:
      // Unknown command — show help
      await sendWhatsAppMessage(from,
        `🤖 *HSMC Network Bot*\n\n` +
        `I didn't understand "${rawText}".\n\n` +
        `Try these:\n` +
        `• *balance* — Check your HSMC balance\n` +
        `• *deposit* — Get your deposit address\n` +
        `• *send* — Send HSMC\n` +
        `• *price* — Current HSMC price\n` +
        `• *help* — All commands\n\n` +
        `Send *link* to connect your wallet first.`
      );
      break;
  }
}

// ── Webhook Server ──────────────────────────────────────────────────────────────────

/**
 * Meta WhatsApp Cloud API webhook handler.
 * - GET: Webhook verification (Meta sends a challenge)
 * - POST: Incoming messages
 */
async function handleWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // ── GET: Webhook verification ───────────────────────────────────────────────────
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[WhatsApp] Webhook verified successfully.");
      return new Response(challenge, { status: 200 });
    }

    console.warn("[WhatsApp] Webhook verification failed: invalid token.");
    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: Incoming messages ─────────────────────────────────────────────────────
  if (req.method === "POST") {
    try {
      const body = await req.json() as {
        object: string;
        entry: WhatsAppWebhookEntry[];
      };

      // Validate it's a WhatsApp webhook
      if (body.object !== "whatsapp_business_account") {
        return new Response("Not a WhatsApp webhook", { status: 400 });
      }

      // Process each entry
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.value.messaging_product !== "whatsapp") continue;

          const messages = change.value.messages;
          if (!messages || messages.length === 0) continue;

          for (const msg of messages) {
            // Only handle text messages
            if (msg.type !== "text") {
              // Send a friendly note about unsupported message types
              await sendWhatsAppMessage(msg.from,
                "👋 Thanks for your message! I currently only support text commands.\n\n" +
                "Send *help* to see what I can do."
              );
              continue;
            }

            // Extract sender name from contacts if available (Meta may include it)
            const senderName = ""; // Meta doesn't always provide name in webhook
            await handleIncomingMessage(msg, senderName);
          }
        }
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("[WhatsApp] Webhook processing error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}

// ── Notification Pollers ────────────────────────────────────────────────────────────

let lastTxCheck = new Date().toISOString();
let lastKillSwitchState = getKillSwitchStatus().active;

/** Poll for new transactions to linked users and send notifications */
async function pollTransactionNotifications(): Promise<void> {
  try {
    const rows = db.query(
      "SELECT t.id, t.to_address, t.amount, t.from_address, t.created_at, wu.whatsapp_id, wu.user_id " +
      "FROM transactions t " +
      "JOIN wallets w ON w.address = t.to_address " +
      "JOIN whatsapp_users wu ON wu.user_id = w.user_id " +
      "WHERE t.created_at > ? AND t.status = 'pending' " +
      "ORDER BY t.created_at DESC LIMIT 50"
    ).all(lastTxCheck) as Array<{
      id: string; to_address: string; amount: number; from_address: string;
      created_at: string; whatsapp_id: string; user_id: string;
    }>;

    for (const tx of rows) {
      const msg =
        `📥 *Incoming Transaction!*\n\n` +
        `💎 Amount: ${fmtHSMC(tx.amount)}\n` +
        `📤 From: ${(tx.from_address || "anonymous").slice(0, 12)}...\n` +
        `🔢 TX: ${tx.id.slice(0, 8)}...\n\n` +
        `Send *balance* to check.`;

      try {
        await sendWhatsAppMessage(tx.whatsapp_id, msg);
      } catch (err) {
        console.error(`[WhatsApp] Cannot notify whatsapp_id=${tx.whatsapp_id}:`, err);
      }
    }

    if (rows.length > 0) {
      lastTxCheck = rows[0].created_at;
    }
  } catch (err) {
    console.error("[WhatsApp] Transaction poll error:", err);
  }
}

/** Poll for kill-switch status changes and broadcast */
async function pollKillSwitch(): Promise<void> {
  try {
    const current = getKillSwitchStatus();
    if (current.active !== lastKillSwitchState) {
      lastKillSwitchState = current.active;

      if (current.active) {
        await broadcastAll(
          `🚨 *HSMC Kill-Switch Activated*\n\n` +
          `The HSMC Network kill-switch has been activated as of ${new Date(current.updatedAt).toLocaleString()}.\n\n` +
          `⚠️ HSMCPay fiat processing is temporarily paused. P2P (direct wallet) transactions remain available.\n\n` +
          `We'll notify you when normal operations resume.`
        );
      } else {
        await broadcastAll(
          `✅ *HSMC Kill-Switch Deactivated*\n\n` +
          `The HSMC Network kill-switch has been deactivated as of ${new Date(current.updatedAt).toLocaleString()}.\n\n` +
          `All services are back to normal. HSMCPay fiat processing is now available.`
        );
      }
    }
  } catch (err) {
    console.error("[WhatsApp] Kill-switch poll error:", err);
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────────────

const NOTIFICATION_POLL_INTERVAL_MS = 15_000; // 15 seconds
const KILLSWITCH_POLL_INTERVAL_MS = 30_000;   // 30 seconds

console.log("[WhatsApp] Starting HSMC Network WhatsApp Gateway...");
console.log(`[WhatsApp] Webhook server on port ${WEBHOOK_PORT}`);
console.log(`[WhatsApp] Meta Phone Number ID: ${PHONE_NUMBER_ID}`);

// Start the webhook HTTP server
const server = Bun.serve({
  port: WEBHOOK_PORT,
  fetch: handleWebhook,
});

console.log(`[WhatsApp] Webhook URL: http://0.0.0.0:${WEBHOOK_PORT}/webhook`);

// Start notification pollers
const txPollInterval = setInterval(pollTransactionNotifications, NOTIFICATION_POLL_INTERVAL_MS);
const ksPollInterval = setInterval(pollKillSwitch, KILLSWITCH_POLL_INTERVAL_MS);

// Graceful shutdown
function shutdown(): void {
  console.log("[WhatsApp] Shutting down...");
  clearInterval(txPollInterval);
  clearInterval(ksPollInterval);
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[WhatsApp] Polling for transaction notifications every", NOTIFICATION_POLL_INTERVAL_MS / 1000, "s");
console.log("[WhatsApp] Kill-switch check every", KILLSWITCH_POLL_INTERVAL_MS / 1000, "s");
console.log("[WhatsApp] ✅ Gateway is ready!");

export {
  sendWhatsAppMessage,
  notifyUser,
  broadcastAll,
  getLinkedUser,
  createOTP,
  verifyOTP,
};
