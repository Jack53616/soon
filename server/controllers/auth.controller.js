import { query } from "../config/db.js";
import { sanitizeInput, validateTelegramId } from "../config/security.js";
import { extractKeyCandidates } from "../utils/keyExtractor.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import bot from "../bot/bot.js";
import { registerAgentReferral } from "./agent.controller.js";

// Generate unique referral code
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Process referral bonus based on deposit amount
async function processReferralBonus(tgId, depositAmount) {
  try {
    // Check if this user was referred by someone
    const referralResult = await query(
      "SELECT * FROM referrals WHERE referred_tg_id = $1 AND status = 'pending'",
      [tgId]
    );

    if (referralResult.rows.length === 0) return;

    const referral = referralResult.rows[0];
    
    // Calculate bonus based on deposit amount
    let bonusAmount = 0;
    if (depositAmount >= 1000) {
      bonusAmount = 100; // $100 for deposits >= $1000
    } else if (depositAmount >= 500) {
      bonusAmount = 50;  // $50 for deposits >= $500
    }

    if (bonusAmount <= 0) return;

    // Update referral record
    await query(
      "UPDATE referrals SET bonus_amount = $1, deposit_amount = $2, status = 'credited', credited_at = NOW() WHERE id = $3",
      [bonusAmount, depositAmount, referral.id]
    );

    // Credit bonus to referrer
    const referrerResult = await query("SELECT * FROM users WHERE tg_id = $1", [referral.referrer_tg_id]);
    if (referrerResult.rows.length > 0) {
      const referrer = referrerResult.rows[0];
      
      await query("UPDATE users SET balance = balance + $1, referral_earnings = COALESCE(referral_earnings, 0) + $1 WHERE id = $2", 
        [bonusAmount, referrer.id]);
      
      await query(
        "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'referral', $2, $3)",
        [referrer.id, bonusAmount, `Referral bonus: user ${tgId} deposited $${depositAmount}`]
      );

      // Notify referrer
      try {
        await bot.sendMessage(Number(referral.referrer_tg_id), `🎉 *مكافأة الدعوة!*

💰 حصلت على *$${bonusAmount}* كمكافأة دعوة!
👤 صديقك قام بإيداع $${depositAmount}

💵 تم إضافة المبلغ لرصيدك تلقائياً.

---

🎉 *Referral Bonus!*
💰 You earned *$${bonusAmount}* referral bonus!
👤 Your friend deposited $${depositAmount}`, { parse_mode: "Markdown" });
      } catch (err) { /* ignore */ }
    }
  } catch (error) {
    console.error("Referral bonus error:", error.message);
  }
}

