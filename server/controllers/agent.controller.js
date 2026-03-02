/**
 * Agent (Partner) System Controller
 * 
 * Rules:
 * - User becomes agent after 5 active depositing referrals
 * - Commission tiers: 5% (default), 7% (20+ clients), 10% (50+ clients)
 * - Commission window: 30 days per referred user
 * - Extra daily trade: +1 per referred depositor for 30 days
 * - Loyalty bonus: $100 if referred user stays 3 months
 * - Withdrawal bonus: 2% from referred user's withdrawal within first 30 days
 * - If referred user leaves: commission + extra trade stop immediately
 */

import { query } from "../config/db.js";
import bot from "../bot/bot.js";

// ===== HELPER: Get agent commission rate based on active clients =====
export function getAgentCommissionRate(activeClients) {
  if (activeClients >= 50) return 10;
  if (activeClients >= 20) return 7;
  return 5;
}

// ===== HELPER: Check and upgrade user to agent status =====
export async function checkAndUpgradeToAgent(userId) {
  try {
    const user = await query("SELECT * FROM users WHERE id = $1", [userId]);
    if (user.rows.length === 0) return;

    const u = user.rows[0];
    if (u.is_agent) return; // Already an agent

    // Count active depositing referrals
    const activeRefs = await query(
      `SELECT COUNT(*) as count FROM agent_referrals 
       WHERE agent_user_id = $1 AND is_active = TRUE AND has_deposited = TRUE`,
      [userId]
    );

    const count = parseInt(activeRefs.rows[0].count);

    if (count >= 5) {
      // Upgrade to agent!
      await query(
        `UPDATE users SET is_agent = TRUE, role = 'agent', agent_since = NOW(), 
         agent_active_clients = $1, agent_commission_rate = $2 WHERE id = $3`,
        [count, getAgentCommissionRate(count), userId]
      );

      // Notify via Telegram
      if (u.tg_id) {
        try {
          await bot.sendMessage(Number(u.tg_id), `🎉 *تهانينا! أصبحت شريكاً (Agent)!*

✅ لديك الآن ${count} عملاء نشطين
💰 عمولتك: *${getAgentCommissionRate(count)}%* من أرباح كل عميل مُحال
⏱ مدة العمولة: 30 يوم لكل عميل
📈 كلما زاد عدد عملائك، زادت نسبتك!

---

🎉 *Congratulations! You are now an Agent!*
✅ You have ${count} active clients
💰 Commission: *${getAgentCommissionRate(count)}%* per referred client`, { parse_mode: "Markdown" });
        } catch (e) { /* ignore */ }
      }

      console.log(`[Agent] User ${userId} upgraded to Agent with ${count} active clients`);
    }
  } catch (err) {
    console.error("[Agent] checkAndUpgradeToAgent error:", err.message);
  }
}

// ===== HELPER: Update agent commission rate based on current active clients =====
export async function updateAgentCommissionRate(agentUserId) {
  try {
    const activeRefs = await query(
      `SELECT COUNT(*) as count FROM agent_referrals 
       WHERE agent_user_id = $1 AND is_active = TRUE AND has_deposited = TRUE`,
      [agentUserId]
    );
    const count = parseInt(activeRefs.rows[0].count);
    const rate = getAgentCommissionRate(count);

    await query(
      `UPDATE users SET agent_active_clients = $1, agent_commission_rate = $2 WHERE id = $3`,
      [count, rate, agentUserId]
    );

    return { count, rate };
  } catch (err) {
    console.error("[Agent] updateAgentCommissionRate error:", err.message);
    return { count: 0, rate: 5 };
  }
}

// ===== HELPER: Update extra daily trades count for an agent =====
export async function updateAgentExtraTrades(agentUserId) {
  try {
    // Count active referrals still within 30-day extra trade window
    const activeExtra = await query(
      `SELECT COUNT(*) as count FROM agent_referrals 
       WHERE agent_user_id = $1 AND is_active = TRUE AND has_deposited = TRUE 
       AND extra_trade_expires_at > NOW()`,
      [agentUserId]
    );
    const extraTrades = parseInt(activeExtra.rows[0].count);

    await query(
      "UPDATE users SET extra_daily_trades = $1 WHERE id = $2",
      [extraTrades, agentUserId]
    );

    return extraTrades;
  } catch (err) {
    console.error("[Agent] updateAgentExtraTrades error:", err.message);
    return 0;
  }
}

