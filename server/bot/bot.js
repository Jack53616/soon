import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { query } from "../config/db.js";
import { extractKeyCandidates } from "../utils/keyExtractor.js";

dotenv.config();

const { BOT_TOKEN, ADMIN_ID } = process.env;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

// CRITICAL FIX: Disable polling when using webhook
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

const isAdmin = (msg) => Number(msg?.from?.id) === Number(ADMIN_ID);

// Rate Limiting Map
const userLastMessage = new Map();
const RATE_LIMIT_MS = 1000; // 1 second per message

const checkRateLimit = (msg) => {
  const userId = msg.from.id;
  const now = Date.now();
  const last = userLastMessage.get(userId) || 0;
  
  if (now - last < RATE_LIMIT_MS) {
    return false;
  }
  
  userLastMessage.set(userId, now);
  return true;
};

// Middleware wrapper for bot commands
const handleCommand = (regex, callback) => {
  bot.onText(regex, async (msg, match) => {
    if (!checkRateLimit(msg)) {
      return; // Silently ignore spam
    }
    
    try {
      await callback(msg, match);
    } catch (error) {
      console.error(`Command error: ${error.message}`);
      bot.sendMessage(msg.chat.id, "❌ An error occurred while processing your request.");
    }
  });
};

// Welcome message
handleCommand(/^\/start$/, (msg) => {
  const text = `👋 Welcome to QL Trading AI

🤖 Smart AI-powered trading bot
💰 Automated profit generation
📊 Real-time portfolio tracking
🕒 24/7 support

مرحباً بك في QL Trading AI 👋

🤖 بوت تداول ذكي بالذكاء الاصطناعي
💰 توليد أرباح تلقائي
📊 تتبع المحفظة في الوقت الفعلي
🕒 دعم 24/7`;

  bot.sendMessage(msg.chat.id, text);
});

// Admin help
handleCommand(/^\/help$/, (msg) => {
  if (!isAdmin(msg)) return;
  
  const text = `🛠 Admin Commands:

/create_key <KEY> <DAYS> - Create subscription key
/addbalance <tg_id> <amount> - Add balance
/removebalance <tg_id> <amount> - Remove balance
/open <tg_id> <hours> <target> - Open Gold trade with target
  Example: /open 123 2 10    → Trade for 2h, target +$10 profit
  Example: /open 123 1 -15   → Trade for 1h, target -$15 loss
/close <trade_id> - Close trade (auto-calculate PnL)
/setdaily <tg_id> <target> <duration> - Set daily target
/tp <trade_id> <price> - Set take profit
/sl <trade_id> <price> - Set stop loss
/ban <tg_id> - Ban user
/unban <tg_id> - Unban user
/lock <tg_id> - Lock trading
/unlock <tg_id> - Unlock trading
/approve <request_id> - Approve withdrawal
/reject <request_id> <reason> - Reject withdrawal
/broadcast <message> - Send to all users
/notify <tg_id> <message> - Send to specific user
/stats - System statistics`;

  bot.sendMessage(msg.chat.id, text);
});

