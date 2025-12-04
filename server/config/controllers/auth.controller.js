import { query } from "../config/db.js";
import { sanitizeInput, validateTelegramId } from "../config/security.js";
import { extractKeyCandidates } from "../utils/keyExtractor.js";
import jwt from "jsonwebtoken";

export const activate = async (req, res) => {
  try {
    const { key: rawKey, tg_id, name, email, initData } = req.body;

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
      "SELECT * FROM keys WHERE key_code = $1 AND used_by IS NULL",
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
      // User exists, extend subscription
      user = user.rows[0];
      reused = true;

      const currentExpires = user.sub_expires ? new Date(user.sub_expires) : new Date();
      const newExpires = new Date(currentExpires);
      newExpires.setDate(newExpires.getDate() + keyData.days);

      await query(
        "UPDATE users SET sub_expires = $1, updated_at = NOW() WHERE id = $2",
        [newExpires, user.id]
      );

      user.sub_expires = newExpires;
    } else {
      // Create new user
      const expires = new Date();
      expires.setDate(expires.getDate() + keyData.days);

      const result = await query(
        `INSERT INTO users (tg_id, name, email, sub_expires) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [tg_id, sanitizeInput(name), sanitizeInput(email), expires]
      );

      user = result.rows[0];

      // Log activation
      await query(
        "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'info', 0, 'Account activated')",
        [user.id]
      );
    }

    // Mark key as used
    await query(
      "UPDATE keys SET used_by = $1, used_at = NOW() WHERE id = $2",
      [tg_id, keyData.id]
    );

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

    // Check if subscription expired
    if (user.sub_expires && new Date(user.sub_expires) < new Date()) {
      return res.status(403).json({ ok: false, error: "Subscription expired" });
    }

    res.json({ ok: true, user });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const checkSubscription = async (req, res) => {
  try {
    const { tg_id } = req.body;

    const result = await query("SELECT sub_expires FROM users WHERE tg_id = $1", [tg_id]);

    if (result.rows.length === 0) {
      return res.json({ ok: false, valid: false });
    }

    const { sub_expires } = result.rows[0];
    const valid = sub_expires && new Date(sub_expires) > new Date();

    res.json({ ok: true, valid, expires: sub_expires });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};