// ===== MAIN: Process agent commission when referred user earns profit =====
export async function processAgentCommission(referredUserId, profitAmount) {
  try {
    if (profitAmount <= 0) return; // Only on profits

    // Find active agent referral for this user
    const refResult = await query(
      `SELECT ar.*, u.is_agent, u.tg_id as agent_tg_id, u.name as agent_name,
              u.agent_commission_rate
       FROM agent_referrals ar
       JOIN users u ON u.id = ar.agent_user_id
       WHERE ar.referred_user_id = $1 
         AND ar.is_active = TRUE 
         AND ar.commission_expires_at > NOW()
         AND u.is_agent = TRUE`,
      [referredUserId]
    );

    if (refResult.rows.length === 0) return;

    const ref = refResult.rows[0];
    const rate = Number(ref.agent_commission_rate);
    const commission = Number((profitAmount * rate / 100).toFixed(2));

    if (commission <= 0) return;

    // Add commission to agent's balance instantly
    await query(
      "UPDATE users SET balance = balance + $1, agent_total_earned = agent_total_earned + $1 WHERE id = $2",
      [commission, ref.agent_user_id]
    );

    // Log commission
    await query(
      `INSERT INTO agent_commissions (agent_user_id, referred_user_id, commission_type, amount, rate_applied, source_amount, note)
       VALUES ($1, $2, 'trade_profit', $3, $4, $5, 'Commission from referred user profit')`,
      [ref.agent_user_id, referredUserId, commission, rate, profitAmount]
    );

    // Update total earned on referral record
    await query(
      "UPDATE agent_referrals SET total_commission_earned = total_commission_earned + $1 WHERE id = $2",
      [commission, ref.id]
    );

    // Log to ops
    await query(
      `INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'agent_commission', $2, $3)`,
      [ref.agent_user_id, commission, `عمولة شريك ${rate}% من ربح عميل`]
    );

    console.log(`[Agent] Commission $${commission} (${rate}%) paid to agent ${ref.agent_user_id} from user ${referredUserId}`);
  } catch (err) {
    console.error("[Agent] processAgentCommission error:", err.message);
  }
}

// ===== MAIN: Process agent withdrawal bonus (2% from referred user's withdrawal in first 30 days) =====
export async function processAgentWithdrawalBonus(referredUserId, withdrawalAmount) {
  try {
    // Find active agent referral — only within first 30 days of referral
    const refResult = await query(
      `SELECT ar.*, u.is_agent, u.tg_id as agent_tg_id, u.agent_commission_rate
       FROM agent_referrals ar
       JOIN users u ON u.id = ar.agent_user_id
       WHERE ar.referred_user_id = $1 
         AND ar.is_active = TRUE 
         AND ar.referred_at > NOW() - INTERVAL '30 days'
         AND u.is_agent = TRUE`,
      [referredUserId]
    );

    if (refResult.rows.length === 0) return;

    const ref = refResult.rows[0];
    const bonus = Number((withdrawalAmount * 0.02).toFixed(2)); // 2% fixed

    if (bonus <= 0) return;

    // Add bonus to agent's balance
    await query(
      "UPDATE users SET balance = balance + $1, agent_total_earned = agent_total_earned + $1 WHERE id = $2",
      [bonus, ref.agent_user_id]
    );

    // Log commission
    await query(
      `INSERT INTO agent_commissions (agent_user_id, referred_user_id, commission_type, amount, rate_applied, source_amount, note)
       VALUES ($1, $2, 'withdrawal_bonus', $3, 2.00, $4, '2% withdrawal bonus from referred user')`,
      [ref.agent_user_id, referredUserId, bonus, withdrawalAmount]
    );

    // Log to ops
    await query(
      `INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'agent_commission', $2, $3)`,
      [ref.agent_user_id, bonus, `مكافأة سحب عميل 2%: $${withdrawalAmount}`]
    );

    console.log(`[Agent] Withdrawal bonus $${bonus} paid to agent ${ref.agent_user_id}`);
  } catch (err) {
    console.error("[Agent] processAgentWithdrawalBonus error:", err.message);
  }
}

