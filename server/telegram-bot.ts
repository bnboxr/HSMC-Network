/**
 * HSMC Telegram Bot — Feature #11
 *
 * Privacy-focused HSMC Network bot with wallet linking, balance checks,
 * HSMC transfers, price tracking, and real-time notifications.
 *
 * Usage: TELEGRAM_BOT_TOKEN=xxx bun run server/telegram-bot.ts
 *
 * Commands:
 *   /start   — Welcome message + link wallet prompt
 *   /help    — Command list
 *   /link    — Generate OTP to link Telegram with HSMC account
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

import { Bot, InlineKeyboard, session, type Context, type SessionFlavor } from "grammy";
import { Database } from "bun:sqlite";
import { randomUUID, randomInt } from "crypto";

// ── Types ───────────────────────────────────────────────────────────────────────────

interface SessionData {
  awaitingLinkUserId: boolean;
  awaitingSendAddress: boolean;
  awaitingSendAmount: boolean;
  sendAddress: string;
}

type BotContext = Context & SessionFlavor<SessionData>;

// ── Database ────────────────────────────────────────────────────────────────────────

const DB_PATH = process.env.HSMC_DB_PATH || "/home/team/shared/hsmc.db";
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL;");

// ── Migration: create telegram-specific tables ──────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_users (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    telegram_username TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS telegram_otp (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    user_id TEXT,
    otp_code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_telegram_users_user_id ON telegram_users(user_id);
  CREATE INDEX IF NOT EXISTS idx_telegram_otp_telegram_id ON telegram_otp(telegram_id);
`);

console.log("[Telegram] Database migration complete.");

// ── Bot Initialization ──────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || Bun.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("[Telegram] FATAL: TELEGRAM_BOT_TOKEN not set. Set it in .env or environment.");
  process.exit(1);
}

const bot = new Bot<BotContext>(BOT_TOKEN);

// Session middleware
bot.use(session({
  initial(): SessionData {
    return {
      awaitingLinkUserId: false,
      awaitingSendAddress: false,
      awaitingSendAmount: false,
      sendAddress: "",
    };
  },
}));

// ── Helper Functions ────────────────────────────────────────────────────────────────

/** Get linked HSMC user for a Telegram ID */
function getLinkedUser(telegramId: number): { userId: string; telegramUsername: string | null } | null {
  const row = db.query(
    "SELECT user_id, telegram_username FROM telegram_users WHERE telegram_id = ?"
  ).get(telegramId) as { user_id: string; telegram_username: string | null } | undefined;
  return row ? { userId: row.user_id, telegramUsername: row.telegram_username } : null;
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
function requireLinkedUser(ctx: BotContext, telegramId: number): { userId: string } | null {
  const linked = getLinkedUser(telegramId);
  if (!linked) {
    ctx.reply(
      "⚠️ *Wallet not linked*\n\n" +
      "You need to link your HSMC wallet first.\n" +
      "Use /link to get started.",
      { parse_mode: "Markdown" }
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
function createOTP(telegramId: number, userId: string | null = null): { code: string; expiresAt: string } {
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min expiry
  db.query(
    "INSERT INTO telegram_otp (id, telegram_id, user_id, otp_code, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(randomUUID(), telegramId, userId, code, expiresAt);
  return { code, expiresAt };
}

/** Verify an OTP */
function verifyOTP(telegramId: number, code: string): boolean {
  const row = db.query(
    "SELECT id FROM telegram_otp WHERE telegram_id = ? AND otp_code = ? AND used = 0 AND expires_at > datetime('now')"
  ).get(telegramId, code) as { id: string } | undefined;
  if (!row) return false;
  db.query("UPDATE telegram_otp SET used = 1 WHERE id = ?").run(row.id);
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

/** Send notification to linked Telegram users */
async function notifyUser(userId: string, message: string): Promise<void> {
  const rows = db.query(
    "SELECT telegram_id FROM telegram_users WHERE user_id = ?"
  ).all(userId) as Array<{ telegram_id: number }>;
  for (const row of rows) {
    try {
      await bot.api.sendMessage(row.telegram_id, message, { parse_mode: "Markdown" });
    } catch (err) {
      console.error(`[Telegram] Failed to notify telegram_id=${row.telegram_id}:`, err);
    }
  }
}

/** Broadcast message to all linked Telegram users */
async function broadcastAll(message: string): Promise<void> {
  const rows = db.query("SELECT telegram_id FROM telegram_users").all() as Array<{ telegram_id: number }>;
  for (const row of rows) {
    try {
      await bot.api.sendMessage(row.telegram_id, message, { parse_mode: "Markdown" });
    } catch (err) {
      console.error(`[Telegram] Failed to broadcast to telegram_id=${row.telegram_id}:`, err);
    }
  }
}

// ── Bot Commands ────────────────────────────────────────────────────────────────────

// /start — Welcome message
bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const linked = getLinkedUser(telegramId);
  const firstName = ctx.from?.first_name ?? "there";

  if (linked) {
    await ctx.reply(
      `👋 Welcome back, *${firstName}*!\n\n` +
      `✅ Your Telegram is linked to HSMC account.\n\n` +
      `*Quick commands:*\n` +
      `💰 /balance — Check your balance\n` +
      `💎 /deposit — Get deposit address\n` +
      `💸 /send — Send HSMC\n` +
      `📈 /price — Current HSMC price\n` +
      `❓ /help — All commands`,
      { parse_mode: "Markdown" }
    );
  } else {
    await ctx.reply(
      `👋 Welcome to *HSMC Network*, ${firstName}!\n\n` +
      `🔒 *Privacy-first blockchain* with Monero-grade privacy (RingCT, stealth addresses).\n\n` +
      `*Get started:*\n` +
      `1️⃣ Use /link to connect your HSMC wallet\n` +
      `2️⃣ Then use /balance, /send, /deposit, /price\n\n` +
      `🌐 [HSMC Network Website](https://hsmc.network) | 📄 [Whitepaper](https://hsmc.network/whitepaper)`,
      { parse_mode: "Markdown", disable_web_page_preview: true }
    );
  }
});

// /help — Command list
bot.command("help", async (ctx) => {
  await ctx.reply(
    `🤖 *HSMC Network Bot — Commands*\n\n` +
    `🔗 /link — Link your Telegram with HSMC account\n` +
    `✅ /verify <code> — Verify OTP code\n` +
    `💰 /balance — Check your HSMC balance\n` +
    `💎 /deposit — Show deposit wallet address\n` +
    `💸 /send <address> <amount> — Send HSMC\n` +
    `📈 /price — Current HSMC price & market data\n` +
    `❓ /help — Show this help message\n\n` +
    `🔒 *Privacy-first.* All transactions use RingCT + stealth addresses.\n\n` +
    `Need support? Visit [hsmc.network](https://hsmc.network)`,
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
});

// /link — Generate OTP for authentication
bot.command("link", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply("❌ Could not identify your Telegram account.");
    return;
  }

  const alreadyLinked = getLinkedUser(telegramId);
  if (alreadyLinked) {
    await ctx.reply(
      "✅ Your Telegram is already linked to an HSMC account.\n\n" +
      "Use /balance, /deposit, or /send to interact with your wallet."
    );
    return;
  }

  // Generate OTP
  const { code, expiresAt } = createOTP(telegramId);
  const expiryTime = new Date(expiresAt).toLocaleTimeString();

  await ctx.reply(
    `🔐 *Link Your HSMC Account*\n\n` +
    `Your OTP code is: \`${code}\`\n` +
    `⏰ Expires at: ${expiryTime}\n\n` +
    `*To complete linking:*\n` +
    `1. Open the HSMC web app at [hsmc.network](https://hsmc.network)\n` +
    `2. Go to *Settings → Telegram Link*\n` +
    `3. Enter your Telegram username and this OTP\n\n` +
    `Or use /verify <code> here if you've already generated it on the web app.\n\n` +
    `⚠️ This code expires in 10 minutes. Do not share it.`,
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
});

// /verify <otp_code> — Verify OTP and link account
bot.command("verify", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply("❌ Could not identify your Telegram account.");
    return;
  }

  const alreadyLinked = getLinkedUser(telegramId);
  if (alreadyLinked) {
    await ctx.reply("✅ Your Telegram is already linked to an HSMC account.");
    return;
  }

  const code = ctx.match?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    await ctx.reply(
      "⚠️ *Usage:* `/verify 123456`\n\n" +
      "Enter the 6-digit OTP code you received.\n" +
      "Use /link to generate a new code.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Check if OTP is valid
  const otpRow = db.query(
    "SELECT id, user_id FROM telegram_otp WHERE telegram_id = ? AND otp_code = ? AND used = 0 AND expires_at > datetime('now')"
  ).get(telegramId, code) as { id: string; user_id: string | null } | undefined;

  if (!otpRow) {
    await ctx.reply(
      "❌ *Invalid or expired OTP.*\n\n" +
      "Use /link to generate a new code.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // If OTP was created without user_id (from /link), prompt for user ID
  if (!otpRow.user_id) {
    ctx.session.awaitingLinkUserId = true;
    await ctx.reply(
      "🔗 *Almost there!*\n\n" +
      "Your OTP is valid. Now please send me your HSMC *User ID* or *wallet address* to complete the link.\n\n" +
      "You can find your User ID in the HSMC web app under Settings.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // OTP has user_id pre-set — link directly
  db.query("UPDATE telegram_otp SET used = 1 WHERE id = ?").run(otpRow.id);
  db.query(
    "INSERT INTO telegram_users (id, telegram_id, user_id, telegram_username, first_name, last_name) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    randomUUID(), telegramId, otpRow.user_id,
    ctx.from?.username ?? null, ctx.from?.first_name ?? null, ctx.from?.last_name ?? null
  );

  await ctx.reply(
    "✅ *Account Linked!*\n\n" +
    "Your Telegram is now connected to your HSMC account.\n\n" +
    "Try these commands:\n" +
    "💰 /balance — Check your balance\n" +
    "💎 /deposit — Get your deposit address\n" +
    "📈 /price — HSMC price",
    { parse_mode: "Markdown" }
  );
});

// /balance — Show HSMC balance
bot.command("balance", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const linked = requireLinkedUser(ctx, telegramId);
  if (!linked) return;

  const wallets = getUserWallets(linked.userId);

  if (wallets.length === 0) {
    await ctx.reply(
      "💰 *Balance: 0 HSMC*\n\n" +
      "You don't have any wallets yet. Create one in the HSMC web app.",
      { parse_mode: "Markdown" }
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

  await ctx.reply(message, { parse_mode: "Markdown" });
});

// /deposit — Show deposit address
bot.command("deposit", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const linked = requireLinkedUser(ctx, telegramId);
  if (!linked) return;

  const address = getPrimaryWallet(linked.userId);

  if (!address) {
    await ctx.reply(
      "💎 *No wallet found*\n\n" +
      "You need to create a wallet first. Visit the HSMC web app to create one.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  await ctx.reply(
    `💎 *Your Deposit Address*\n\n` +
    `\`${address}\`\n\n` +
    `🔒 Send HSMC to this address. All transactions use RingCT + stealth addresses for maximum privacy.\n\n` +
    `⚠️ Only send HSMC tokens to this address. Sending other tokens may result in permanent loss.`,
    { parse_mode: "Markdown" }
  );
});

// /send — Send HSMC
bot.command("send", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const linked = requireLinkedUser(ctx, telegramId);
  if (!linked) return;

  const args = ctx.match?.trim().split(/\s+/) ?? [];

  if (args.length < 2 || args[0] === "" || args[1] === "") {
    await ctx.reply(
      "💸 *Send HSMC*\n\n" +
      "Usage: `/send <address> <amount>`\n\n" +
      "Example: `/send hx1abc... 100`\n\n" +
      "Or send just the address or amount first and I'll guide you step by step.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const toAddress = args[0];
  const amountStr = args[1];
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply("❌ Invalid amount. Please enter a positive number.\nExample: `/send hx1abc... 100`", { parse_mode: "Markdown" });
    return;
  }

  // Validate address format (basic check)
  if (toAddress.length < 26 || toAddress.length > 100) {
    await ctx.reply("❌ Invalid address format. HSMC addresses are 26-100 characters.", { parse_mode: "Markdown" });
    return;
  }

  // Get sender's primary wallet
  const fromAddress = getPrimaryWallet(linked.userId);
  if (!fromAddress) {
    await ctx.reply("❌ No wallet found. Create a wallet in the HSMC web app first.");
    return;
  }

  // Check balance
  const wallets = getUserWallets(linked.userId);
  const totalBalance = wallets.reduce((sum, w) => sum + w.balance, 0);

  if (totalBalance < amount) {
    await ctx.reply(
      `❌ *Insufficient balance*\n\n` +
      `You have ${fmtHSMC(totalBalance)} but trying to send ${fmtHSMC(amount)}.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Create transaction
  const txId = createTransaction(fromAddress, toAddress, amount, linked.userId);

  await ctx.reply(
    `💸 *Transaction Created*\n\n` +
    `📤 From: \`${fromAddress.slice(0, 12)}...\`\n` +
    `📥 To: \`${toAddress.slice(0, 12)}...\`\n` +
    `💎 Amount: ${fmtHSMC(amount)}\n` +
    `🔢 TX ID: \`${txId.slice(0, 8)}...\`\n` +
    `🔒 Privacy: RingCT + Stealth Addresses\n\n` +
    `⏳ Status: Pending confirmation...\n\n` +
    `Track your transaction in the HSMC web app.`,
    { parse_mode: "Markdown" }
  );

  // Also notify the recipient if they have a linked Telegram
  const recipientRow = db.query(
    "SELECT user_id FROM wallets WHERE address = ? LIMIT 1"
  ).get(toAddress) as { user_id: string } | undefined;

  if (recipientRow) {
    await notifyUser(
      recipientRow.user_id,
      `📥 *Incoming Transaction!*\n\n` +
      `💎 Amount: ${fmtHSMC(amount)}\n` +
      `📤 From: \`${fromAddress.slice(0, 12)}...\`\n` +
      `🔢 TX ID: \`${txId.slice(0, 8)}...\`\n\n` +
      `Use /balance to check your updated balance.`,
    );
  }
});

// /price — Current HSMC price
bot.command("price", async (ctx) => {
  const price = getHSMCPrice();

  if (!price) {
    await ctx.reply("📈 *HSMC Price*\n\nNo price data available yet.", { parse_mode: "Markdown" });
    return;
  }

  const changeEmoji = price.change24h >= 0 ? "🟢" : "🔴";
  const changeSign = price.change24h >= 0 ? "+" : "";

  await ctx.reply(
    `📈 *HSMC Price*\n\n` +
    `💎 *$${price.price.toFixed(6)}* USD\n` +
    `${changeEmoji} 24h: ${changeSign}${price.change24h.toFixed(2)}%\n` +
    `🏦 Market Cap: $${(price.marketCap / 1_000_000).toFixed(2)}M\n\n` +
    `_Data from HSMC Network token metrics_`,
    { parse_mode: "Markdown" }
  );
});

// ── Text Message Handler (for multi-step flows) ─────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const text = ctx.message.text.trim();

  // Handle "awaiting user ID for linking" state
  if (ctx.session.awaitingLinkUserId) {
    ctx.session.awaitingLinkUserId = false;

    // Try to find the user by ID or wallet address
    let userId: string | null = null;

    // Try as user ID first
    const userRow = db.query("SELECT id FROM users WHERE id = ?").get(text) as { id: string } | undefined;
    if (userRow) {
      userId = userRow.id;
    }

    // Try as wallet address
    if (!userId) {
      const walletRow = db.query("SELECT user_id FROM wallets WHERE address = ? LIMIT 1").get(text) as { user_id: string } | undefined;
      if (walletRow) {
        userId = walletRow.user_id;
      }
    }

    if (!userId) {
      await ctx.reply(
        "❌ *User not found.*\n\n" +
        "Please check your User ID or wallet address and try again.\n" +
        "Use /link to restart the process.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Link the account
    const existingLink = db.query(
      "SELECT id FROM telegram_users WHERE telegram_id = ?"
    ).get(telegramId) as { id: string } | undefined;

    if (existingLink) {
      await ctx.reply("✅ Your Telegram is already linked to an HSMC account.");
      return;
    }

    db.query(
      "INSERT INTO telegram_users (id, telegram_id, user_id, telegram_username, first_name, last_name) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      randomUUID(), telegramId, userId,
      ctx.from?.username ?? null, ctx.from?.first_name ?? null, ctx.from?.last_name ?? null
    );

    await ctx.reply(
      "✅ *Account Linked!*\n\n" +
      "Your Telegram is now connected to your HSMC account.\n\n" +
      "Try: /balance | /deposit | /price",
      { parse_mode: "Markdown" }
    );
    return;
  }
});

// ── Notification Poller ─────────────────────────────────────────────────────────────

let lastTxCheck = new Date().toISOString();
let lastKillSwitchState = getKillSwitchStatus().active;

/** Poll for new transactions to linked users and send notifications */
async function pollTransactionNotifications(): Promise<void> {
  try {
    const rows = db.query(
      "SELECT t.id, t.to_address, t.amount, t.from_address, t.created_at, tu.telegram_id, tu.user_id " +
      "FROM transactions t " +
      "JOIN wallets w ON w.address = t.to_address " +
      "JOIN telegram_users tu ON tu.user_id = w.user_id " +
      "WHERE t.created_at > ? AND t.status = 'pending' " +
      "ORDER BY t.created_at DESC LIMIT 50"
    ).all(lastTxCheck) as Array<{
      id: string; to_address: string; amount: number; from_address: string;
      created_at: string; telegram_id: number; user_id: string;
    }>;

    for (const tx of rows) {
      const msg =
        `📥 *Incoming Transaction!*\n\n` +
        `💎 Amount: ${fmtHSMC(tx.amount)}\n` +
        `📤 From: \`${(tx.from_address || "anonymous").slice(0, 12)}...\`\n` +
        `🔢 TX: \`${tx.id.slice(0, 8)}...\`\n\n` +
        `Use /balance to check.`;

      try {
        await bot.api.sendMessage(tx.telegram_id, msg, { parse_mode: "Markdown" });
      } catch (err) {
        // User may have blocked the bot
        console.error(`[Telegram] Cannot notify telegram_id=${tx.telegram_id}:`, err);
      }
    }

    if (rows.length > 0) {
      lastTxCheck = rows[0].created_at;
    }
  } catch (err) {
    console.error("[Telegram] Transaction poll error:", err);
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
    console.error("[Telegram] Kill-switch poll error:", err);
  }
}

// ── Startup ─────────────────────────────────────────────────────────────────────────

const NOTIFICATION_POLL_INTERVAL_MS = 15_000; // 15 seconds
const KILLSWITCH_POLL_INTERVAL_MS = 30_000;   // 30 seconds

console.log("[Telegram] Starting HSMC Network Telegram Bot...");

// Start the bot
bot.start({
  onStart: (botInfo) => {
    console.log(`[Telegram] Bot @${botInfo.username} is running!`);
  },
});

// Start notification pollers
const txPollInterval = setInterval(pollTransactionNotifications, NOTIFICATION_POLL_INTERVAL_MS);
const ksPollInterval = setInterval(pollKillSwitch, KILLSWITCH_POLL_INTERVAL_MS);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[Telegram] Shutting down...");
  clearInterval(txPollInterval);
  clearInterval(ksPollInterval);
  bot.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[Telegram] Shutting down...");
  clearInterval(txPollInterval);
  clearInterval(ksPollInterval);
  bot.stop();
  process.exit(0);
});

console.log("[Telegram] Polling for notifications every", NOTIFICATION_POLL_INTERVAL_MS / 1000, "s");
console.log("[Telegram] Kill-switch check every", KILLSWITCH_POLL_INTERVAL_MS / 1000, "s");

export { bot, notifyUser, broadcastAll, getLinkedUser, createOTP, verifyOTP };
