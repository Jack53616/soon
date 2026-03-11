import { query } from "../config/db.js";
import { validateTelegramId } from "../config/security.js";
import bot from "../bot/bot.js";

export const getActiveTrades = async (req, res) => {
  try {
    const { tg_id } = req.params;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    // Get regular trades
    const result = await query(
      "SELECT *, 'regular' as trade_type FROM trades WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC",
      [user_id]
    );

    // Get mass trade user trades (visual trades from mass trades)
    const massResult = await query(
      `SELECT mtut.*, mt.duration_seconds as mt_duration, mt.scheduled_time, 'mass' as trade_type
       FROM mass_trade_user_trades mtut
       JOIN mass_trades mt ON mtut.mass_trade_id = mt.id
       WHERE mtut.user_id = $1 AND mtut.status = 'open'
       ORDER BY mtut.opened_at DESC`,
      [user_id]
    );

    // Get custom trades (admin-created for specific users)
    const customResult = await query(
      "SELECT *, 'custom' as trade_type FROM custom_trades WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC",
      [user_id]
    );

    // Combine all types
    const allTrades = [...result.rows, ...massResult.rows, ...customResult.rows];

    res.json({ ok: true, trades: allTrades });
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
    const { tg_id, trade_id, trade_type } = req.body;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    // Handle custom trade close
    if (trade_type === 'custom') {
      const tradeResult = await query(
        "SELECT * FROM custom_trades WHERE id = $1 AND user_id = $2 AND status = 'open' AND can_close = TRUE",
        [trade_id, user_id]
      );

      if (tradeResult.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "Trade not found or cannot be closed" });
      }

      const trade = tradeResult.rows[0];
      const pnl = Number(trade.pnl || 0);

      const closeResult = await query(
        "UPDATE custom_trades SET status = 'closed', closed_at = NOW(), close_reason = 'manual' WHERE id = $1 AND status = 'open' RETURNING id",
        [trade_id]
      );
      
      if (closeResult.rowCount === 0) {
        return res.status(400).json({ ok: false, error: "Trade already closed" });
      }

      await query("UPDATE users SET balance = balance + $1 WHERE id = $2", [pnl, user_id]);

      if (pnl >= 0) {
        await query("UPDATE users SET wins = COALESCE(wins, 0) + $1 WHERE id = $2", [pnl, user_id]);
      } else {
        await query("UPDATE users SET losses = COALESCE(losses, 0) + $1 WHERE id = $2", [Math.abs(pnl), user_id]);
      }

      await query(
        "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, 'Custom trade closed manually')",
        [user_id, pnl]
      );

      return res.json({ ok: true, message: "Trade closed", pnl: pnl });
    }

    // Handle regular trade close
    const tradeResult = await query(
      "SELECT * FROM trades WHERE id = $1 AND user_id = $2 AND status = 'open'",
      [trade_id, user_id]
    );

    if (tradeResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Trade not found" });
    }

    const trade = tradeResult.rows[0];
    const pnl = Number(trade.pnl || 0);

    const closeResult = await query(
      "UPDATE trades SET status = 'closed', closed_at = NOW(), close_reason = 'manual' WHERE id = $1 AND status = 'open' RETURNING id",
      [trade_id]
    );
    
    if (closeResult.rowCount === 0) {
      return res.status(400).json({ ok: false, error: "Trade already closed" });
    }

    await query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [pnl, user_id]
    );

    if (pnl >= 0) {
      await query("UPDATE users SET wins = COALESCE(wins, 0) + $1 WHERE id = $2", [pnl, user_id]);
    } else {
      await query("UPDATE users SET losses = COALESCE(losses, 0) + $1 WHERE id = $2", [Math.abs(pnl), user_id]);
    }

    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, 'Trade closed manually')",
      [user_id, pnl]
    );

    const duration = Math.floor((new Date() - new Date(trade.opened_at)) / 1000);
    await query(
      `INSERT INTO trades_history (user_id, trade_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'manual')`,
      [user_id, trade_id, trade.symbol, trade.direction, trade.entry_price, trade.current_price, trade.lot_size, pnl, duration, trade.opened_at]
    );

    res.json({ ok: true, message: "Trade closed", pnl: pnl });
  } catch (error) {
    console.error("Close trade error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// FIXED: Close trade by ID with proper balance update
export const closeTradeById = async (req, res) => {
  try {
    const { trade_id } = req.params;

    const tradeResult = await query(
      "SELECT * FROM trades WHERE id = $1 AND status = 'open'",
      [trade_id]
    );

    if (tradeResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Trade not found or already closed" });
    }

    const trade = tradeResult.rows[0];
    const pnl = Number(trade.pnl || 0);
    const user_id = trade.user_id;

    const closeResult = await query(
      "UPDATE trades SET status = 'closed', closed_at = NOW(), close_reason = 'manual' WHERE id = $1 AND status = 'open' RETURNING id",
      [trade_id]
    );
    
    if (closeResult.rowCount === 0) {
      return res.status(400).json({ ok: false, error: "Trade already closed" });
    }

    await query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [pnl, user_id]
    );

    if (pnl >= 0) {
      await query("UPDATE users SET wins = COALESCE(wins, 0) + $1 WHERE id = $2", [pnl, user_id]);
    } else {
      await query("UPDATE users SET losses = COALESCE(losses, 0) + $1 WHERE id = $2", [Math.abs(pnl), user_id]);
    }

    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, 'Trade closed manually')",
      [user_id, pnl]
    );

    const duration = Math.floor((new Date() - new Date(trade.opened_at)) / 1000);
    await query(
      `INSERT INTO trades_history (user_id, trade_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'manual')`,
      [user_id, trade_id, trade.symbol, trade.direction, trade.entry_price, trade.current_price, trade.lot_size, pnl, duration, trade.opened_at]
    );

    const userResult2 = await query("SELECT tg_id, balance, wins, losses FROM users WHERE id = $1", [user_id]);
    if (userResult2.rows.length > 0) {
      const user = userResult2.rows[0];
      try {
        await bot.sendMessage(user.tg_id, `🔔 *تم إغلاق الصفقة*\n${pnl >= 0 ? '🟢 ربح' : '🔴 خسارة'}: ${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}\n💰 الرصيد: $${Number(user.balance).toFixed(2)}`, { parse_mode: "Markdown" });
      } catch (err) {}
    }

    res.json({ ok: true, message: "Trade closed", pnl: pnl });
  } catch (error) {
    console.error("Close trade error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
};