// ===== MAIN: Handle referred user leaving (full withdrawal) =====
export async function handleReferredUserLeaving(referredUserId) {
  try {
    // Find the agent referral
    const refResult = await query(
      `SELECT ar.*, u.is_agent FROM agent_referrals ar
       JOIN users u ON u.id = ar.agent_user_id
       WHERE ar.referred_user_id = $1 AND ar.is_active = TRUE`,
      [referredUserId]
    );

    if (refResult.rows.length === 0) return;

    const ref = refResult.rows[0];

    // Deactivate the referral
    await query(
      "UPDATE agent_referrals SET is_active = FALSE WHERE id = $1",
      [ref.id]
    );

    // Update agent's active clients count and extra trades
    await updateAgentCommissionRate(ref.agent_user_id);
    await updateAgentExtraTrades(ref.agent_user_id);

    console.log(`[Agent] Referred user ${referredUserId} left — agent ${ref.agent_user_id} updated`);
  } catch (err) {
    console.error("[Agent] handleReferredUserLeaving error:", err.message);
  }
}

// ===== MAIN: Register a new referral for an agent =====
export async function registerAgentReferral(agentUserId, referredUserId) {
  try {
    // Check if already registered
    const existing = await query(
      "SELECT id FROM agent_referrals WHERE agent_user_id = $1 AND referred_user_id = $2",
      [agentUserId, referredUserId]
    );
    if (existing.rows.length > 0) return;

    await query(
      `INSERT INTO agent_referrals (agent_user_id, referred_user_id, referred_at, 
        commission_expires_at, extra_trade_expires_at, loyalty_bonus_eligible_at)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '30 days', NOW() + INTERVAL '30 days', NOW() + INTERVAL '90 days')`,
      [agentUserId, referredUserId]
    );

    console.log(`[Agent] Referral registered: agent ${agentUserId} → user ${referredUserId}`);
  } catch (err) {
    console.error("[Agent] registerAgentReferral error:", err.message);
  }
}

// ===== MAIN: Mark referred user as deposited (activates commission) =====
export async function markReferralAsDeposited(referredUserId, depositAmount) {
  try {
    const refResult = await query(
      "SELECT * FROM agent_referrals WHERE referred_user_id = $1",
      [referredUserId]
    );

    if (refResult.rows.length === 0) return;

    const ref = refResult.rows[0];

    await query(
      "UPDATE agent_referrals SET has_deposited = TRUE, deposit_amount = $1 WHERE id = $2",
      [depositAmount, ref.id]
    );

    // Update agent's active clients and check for upgrade
    await updateAgentCommissionRate(ref.agent_user_id);
    await updateAgentExtraTrades(ref.agent_user_id);
    await checkAndUpgradeToAgent(ref.agent_user_id);

    console.log(`[Agent] Referral ${referredUserId} marked as deposited ($${depositAmount})`);
  } catch (err) {
    console.error("[Agent] markReferralAsDeposited error:", err.message);
  }
}

// ===== CRON: Check loyalty bonuses (run daily) =====
export async function checkLoyaltyBonuses() {
  try {
    const eligibleRefs = await query(
      `SELECT ar.*, u.tg_id as agent_tg_id, u.name as agent_name
       FROM agent_referrals ar
       JOIN users u ON u.id = ar.agent_user_id
       WHERE ar.loyalty_bonus_eligible_at <= NOW()
         AND ar.loyalty_bonus_paid = FALSE
         AND ar.is_active = TRUE
         AND ar.has_deposited = TRUE
         AND u.is_agent = TRUE`
    );

    for (const ref of eligibleRefs.rows) {
      const bonusAmount = 100; // $100 loyalty bonus

      // Pay loyalty bonus
      await query(
        "UPDATE users SET balance = balance + $1, agent_total_earned = agent_total_earned + $1 WHERE id = $2",
        [bonusAmount, ref.agent_user_id]
      );

      // Mark as paid
      await query(
        "UPDATE agent_referrals SET loyalty_bonus_paid = TRUE WHERE id = $1",
        [ref.id]
      );

      // Log commission
      await query(
        `INSERT INTO agent_commissions (agent_user_id, referred_user_id, commission_type, amount, rate_applied, source_amount, note)
         VALUES ($1, $2, 'loyalty_bonus', $3, 0, 0, 'Loyalty bonus - 3 months active referral')`,
        [ref.agent_user_id, ref.referred_user_id, bonusAmount]
      );

      // Log to ops
      await query(
        `INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'agent_commission', $2, $3)`,
        [ref.agent_user_id, bonusAmount, `مكافأة ولاء $100 - عميل نشط 3 أشهر`]
      );

      // Notify agent
      if (ref.agent_tg_id) {
        try {
          await bot.sendMessage(Number(ref.agent_tg_id), `🏆 *مكافأة ولاء!*

💰 حصلت على *$100* مكافأة ولاء
✅ أحد عملائك المُحالين بقي نشطاً لمدة 3 أشهر!

---

🏆 *Loyalty Bonus!*
💰 You earned *$100* loyalty bonus
✅ One of your referred clients stayed active for 3 months!`, { parse_mode: "Markdown" });
        } catch (e) { /* ignore */ }
      }

      console.log(`[Agent] Loyalty bonus $${bonusAmount} paid to agent ${ref.agent_user_id}`);
    }
  } catch (err) {
    console.error("[Agent] checkLoyaltyBonuses error:", err.message);
  }
}

