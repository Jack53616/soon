import express from "express";
import { query } from "../config/db.js";

const router = express.Router();

// GET /api/analytics/:tg_id - Get user analytics
router.get("/:tg_id", async (req, res) => {
  try {
    const { tg_id } = req.params;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    // Get trade statistics
    const stats = await query(`
      SELECT 
        COUNT(*) as total_trades,
        COUNT(CASE WHEN pnl > 0 THEN 1 END) as winning_trades,
        COUNT(CASE WHEN pnl < 0 THEN 1 END) as losing_trades,
        AVG(pnl) as avg_pnl,
        MAX(pnl) as best_trade,
        MIN(pnl) as worst_trade,
        SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) as total_profit,
        SUM(CASE WHEN pnl < 0 THEN ABS(pnl) ELSE 0 END) as total_loss
      FROM trades_history
      WHERE user_id = $1
    `, [user_id]);

    // Get recent performance (last 7 days)
    const recentPerformance = await query(`
      SELECT 
        DATE(closed_at) as date,
        SUM(pnl) as daily_pnl,
        COUNT(*) as trades_count
      FROM trades_history
      WHERE user_id = $1 AND closed_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(closed_at)
      ORDER BY date DESC
    `, [user_id]);

    // Get symbol performance
    const symbolPerformance = await query(`
      SELECT 
        symbol,
        COUNT(*) as trades,
        SUM(pnl) as total_pnl,
        AVG(pnl) as avg_pnl
      FROM trades_history
      WHERE user_id = $1
      GROUP BY symbol
      ORDER BY total_pnl DESC
    `, [user_id]);

    const analytics = {
      ...stats.rows[0],
      win_rate: stats.rows[0].total_trades > 0 
        ? ((stats.rows[0].winning_trades / stats.rows[0].total_trades) * 100).toFixed(2)
        : 0,
      recent_performance: recentPerformance.rows,
      symbol_performance: symbolPerformance.rows
    };

    res.json({ ok: true, analytics });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;