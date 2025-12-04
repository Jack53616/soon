import express from "express";
import * as walletController from "../controllers/wallet.controller.js";
import { withdrawLimiter } from "../config/security.js";

const router = express.Router();

// GET /api/wallet/:tg_id - Get wallet info
router.get("/:tg_id", walletController.getWallet);

// GET /api/ops/:tg_id - Get operations history
router.get("/ops/:tg_id", walletController.getOps);

// POST /api/withdraw - Request withdrawal
router.post("/withdraw", withdrawLimiter, walletController.requestWithdraw);

// POST /api/withdraw/method - Save withdrawal method
router.post("/withdraw/method", walletController.saveWithdrawMethod);

// POST /api/withdraw/cancel - Cancel withdrawal request
router.post("/withdraw/cancel", walletController.cancelWithdraw);

// GET /api/requests/:tg_id - Get withdrawal requests
router.get("/requests/:tg_id", walletController.getRequests);

export default router;