// ===== API: Get agent dashboard info =====
export const getAgentDashboard = async (req, res) => {
  try {
    const { user_id } = req.params;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];

    // Get all referrals
    const referrals = await query(
      `SELECT ar.*, u.name as referred_name, u.balance as referred_balance,
              u.total_deposited as referred_deposited
       FROM agent_referrals ar
       JOIN users u ON u.id = ar.referred_user_id
       WHERE ar.agent_user_id = $1
       ORDER BY ar.referred_at DESC`,
      [user_id]
    );

    // Get commission history
    const commissions = await query(
      `SELECT * FROM agent_commissions WHERE agent_user_id = $1 
       ORDER BY created_at DESC LIMIT 50`,
      [user_id]
    );

    // Stats
    const stats = await query(
      `SELECT 
        COUNT(*) FILTER (WHERE is_active = TRUE AND has_deposited = TRUE) as active_clients,
        COUNT(*) FILTER (WHERE has_deposited = TRUE) as total_deposited_clients,
        COUNT(*) FILTER (WHERE loyalty_bonus_paid = TRUE) as loyalty_bonuses_paid,
        SUM(total_commission_earned) as total_commission
       FROM agent_referrals WHERE agent_user_id = $1`,
      [user_id]
    );

    const s = stats.rows[0];
    const activeClients = parseInt(s.active_clients) || 0;
    const currentRate = getAgentCommissionRate(activeClients);

    res.json({
      ok: true,
      data: {
        is_agent: user.is_agent,
        agent_since: user.agent_since,
        active_clients: activeClients,
        total_deposited_clients: parseInt(s.total_deposited_clients) || 0,
        commission_rate: currentRate,
        next_tier: activeClients < 20 ? { threshold: 20, rate: 7 } : activeClients < 50 ? { threshold: 50, rate: 10 } : null,
        total_earned: Number(s.total_commission) || 0,
        agent_total_earned: Number(user.agent_total_earned) || 0,
        extra_daily_trades: user.extra_daily_trades || 0,
        referrals: referrals.rows,
        commissions: commissions.rows
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== ADMIN API: Get all agents =====
export const getAllAgents = async (req, res) => {
  try {
    const agents = await query(
      `SELECT u.id, u.name, u.tg_id, u.balance, u.is_agent, u.agent_since,
              u.agent_active_clients, u.agent_commission_rate, u.agent_total_earned,
              u.extra_daily_trades,
              (SELECT COUNT(*) FROM agent_referrals ar WHERE ar.agent_user_id = u.id AND ar.is_active = TRUE AND ar.has_deposited = TRUE) as live_active_clients
       FROM users u
       WHERE u.is_agent = TRUE OR u.role = 'agent'
       ORDER BY u.agent_total_earned DESC`
    );

    res.json({ ok: true, data: agents.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== ADMIN API: Manually promote user to agent =====
export const promoteToAgent = async (req, res) => {
  try {
    const { user_id } = req.body;

    const userResult = await query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    await query(
      `UPDATE users SET is_agent = TRUE, role = 'agent', agent_since = NOW() WHERE id = $1`,
      [user_id]
    );

    res.json({ ok: true, message: "User promoted to Agent" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ===== ADMIN API: Revoke agent status =====
export const revokeAgent = async (req, res) => {
  try {
    const { user_id } = req.body;

    await query(
      `UPDATE users SET is_agent = FALSE, role = 'user', agent_since = NULL WHERE id = $1`,
      [user_id]
    );

    res.json({ ok: true, message: "Agent status revoked" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
