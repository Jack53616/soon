import express from "express";
import * as supervisorController from "../controllers/supervisor.controller.js";

const router = express.Router();

// ===== Public: Login =====
router.post("/login", supervisorController.supervisorLogin);

// ===== Protected routes (require supervisor token) =====
router.use(supervisorController.verifySupervisor);

// Dashboard
router.get("/dashboard", supervisorController.getDashboard);

// Users (read-only)
router.get("/users", supervisorController.getUsers);

// Open trades (read-only)
router.get("/trades", supervisorController.getOpenTrades);

// Deposits (read-only)
router.get("/deposits", supervisorController.getDeposits);

// Approved withdrawals only (NO pending)
router.get("/withdrawals/approved", supervisorController.getApprovedWithdrawals);

// Generate monthly key (30 days only)
router.post("/key/monthly", supervisorController.generateMonthlyKey);

export default router;
