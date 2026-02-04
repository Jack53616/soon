import { query } from "../config/db.js";

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

    const durationSeconds = (duration_hours || 1) * 3600;
    const entryPrice = 2650 + (Math.random() - 0.5) * 10;

    await query(`
      INSERT INTO trades (user_id, symbol, direction, entry_price, current_price, lot_size, target_pnl, duration_seconds, status)
      VALUES ($1, 'XAUUSD', $2, $3, $3, 0.05, $4, $5, 'open')
    `, [user_id, target_pnl >= 0 ? 'BUY' : 'SELL', entryPrice, target_pnl, durationSeconds]);

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

// Ban/Unban user
export const banUser = async (req, res) => {
  try {
    const { user_id, banned } = req.body;
    const isBanned = banned !== false;

    await query("UPDATE users SET is_banned = $1 WHERE id = $2", [isBanned, user_id]);

    res.json({ ok: true, message: isBanned ? "User banned" : "User unbanned" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get withdrawals with filter
export const getWithdrawals = async (req, res) => {
  try {
    const { status } = req.query;
    let whereClause = '';
    
    if (status && status !== 'all') {
      whereClause = `WHERE r.status = '${status}'`;
    }

    const result = await query(`
      SELECT r.*, u.tg_id, u.name as user_name 
      FROM requests r 
      JOIN users u ON r.user_id = u.id 
      ${whereClause}
      ORDER BY r.created_at DESC 
      LIMIT 100
    `);

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

    res.json({ ok: true, message: "Withdrawal rejected" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get trades with filter
export const getAllTrades = async (req, res) => {
  try {
    const { status } = req.query;
    let whereClause = '';
    
    if (status && status !== 'all') {
      whereClause = `WHERE t.status = '${status}'`;
    }

    const result = await query(`
      SELECT t.*, u.tg_id, u.name as user_name 
      FROM trades t 
      JOIN users u ON t.user_id = u.id 
      ${whereClause}
      ORDER BY t.opened_at DESC 
      LIMIT 100
    `);

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
      "UPDATE trades SET status = 'closed', closed_at = NOW(), close_reason = 'admin' WHERE id = $1",
      [trade_id]
    );
    await query("UPDATE users SET balance = balance + $1 WHERE id = $2", [pnl, trade.user_id]);

    if (pnl >= 0) {
      await query("UPDATE users SET wins = COALESCE(wins, 0) + $1 WHERE id = $2", [pnl, trade.user_id]);
    } else {
      await query("UPDATE users SET losses = COALESCE(losses, 0) + $1 WHERE id = $2", [Math.abs(pnl), trade.user_id]);
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

    res.json({ ok: true, message: "Broadcast sent" });
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
