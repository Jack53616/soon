import express from "express";
import * as tradesController from "../controllers/trades.controller.js";

const router = express.Router();

// GET /api/trades/:tg_id - Get active trades
router.get("/:tg_id", tradesController.getActiveTrades);

// GET /api/trades/history/:tg_id - Get trade history
router.get("/history/:tg_id", tradesController.getTradeHistory);

// POST /api/trades/modify-tp - Modify take profit
router.post("/modify-tp", tradesController.modifyTakeProfit);

// POST /api/trades/modify-sl - Modify stop loss
router.post("/modify-sl", tradesController.modifyStopLoss);

// POST /api/trades/close/:trade_id - Close trade manually (NEW)
router.post("/close/:trade_id", tradesController.closeTradeById);

// POST /api/trades/close - Close trade manually (legacy)
router.post("/close", tradesController.closeTrade);

export default router;
