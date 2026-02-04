import express from "express";
import * as adminController from "../controllers/admin.controller.js";

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
router.post("/user/subscription", adminController.extendSubscription);
router.post("/user/trade", adminController.addTrade);
router.post("/user/clear-history", adminController.clearHistory);
router.post("/user/ban", adminController.banUser);

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

export default router;
