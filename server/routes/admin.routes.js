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

// GET /api/admin/dashboard - Get dashboard stats
router.get("/dashboard", adminController.getDashboard);

// GET /api/admin/users - Get all users
router.get("/users", adminController.getUsers);

// GET /api/admin/withdrawals - Get all withdrawal requests
router.get("/withdrawals", adminController.getWithdrawals);

// GET /api/admin/trades - Get all trades
router.get("/trades", adminController.getAllTrades);

// POST /api/admin/user/balance - Add/remove balance
router.post("/user/balance", adminController.modifyBalance);

// POST /api/admin/user/ban - Ban/unban user
router.post("/user/ban", adminController.banUser);

// POST /api/admin/withdrawal/approve - Approve withdrawal
router.post("/withdrawal/approve", adminController.approveWithdrawal);

// POST /api/admin/withdrawal/reject - Reject withdrawal
router.post("/withdrawal/reject", adminController.rejectWithdrawal);

// POST /api/admin/broadcast - Send broadcast message
router.post("/broadcast", adminController.broadcast);

// POST /api/admin/settings - Update system settings
router.post("/settings", adminController.updateSettings);

export default router;