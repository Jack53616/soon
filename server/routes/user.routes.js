import express from "express";
import * as userController from "../controllers/user.controller.js";

const router = express.Router();

// GET /api/user/profile/:tg_id - Get user profile
router.get("/profile/:tg_id", userController.getProfile);

// GET /api/user/stats/:tg_id - Get user statistics
router.get("/stats/:tg_id", userController.getStats);

// GET /api/user/messages/:tg_id - Get system messages
router.get("/messages/:tg_id", userController.getMessages);

// POST /api/user/messages/read - Mark message as read
router.post("/messages/read", userController.markMessageRead);

export default router;