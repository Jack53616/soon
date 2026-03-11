import express from "express";
import * as adminController from "../controllers/admin.controller.js";
import * as agentController from "../controllers/agent.controller.js";
import * as supervisorController from "../controllers/supervisor.controller.js";

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
router.get("/user/referrals/:user_id", adminController.getUserReferralsList);

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

export default router;
