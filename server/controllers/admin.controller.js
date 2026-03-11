import { query } from "../config/db.js";
import bot from "../bot/bot.js";
import crypto from "crypto";

// Dashboard with comprehensive stats
export const getDashboard = async (req, res) => {
  try {
    const usersCount = await query("SELECT COUNT(*) as count FROM users");
    const totalDeposits = await query("SELECT COALESCE(SUM(total_deposited), 0) as total FROM users");
    const totalWithdrawals = await query("SELECT COALESCE(SUM(total_withdrawn), 0) as total FROM users");
    const openTrades = await query("SELECT COUNT(*) as count FROM trades WHERE status = 'open'");
    const recentOps = await query(`
      SELECT o.*, u.name, u.tg_id 
      FROM ops o 
      LEFT JOIN users u ON o.user_id = u.id 
      ORDER BY o.created_at DESC 
      LIMIT 20
    `);

    res.json({ 
      ok: true, 
      data: {
        totalUsers: usersCount.rows[0].count,
        totalDeposited: totalDeposits.rows[0].total,
        totalWithdrawn: totalWithdrawals.rows[0].total,
        openTrades: openTrades.rows[0].count,
        recentOps: recentOps.rows
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get all users
export const getUsers = async (req, res) => {
  try {
    const result = await query("SELECT * FROM users ORDER BY created_at DESC LIMIT 200");
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Search user by ID or name
export const searchUser = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ ok: false, error: "Query required" });

    const result = await query(`
      SELECT * FROM users 
      WHERE tg_id::text LIKE $1 
         OR LOWER(name) LIKE LOWER($1) 
         OR id::text = $2
      LIMIT 1
    `, [`%${q}%`, q]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get single user by ID
export const getUser = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query("SELECT * FROM users WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Modify user balance
export const modifyBalance = async (req, res) => {
  try {
    const { user_id, amount, action, note } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];
    let newBalance;

    if (action === 'add') {
      await query("UPDATE users SET balance = balance + $1 WHERE id = $2", [amount, user_id]);
      await query("UPDATE users SET total_deposited = total_deposited + $1 WHERE id = $2", [amount, user_id]);
      newBalance = Number(user.balance) + amount;
    } else if (action === 'remove') {
      await query("UPDATE users SET balance = balance - $1 WHERE id = $2", [amount, user_id]);
      newBalance = Number(user.balance) - amount;
    } else if (action === 'zero') {
      await query("UPDATE users SET balance = 0 WHERE id = $1", [user_id]);
      newBalance = 0;
    }

    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'admin', $2, $3)",
      [user_id, action === 'remove' ? -amount : (action === 'zero' ? -user.balance : amount), note || `Admin ${action}`]
    );

    res.json({ ok: true, message: "Balance updated", newBalance });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Update user name
export const updateUserName = async (req, res) => {
  try {
    const { user_id, name } = req.body;

    if (!user_id) return res.status(400).json({ ok: false, error: 'user_id required' });
    if (!name || name.trim().length < 2) return res.status(400).json({ ok: false, error: 'Name too short' });
    if (name.trim().length > 60) return res.status(400).json({ ok: false, error: 'Name too long' });

    const userResult = await query('SELECT id, name FROM users WHERE id = $1', [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const oldName = userResult.rows[0].name;
    await query('UPDATE users SET name = $1 WHERE id = $2', [name.trim(), user_id]);

    // Log the action
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'admin', 0, $2)",
      [user_id, `Admin changed name: "${oldName}" → "${name.trim()}"`]
    );

    res.json({ ok: true, message: 'Name updated', name: name.trim() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Extend subscription
export const extendSubscription = async (req, res) => {
  try {
    const { user_id, days } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];
    const currentExpiry = user.sub_expires ? new Date(user.sub_expires) : new Date();
    const newExpiry = new Date(Math.max(currentExpiry.getTime(), Date.now()) + days * 24 * 60 * 60 * 1000);

    await query("UPDATE users SET sub_expires = $1 WHERE id = $2", [newExpiry, user_id]);
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'admin', 0, $2)",
      [user_id, `Subscription extended by ${days} days`]
    );

    res.json({ ok: true, message: "Subscription extended", newExpiry });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Add trade for user
export const addTrade = async (req, res) => {
  try {
    const { user_id, target_pnl, duration_hours, duration_minutes, speed } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];
    const durationSeconds = duration_minutes ? duration_minutes * 60 : (duration_hours || 1) * 3600;
    const tradeSpeed = speed || 'normal';
    const entryPrice = 2650 + (Math.random() - 0.5) * 10;
    // FIX: Direction is random, NOT based on target_pnl sign
    const directions = ['BUY', 'SELL'];
    const direction = directions[Math.floor(Math.random() * 2)];

    await query(`
      INSERT INTO trades (user_id, symbol, direction, entry_price, current_price, lot_size, target_pnl, duration_seconds, speed, status)
      VALUES ($1, 'XAUUSD', $2, $3, $3, 0.05, $4, $5, $6, 'open')
    `, [user_id, direction, entryPrice, target_pnl, durationSeconds, tradeSpeed]);

    // Format duration for notification
    let durationText, durationTextEn;
    if (durationSeconds >= 3600) {
      const h = Math.round(durationSeconds / 3600 * 10) / 10;
      durationText = `${h} ساعة`;
      durationTextEn = `${h} Hours`;
    } else if (durationSeconds >= 60) {
      const m = Math.round(durationSeconds / 60);
      durationText = `${m} دقيقة`;
      durationTextEn = `${m} Minutes`;
    } else {
      durationText = `${durationSeconds} ثانية`;
      durationTextEn = `${durationSeconds} Seconds`;
    }
    const speedText = tradeSpeed === 'turbo' ? '🚀 تيربو' : (tradeSpeed === 'fast' ? '⚡ سريع' : '📊 عادي');
    const speedTextEn = tradeSpeed === 'turbo' ? '🚀 Turbo' : (tradeSpeed === 'fast' ? '⚡ Fast' : '📊 Normal');

    if (user.tg_id) {
      try {
        await bot.sendMessage(Number(user.tg_id), `🚀 *تم تفعيل صفقة ذكية جديدة*

🔸 *الرمز:* XAUUSD (الذهب)
⏱ *المدة:* ${durationText}
${speedText}
📊 *الحالة:* نشطة ومراقبة

💡 _تابع محفظتك للتحديثات المباشرة._

---

🚀 *New Smart Trade Activated*
🔸 *Symbol:* XAUUSD (Gold)
⏱ *Duration:* ${durationTextEn}
${speedTextEn}
📊 *Status:* Active & Monitored`, { parse_mode: "Markdown" });
      } catch (err) {
        console.log(`Failed to send trade notification to ${user.tg_id}:`, err.message);
      }
    }

    res.json({ ok: true, message: "Trade added" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Clear user history
export const clearHistory = async (req, res) => {
  try {
    const { user_id } = req.body;

    await query("DELETE FROM ops WHERE user_id = $1", [user_id]);
    await query("DELETE FROM trades_history WHERE user_id = $1", [user_id]);
    await query("UPDATE users SET wins = 0, losses = 0 WHERE id = $1", [user_id]);

    res.json({ ok: true, message: "History cleared" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Ban user
export const banUser = async (req, res) => {
  try {
    const { user_id, banned, reason } = req.body;
    const isBanned = banned !== false;
    const banReason = reason || 'مخالفة شروط الاستخدام';

    if (isBanned) {
      await query("UPDATE users SET is_banned = TRUE, ban_reason = $1, banned_at = NOW() WHERE id = $2", [banReason, user_id]);
    } else {
      await query("UPDATE users SET is_banned = FALSE, ban_reason = NULL, banned_at = NULL WHERE id = $1", [user_id]);
    }

    const userResult = await query("SELECT tg_id FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length > 0 && userResult.rows[0].tg_id) {
      const tgId = Number(userResult.rows[0].tg_id);
      try {
        if (isBanned) {
          await bot.sendMessage(tgId, `🚫 *تم حظر حسابك*\n\n━━━━━━━━━━━━━━━━━━━━\n📋 *السبب:* ${banReason}\n\n📩 للتواصل مع الدعم:\n━━━━━━━━━━━━━━━━━━━━\n\n🔗 *Your account has been suspended*\nReason: ${banReason}`, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "📩 تواصل مع الدعم | Contact Support", url: "https://t.me/QL_Support" }]
              ]
            }
          });
        } else {
          await bot.sendMessage(tgId, `✅ *تم رفع الحظر عن حسابك*\n\nيمكنك الآن استخدام المنصة بشكل طبيعي.\n\n✅ *Your account has been reactivated*\nYou can now use the platform normally.`, { parse_mode: "Markdown" });
        }
      } catch (err) {
        console.log(`Failed to send ban notification to ${tgId}`);
      }
    }

    res.json({ ok: true, message: isBanned ? "User banned" : "User unbanned" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Unban user
export const unbanUser = async (req, res) => {
  try {
    const { user_id } = req.body;

    await query("UPDATE users SET is_banned = FALSE, ban_reason = NULL, banned_at = NULL WHERE id = $1", [user_id]);

    const userResult = await query("SELECT tg_id FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length > 0 && userResult.rows[0].tg_id) {
      try {
        await bot.sendMessage(Number(userResult.rows[0].tg_id), `✅ *تم رفع الحظر عن حسابك*\n\nيمكنك الآن استخدام المنصة بشكل طبيعي.\n\n✅ *Your account has been reactivated*\nYou can now use the platform normally.`, { parse_mode: "Markdown" });
      } catch (err) { /* ignore */ }
    }

    res.json({ ok: true, message: "User unbanned" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get withdrawals with filter
export const getWithdrawals = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT r.*, u.tg_id, u.name as user_name,
             wm.address as saved_wallet_address
      FROM requests r 
      JOIN users u ON r.user_id = u.id
      LEFT JOIN withdraw_methods wm ON wm.user_id = r.user_id AND wm.method = r.method
    `;
    const params = [];
    
    if (status && status !== 'all') {
      sql += ` WHERE r.status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY r.created_at DESC LIMIT 100`;

    const result = await query(sql, params);
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Approve withdrawal
export const approveWithdrawal = async (req, res) => {
  try {
    const { request_id } = req.body;

    const reqResult = await query("SELECT * FROM requests WHERE id = $1", [request_id]);
    if (reqResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Request not found" });
    }

    const request = reqResult.rows[0];
    if (request.status !== 'pending') {
      return res.status(400).json({ ok: false, error: "Request already processed" });
    }

    await query("UPDATE requests SET status = 'approved', updated_at = NOW() WHERE id = $1", [request_id]);
    await query(
      "UPDATE users SET frozen_balance = frozen_balance - $1, total_withdrawn = total_withdrawn + $1 WHERE id = $2",
      [request.amount, request.user_id]
    );
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'withdraw', $2, 'Withdrawal approved')",
      [request.user_id, -request.amount]
    );

    const userResult = await query("SELECT tg_id FROM users WHERE id = $1", [request.user_id]);
    if (userResult.rows.length > 0 && userResult.rows[0].tg_id) {
      try {
        await bot.sendMessage(Number(userResult.rows[0].tg_id), `💸 تمت الموافقة على طلب السحب #${request_id} بقيمة $${Number(request.amount).toFixed(2)}.`);
      } catch (err) { /* ignore */ }
    }

    res.json({ ok: true, message: "Withdrawal approved" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Reject withdrawal
export const rejectWithdrawal = async (req, res) => {
  try {
    const { request_id, reason } = req.body;

    const reqResult = await query("SELECT * FROM requests WHERE id = $1", [request_id]);
    if (reqResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Request not found" });
    }

    const request = reqResult.rows[0];
    if (request.status !== 'pending') {
      return res.status(400).json({ ok: false, error: "Request already processed" });
    }

    await query(
      "UPDATE requests SET status = 'rejected', admin_note = $1, updated_at = NOW() WHERE id = $2",
      [reason || 'Rejected by admin', request_id]
    );
    await query(
      "UPDATE users SET balance = balance + $1, frozen_balance = frozen_balance - $1 WHERE id = $2",
      [request.amount, request.user_id]
    );

    const userResult = await query("SELECT tg_id FROM users WHERE id = $1", [request.user_id]);
    if (userResult.rows.length > 0 && userResult.rows[0].tg_id) {
      try {
        await bot.sendMessage(Number(userResult.rows[0].tg_id), `❌ تم رفض طلب السحب #${request_id}. السبب: ${reason || 'Rejected by admin'}`);
      } catch (err) { /* ignore */ }
    }

    res.json({ ok: true, message: "Withdrawal rejected" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get trades with filter
export const getAllTrades = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT t.*, u.tg_id, u.name as user_name 
      FROM trades t 
      JOIN users u ON t.user_id = u.id 
    `;
    const params = [];
    
    if (status && status !== 'all') {
      sql += ` WHERE t.status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY t.opened_at DESC LIMIT 100`;

    const result = await query(sql, params);
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Close trade
export const closeTrade = async (req, res) => {
  try {
    const { trade_id } = req.body;

    const tradeResult = await query("SELECT * FROM trades WHERE id = $1", [trade_id]);
    if (tradeResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Trade not found" });
    }

    const trade = tradeResult.rows[0];
    
    // FIX: Prevent double-close - check if already closed
    if (trade.status !== 'open') {
      return res.status(400).json({ ok: false, error: "Trade is not open" });
    }
    
    const pnl = Number(trade.target_pnl) || Number(trade.pnl) || 0;

    // FIX: Use atomic UPDATE with RETURNING to prevent race condition
    const closeResult = await query(
      "UPDATE trades SET status = 'closed', closed_at = NOW(), close_reason = 'admin', pnl = $1 WHERE id = $2 AND status = 'open' RETURNING id",
      [pnl, trade_id]
    );
    
    if (closeResult.rowCount === 0) {
      return res.status(400).json({ ok: false, error: "Trade already closed" });
    }
    
    await query("UPDATE users SET balance = balance + $1 WHERE id = $2", [pnl, trade.user_id]);

    if (pnl >= 0) {
      await query("UPDATE users SET wins = COALESCE(wins, 0) + $1 WHERE id = $2", [pnl, trade.user_id]);
    } else {
      await query("UPDATE users SET losses = COALESCE(losses, 0) + $1 WHERE id = $2", [Math.abs(pnl), trade.user_id]);
    }

    const duration = Math.floor((new Date() - new Date(trade.opened_at)) / 1000);
    await query(
      `INSERT INTO trades_history (user_id, trade_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'admin')`,
      [trade.user_id, trade_id, trade.symbol, trade.direction, trade.entry_price, trade.current_price, trade.lot_size, pnl, duration, trade.opened_at]
    );

    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
      [trade.user_id, pnl, `Trade #${trade_id} closed by admin`]
    );

    const userResult = await query("SELECT tg_id, balance FROM users WHERE id = $1", [trade.user_id]);
    if (userResult.rows.length > 0 && userResult.rows[0].tg_id) {
      try {
        const user = userResult.rows[0];
        await bot.sendMessage(Number(user.tg_id), `🔔 *Trade Closed*\n${pnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}\n💰 Balance: $${Number(user.balance).toFixed(2)}`, { parse_mode: "Markdown" });
      } catch (err) { /* ignore */ }
    }

    res.json({ ok: true, message: "Trade closed" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get withdrawal setting
export const getWithdrawalSetting = async (req, res) => {
  try {
    const result = await query("SELECT value FROM settings WHERE key = 'withdrawal_enabled'");
    const enabled = result.rows.length === 0 || result.rows[0].value !== 'false';
    res.json({ ok: true, enabled });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Toggle withdrawal setting
export const toggleWithdrawal = async (req, res) => {
  try {
    const result = await query("SELECT value FROM settings WHERE key = 'withdrawal_enabled'");
    const currentEnabled = result.rows.length === 0 || result.rows[0].value !== 'false';
    const newValue = currentEnabled ? 'false' : 'true';

    await query(
      "INSERT INTO settings (key, value) VALUES ('withdrawal_enabled', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
      [newValue]
    );

    res.json({ ok: true, enabled: !currentEnabled });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get maintenance setting
export const getMaintenanceSetting = async (req, res) => {
  try {
    const result = await query("SELECT value FROM settings WHERE key = 'maintenance_mode'");
    const enabled = result.rows.length > 0 && result.rows[0].value === 'true';
    res.json({ ok: true, enabled });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Toggle maintenance setting
export const toggleMaintenance = async (req, res) => {
  try {
    const result = await query("SELECT value FROM settings WHERE key = 'maintenance_mode'");
    const currentEnabled = result.rows.length > 0 && result.rows[0].value === 'true';
    const newValue = currentEnabled ? 'false' : 'true';

    await query(
      "INSERT INTO settings (key, value) VALUES ('maintenance_mode', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
      [newValue]
    );

    res.json({ ok: true, enabled: !currentEnabled });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Create subscription key
export const createKey = async (req, res) => {
  try {
    const { code, days } = req.body;

    if (!code) {
      return res.status(400).json({ ok: false, error: "Key code required" });
    }

    await query(
      "INSERT INTO subscription_keys (key_code, days) VALUES ($1, $2)",
      [code, days || 30]
    );

    res.json({ ok: true, message: "Key created" });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ ok: false, error: "Key already exists" });
    }
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Broadcast message
export const broadcast = async (req, res) => {
  try {
    const { message, title } = req.body;

    if (!message) {
      return res.status(400).json({ ok: false, error: "Message required" });
    }

    await query(
      "INSERT INTO system_messages (title, message) VALUES ($1, $2)",
      [title || 'إشعار', message]
    );

    const users = await query("SELECT tg_id FROM users WHERE tg_id IS NOT NULL AND is_banned = FALSE");
    let sent = 0;
    let failed = 0;

    for (const user of users.rows) {
      try {
        const fullMessage = title ? `📢 *${title}*\n\n${message}` : `📢 ${message}`;
        await bot.sendMessage(Number(user.tg_id), fullMessage, { parse_mode: "Markdown" });
        sent++;
      } catch (err) {
        failed++;
      }
    }

    res.json({ ok: true, message: `Broadcast sent to ${sent} users (${failed} failed)`, sent, failed });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Update settings
export const updateSettings = async (req, res) => {
  try {
    const { key, value } = req.body;

    await query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
      [key, value]
    );

    res.json({ ok: true, message: "Settings updated" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Clear user withdrawals
export const clearUserWithdrawals = async (req, res) => {
  try {
    const { user_id } = req.body;

    const pendingResult = await query(
      "SELECT * FROM requests WHERE user_id = $1 AND status = 'pending'",
      [user_id]
    );

    for (const req of pendingResult.rows) {
      await query(
        "UPDATE users SET balance = balance + $1, frozen_balance = frozen_balance - $1 WHERE id = $2",
        [req.amount, user_id]
      );
    }

    await query("DELETE FROM requests WHERE user_id = $1", [user_id]);

    res.json({ ok: true, message: "User withdrawals cleared" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Clear all withdrawals system-wide
export const clearAllWithdrawals = async (req, res) => {
  try {
    const pendingResult = await query("SELECT * FROM requests WHERE status = 'pending'");

    for (const req of pendingResult.rows) {
      await query(
        "UPDATE users SET balance = balance + $1, frozen_balance = frozen_balance - $1 WHERE id = $2",
        [req.amount, req.user_id]
      );
    }

    await query("DELETE FROM requests");

    res.json({ ok: true, message: "All withdrawals cleared" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Reset user's total withdrawn
export const resetUserWithdrawn = async (req, res) => {
  try {
    const { user_id } = req.body;

    await query("UPDATE users SET total_withdrawn = 0 WHERE id = $1", [user_id]);

    res.json({ ok: true, message: "User total withdrawn reset" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Clear user trades
export const clearUserTrades = async (req, res) => {
  try {
    const { user_id } = req.body;

    await query("DELETE FROM trades WHERE user_id = $1", [user_id]);
    await query("DELETE FROM trades_history WHERE user_id = $1", [user_id]);

    res.json({ ok: true, message: "User trades cleared" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== REFERRAL SYSTEM =====

// Get referral stats
export const getReferralStats = async (req, res) => {
  try {
    const totalRefs = await query("SELECT COUNT(*) as count FROM referrals");
    const creditedRefs = await query("SELECT COUNT(*) as count, COALESCE(SUM(bonus_amount), 0) as total FROM referrals WHERE status = 'credited'");
    const pendingRefs = await query("SELECT COUNT(*) as count FROM referrals WHERE status = 'pending'");
    
    const topReferrers = await query(`
      SELECT u.name, u.tg_id, COUNT(r.id) as ref_count, COALESCE(u.referral_earnings, 0) as earnings
      FROM users u
      JOIN referrals r ON r.referrer_tg_id = u.tg_id
      GROUP BY u.id, u.name, u.tg_id, u.referral_earnings
      ORDER BY ref_count DESC
      LIMIT 10
    `);

    res.json({
      ok: true,
      data: {
        total: totalRefs.rows[0].count,
        credited: creditedRefs.rows[0].count,
        totalPaid: creditedRefs.rows[0].total,
        pending: pendingRefs.rows[0].count,
        topReferrers: topReferrers.rows
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get user referral info
export const getUserReferrals = async (req, res) => {
  try {
    const { user_id } = req.params;
    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];

    if (!user.referral_code) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      await query("UPDATE users SET referral_code = $1 WHERE id = $2", [code, user_id]);
      user.referral_code = code;
    }

    const referrals = await query(
      "SELECT r.*, u.name as referred_name FROM referrals r LEFT JOIN users u ON u.tg_id = r.referred_tg_id WHERE r.referrer_tg_id = $1 ORDER BY r.created_at DESC",
      [user.tg_id]
    );

    res.json({
      ok: true,
      data: {
        referral_code: user.referral_code,
        referral_earnings: user.referral_earnings || 0,
        referrals: referrals.rows
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== ENHANCED MASS TRADES SYSTEM v3.1 =====

// Create a scheduled mass trade (pending - waiting for admin to set percentage)
export const createScheduledMassTrade = async (req, res) => {
  try {
    const { symbol, direction, note, scheduled_time, scheduled_date, duration_seconds } = req.body;

    const entryPrice = 2650 + (Math.random() - 0.5) * 10;
    const usersCount = await query("SELECT COUNT(*) as count FROM users WHERE is_banned = FALSE AND balance > 0");

    const result = await query(
      `INSERT INTO mass_trades (symbol, direction, note, participants_count, status, scheduled_time, scheduled_date, duration_seconds, entry_price, is_scheduled)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9) RETURNING *`,
      [
        symbol || 'XAUUSD',
        direction || 'BUY',
        note || '',
        usersCount.rows[0].count,
        scheduled_time || null,
        scheduled_date || new Date().toISOString().split('T')[0],
        duration_seconds || 3600,
        entryPrice,
        !!scheduled_time
      ]
    );

    res.json({ ok: true, message: "Mass trade created (pending)", data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Set percentage on a pending mass trade (changes status to 'ready' - will auto-activate at scheduled time)
export const setMassTradePercentage = async (req, res) => {
  try {
    const { mass_trade_id, percentage } = req.body;

    if (percentage === undefined || percentage === null) {
      return res.status(400).json({ ok: false, error: "Percentage required" });
    }

    const tradeResult = await query("SELECT * FROM mass_trades WHERE id = $1 AND status IN ('pending', 'ready')", [mass_trade_id]);
    if (tradeResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Mass trade not found or already activated" });
    }

    // Update mass trade to 'ready' status with percentage set
    await query(
      "UPDATE mass_trades SET status = 'ready', percentage = $1 WHERE id = $2",
      [percentage, mass_trade_id]
    );

    const massTrade = tradeResult.rows[0];
    const timeLabel = massTrade.scheduled_time === '14:00' ? '2:00 PM' : massTrade.scheduled_time === '18:00' ? '6:00 PM' : '9:30 PM';

    res.json({
      ok: true,
      message: `Percentage set to ${percentage}%. Trade will auto-activate at ${timeLabel}.`,
      data: {
        mass_trade_id,
        percentage,
        scheduled_time: massTrade.scheduled_time,
        status: 'ready'
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Activate a pending/ready mass trade (creates user trades, sends notifications)
// Called automatically by scheduler or manually by admin
export const activateMassTrade = async (req, res) => {
  try {
    const { mass_trade_id, percentage } = req.body;

    if (percentage === undefined || percentage === null) {
      return res.status(400).json({ ok: false, error: "Percentage required" });
    }

    // FIX: Use atomic UPDATE with RETURNING to prevent double-activation race conditions
    const atomicUpdate = await query(
      "UPDATE mass_trades SET status = 'open', percentage = $1, activated_at = NOW() WHERE id = $2 AND status IN ('pending', 'ready') RETURNING *",
      [percentage, mass_trade_id]
    );

    if (atomicUpdate.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Mass trade not found or already activated" });
    }

    const massTrade = atomicUpdate.rows[0];
    const durationSeconds = Number(massTrade.duration_seconds) || 3600;
    const entryPrice = Number(massTrade.entry_price) || (2650 + (Math.random() - 0.5) * 10);

    // Get all eligible users (non-banned, with balance > 0)
    const users = await query("SELECT * FROM users WHERE is_banned = FALSE AND balance > 0");

    let totalCreated = 0;

    for (const user of users.rows) {
      // Check for custom override
      const overrideResult = await query(
        "SELECT custom_percentage FROM mass_trade_overrides WHERE mass_trade_id = $1 AND user_id = $2",
        [mass_trade_id, user.id]
      );

      const appliedPercentage = overrideResult.rows.length > 0 
        ? Number(overrideResult.rows[0].custom_percentage) 
        : Number(percentage);

      const balanceBefore = Number(user.balance);
      const targetPnl = Number((balanceBefore * appliedPercentage / 100).toFixed(2));
      // FIX: Direction is random, NOT based on targetPnl sign
      const directions = ['BUY', 'SELL'];
      const direction = directions[Math.floor(Math.random() * 2)];

      // FIX: ON CONFLICT DO NOTHING prevents duplicate user trades
      await query(
        `INSERT INTO mass_trade_user_trades (mass_trade_id, user_id, symbol, direction, entry_price, current_price, lot_size, pnl, target_pnl, duration_seconds, status, opened_at)
         VALUES ($1, $2, $3, $4, $5, $5, 0.05, 0, $6, $7, 'open', NOW())
         ON CONFLICT (mass_trade_id, user_id) DO NOTHING`,
        [mass_trade_id, user.id, massTrade.symbol || 'XAUUSD', direction, entryPrice, targetPnl, durationSeconds]
      );

      // Save participant record
      await query(
        `INSERT INTO mass_trade_participants (mass_trade_id, user_id, balance_before, balance_after, pnl_amount, percentage_applied)
         VALUES ($1, $2, $3, $3, 0, $4)
         ON CONFLICT (mass_trade_id, user_id) DO NOTHING`,
        [mass_trade_id, user.id, balanceBefore, appliedPercentage]
      );

      // Send Telegram notification
      if (user.tg_id) {
        try {
          await bot.sendMessage(Number(user.tg_id), `🚀 *البوت دخل صفقة جديدة!*

🔸 *الرمز:* ${massTrade.symbol || 'XAUUSD'}
📊 *الاتجاه:* ${direction}
⏱ *المدة:* ${Math.round(durationSeconds / 60)} دقيقة

📱 يمكنك المراقبة من خيار *صفقاتي*

---

🚀 *Bot entered a new trade!*
🔸 *Symbol:* ${massTrade.symbol || 'XAUUSD'}
📊 *Direction:* ${direction}
⏱ *Duration:* ${Math.round(durationSeconds / 60)} min

📱 Monitor from *My Trades*`, { parse_mode: "Markdown" });
        } catch (err) { /* ignore */ }
      }

      totalCreated++;
    }

    // Update participants count
    await query("UPDATE mass_trades SET participants_count = $1 WHERE id = $2", [totalCreated, mass_trade_id]);

    res.json({
      ok: true,
      message: `Mass trade activated! ${totalCreated} user trades created.`,
      data: {
        mass_trade_id,
        participants: totalCreated,
        percentage
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Close mass trade (called automatically after duration or manually)
export const closeMassTrade = async (req, res) => {
  try {
    const { mass_trade_id, percentage } = req.body;

    // Check if it's a pending trade being closed directly (old behavior)
    const tradeResult = await query("SELECT * FROM mass_trades WHERE id = $1", [mass_trade_id]);
    if (tradeResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Mass trade not found" });
    }

    const massTrade = tradeResult.rows[0];

    // If it's still pending and percentage is provided, activate and close immediately (legacy behavior)
    if (massTrade.status === 'pending' && percentage !== undefined) {
      // Get all eligible users
      const users = await query("SELECT * FROM users WHERE is_banned = FALSE AND balance > 0");
      let totalAffected = 0;
      let totalPnl = 0;

      for (const user of users.rows) {
        const overrideResult = await query(
          "SELECT custom_percentage FROM mass_trade_overrides WHERE mass_trade_id = $1 AND user_id = $2",
          [mass_trade_id, user.id]
        );

        const appliedPercentage = overrideResult.rows.length > 0 
          ? Number(overrideResult.rows[0].custom_percentage) 
          : Number(percentage);

        const balanceBefore = Number(user.balance);
        const pnlAmount = Number((balanceBefore * appliedPercentage / 100).toFixed(2));
        const balanceAfter = Number((balanceBefore + pnlAmount).toFixed(2));

        await query("UPDATE users SET balance = $1 WHERE id = $2", [balanceAfter, user.id]);

        if (pnlAmount >= 0) {
          await query("UPDATE users SET wins = COALESCE(wins, 0) + $1 WHERE id = $2", [pnlAmount, user.id]);
        } else {
          await query("UPDATE users SET losses = COALESCE(losses, 0) + $1 WHERE id = $2", [Math.abs(pnlAmount), user.id]);
        }

        await query(
          "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
          [user.id, pnlAmount, `Mass trade #${mass_trade_id} (${appliedPercentage >= 0 ? '+' : ''}${appliedPercentage}%)`]
        );

        await query(
          `INSERT INTO mass_trade_participants (mass_trade_id, user_id, balance_before, balance_after, pnl_amount, percentage_applied)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (mass_trade_id, user_id) DO UPDATE SET balance_after = $4, pnl_amount = $5, percentage_applied = $6`,
          [mass_trade_id, user.id, balanceBefore, balanceAfter, pnlAmount, appliedPercentage]
        );

        await query(
          `INSERT INTO trades_history (user_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
           VALUES ($1, $2, $3, 0, 0, 0, $4, 0, $5, NOW(), 'mass_trade')`,
          [user.id, massTrade.symbol || 'XAUUSD', massTrade.direction || 'BUY', pnlAmount, massTrade.created_at]
        );

        if (user.tg_id) {
          try {
            await bot.sendMessage(Number(user.tg_id), `🔔 *تم إغلاق الصفقة*\n${pnlAmount >= 0 ? "🟢 ربح" : "🔴 خسارة"}: ${pnlAmount >= 0 ? "+" : ""}$${Math.abs(pnlAmount).toFixed(2)} (${appliedPercentage >= 0 ? '+' : ''}${appliedPercentage}%)\n💰 الرصيد: $${balanceAfter.toFixed(2)}\n\n🔔 *Trade Closed*\n${pnlAmount >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${pnlAmount >= 0 ? "+" : ""}$${Math.abs(pnlAmount).toFixed(2)}\n💰 Balance: $${balanceAfter.toFixed(2)}`, { parse_mode: "Markdown" });
          } catch (err) { /* ignore */ }
        }

        totalAffected++;
        totalPnl += pnlAmount;
      }

      await query(
        "UPDATE mass_trades SET status = 'closed', percentage = $1, closed_at = NOW(), participants_count = $2 WHERE id = $3",
        [percentage, totalAffected, mass_trade_id]
      );

      return res.json({
        ok: true,
        message: `Mass trade closed. ${totalAffected} users affected.`,
        data: { affected: totalAffected, totalPnl: totalPnl.toFixed(2), percentage }
      });
    }

    // If it's an 'open' trade (with live user trades), close all user trades and apply PnL
    if (massTrade.status === 'open') {
      const userTrades = await query(
        "SELECT mt.*, u.tg_id, u.balance FROM mass_trade_user_trades mt JOIN users u ON mt.user_id = u.id WHERE mt.mass_trade_id = $1 AND mt.status = 'open'",
        [mass_trade_id]
      );

      let totalAffected = 0;
      let totalPnl = 0;

      for (const ut of userTrades.rows) {
        const finalPnl = Number(ut.target_pnl || ut.pnl || 0);
        const balanceBefore = Number(ut.balance);
        const balanceAfter = Number((balanceBefore + finalPnl).toFixed(2));

        // FIX: Use atomic UPDATE with RETURNING to prevent double-close race condition
        const utCloseResult = await query(
          "UPDATE mass_trade_user_trades SET status = 'closed', pnl = $1, closed_at = NOW(), close_reason = 'mass_close' WHERE id = $2 AND status = 'open' RETURNING id",
          [finalPnl, ut.id]
        );
        
        // Skip if already closed by the engine
        if (utCloseResult.rowCount === 0) continue;

        // Update user balance
        await query("UPDATE users SET balance = $1 WHERE id = $2", [balanceAfter, ut.user_id]);

        if (finalPnl >= 0) {
          await query("UPDATE users SET wins = COALESCE(wins, 0) + $1 WHERE id = $2", [finalPnl, ut.user_id]);
        } else {
          await query("UPDATE users SET losses = COALESCE(losses, 0) + $1 WHERE id = $2", [Math.abs(finalPnl), ut.user_id]);
        }

        // Log operation
        await query(
          "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
          [ut.user_id, finalPnl, `Mass trade #${mass_trade_id} closed`]
        );

        // Update participant record
        await query(
          `UPDATE mass_trade_participants SET balance_after = $1, pnl_amount = $2 WHERE mass_trade_id = $3 AND user_id = $4`,
          [balanceAfter, finalPnl, mass_trade_id, ut.user_id]
        );

        // Save to trades_history
        await query(
          `INSERT INTO trades_history (user_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'mass_trade')`,
          [ut.user_id, ut.symbol, ut.direction, ut.entry_price, ut.current_price, ut.lot_size, finalPnl, 
           Math.floor((Date.now() - new Date(ut.opened_at).getTime()) / 1000), ut.opened_at]
        );

        // Send notification
        if (ut.tg_id) {
          try {
            await bot.sendMessage(Number(ut.tg_id), `🔔 *تم إغلاق الصفقة*\n${finalPnl >= 0 ? "🟢 ربح" : "🔴 خسارة"}: ${finalPnl >= 0 ? "+" : ""}$${Math.abs(finalPnl).toFixed(2)}\n💰 الرصيد: $${balanceAfter.toFixed(2)}\n\n🔔 *Trade Closed*\n${finalPnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${finalPnl >= 0 ? "+" : ""}$${Math.abs(finalPnl).toFixed(2)}\n💰 Balance: $${balanceAfter.toFixed(2)}`, { parse_mode: "Markdown" });
          } catch (err) { /* ignore */ }
        }

        totalAffected++;
        totalPnl += finalPnl;
      }

      await query(
        "UPDATE mass_trades SET status = 'closed', closed_at = NOW(), participants_count = $1 WHERE id = $2",
        [totalAffected, mass_trade_id]
      );

      return res.json({
        ok: true,
        message: `Mass trade closed. ${totalAffected} users affected.`,
        data: { affected: totalAffected, totalPnl: totalPnl.toFixed(2) }
      });
    }

    return res.status(400).json({ ok: false, error: "Mass trade is already closed" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Open mass trade (legacy - creates as pending)
export const openMassTrade = async (req, res) => {
  try {
    const { symbol, direction, note } = req.body;

    const usersCount = await query("SELECT COUNT(*) as count FROM users WHERE is_banned = FALSE AND balance > 0");
    const entryPrice = 2650 + (Math.random() - 0.5) * 10;

    const result = await query(
      `INSERT INTO mass_trades (symbol, direction, note, participants_count, status, entry_price)
       VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
      [symbol || 'XAUUSD', direction || 'BUY', note || '', usersCount.rows[0].count, entryPrice]
    );

    res.json({ ok: true, message: "Mass trade created (pending)", data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Set custom percentage for specific user in mass trade
export const setMassTradeOverride = async (req, res) => {
  try {
    const { mass_trade_id, user_id, custom_percentage } = req.body;

    const tradeResult = await query("SELECT * FROM mass_trades WHERE id = $1 AND status IN ('pending', 'open')", [mass_trade_id]);
    if (tradeResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Mass trade not found or already closed" });
    }

    await query(
      `INSERT INTO mass_trade_overrides (mass_trade_id, user_id, custom_percentage)
       VALUES ($1, $2, $3)
       ON CONFLICT (mass_trade_id, user_id) DO UPDATE SET custom_percentage = $3`,
      [mass_trade_id, user_id, custom_percentage]
    );

    res.json({ ok: true, message: "Override set" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get mass trades list
export const getMassTrades = async (req, res) => {
  try {
    const result = await query("SELECT * FROM mass_trades ORDER BY created_at DESC LIMIT 50");
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get mass trade details with participants
export const getMassTradeDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    const trade = await query("SELECT * FROM mass_trades WHERE id = $1", [id]);
    if (trade.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Mass trade not found" });
    }

    const participants = await query(`
      SELECT mtp.*, u.name, u.tg_id 
      FROM mass_trade_participants mtp
      JOIN users u ON mtp.user_id = u.id
      WHERE mtp.mass_trade_id = $1
      ORDER BY mtp.pnl_amount DESC
    `, [id]);

    const overrides = await query(`
      SELECT mto.*, u.name, u.tg_id
      FROM mass_trade_overrides mto
      JOIN users u ON mto.user_id = u.id
      WHERE mto.mass_trade_id = $1
    `, [id]);

    // Get user trades if any
    const userTrades = await query(`
      SELECT mtut.*, u.name, u.tg_id
      FROM mass_trade_user_trades mtut
      JOIN users u ON mtut.user_id = u.id
      WHERE mtut.mass_trade_id = $1
      ORDER BY mtut.pnl DESC
    `, [id]);

    res.json({
      ok: true,
      data: {
        trade: trade.rows[0],
        participants: participants.rows,
        overrides: overrides.rows,
        userTrades: userTrades.rows
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== EXTRA TRADES PER USER =====

// Add user to extra trades list
export const addExtraTradeUser = async (req, res) => {
  try {
    const { user_id, extra_trades_per_day, note } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    await query(
      `INSERT INTO mass_trade_extra_users (user_id, extra_trades_per_day, note, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET extra_trades_per_day = $2, note = $3, is_active = TRUE, updated_at = NOW()`,
      [user_id, extra_trades_per_day || 1, note || '']
    );

    res.json({ ok: true, message: "Extra trade user added" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Remove user from extra trades list
export const removeExtraTradeUser = async (req, res) => {
  try {
    const { user_id } = req.body;

    await query("UPDATE mass_trade_extra_users SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1", [user_id]);

    res.json({ ok: true, message: "Extra trade user removed" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get extra trade users list
export const getExtraTradeUsers = async (req, res) => {
  try {
    const result = await query(`
      SELECT mtu.*, u.name, u.tg_id, u.balance
      FROM mass_trade_extra_users mtu
      JOIN users u ON mtu.user_id = u.id
      WHERE mtu.is_active = TRUE
      ORDER BY mtu.created_at DESC
    `);

    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== SCHEDULED MASS TRADES =====

// Create today's 3 scheduled trades (called by cron or manually)
export const createDailyScheduledTrades = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const schedules = [
      { time: '14:00', note: 'صفقة الظهر | Afternoon Trade' },
      { time: '18:00', note: 'صفقة المساء | Evening Trade' },
      { time: '21:30', note: 'صفقة الليل | Night Trade' }
    ];

    const created = [];

    for (const schedule of schedules) {
      // Check if already exists for today
      const existing = await query(
        "SELECT id FROM mass_trades WHERE scheduled_date = $1 AND scheduled_time = $2 AND is_scheduled = TRUE",
        [today, schedule.time]
      );

      if (existing.rows.length === 0) {
        const entryPrice = 2650 + (Math.random() - 0.5) * 10;
        const directions = ['BUY', 'SELL'];
        const direction = directions[Math.floor(Math.random() * 2)];
        const usersCount = await query("SELECT COUNT(*) as count FROM users WHERE is_banned = FALSE AND balance > 0");

        const result = await query(
          `INSERT INTO mass_trades (symbol, direction, note, participants_count, status, scheduled_time, scheduled_date, duration_seconds, entry_price, is_scheduled)
           VALUES ('XAUUSD', $1, $2, $3, 'pending', $4, $5, 3600, $6, TRUE) RETURNING *`,
          [direction, schedule.note, usersCount.rows[0].count, schedule.time, today, entryPrice]
        );

        created.push(result.rows[0]);
      }
    }

    res.json({ ok: true, message: `${created.length} scheduled trades created for ${today}`, data: created });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get today's scheduled trades
export const getTodayScheduledTrades = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await query(
      "SELECT * FROM mass_trades WHERE scheduled_date = $1 ORDER BY scheduled_time ASC",
      [today]
    );

    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== CUSTOM TRADES (Admin opens trades for specific users) =====

// Open custom trade for specific users
export const openCustomTrade = async (req, res) => {
  try {
    const { user_ids, target_pnl, duration_minutes, duration_hours, speed, symbol, direction, note } = req.body;

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ ok: false, error: "user_ids array required" });
    }

    const durationSeconds = duration_minutes ? duration_minutes * 60 : (duration_hours || 1) * 3600;
    const tradeSpeed = speed || 'normal'; // normal, fast, turbo
    const entryPrice = 2650 + (Math.random() - 0.5) * 10;
    const tradeSymbol = symbol || 'XAUUSD';
    
    const results = [];

    for (const userId of user_ids) {
      const userResult = await query("SELECT * FROM users WHERE id = $1", [userId]);
      if (userResult.rows.length === 0) continue;

      const user = userResult.rows[0];
      
      // Calculate target PnL based on percentage of balance if target_pnl looks like a percentage
      let finalTargetPnl = Number(target_pnl || 0);
      
      // Random direction if not specified
      const tradeDirection = direction || (['BUY', 'SELL'][Math.floor(Math.random() * 2)]);

      const tradeResult = await query(
        `INSERT INTO custom_trades (user_id, symbol, direction, entry_price, current_price, lot_size, target_pnl, duration_seconds, speed, status, admin_note, can_close)
         VALUES ($1, $2, $3, $4, $4, 0.05, $5, $6, $7, 'open', $8, TRUE) RETURNING *`,
        [userId, tradeSymbol, tradeDirection, entryPrice, finalTargetPnl, durationSeconds, tradeSpeed, note || '']
      );

      results.push(tradeResult.rows[0]);

      // Send notification to user
      if (user.tg_id) {
        try {
          const durationLabel = durationSeconds >= 3600 
            ? `${Math.round(durationSeconds / 3600)} ساعة` 
            : `${Math.round(durationSeconds / 60)} دقيقة`;
          const durationLabelEn = durationSeconds >= 3600 
            ? `${Math.round(durationSeconds / 3600)} hour(s)` 
            : `${Math.round(durationSeconds / 60)} min`;

          await bot.sendMessage(Number(user.tg_id), `🎯 *صفقة إضافية!*

🔸 *الرمز:* ${tradeSymbol}
📊 *الاتجاه:* ${tradeDirection}
⏱ *المدة:* ${durationLabel}
⚡ *السرعة:* ${tradeSpeed === 'turbo' ? 'سريعة جداً' : tradeSpeed === 'fast' ? 'سريعة' : 'عادية'}

📱 تابع من خيار *صفقاتي*

---

🎯 *Extra Trade!*

🔸 *Symbol:* ${tradeSymbol}
📊 *Direction:* ${tradeDirection}
⏱ *Duration:* ${durationLabelEn}
⚡ *Speed:* ${tradeSpeed}

📱 Monitor from *My Trades*`, { parse_mode: "Markdown" });
        } catch (err) { /* ignore */ }
      }
    }

    res.json({
      ok: true,
      message: `${results.length} custom trades opened`,
      data: results
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Close custom trade manually
export const closeCustomTrade = async (req, res) => {
  try {
    const trade_id = req.params.id || req.body.trade_id;

    const tradeResult = await query(
      "UPDATE custom_trades SET status='closed', closed_at=NOW(), close_reason='admin_close' WHERE id=$1 AND status='open' RETURNING *",
      [trade_id]
    );

    if (tradeResult.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Trade not found or already closed" });
    }

    const trade = tradeResult.rows[0];
    const pnl = Number(trade.target_pnl || trade.pnl || 0);

    // Update balance
    await query("UPDATE users SET balance = balance + $1 WHERE id=$2", [pnl, trade.user_id]);

    if (pnl >= 0) {
      await query("UPDATE users SET wins = COALESCE(wins,0) + $1 WHERE id=$2", [pnl, trade.user_id]);
    } else {
      await query("UPDATE users SET losses = COALESCE(losses,0) + $1 WHERE id=$2", [Math.abs(pnl), trade.user_id]);
    }

    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
      [trade.user_id, pnl, `Custom trade #${trade.id} closed by admin`]
    );

    res.json({ ok: true, message: "Custom trade closed", data: { pnl } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get all custom trades with optional status filter
export const getCustomTrades = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT ct.*, u.name as user_name, u.tg_id, u.balance
      FROM custom_trades ct
      JOIN users u ON ct.user_id = u.id
    `;
    const params = [];
    if (status && status !== 'all') {
      sql += ` WHERE ct.status = $1`;
      params.push(status);
    }
    sql += ` ORDER BY ct.opened_at DESC LIMIT 100`;
    
    const result = await query(sql, params);
    res.json({ ok: true, trades: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== DELETE USER (completely remove account) =====

export const deleteUser = async (req, res) => {
  try {
    const { user_id } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];

    // Close all open trades
    await query("UPDATE trades SET status='closed', closed_at=NOW(), close_reason='account_deleted' WHERE user_id=$1 AND status='open'", [user_id]);
    await query("UPDATE mass_trade_user_trades SET status='closed', closed_at=NOW(), close_reason='account_deleted' WHERE user_id=$1 AND status='open'", [user_id]);
    await query("UPDATE custom_trades SET status='closed', closed_at=NOW(), close_reason='account_deleted' WHERE user_id=$1 AND status='open'", [user_id]);

    // Delete related records
    await query("DELETE FROM ops WHERE user_id=$1", [user_id]);
    await query("DELETE FROM requests WHERE user_id=$1", [user_id]);
    await query("DELETE FROM trades_history WHERE user_id=$1", [user_id]);
    await query("DELETE FROM trades WHERE user_id=$1", [user_id]);
    await query("DELETE FROM mass_trade_user_trades WHERE user_id=$1", [user_id]);
    await query("DELETE FROM mass_trade_participants WHERE user_id=$1", [user_id]);
    await query("DELETE FROM custom_trades WHERE user_id=$1", [user_id]);
    await query("DELETE FROM referral_commissions WHERE referrer_user_id=$1 OR referred_user_id=$1", [user_id]);
    
    try { await query("DELETE FROM mass_trade_extra_users WHERE user_id=$1", [user_id]); } catch(e) {}
    try { await query("DELETE FROM mass_trade_overrides WHERE user_id=$1", [user_id]); } catch(e) {}
    try { await query("DELETE FROM agent_referrals WHERE agent_user_id=$1 OR referred_user_id=$1", [user_id]); } catch(e) {}
    try { await query("DELETE FROM agent_commissions WHERE agent_user_id=$1 OR referred_user_id=$1", [user_id]); } catch(e) {}

    // Finally delete the user
    await query("DELETE FROM users WHERE id=$1", [user_id]);

    // Notify via Telegram
    if (user.tg_id) {
      try {
        await bot.sendMessage(Number(user.tg_id), `⚠️ تم حذف حسابك.\n\n⚠️ Your account has been deleted.`);
      } catch (err) { /* ignore */ }
    }

    res.json({ ok: true, message: `User ${user.name || user.tg_id} deleted successfully` });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== MANAGE REFERRALS =====

// Remove referral (detach referred user from referrer)
export const removeReferral = async (req, res) => {
  try {
    const { user_id } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const oldReferrer = userResult.rows[0].referred_by;

    // Remove referral link
    await query("UPDATE users SET referred_by = NULL WHERE id = $1", [user_id]);

    // Update referrer's referral count
    if (oldReferrer) {
      await query("UPDATE users SET referral_count = GREATEST(COALESCE(referral_count, 0) - 1, 0) WHERE tg_id = $1", [oldReferrer]);
    }

    // Remove from agent_referrals if exists
    try {
      await query("DELETE FROM agent_referrals WHERE referred_user_id = $1", [user_id]);
    } catch(e) {}

    res.json({ ok: true, message: "Referral removed", data: { old_referrer: oldReferrer } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Transfer referral to another user
export const transferReferral = async (req, res) => {
  try {
    const { user_id, new_referrer_tg_id } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    // Verify new referrer exists
    const newReferrerResult = await query("SELECT * FROM users WHERE tg_id = $1", [new_referrer_tg_id]);
    if (newReferrerResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "New referrer not found" });
    }

    const oldReferrer = userResult.rows[0].referred_by;
    const newReferrer = newReferrerResult.rows[0];

    // Can't refer to self
    if (String(new_referrer_tg_id) === String(userResult.rows[0].tg_id)) {
      return res.status(400).json({ ok: false, error: "Cannot refer user to themselves" });
    }

    // Update referral
    await query("UPDATE users SET referred_by = $1 WHERE id = $2", [new_referrer_tg_id, user_id]);

    // Decrement old referrer count
    if (oldReferrer) {
      await query("UPDATE users SET referral_count = GREATEST(COALESCE(referral_count, 0) - 1, 0) WHERE tg_id = $1", [oldReferrer]);
    }

    // Increment new referrer count
    await query("UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1 WHERE tg_id = $1", [new_referrer_tg_id]);

    // Update agent_referrals
    try {
      await query("DELETE FROM agent_referrals WHERE referred_user_id = $1", [user_id]);
      await query(
        `INSERT INTO agent_referrals (agent_user_id, referred_user_id, referred_at, is_active)
         VALUES ($1, $2, NOW(), TRUE)`,
        [newReferrer.id, user_id]
      );
    } catch(e) {}

    res.json({
      ok: true,
      message: `Referral transferred from ${oldReferrer || 'none'} to ${new_referrer_tg_id}`,
      data: { old_referrer: oldReferrer, new_referrer: new_referrer_tg_id }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Delete referral (remove referred user completely from referrer's list)
export const deleteReferral = async (req, res) => {
  try {
    const { user_id } = req.body;

    // Same as removeReferral but also clears commission records
    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const oldReferrer = userResult.rows[0].referred_by;

    await query("UPDATE users SET referred_by = NULL WHERE id = $1", [user_id]);

    if (oldReferrer) {
      await query("UPDATE users SET referral_count = GREATEST(COALESCE(referral_count, 0) - 1, 0) WHERE tg_id = $1", [oldReferrer]);
    }

    // Delete commission records
    await query("DELETE FROM referral_commissions WHERE referred_user_id = $1", [user_id]);
    try { await query("DELETE FROM agent_referrals WHERE referred_user_id = $1", [user_id]); } catch(e) {}
    try { await query("DELETE FROM agent_commissions WHERE referred_user_id = $1", [user_id]); } catch(e) {}

    res.json({ ok: true, message: "Referral deleted with all commission records" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get user's referrals list
export const getUserReferralsList = async (req, res) => {
  try {
    const { user_id } = req.params;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const referrals = await query(
      `SELECT id, name, tg_id, balance, created_at, referred_by
       FROM users WHERE referred_by = $1 ORDER BY created_at DESC`,
      [userResult.rows[0].tg_id]
    );

    res.json({ ok: true, referrals: referrals.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== CUSTOM RANK MANAGEMENT =====

// Set custom rank for a user
export const setUserRank = async (req, res) => {
  try {
    const { user_id, custom_rank } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    // custom_rank = null means use default logic (عضو/وكيل based on referral count)
    await query("UPDATE users SET custom_rank = $1 WHERE id = $2", [custom_rank || null, user_id]);

    res.json({
      ok: true,
      message: custom_rank ? `Rank set to "${custom_rank}"` : `Rank reset to default`,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Bulk set rank for multiple users
export const bulkSetUserRank = async (req, res) => {
  try {
    const { user_ids, rank } = req.body;

    if (!user_ids || !Array.isArray(user_ids)) {
      return res.status(400).json({ ok: false, error: "user_ids array required" });
    }

    let updated = 0;
    for (const uid of user_ids) {
      const result = await query("UPDATE users SET custom_rank = $1 WHERE id = $2", [rank || null, uid]);
      updated += result.rowCount;
    }

    res.json({ ok: true, message: `Rank updated for ${updated} users`, data: { updated, rank: rank || 'default' } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get referral commission stats
export const getReferralCommissionStats = async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        u.id, u.name, u.tg_id, u.referral_count, u.referral_trade_commission,
        u.custom_rank,
        CASE 
          WHEN u.custom_rank IS NOT NULL THEN u.custom_rank
          WHEN COALESCE(u.referral_count, 0) >= 5 THEN 'وكيل'
          ELSE 'عضو'
        END as display_rank,
        (SELECT COUNT(*) FROM referral_commissions rc WHERE rc.referrer_user_id = u.id) as commission_count,
        (SELECT COALESCE(SUM(rc.commission_amount), 0) FROM referral_commissions rc WHERE rc.referrer_user_id = u.id) as total_commission
      FROM users u
      WHERE u.referral_count > 0 OR u.custom_rank IS NOT NULL
      ORDER BY u.referral_count DESC
    `);

    res.json({ ok: true, data: stats.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
