import express from "express";
import pool from "../config/db.js";
import * as adminController from "../controllers/admin.controller.js";
import * as agentController from "../controllers/agent.controller.js";
import * as supervisorController from "../controllers/supervisor.controller.js";
import * as walletController from "../controllers/wallet.controller.js";

const router = express.Router();

// Middleware to verify admin token
const verifyAdmin = (req, res, next) => {
  const token = req.headers["x-admin-token"] || req.body.admin_token;
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ ok: false, error: "Unauthorized" });
  }
  next();
};

router.use(verifyAdmin);

// ===== Dashboard =====
router.get("/dashboard", adminController.getDashboard);

// ===== Users =====
router.get("/users", adminController.getUsers);
router.get("/user/search", adminController.searchUser);
router.get("/user/:id", adminController.getUser);
router.post("/user/balance", adminController.modifyBalance);
router.post("/user/name", adminController.updateUserName);
router.post("/user/subscription", adminController.extendSubscription);
router.post("/user/trade", adminController.addTrade);
router.post("/user/clear-history", adminController.clearHistory);
router.post("/user/ban", adminController.banUser);
router.post("/user/unban", adminController.unbanUser);

// ===== Withdrawals =====
router.get("/withdrawals", adminController.getWithdrawals);
router.post("/withdraw/approve", adminController.approveWithdrawal);
router.post("/withdraw/reject", adminController.rejectWithdrawal);
router.post("/withdraw/clear-user", adminController.clearUserWithdrawals);
router.post("/withdraw/clear-all", adminController.clearAllWithdrawals);
router.post("/user/reset-withdrawn", adminController.resetUserWithdrawn);

// ===== Trades =====
router.get("/trades", adminController.getAllTrades);
router.post("/trade/close", adminController.closeTrade);
router.post("/user/clear-trades", adminController.clearUserTrades);

// ===== Settings =====
router.get("/settings/withdrawal", adminController.getWithdrawalSetting);
router.post("/settings/withdrawal/toggle", adminController.toggleWithdrawal);
router.get("/settings/maintenance", adminController.getMaintenanceSetting);
router.post("/settings/maintenance/toggle", adminController.toggleMaintenance);
router.post("/settings", adminController.updateSettings);

// ===== Keys =====
router.post("/key/create", adminController.createKey);

// ===== Broadcast =====
router.post("/broadcast", adminController.broadcast);

// ===== Referral System =====
router.get("/referrals/stats", adminController.getReferralStats);
router.get("/referrals/user/:user_id", adminController.getUserReferrals);

// ===== Mass Trades (Enhanced v3.1) =====
router.get("/mass-trades", adminController.getMassTrades);
router.get("/mass-trade/today", adminController.getTodayScheduledTrades);
router.get("/mass-trade/:id", adminController.getMassTradeDetails);
router.post("/mass-trade/open", adminController.openMassTrade);
router.post("/mass-trade/close", adminController.closeMassTrade);
router.post("/mass-trade/override", adminController.setMassTradeOverride);
router.post("/mass-trade/create-scheduled", adminController.createScheduledMassTrade);
router.post("/mass-trade/activate", adminController.activateMassTrade);
router.post("/mass-trade/set-percentage", adminController.setMassTradePercentage);
router.post("/mass-trade/create-daily", adminController.createDailyScheduledTrades);

// ===== Extra Trade Users =====
router.get("/extra-trade-users", adminController.getExtraTradeUsers);
router.post("/extra-trade-user/add", adminController.addExtraTradeUser);
router.post("/extra-trade-user/remove", adminController.removeExtraTradeUser);

// ===== Custom Trades (Admin opens for specific users) =====
router.get("/custom-trades", adminController.getCustomTrades);
router.post("/custom-trade/open", adminController.openCustomTrade);
router.post("/custom-trade/close/:id", adminController.closeCustomTrade);

// ===== Delete User =====
router.post("/user/delete", adminController.deleteUser);

// ===== Manage Referrals =====
router.post("/referral/remove", adminController.removeReferral);
router.post("/referral/transfer", adminController.transferReferral);
router.post("/referral/remove-single", adminController.deleteReferral);
router.post("/referral/assign", adminController.assignReferrer);
router.get("/user/referrals/:user_id", adminController.getUserReferralsList);
router.get("/users/unlinked", adminController.getUnlinkedUsers);

// ===== Fee Management =====
router.get("/user/fee/:user_id", walletController.getUserFeeInfo);
router.post("/user/fee/set", walletController.setUserFeeOverride);
router.post("/user/fee/reset-timer", walletController.resetUserFeeTimer);
router.post("/users/fee/set-all", walletController.setAllUsersFeeOverride);

// ===== Rank Management =====
router.post("/user/rank", adminController.setUserRank);
router.post("/user/rank/bulk", adminController.bulkSetUserRank);
router.get("/referral-commissions", adminController.getReferralCommissionStats);

// ===== Agent System =====
router.get("/agents", agentController.getAllAgents);
router.post("/agent/promote", agentController.promoteToAgent);
router.post("/agent/revoke", agentController.revokeAgent);

