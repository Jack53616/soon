import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { query } from "../server/config/db.js";
import { extractKeyCandidates } from "../server/utils/keyExtractor.js";

dotenv.config();

const { BOT_TOKEN, ADMIN_ID } = process.env;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

// CRITICAL FIX: Disable polling when using webhook
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

const isAdmin = (msg) => Number(msg?.from?.id) === Number(ADMIN_ID);

// Welcome message
bot.onText(/^\/start$/, (msg) => {
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
bot.onText(/^\/help$/, (msg) => {
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
bot.onText(/^\/create_key\s+(\S+)(?:\s+(\d+))?$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const key = extractKeyCandidates(match[1])[0];
  const days = Number(match[2] || 30);
  
  if (!key) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid key format");
  }
  
  try {
    await query("INSERT INTO keys (key_code, days) VALUES ($1, $2)", [key, days]);
    bot.sendMessage(msg.chat.id, `✅ Key created: ${key} (${days} days)`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Add balance
bot.onText(/^\/addbalance\s+(\d+)\s+(-?\d+(?:\.\d+)?)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  const amount = Number(match[2]);
  
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
bot.onText(/^\/removebalance\s+(\d+)\s+(\d+(?:\.\d+)?)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  const amount = Number(match[2]);
  
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
bot.onText(/^\/open\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  const hours = Number(match[2]);
  const target_pnl = Number(match[3]);
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
bot.onText(/^\/close\s+(\d+)$/, async (msg, match) => {
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

// Set daily target
bot.onText(/^\/setdaily\s+(\d+)\s+(-?\d+(?:\.\d+)?)(?:\s+(\d+))?$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  const target = Number(match[2]);
  const duration = Number(match[3] || 1800);
  
  try {
    const userResult = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, "❌ User not found");
    }
    
    const user = userResult.rows[0];
    
    await query(
      "INSERT INTO daily_targets (user_id, target, duration_sec) VALUES ($1, $2, $3)",
      [user.id, target, duration]
    );
    
    bot.sendMessage(msg.chat.id, `✅ Daily target set for ${tg_id}: ${target >= 0 ? '+' : ''}$${target} over ${duration}s`);
    bot.sendMessage(tg_id, `🚀 AI trading started: Target ${target >= 0 ? '+' : ''}$${Math.abs(target)}`).catch(() => {});
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Set TP
bot.onText(/^\/tp\s+(\d+)\s+(\d+(?:\.\d+)?)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const trade_id = Number(match[1]);
  const take_profit = Number(match[2]);
  
  try {
    await query("UPDATE trades SET take_profit = $1 WHERE id = $2 AND status = 'open'", [take_profit, trade_id]);
    bot.sendMessage(msg.chat.id, `✅ Take Profit set for trade #${trade_id}: ${take_profit}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Set SL
bot.onText(/^\/sl\s+(\d+)\s+(\d+(?:\.\d+)?)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const trade_id = Number(match[1]);
  const stop_loss = Number(match[2]);
  
  try {
    await query("UPDATE trades SET stop_loss = $1 WHERE id = $2 AND status = 'open'", [stop_loss, trade_id]);
    bot.sendMessage(msg.chat.id, `✅ Stop Loss set for trade #${trade_id}: ${stop_loss}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Ban user
bot.onText(/^\/ban\s+(\d+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  
  try {
    await query("UPDATE users SET is_banned = TRUE WHERE tg_id = $1", [tg_id]);
    bot.sendMessage(msg.chat.id, `✅ User ${tg_id} banned`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Unban user
bot.onText(/^\/unban\s+(\d+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  
  try {
    await query("UPDATE users SET is_banned = FALSE WHERE tg_id = $1", [tg_id]);
    bot.sendMessage(msg.chat.id, `✅ User ${tg_id} unbanned`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Lock trading
bot.onText(/^\/lock\s+(\d+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  
  try {
    await query("UPDATE users SET trading_locked = TRUE WHERE tg_id = $1", [tg_id]);
    bot.sendMessage(msg.chat.id, `✅ Trading locked for ${tg_id}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Unlock trading
bot.onText(/^\/unlock\s+(\d+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  
  try {
    await query("UPDATE users SET trading_locked = FALSE WHERE tg_id = $1", [tg_id]);
    bot.sendMessage(msg.chat.id, `✅ Trading unlocked for ${tg_id}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Approve withdrawal
bot.onText(/^\/approve\s+(\d+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const id = Number(match[1]);
  
  try {
    const reqResult = await query("SELECT * FROM requests WHERE id = $1", [id]);
    if (reqResult.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, "❌ Request not found");
    }
    
    const request = reqResult.rows[0];
    
    await query("UPDATE requests SET status = 'approved', updated_at = NOW() WHERE id = $1", [id]);
    await query(
      "UPDATE users SET frozen_balance = frozen_balance - $1, total_withdrawn = total_withdrawn + $1 WHERE id = $2",
      [request.amount, request.user_id]
    );
    
    const tg_id = await query("SELECT tg_id FROM users WHERE id = $1", [request.user_id]).then(r => r.rows[0]?.tg_id);
    
    bot.sendMessage(msg.chat.id, `✅ Withdrawal #${id} approved`);
    if (tg_id) {
      bot.sendMessage(tg_id, `💸 Withdrawal approved: $${Number(request.amount).toFixed(2)}`).catch(() => {});
    }
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Reject withdrawal
bot.onText(/^\/reject\s+(\d+)\s+(.+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const id = Number(match[1]);
  const reason = match[2];
  
  try {
    const reqResult = await query("SELECT * FROM requests WHERE id = $1", [id]);
    if (reqResult.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, "❌ Request not found");
    }
    
    const request = reqResult.rows[0];
    
    await query(
      "UPDATE requests SET status = 'rejected', admin_note = $1, updated_at = NOW() WHERE id = $2",
      [reason, id]
    );
    await query(
      "UPDATE users SET balance = balance + $1, frozen_balance = frozen_balance - $1 WHERE id = $2",
      [request.amount, request.user_id]
    );
    
    const tg_id = await query("SELECT tg_id FROM users WHERE id = $1", [request.user_id]).then(r => r.rows[0]?.tg_id);
    
    bot.sendMessage(msg.chat.id, `✅ Withdrawal #${id} rejected`);
    if (tg_id) {
      bot.sendMessage(tg_id, `❌ Withdrawal rejected: ${reason}`).catch(() => {});
    }
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Broadcast
bot.onText(/^\/broadcast\s+([\s\S]+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const message = match[1];
  
  try {
    const result = await query("SELECT tg_id FROM users WHERE tg_id IS NOT NULL");
    let sent = 0;
    
    for (const row of result.rows) {
      try {
        await bot.sendMessage(row.tg_id, message);
        sent++;
      } catch {}
    }
    
    bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${sent} users`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Notify specific user
bot.onText(/^\/notify\s+(\d+)\s+([\s\S]+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  
  const tg_id = Number(match[1]);
  const message = match[2];
  
  try {
    await bot.sendMessage(tg_id, message);
    bot.sendMessage(msg.chat.id, "✅ Message sent");
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Stats
bot.onText(/^\/stats$/, async (msg) => {
  if (!isAdmin(msg)) return;
  
  try {
    const users = await query("SELECT COUNT(*) as count FROM users");
    const trades = await query("SELECT COUNT(*) as count FROM trades WHERE status = 'open'");
    const requests = await query("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'");
    
    const text = `📊 System Statistics:

👥 Total Users: ${users.rows[0].count}
📈 Open Trades: ${trades.rows[0].count}
💸 Pending Withdrawals: ${requests.rows[0].count}`;

    bot.sendMessage(msg.chat.id, text);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

export default bot;