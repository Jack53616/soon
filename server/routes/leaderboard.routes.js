import express from "express";
import { query } from "../config/db.js";

const router = express.Router();

// GET /api/leaderboard - Get top traders
router.get("/", async (req, res) => {
  try {
    const { period = 'all' } = req.query;

    let timeFilter = '';
    if (period === 'daily') {
      timeFilter = "AND closed_at >= NOW() - INTERVAL '1 day'";
    } else if (period === 'weekly') {
      timeFilter = "AND closed_at >= NOW() - INTERVAL '7 days'";
    } else if (period === 'monthly') {
      timeFilter = "AND closed_at >= NOW() - INTERVAL '30 days'";
    }

    const leaderboard = await query(`
      SELECT 
        u.name,
        u.tg_id,
        u.level,
        COUNT(th.id) as total_trades,
        SUM(CASE WHEN th.pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(th.pnl) as total_pnl,
        AVG(th.pnl) as avg_pnl
      FROM users u
      LEFT JOIN trades_history th ON u.id = th.user_id ${timeFilter}
      WHERE u.is_banned = FALSE
      GROUP BY u.id, u.name, u.tg_id, u.level
      HAVING COUNT(th.id) > 0
      ORDER BY total_pnl DESC
      LIMIT 50
    `);

    res.json({ ok: true, leaderboard: leaderboard.rows });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;