// ===== Supervisor Management =====
router.get("/supervisors", supervisorController.getSupervisors);
router.post("/supervisor/create", supervisorController.createSupervisor);
router.post("/supervisor/toggle", supervisorController.toggleSupervisor);
router.post("/supervisor/change-password", supervisorController.changeSupervisorPassword);

// ===== Rewards Management =====
router.get("/reward/status", async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'active_reward'");
    if (result.rows.length === 0) return res.json({ ok: true, reward: null });
    const reward = JSON.parse(result.rows[0].value);
    res.json({ ok: true, reward });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

router.post("/reward/create", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.json({ ok: false, error: 'Invalid amount' });

    const users = await pool.query("SELECT tg_id FROM users WHERE is_banned = false AND sub_expires > NOW()");
    if (users.rows.length === 0) return res.json({ ok: false, error: 'No active users' });

    const perUser = Math.round((amount / users.rows.length) * 100) / 100;
    const reward = {
      id: Date.now().toString(36),
      active: true,
      totalAmount: amount,
      perUser,
      totalUsers: users.rows.length,
      claimed: [],
      createdAt: new Date().toISOString()
    };

    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('active_reward', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
      [JSON.stringify(reward)]
    );

    res.json({ ok: true, perUser, totalUsers: users.rows.length });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

router.post("/reward/send", async (req, res) => {
  try {
    const { tg_id, amount } = req.body;
    if (!tg_id || !amount || amount <= 0) return res.json({ ok: false, error: 'Invalid data' });

    const user = await pool.query("SELECT name, tg_id FROM users WHERE tg_id = $1", [tg_id]);
    if (user.rows.length === 0) return res.json({ ok: false, error: 'User not found' });

    const reward = {
      id: Date.now().toString(36) + '_p',
      active: true,
      totalAmount: amount,
      perUser: amount,
      totalUsers: 1,
      claimed: [],
      createdAt: new Date().toISOString(),
      isPersonal: true
    };

    await pool.query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
      [`personal_reward_${tg_id}`, JSON.stringify(reward)]
    );

    res.json({ ok: true, userName: user.rows[0].name });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

router.post("/reward/cancel", async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'active_reward'");
    if (result.rows.length > 0) {
      const reward = JSON.parse(result.rows[0].value);
      reward.active = false;
      await pool.query("UPDATE settings SET value = $1, updated_at = NOW() WHERE key = 'active_reward'", [JSON.stringify(reward)]);
    }
    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

// ===== Session Management =====
router.post("/session/logout", async (req, res) => {
  try {
    const { tg_id } = req.body;
    if (!tg_id) return res.json({ ok: false, error: 'Missing tg_id' });

    const user = await pool.query("SELECT name FROM users WHERE tg_id = $1", [tg_id]);
    if (user.rows.length === 0) return res.json({ ok: false, error: 'User not found' });

    const newToken = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await pool.query("UPDATE users SET session_token = $1 WHERE tg_id = $2", [newToken, tg_id]);

    res.json({ ok: true, userName: user.rows[0].name });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

router.post("/session/logout-all", async (req, res) => {
  try {
    const result = await pool.query("SELECT tg_id FROM users");
    for (const row of result.rows) {
      const newToken = Date.now().toString(36) + Math.random().toString(36).slice(2);
      await pool.query("UPDATE users SET session_token = $1 WHERE tg_id = $2", [newToken, row.tg_id]);
    }
    res.json({ ok: true, count: result.rows.length });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

// ===== Maintenance Whitelist Management =====
router.post("/maintenance/enable", async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('maintenance_mode', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()"
    );
    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

router.post("/maintenance/disable", async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('maintenance_mode', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = NOW()"
    );
    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

router.get("/maintenance/whitelist", async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'maintenance_whitelist'");
    const whitelist = result.rows.length > 0 && result.rows[0].value ? result.rows[0].value.split(',').map(s => s.trim()).filter(Boolean) : [];
    res.json({ ok: true, whitelist });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

router.post("/maintenance/whitelist/add", async (req, res) => {
  try {
    const { tg_id } = req.body;
    if (!tg_id) return res.json({ ok: false, error: 'Missing tg_id' });

    const result = await pool.query("SELECT value FROM settings WHERE key = 'maintenance_whitelist'");
    let whitelist = result.rows.length > 0 && result.rows[0].value ? result.rows[0].value.split(',').map(s => s.trim()).filter(Boolean) : [];

    if (!whitelist.includes(String(tg_id))) {
      whitelist.push(String(tg_id));
    }

    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('maintenance_whitelist', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
      [whitelist.join(',')]
    );

    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

router.post("/maintenance/whitelist/remove", async (req, res) => {
  try {
    const { tg_id } = req.body;
    if (!tg_id) return res.json({ ok: false, error: 'Missing tg_id' });

    const result = await pool.query("SELECT value FROM settings WHERE key = 'maintenance_whitelist'");
    let whitelist = result.rows.length > 0 && result.rows[0].value ? result.rows[0].value.split(',').map(s => s.trim()).filter(Boolean) : [];

    whitelist = whitelist.filter(id => id !== String(tg_id));

    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('maintenance_whitelist', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
      [whitelist.join(',')]
    );

    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

export default router;
