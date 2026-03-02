/**
 * Supervisor Controller - Limited Access Role
 * 
 * Permissions:
 * ✅ CAN VIEW: All users, open trades, all deposits, approved withdrawals only
 * ✅ CAN: Generate subscription keys (Monthly only - 30 days)
 * ❌ CANNOT: Edit balances, approve/reject withdrawals, view pending withdrawals,
 *            access profit logic, change settings
 */

import { query } from "../config/db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

// ===== AUTH: Login as supervisor =====
export const supervisorLogin = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Username and password required" });
    }

    const result = await query(
      "SELECT * FROM supervisors WHERE username = $1 AND is_active = TRUE",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const supervisor = result.rows[0];
    const isValid = await bcrypt.compare(password, supervisor.password_hash);

    if (!isValid) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    // Update last login
    await query(
      "UPDATE supervisors SET last_login_at = NOW() WHERE id = $1",
      [supervisor.id]
    );

    // Return a simple token (supervisor_id:timestamp:hash)
    const token = Buffer.from(`sv:${supervisor.id}:${Date.now()}`).toString('base64');

    res.json({
      ok: true,
      token,
      supervisor: {
        id: supervisor.id,
        username: supervisor.username,
        name: supervisor.name
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== MIDDLEWARE: Verify supervisor token =====
export const verifySupervisor = async (req, res, next) => {
  try {
    const token = req.headers["x-supervisor-token"] || req.body.supervisor_token;
    if (!token) {
      return res.status(403).json({ ok: false, error: "Unauthorized" });
    }

    // Decode token
    let decoded;
    try {
      decoded = Buffer.from(token, 'base64').toString('utf8');
    } catch (e) {
      return res.status(403).json({ ok: false, error: "Invalid token" });
    }

    const parts = decoded.split(':');
    if (parts[0] !== 'sv' || !parts[1]) {
      return res.status(403).json({ ok: false, error: "Invalid token format" });
    }

    const supervisorId = parseInt(parts[1]);
    const timestamp = parseInt(parts[2]);

    // Token expires after 24 hours
    if (Date.now() - timestamp > 24 * 60 * 60 * 1000) {
      return res.status(403).json({ ok: false, error: "Token expired, please login again" });
    }

    const result = await query(
      "SELECT * FROM supervisors WHERE id = $1 AND is_active = TRUE",
      [supervisorId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ ok: false, error: "Supervisor not found or deactivated" });
    }

    req.supervisor = result.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== VIEW: Get all users (read-only) =====
export const getUsers = async (req, res) => {
  try {
    const users = await query(
      `SELECT id, tg_id, name, balance, is_banned, sub_expires, created_at,
              (SELECT COUNT(*) FROM trades WHERE user_id = users.id AND status = 'open') as open_trades_count,
              (SELECT MIN(opened_at) FROM trades WHERE user_id = users.id AND status = 'open') as earliest_trade_open
       FROM users
       ORDER BY created_at DESC
       LIMIT 200`
    );

    res.json({ ok: true, data: users.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== VIEW: Get open trades =====
export const getOpenTrades = async (req, res) => {
  try {
    const trades = await query(
      `SELECT t.id, t.symbol, t.direction, t.lot_size, t.pnl, t.opened_at, t.duration_seconds,
              u.name as user_name, u.tg_id
       FROM trades t
       JOIN users u ON u.id = t.user_id
       WHERE t.status = 'open'
       ORDER BY t.opened_at DESC`
    );

    res.json({ ok: true, data: trades.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== VIEW: Get all deposits =====
export const getDeposits = async (req, res) => {
  try {
    const deposits = await query(
      `SELECT dl.id, dl.amount, dl.method, dl.note, dl.created_at,
              u.name as user_name, u.tg_id
       FROM deposit_logs dl
       JOIN users u ON u.id = dl.user_id
       ORDER BY dl.created_at DESC
       LIMIT 200`
    );

    res.json({ ok: true, data: deposits.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== VIEW: Get APPROVED withdrawals only (NOT pending) =====
export const getApprovedWithdrawals = async (req, res) => {
  try {
    const withdrawals = await query(
      `SELECT r.id, r.amount, r.fee_amount, r.net_amount, r.fee_rate, r.method, 
              r.status, r.created_at, r.updated_at,
              u.name as user_name, u.tg_id
       FROM requests r
       JOIN users u ON u.id = r.user_id
       WHERE r.status = 'approved'
       ORDER BY r.updated_at DESC
       LIMIT 200`
    );

    res.json({ ok: true, data: withdrawals.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== ACTION: Generate monthly subscription key (30 days only) =====
export const generateMonthlyKey = async (req, res) => {
  try {
    const { count = 1 } = req.body;
    const keysToGenerate = Math.min(parseInt(count) || 1, 10); // Max 10 at once

    const keys = [];

    for (let i = 0; i < keysToGenerate; i++) {
      const keyCode = `SV-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      await query(
        "INSERT INTO subscription_keys (key_code, days) VALUES ($1, 30)",
        [keyCode]
      );

      keys.push({ key: keyCode, days: 30, type: 'monthly' });
    }

    res.json({
      ok: true,
      message: `تم إنشاء ${keysToGenerate} مفتاح اشتراك شهري`,
      keys
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== VIEW: Dashboard summary (read-only) =====
export const getDashboard = async (req, res) => {
  try {
    const [usersCount, openTrades, todayDeposits, approvedWithdrawals] = await Promise.all([
      query("SELECT COUNT(*) as count FROM users WHERE is_banned = FALSE"),
      query("SELECT COUNT(*) as count FROM trades WHERE status = 'open'"),
      query("SELECT COALESCE(SUM(amount), 0) as total FROM deposit_logs WHERE created_at > NOW() - INTERVAL '24 hours'"),
      query("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM requests WHERE status = 'approved' AND updated_at > NOW() - INTERVAL '24 hours'")
    ]);

    res.json({
      ok: true,
      data: {
        total_users: parseInt(usersCount.rows[0].count),
        open_trades: parseInt(openTrades.rows[0].count),
        today_deposits: Number(todayDeposits.rows[0].total),
        today_approved_withdrawals: {
          count: parseInt(approvedWithdrawals.rows[0].count),
          total: Number(approvedWithdrawals.rows[0].total)
        }
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== ADMIN API: Create supervisor account =====
export const createSupervisor = async (req, res) => {
  try {
    const { username, password, name } = req.body;

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Username and password required" });
    }

    // Check if username already exists
    const existing = await query("SELECT id FROM supervisors WHERE username = $1", [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ ok: false, error: "Username already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      "INSERT INTO supervisors (username, password_hash, name) VALUES ($1, $2, $3) RETURNING id, username, name, created_at",
      [username, passwordHash, name || username]
    );

    res.json({
      ok: true,
      message: "Supervisor account created",
      data: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== ADMIN API: Get all supervisors =====
export const getSupervisors = async (req, res) => {
  try {
    const result = await query(
      "SELECT id, username, name, is_active, created_at, last_login_at as last_login FROM supervisors ORDER BY created_at DESC"
    );
    res.json({ ok: true, supervisors: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== ADMIN API: Change supervisor password =====
export const changeSupervisorPassword = async (req, res) => {
  try {
    const { username, new_password } = req.body;

    if (!username || !new_password) {
      return res.status(400).json({ ok: false, error: "Username and new password required" });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });
    }

    const existing = await query("SELECT id FROM supervisors WHERE username = $1", [username]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Supervisor not found" });
    }

    const passwordHash = await bcrypt.hash(new_password, 12);

    await query(
      "UPDATE supervisors SET password_hash = $1, updated_at = NOW() WHERE username = $2",
      [passwordHash, username]
    );

    // Log the action
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES (0, 'admin', 0, $1)",
      [`Admin changed password for supervisor: ${username} at ${new Date().toISOString()}`]
    ).catch(() => {}); // ignore if ops table doesn't allow user_id=0

    res.json({ ok: true, message: `Password updated for supervisor: ${username}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== ADMIN API: Toggle supervisor active status =====
export const toggleSupervisor = async (req, res) => {
  try {
    const { supervisor_id } = req.body;

    const result = await query(
      "UPDATE supervisors SET is_active = NOT is_active WHERE id = $1 RETURNING is_active",
      [supervisor_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Supervisor not found" });
    }

    res.json({ ok: true, is_active: result.rows[0].is_active });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
