import { query } from "../config/db.js";

export const getProfile = async (req, res) => {
  try {
    const { tg_id } = req.params;
    const result = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    res.json({ ok: true, profile: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const getStats = async (req, res) => {
  try {
    const { tg_id } = req.params;
    
    const userResult = await query("SELECT id, balance, wins, losses FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];
    
    // Get trade stats
    const tradesResult = await query(
      "SELECT COUNT(*) as total, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins FROM trades_history WHERE user_id = $1",
      [user.id]
    );

    const stats = {
      balance: user.balance,
      total_wins: user.wins,
      total_losses: user.losses,
      total_trades: tradesResult.rows[0].total,
      winning_trades: tradesResult.rows[0].wins
    };

    res.json({ ok: true, stats });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { tg_id } = req.params;
    
    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    const result = await query(
      "SELECT * FROM system_messages WHERE target_user_id = $1 OR target_user_id IS NULL ORDER BY created_at DESC LIMIT 20",
      [user_id]
    );

    res.json({ ok: true, messages: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const markMessageRead = async (req, res) => {
  try {
    const { message_id } = req.body;
    
    await query("UPDATE system_messages SET is_read = TRUE WHERE id = $1", [message_id]);
    
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};