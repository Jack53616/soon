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
    const { user_id, target_pnl, duration_hours } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];
    const durationSeconds = (duration_hours || 1) * 3600;
    const entryPrice = 2650 + (Math.random() - 0.5) * 10;
    const direction = target_pnl >= 0 ? 'BUY' : 'SELL';

    await query(`
      INSERT INTO trades (user_id, symbol, direction, entry_price, current_price, lot_size, target_pnl, duration_seconds, status)
      VALUES ($1, 'XAUUSD', $2, $3, $3, 0.05, $4, $5, 'open')
    `, [user_id, direction, entryPrice, target_pnl, durationSeconds]);

    if (user.tg_id) {
      try {
        await bot.sendMessage(Number(user.tg_id), `🚀 *تم تفعيل صفقة ذكية جديدة*

🔸 *الرمز:* XAUUSD (الذهب)
⏱ *المدة:* ${duration_hours || 1} ساعة
📊 *الحالة:* نشطة ومراقبة

💡 _تابع محفظتك للتحديثات المباشرة._

---

🚀 *New Smart Trade Activated*
🔸 *Symbol:* XAUUSD (Gold)
⏱ *Duration:* ${duration_hours || 1} Hours
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
      SELECT r.*, u.tg_id, u.name as user_name 
      FROM requests r 
      JOIN users u ON r.user_id = u.id 
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
    const pnl = Number(trade.target_pnl) || Number(trade.pnl) || 0;

    await query(
      "UPDATE trades SET status = 'closed', closed_at = NOW(), close_reason = 'admin', pnl = $1 WHERE id = $2",
      [pnl, trade_id]
    );
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

    const tradeResult = await query("SELECT * FROM mass_trades WHERE id = $1 AND status IN ('pending', 'ready')", [mass_trade_id]);
    if (tradeResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Mass trade not found or already activated" });
    }

    const massTrade = tradeResult.rows[0];
    const durationSeconds = Number(massTrade.duration_seconds) || 3600;
    const entryPrice = Number(massTrade.entry_price) || (2650 + (Math.random() - 0.5) * 10);

    // Update mass trade to 'open' status
    await query(
      "UPDATE mass_trades SET status = 'open', percentage = $1, activated_at = NOW() WHERE id = $2",
      [percentage, mass_trade_id]
    );

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
      const direction = targetPnl >= 0 ? 'BUY' : 'SELL';

      // Create individual visual trade for this user
      await query(
        `INSERT INTO mass_trade_user_trades (mass_trade_id, user_id, symbol, direction, entry_price, current_price, lot_size, pnl, target_pnl, status, opened_at)
         VALUES ($1, $2, $3, $4, $5, $5, 0.05, 0, $6, 'open', NOW())
         ON CONFLICT (mass_trade_id, user_id) DO UPDATE SET status = 'open', target_pnl = $6, pnl = 0, opened_at = NOW()`,
        [mass_trade_id, user.id, massTrade.symbol || 'XAUUSD', direction, entryPrice, targetPnl]
      );

      // Save participant record
      await query(
        `INSERT INTO mass_trade_participants (mass_trade_id, user_id, balance_before, balance_after, pnl_amount, percentage_applied)
         VALUES ($1, $2, $3, $3, 0, $4)
         ON CONFLICT (mass_trade_id, user_id) DO UPDATE SET balance_before = $3, percentage_applied = $4`,
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

        // Close user trade
        await query(
          "UPDATE mass_trade_user_trades SET status = 'closed', pnl = $1, closed_at = NOW(), close_reason = 'mass_close' WHERE id = $2",
          [finalPnl, ut.id]
        );

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
