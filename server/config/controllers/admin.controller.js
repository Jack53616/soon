import { query } from "../config/db.js";

export const getDashboard = async (req, res) => {
  try {
    const usersCount = await query("SELECT COUNT(*) as count FROM users");
    const totalDeposits = await query("SELECT SUM(total_deposited) as total FROM users");
    const totalWithdrawals = await query("SELECT SUM(total_withdrawn) as total FROM users");
    const openTrades = await query("SELECT COUNT(*) as count FROM trades WHERE status = 'open'");
    
    const stats = {
      users: usersCount.rows[0].count,
      total_deposits: totalDeposits.rows[0].total || 0,
      total_withdrawals: totalWithdrawals.rows[0].total || 0,
      open_trades: openTrades.rows[0].count
    };

    res.json({ ok: true, stats });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const getUsers = async (req, res) => {
  try {
    const result = await query("SELECT * FROM users ORDER BY created_at DESC LIMIT 100");
    res.json({ ok: true, users: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const getWithdrawals = async (req, res) => {
  try {
    const result = await query(`
      SELECT r.*, u.tg_id, u.name 
      FROM requests r 
      JOIN users u ON r.user_id = u.id 
      ORDER BY r.created_at DESC 
      LIMIT 100
    `);
    res.json({ ok: true, withdrawals: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const getAllTrades = async (req, res) => {
  try {
    const result = await query(`
      SELECT t.*, u.tg_id, u.name 
      FROM trades t 
      JOIN users u ON t.user_id = u.id 
      ORDER BY t.opened_at DESC 
      LIMIT 100
    `);
    res.json({ ok: true, trades: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const modifyBalance = async (req, res) => {
  try {
    const { tg_id, amount, note } = req.body;
    
    const userResult = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];

    await query("UPDATE users SET balance = balance + $1 WHERE id = $2", [amount, user.id]);
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'admin', $2, $3)",
      [user.id, amount, note || "Admin balance adjustment"]
    );

    if (amount > 0) {
      await query(
        "UPDATE users SET total_deposited = total_deposited + $1 WHERE id = $2",
        [amount, user.id]
      );
    }

    res.json({ ok: true, message: "Balance updated" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const banUser = async (req, res) => {
  try {
    const { tg_id, banned } = req.body;
    
    await query("UPDATE users SET is_banned = $1 WHERE tg_id = $2", [banned, tg_id]);
    
    res.json({ ok: true, message: banned ? "User banned" : "User unbanned" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.body;
    
    const reqResult = await query("SELECT * FROM requests WHERE id = $1", [id]);
    if (reqResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Request not found" });
    }

    const request = reqResult.rows[0];

    await query("UPDATE requests SET status = 'approved', updated_at = NOW() WHERE id = $1", [id]);
    await query(
      "UPDATE users SET frozen_balance = frozen_balance - $1, total_withdrawn = total_withdrawn + $1 WHERE id = $2",
      [request.amount, request.user_id]
    );

    res.json({ ok: true, message: "Withdrawal approved" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const rejectWithdrawal = async (req, res) => {
  try {
    const { id, reason } = req.body;
    
    const reqResult = await query("SELECT * FROM requests WHERE id = $1", [id]);
    if (reqResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Request not found" });
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

    res.json({ ok: true, message: "Withdrawal rejected" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const broadcast = async (req, res) => {
  try {
    const { title, message } = req.body;
    
    await query(
      "INSERT INTO system_messages (title, message) VALUES ($1, $2)",
      [title, message]
    );

    res.json({ ok: true, message: "Broadcast sent" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

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