export const activate = async (req, res) => {
  try {
    const { key: rawKey, tg_id, name, email, initData, tg_username } = req.body;

    if (!validateTelegramId(tg_id)) {
      return res.status(400).json({ ok: false, error: "Invalid Telegram ID" });
    }

    // Extract best key candidate
    const candidates = extractKeyCandidates(rawKey || "");
    const key = candidates[0];

    if (!key) {
      return res.status(400).json({ ok: false, error: "Invalid key format" });
    }

    // Check if key exists and not used
    const keyResult = await query(
      "SELECT * FROM subscription_keys WHERE key_code = $1 AND used_by IS NULL",
      [key]
    );

    if (keyResult.rows.length === 0) {
      return res.status(400).json({ ok: false, error: "Invalid or used key" });
    }

    const keyData = keyResult.rows[0];

    // Check if user exists
    let user = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    let reused = false;

    if (user.rows.length > 0) {
      // User exists - check if banned
      user = user.rows[0];
      
      if (user.is_banned) {
        return res.status(403).json({ 
          ok: false, 
          error: "banned",
          ban_reason: user.ban_reason || 'مخالفة شروط الاستخدام',
          banned_at: user.banned_at
        });
      }

      reused = true;

      const currentExpires = user.sub_expires ? new Date(user.sub_expires) : new Date();
      const newExpires = new Date(currentExpires);
      newExpires.setDate(newExpires.getDate() + keyData.days);

      await query(
        `UPDATE users SET sub_expires = $1, updated_at = NOW()${tg_username ? ', tg_username = $3' : ''} WHERE id = $2`,
        tg_username ? [newExpires, user.id, tg_username] : [newExpires, user.id]
      );

      user.sub_expires = newExpires;
    } else {
      // Create new user with referral code
      const expires = new Date();
      expires.setDate(expires.getDate() + keyData.days);
      const referralCode = generateReferralCode();

      // Check if there's a referral pending for this user
      const referralCheck = await query("SELECT referrer_tg_id FROM referrals WHERE referred_tg_id = $1", [tg_id]);
      const referredBy = referralCheck.rows.length > 0 ? referralCheck.rows[0].referrer_tg_id : null;

      const result = await query(
        `INSERT INTO users (tg_id, name, email, sub_expires, referral_code, referred_by, tg_username) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [tg_id, sanitizeInput(name), sanitizeInput(email), expires, referralCode, referredBy, tg_username || null]
      );

      user = result.rows[0];

      // Log activation
      await query(
        "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'info', 0, 'Account activated')",
        [user.id]
      );

      // ===== Agent: Register referral in agent_referrals =====
      // If this user was referred by someone, link them in agent_referrals
      if (referredBy) {
        try {
          // Find the referrer user by tg_id
          const referrerUser = await query("SELECT id FROM users WHERE tg_id = $1", [referredBy]);
          if (referrerUser.rows.length > 0) {
            await registerAgentReferral(referrerUser.rows[0].id, user.id);
          }
        } catch (e) {
          console.error("[Auth] Agent referral registration error:", e.message);
        }
      }
    }

    // Mark key as used
    await query(
      "UPDATE subscription_keys SET used_by = $1, used_at = NOW() WHERE id = $2",
      [tg_id, keyData.id]
    );

    // Generate session token for device management
    const sessionToken = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await query("UPDATE users SET session_token = $1 WHERE tg_id = $2", [sessionToken, tg_id]);
    user.session_token = sessionToken;

    res.json({ ok: true, user, reused });
  } catch (error) {
    console.error("Activation error:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

export const getToken = async (req, res) => {
  try {
    const { tg_id } = req.body;

    if (!validateTelegramId(tg_id)) {
      return res.status(400).json({ ok: false, error: "Invalid Telegram ID" });
    }

    const token = jwt.sign({ tg_id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({ ok: true, token });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const getUserInfo = async (req, res) => {
  try {
    const { tg_id } = req.params;

    if (!validateTelegramId(tg_id)) {
      return res.status(400).json({ ok: false, error: "Invalid Telegram ID" });
    }

    const result = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = result.rows[0];

    // Check if user is banned
    if (user.is_banned) {
      return res.status(403).json({ 
        ok: false, 
        error: "banned",
        ban_reason: user.ban_reason || 'مخالفة شروط الاستخدام',
        banned_at: user.banned_at
      });
    }

    // Check force logout (per-user)
    if (user.force_logout_at) {
      user.force_logout_at_ts = new Date(user.force_logout_at).getTime();
    }

    // Check global force logout
    try {
      const globalSetting = await query("SELECT value FROM settings WHERE key = 'global_force_logout_at'");
      if (globalSetting.rows.length > 0 && globalSetting.rows[0].value) {
        user.global_force_logout_at_ts = new Date(globalSetting.rows[0].value).getTime();
      }
    } catch(e) { /* ignore */ }

    // Check if subscription expired
    if (user.sub_expires && new Date(user.sub_expires) < new Date()) {
      return res.status(403).json({ ok: false, error: "Subscription expired" });
    }

    // Calculate display rank
    const referralCount = Number(user.referral_count || 0);
    let displayRank;
    if (user.custom_rank) {
      displayRank = user.custom_rank;
    } else if (referralCount >= 5) {
      displayRank = 'وكيل';
    } else {
      displayRank = 'عضو';
    }
    user.display_rank = displayRank;
    user.referral_trade_commission = Number(user.referral_trade_commission || 0);

    // Check if maintenance mode is on - hide sensitive data
    try {
      const maintResult = await query("SELECT value FROM settings WHERE key = 'maintenance_mode'");
      const isMaintenance = maintResult.rows.length > 0 && maintResult.rows[0].value === 'true';
      if (isMaintenance) {
        user.tg_id_hidden = true;
      }
    } catch(e) { /* ignore */ }

    res.json({ ok: true, user });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const checkSubscription = async (req, res) => {
  try {
    const { tg_id } = req.body;

    const result = await query("SELECT sub_expires, is_banned, ban_reason, banned_at FROM users WHERE tg_id = $1", [tg_id]);

    if (result.rows.length === 0) {
      return res.json({ ok: false, valid: false });
    }

    const user = result.rows[0];

    // Check if banned
    if (user.is_banned) {
      return res.json({ 
        ok: false, 
        valid: false, 
        banned: true,
        ban_reason: user.ban_reason || 'مخالفة شروط الاستخدام',
        banned_at: user.banned_at
      });
    }

    const { sub_expires } = user;
    const valid = sub_expires && new Date(sub_expires) > new Date();

    res.json({ ok: true, valid, expires: sub_expires });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get referral info for user
export const getReferralInfo = async (req, res) => {
  try {
    const { tg_id } = req.params;

    const userResult = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];

    // Generate referral code if not exists
    if (!user.referral_code) {
      const code = generateReferralCode();
      await query("UPDATE users SET referral_code = $1 WHERE id = $2", [code, user.id]);
      user.referral_code = code;
    }

    // Get referrals made by this user
    const referrals = await query(
      "SELECT r.*, u.name as referred_name FROM referrals r LEFT JOIN users u ON u.tg_id = r.referred_tg_id WHERE r.referrer_tg_id = $1 ORDER BY r.created_at DESC",
      [tg_id]
    );

    res.json({
      ok: true,
      referral_code: user.referral_code,
      referral_earnings: user.referral_earnings || 0,
      referrals: referrals.rows
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Export processReferralBonus for use in wallet controller
export { processReferralBonus };

// POST /api/user/country - Update user country/flag
export const updateCountry = async (req, res) => {
  try {
    const { tg_id, country } = req.body;

    if (!validateTelegramId(tg_id)) {
      return res.status(400).json({ ok: false, error: 'Invalid Telegram ID' });
    }

    // Validate country code (2 uppercase letters)
    const validCode = /^[A-Z]{2}$/.test(country || '');
    if (!validCode) {
      return res.status(400).json({ ok: false, error: 'Invalid country code' });
    }

    await query('UPDATE users SET country = $1 WHERE tg_id = $2', [country, tg_id]);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
