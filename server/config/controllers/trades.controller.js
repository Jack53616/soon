import { query } from "../config/db.js";
import { validateTelegramId } from "../config/security.js";

export const getActiveTrades = async (req, res) => {
  try {
    const { tg_id } = req.params;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    const result = await query(
      "SELECT * FROM trades WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC",
      [user_id]
    );

    res.json({ ok: true, trades: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const getTradeHistory = async (req, res) => {
  try {
    const { tg_id } = req.params;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    const result = await query(
      "SELECT * FROM trades_history WHERE user_id = $1 ORDER BY closed_at DESC LIMIT 50",
      [user_id]
    );

    res.json({ ok: true, history: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const modifyTakeProfit = async (req, res) => {
  try {
    const { tg_id, trade_id, take_profit } = req.body;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    await query(
      "UPDATE trades SET take_profit = $1 WHERE id = $2 AND user_id = $3 AND status = 'open'",
      [take_profit, trade_id, user_id]
    );

    res.json({ ok: true, message: "Take profit updated" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const modifyStopLoss = async (req, res) => {
  try {
    const { tg_id, trade_id, stop_loss } = req.body;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    await query(
      "UPDATE trades SET stop_loss = $1 WHERE id = $2 AND user_id = $3 AND status = 'open'",
      [stop_loss, trade_id, user_id]
    );

    res.json({ ok: true, message: "Stop loss updated" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const closeTrade = async (req, res) => {
  try {
    const { tg_id, trade_id } = req.body;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    const tradeResult = await query(
      "SELECT * FROM trades WHERE id = $1 AND user_id = $2 AND status = 'open'",
      [trade_id, user_id]
    );

    if (tradeResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Trade not found" });
    }

    const trade = tradeResult.rows[0];

    // Close trade
    await query(
      "UPDATE trades SET status = 'closed', closed_at = NOW(), close_reason = 'manual' WHERE id = $1",
      [trade_id]
    );

    // Update balance
    if (trade.pnl >= 0) {
      await query(
        "UPDATE users SET balance = balance + $1, wins = wins + $1 WHERE id = $2",
        [trade.pnl, user_id]
      );
    } else {
      await query(
        "UPDATE users SET losses = losses + $1 WHERE id = $2",
        [Math.abs(trade.pnl), user_id]
      );
    }

    // Log operation
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, 'Trade closed')",
      [user_id, trade.pnl]
    );

    // Move to history
    const duration = Math.floor((new Date() - new Date(trade.opened_at)) / 1000);
    await query(
      `INSERT INTO trades_history (user_id, trade_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'manual')`,
      [user_id, trade_id, trade.symbol, trade.direction, trade.entry_price, trade.current_price, trade.lot_size, trade.pnl, duration, trade.opened_at]
    );

    res.json({ ok: true, message: "Trade closed", pnl: trade.pnl });
  } catch (error) {
    console.error("Close trade error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
};