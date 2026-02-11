import express from "express";
import * as authController from "../controllers/auth.controller.js";
import { authLimiter } from "../config/security.js";

const router = express.Router();

// POST /api/activate - Activate subscription key
router.post("/activate", authLimiter, authController.activate);

// POST /api/token - Get JWT token (optional)
router.post("/token", authController.getToken);

// GET /api/user/:tg_id - Get user info
router.get("/user/:tg_id", authController.getUserInfo);

// POST /api/check-subscription - Check if subscription is valid
router.post("/check-subscription", authController.checkSubscription);

// GET /api/referral/:tg_id - Get referral info for user
router.get("/referral/:tg_id", authController.getReferralInfo);

export default router;