// Create key
handleCommand(/^\/create_key\s+(\S+)(?:\s+(\d+))?$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const key = extractKeyCandidates(match[1])[0];
  const days = Number(match[2] || 30);
  
  if (!key || key.length < 5) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid key format (min 5 chars)");
  }
  
  if (days < 1 || days > 365) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid duration (1-365 days)");
  }
  
  try {
    await query("INSERT INTO subscription_keys (key_code, days) VALUES ($1, $2)", [key, days]);
    bot.sendMessage(msg.chat.id, `✅ Key created: ${key} (${days} days)`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Add balance
handleCommand(/^\/addbalance\s+(\d+)\s+(-?\d+(?:\.\d+)?)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  const amount = Number(match[2]);
  
  if (isNaN(amount) || amount === 0) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid amount");
  }
  
  try {
    const userResult = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, "❌ User not found");
    }
    
    const user = userResult.rows[0];
    
    await query("UPDATE users SET balance = balance + $1, total_deposited = total_deposited + $1 WHERE id = $2", [amount, user.id]);
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'admin', $2, 'Admin deposit')",
      [user.id, amount]
    );
    
    const newBalance = await query("SELECT balance FROM users WHERE id = $1", [user.id]);
    
    bot.sendMessage(msg.chat.id, `✅ Balance updated for ${tg_id}: ${amount > 0 ? '+' : ''}$${amount}\nNew Balance: $${Number(newBalance.rows[0].balance).toFixed(2)}`);
    bot.sendMessage(tg_id, `💳 Deposit: ${amount > 0 ? '+' : ''}$${Math.abs(amount).toFixed(2)}\n💰 New Balance: $${Number(newBalance.rows[0].balance).toFixed(2)}`).catch(() => {});
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Remove balance
handleCommand(/^\/removebalance\s+(\d+)\s+(\d+(?:\.\d+)?)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  const amount = Number(match[2]);
  
  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid amount (must be positive)");
  }
  
  try {
    const userResult = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, "❌ User not found");
    }
    
    const user = userResult.rows[0];
    
    await query("UPDATE users SET balance = balance - $1 WHERE id = $2", [amount, user.id]);
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'admin', $2, 'Admin deduction')",
      [user.id, -amount]
    );
    
    const newBalance = await query("SELECT balance FROM users WHERE id = $1", [user.id]);
    
    bot.sendMessage(msg.chat.id, `✅ Balance deducted from ${tg_id}: -$${amount}\nNew Balance: $${Number(newBalance.rows[0].balance).toFixed(2)}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Open trade - FIXED VERSION
handleCommand(/^\/open\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  const hours = Number(match[2]);
  const target_pnl = Number(match[3]);
  
  if (hours <= 0 || hours > 168) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid duration (1-168 hours)");
  }
  
  const duration_seconds = Math.floor(hours * 3600);
  
  try {
    const userResult = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, "❌ User not found");
    }
    
    const user = userResult.rows[0];
    
    // Always Gold (XAUUSD)
    const symbol = "XAUUSD";
    const direction = target_pnl > 0 ? "BUY" : "SELL";
    const lot_size = 0.01;
    
    // Get real Gold price (will be updated by trading engine)
    const entry_price = 2650 + (Math.random() - 0.5) * 10;
    
    const result = await query(
      "INSERT INTO trades (user_id, symbol, direction, entry_price, current_price, lot_size, duration_seconds, target_pnl) VALUES ($1, $2, $3, $4, $4, $5, $6, $7) RETURNING *",
      [user.id, symbol, direction, entry_price, lot_size, duration_seconds, target_pnl]
    );
    
    const trade = result.rows[0];
    
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'open', 0, $2)",
      [user.id, `Opened ${direction} ${symbol} - Target: ${target_pnl > 0 ? '+' : ''}$${target_pnl}`]
    );
    
    bot.sendMessage(msg.chat.id, `✅ Trade #${trade.id} opened for ${tg_id}
Symbol: ${symbol}
Direction: ${direction}
Entry: $${entry_price.toFixed(2)}
Duration: ${hours} hour(s)
Target: ${target_pnl > 0 ? '+' : ''}$${target_pnl}
Lot: ${lot_size}`);
    
    bot.sendMessage(tg_id, `📈 AI detected Gold opportunity!
${direction} XAUUSD @ $${entry_price.toFixed(2)}
Duration: ${hours} hour(s)
Target: ${target_pnl > 0 ? '🎯 Profit' : '⚠️ Loss'} ${target_pnl > 0 ? '+' : ''}$${Math.abs(target_pnl)}`).catch(() => {});
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Close trade - FIXED VERSION
handleCommand(/^\/close\s+(\d+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const trade_id = Number(match[1]);
  
  try {
    const tradeResult = await query("SELECT * FROM trades WHERE id = $1 AND status = 'open'", [trade_id]);
    if (tradeResult.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, "❌ Trade not found or already closed");
    }
    
    const trade = tradeResult.rows[0];
    const pnl = Number(trade.pnl || 0);
    
    // Close trade
    await query(
      "UPDATE trades SET status = 'closed', closed_at = NOW(), close_reason = 'manual' WHERE id = $1",
      [trade_id]
    );
    
    // FIXED: Update user balance and stats correctly
    await query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [pnl, trade.user_id]
    );
    
    // FIXED: Update wins/losses separately
    if (pnl >= 0) {
      await query("UPDATE users SET wins = COALESCE(wins, 0) + $1 WHERE id = $2", [pnl, trade.user_id]);
    } else {
      await query("UPDATE users SET losses = COALESCE(losses, 0) + $1 WHERE id = $2", [Math.abs(pnl), trade.user_id]);
    }
    
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, 'Trade closed manually')",
      [trade.user_id, pnl]
    );
    
    // Move to history
    const duration = Math.floor((new Date() - new Date(trade.opened_at)) / 1000);
    await query(
      `INSERT INTO trades_history (user_id, trade_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'manual')`,
      [trade.user_id, trade_id, trade.symbol, trade.direction, trade.entry_price, trade.current_price, trade.lot_size, pnl, duration, trade.opened_at]
    );
    
    const userResult = await query("SELECT tg_id, balance, wins, losses FROM users WHERE id = $1", [trade.user_id]);
    const user = userResult.rows[0];
    
    bot.sendMessage(msg.chat.id, `✅ Trade #${trade_id} closed
PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}
New Balance: $${Number(user.balance).toFixed(2)}
Total Wins: $${Number(user.wins || 0).toFixed(2)}
Total Losses: $${Number(user.losses || 0).toFixed(2)}`);
    
    if (user.tg_id) {
      bot.sendMessage(user.tg_id, `🔔 Trade Closed!

${pnl >= 0 ? '🟢 Profit' : '🔴 Loss'}: ${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}
💰 New Balance: $${Number(user.balance).toFixed(2)}
📊 Total Wins: $${Number(user.wins || 0).toFixed(2)}
📉 Total Losses: $${Number(user.losses || 0).toFixed(2)}`).catch(() => {});
    }
  } catch (error) {
    console.error("Close trade error:", error);
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

export default bot;
