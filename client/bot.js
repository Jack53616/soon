// QL Trading AI v2.1 FINAL — Telegram Bot
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import pkg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;

// Explicitly load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

console.log("◈ Telegram bot initialized via webhook mode");

const { BOT_TOKEN, ADMIN_ID } = process.env;

// Fallback to hardcoded URL if env var is wrong
const CORRECT_DB_URL = "postgresql://jack_is2t_user:xUCymi9CMft6fG1ZpkVaxEyBRXaWZB47@dpg-d4s8o3vpm1nc7390j2l0-a.virginia-postgres.render.com/jack_is2t";
const DATABASE_URL = process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgres") 
  ? process.env.DATABASE_URL 
  : CORRECT_DB_URL;

if (!BOT_TOKEN) { console.error("BOT_TOKEN missing"); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN);
console.log("✓ Connected to PostgreSQL via", (DATABASE_URL||"").split("@").pop());

// Force SSL for Render/Neon databases
const sslConfig = { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig // Always enforce SSL
});

const INVISIBLE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
const VALID_KEY_CHARS = /^[A-Za-z0-9._\-+=]+$/;
const KEY_FRAGMENT_RE = /[A-Za-z0-9][A-Za-z0-9._\-+=]{3,}[A-Za-z0-9=]?/g;
const BANNED_KEY_WORDS = new Set([
  "key", "code", "subscription", "subs", "sub", "token", "pass", "password",
  "link", "your", "this", "that", "here", "is", "for", "the", "my",
  "http", "https", "www", "click", "press", "bot", "created", "generated"
]);

const scoreToken = (token) => {
  const lower = token.toLowerCase();
  const length = token.length;
  const digitCount = (token.match(/\d/g) || []).length;
  const letterCount = (token.match(/[A-Za-z]/g) || []).length;

  let score = 0;
  if (digitCount) score += 6;
  if (/[-_]/.test(token)) score += 2;
  if (/[+=]/.test(token)) score += 1;
  if (digitCount && letterCount) score += 2;
  if (length >= 28) score += 6;
  else if (length >= 20) score += 5;
  else if (length >= 16) score += 4;
  else if (length >= 12) score += 3;
  else if (length >= 8) score += 2;
  else if (length >= 6) score += 1;

  const digitRatio = length ? digitCount / length : 0;
  if (digitRatio >= 0.5) score += 4;
  else if (digitRatio >= 0.35) score += 2;

  const upperCount = (token.match(/[A-Z]/g) || []).length;
  if (upperCount >= 4 && letterCount) score += 1;

  if (length > 32) score -= Math.min(length - 32, 12);
  if (length > 64) score -= Math.min(length - 64, 12);

  if (BANNED_KEY_WORDS.has(lower)) score -= 12;
  if (/^(key|code|token|pass)/.test(lower)) score -= 8;
  if (lower.includes("created") || lower.includes("generated")) score -= 6;
  if (lower.includes("http") || lower.includes("www") || lower.includes("tme")) score -= 15;
  if (lower.includes("telegram")) score -= 8;
  if (lower.includes("start=")) score -= 6;

  return score;
};

const sanitizeToken = (candidate = "") => {
  if (!candidate) return "";
  let token = candidate
    .replace(INVISIBLE_CHARS, "")
    .trim();
  if (!token) return "";
  token = token.replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9=]+$/, "");
  if (!token) return "";
  if (!VALID_KEY_CHARS.test(token)) {
    token = token.replace(/[^A-Za-z0-9._\-+=]+/g, "");
  }
  if (token.length < 4) return "";
  return token;
};

const sanitizedCollapsed = (text = "") => {
  if (!text) return "";
  const collapsed = text.replace(/[^A-Za-z0-9._\-+=]+/g, "");
  return collapsed.length >= 4 ? collapsed : "";
};

const extractKeyCandidates = (raw = "") => {
  if (!raw) return [];
  const normalized = raw.normalize("NFKC").replace(INVISIBLE_CHARS, " ").trim();
  if (!normalized) return [];
  const seen = new Map();
  const candidates = [];
  const sanitizedParts = [];

  const register = (token, boost = 0) => {
    const sanitized = sanitizeToken(token);
    if (!sanitized) return;
    const key = sanitized.toLowerCase();
    if (seen.has(key)) return;
    const score = scoreToken(sanitized) + boost;
    seen.set(key, score);
    candidates.push({ token: sanitized, score, idx: candidates.length });
  };

  const pushMatches = (text, boost = 0) => {
    if (!text) return;
    const matches = text.match(KEY_FRAGMENT_RE);
    if (matches) matches.forEach(match => register(match, boost));
  };

  pushMatches(normalized, 1);

  const startMatch = normalized.match(/start=([A-Za-z0-9._\-+=]+)/i);
  if (startMatch) register(startMatch[1], 6);

  normalized
    .split(/[\s|,;:/\\]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(part => {
      const sanitizedPart = sanitizeToken(part);
      if (sanitizedPart) {
        sanitizedParts.push({
          value: sanitizedPart,
          hasDigits: /\d/.test(sanitizedPart),
          hasLetters: /[A-Za-z]/.test(sanitizedPart)
        });
      }
      const eqIndex = part.indexOf("=");
      if (eqIndex >= 0 && eqIndex < part.length - 1) {
        register(part.slice(eqIndex + 1), 5);
      }
      register(part);
      pushMatches(part);
    });

  for (let i = 0; i < sanitizedParts.length - 1; i++) {
    const first = sanitizedParts[i];
    const second = sanitizedParts[i + 1];
    const joined = first.value + second.value;
    if (joined.length >= 6 && (first.hasDigits || second.hasDigits)) {
      register(joined, first.hasDigits && second.hasDigits ? 6 : 5);
    }
  }

  for (let i = 0; i < sanitizedParts.length - 2; i++) {
    const a = sanitizedParts[i];
    const b = sanitizedParts[i + 1];
    const c = sanitizedParts[i + 2];
    const joined = a.value + b.value + c.value;
    if (joined.length >= 8 && (a.hasDigits || b.hasDigits || c.hasDigits)) {
      register(joined, 4);
    }
  }

  const collapsed = sanitizedCollapsed(normalized);
  if (collapsed) {
    const lowerCollapsed = collapsed.toLowerCase();
    const startsWithMeta = /^(key|code|token|pass)/.test(lowerCollapsed);
    register(collapsed, startsWithMeta ? -2 : 1);
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.token.length !== a.token.length) return b.token.length - a.token.length;
    return a.idx - b.idx;
  });

  return candidates.map(c => c.token);
};

const cleanKey = (key = "") => extractKeyCandidates(key)[0] || "";

async function q(sql, params = []) {
  const c = await pool.connect();
  try { return await c.query(sql, params); } finally { c.release(); }
}
const isAdmin = (msg) => Number(msg?.from?.id) === Number(ADMIN_ID);

// رسالة ترحيب خارج الويب
bot.onText(/^\/start$/, (msg) => {
  const t = `✦ Welcome to QL Trading AI
◈ The smart trading bot that works automatically for you.
◆ Just deposit funds and watch profits added to your wallet.
◈ Track balance, trades, and withdrawals inside your wallet.
◆ 24/7 support via WhatsApp or Telegram.

✦ أهلاً بك في QL Trading AI
◈ البوت الذكي الذي يعمل تلقائياً لإدارة تداولاتك.
◆ كل ما عليك هو الإيداع وانتظر الأرباح تُضاف تلقائياً.
◈ تابع رصيدك، صفقاتك، وطلبات السحب من داخل المحفظة.
◆ دعم 24/7 عبر واتساب أو تيليجرام.`;
  bot.sendMessage(msg.chat.id, t);
});

// ===== أوامر الأدمن =====
bot.onText(/^\/help$/, (msg) => {
  if (!isAdmin(msg)) return;
  bot.sendMessage(msg.chat.id, `
⚙ Admin Commands
/create_key <KEY> <DAYS>
/addbalance <tg_id> <amount>
/open_trade <tg_id> <symbol>
/close_trade <trade_id> <pnl>
/setdaily <tg_id> <amount>
/approve_withdraw <id>
/reject_withdraw <id> <reason>
/broadcast all <message>
/notify <tg_id> <message>
  `.trim());
});

// إنشاء مفتاح
bot.onText(/^\/create_key\s+(\S+)(?:\s+(\d+))?$/, async (msg, m) => {
  if (!isAdmin(msg)) return;
  const key = cleanKey(m[1]); const days = Number(m[2] || 30);
  if (!key) return bot.sendMessage(msg.chat.id, "✗ Invalid key format");
  try {
    await q(`INSERT INTO subscription_keys (key_code, days) VALUES ($1,$2)`, [key, days]);
    console.log("◆ New key created:", key, days, "days");
    bot.sendMessage(msg.chat.id, `✓ Key created: ${key} (${days}d)`);
  } catch (e) { bot.sendMessage(msg.chat.id, `✗ ${e.message}`); }
});

// إيداع/خصم رصيد
bot.onText(/^\/addbalance\s+(\d+)\s+(-?\d+(?:\.\d+)?)$/, async (msg, m) => {
  if (!isAdmin(msg)) return;
  const tg = Number(m[1]); const amount = Number(m[2]);
  const u = await q(`SELECT * FROM users WHERE tg_id=$1`, [tg]).then(r => r.rows[0]);
  if (!u) return bot.sendMessage(msg.chat.id, "User not found");
  await q(`UPDATE users SET balance = balance + $1 WHERE id=$2`, [amount, u.id]);
  await q(`INSERT INTO ops (user_id, type, amount, note) VALUES ($1,'admin',$2,'manual admin op')`, [u.id, amount]);
  bot.sendMessage(msg.chat.id, `✓ Balance updated for tg:${tg} by ${amount}`);
  // إشعار للمستخدم بدون ذكر أدمن
  bot.sendMessage(tg, `◆ تم الإيداع في حسابك: ${amount>0?'+':'-'}$${Math.abs(amount).toFixed(2)}`).catch(()=>{});
});

// فتح صفقة
bot.onText(/^\/open_trade\s+(\d+)\s+(\S+)$/, async (msg, m) => {
  if (!isAdmin(msg)) return;
  const tg = Number(m[1]); const symbol = m[2].toUpperCase();
  const u = await q(`SELECT * FROM users WHERE tg_id=$1`, [tg]).then(r => r.rows[0]);
  if (!u) return bot.sendMessage(msg.chat.id, "User not found");
  const tr = await q(`INSERT INTO trades (user_id, symbol, status) VALUES ($1,$2,'open') RETURNING *`, [u.id, symbol]).then(r => r.rows[0]);
  bot.sendMessage(msg.chat.id, `✓ Opened trade #${tr.id} on ${symbol} for ${tg}`);
  bot.sendMessage(tg, `◈ تم فتح صفقة على ${symbol} لحسابك.`).catch(()=>{});
});

// إغلاق صفقة
bot.onText(/^\/close_trade\s+(\d+)\s+(-?\d+(?:\.\d+)?)$/, async (msg, m) => {
  if (!isAdmin(msg)) return;
  const tradeId = Number(m[1]); const pnl = Number(m[2]);
  const tr = await q(`SELECT * FROM trades WHERE id=$1`, [tradeId]).then(r => r.rows[0]);
  if (!tr || tr.status !== "open") return bot.sendMessage(msg.chat.id, "No open trade");
  await q(`UPDATE trades SET status='closed', closed_at=NOW(), pnl=$1 WHERE id=$2`, [pnl, tradeId]);
  if (pnl >= 0) await q(`UPDATE users SET balance = balance + $1, wins = wins + $1 WHERE id=$2`, [pnl, tr.user_id]);
  else await q(`UPDATE users SET losses = losses + $1 WHERE id=$2`, [Math.abs(pnl), tr.user_id]);
  await q(`INSERT INTO ops (user_id, type, amount, note) VALUES ($1,'pnl',$2,'close trade')`, [tr.user_id, pnl]);
  const tg = await q(`SELECT tg_id FROM users WHERE id=$1`, [tr.user_id]).then(r => r.rows[0]?.tg_id);
  bot.sendMessage(msg.chat.id, `✓ Closed trade #${tradeId} PnL ${pnl}`);
  if (tg) bot.sendMessage(Number(tg), `✓ تم إغلاق الصفقة. النتيجة: ${pnl>=0?'+':'-'}$${Math.abs(pnl).toFixed(2)}`).catch(()=>{});
});

// setdaily (تحريك تدريجي للرصيد حتى الهدف)
bot.onText(/^\/setdaily\s+(\d+)\s+(-?\d+(?:\.\d+)?)$/, async (msg, m) => {
  if (!isAdmin(msg)) return;
  const tg = Number(m[1]); const target = Number(m[2]);
  const u = await q(`SELECT * FROM users WHERE tg_id=$1`, [tg]).then(r => r.rows[0]);
  if (!u) return bot.sendMessage(msg.chat.id, "User not found");
  await q(`INSERT INTO daily_targets (user_id, target, active) VALUES ($1,$2,TRUE)`, [u.id, target]);
  bot.sendMessage(msg.chat.id, `✦ setdaily started for tg:${tg} target ${target}`);
  bot.sendMessage(tg, `✦ تم بدء صفقة يومية (الهدف ${target>=0?'+':'-'}$${Math.abs(target)}).`);
  // التحريك التدريجي (سيرفر فقط — الويب يعرض الحركة)
  // هنا فقط تسجّل الهدف؛ الويب سيقوم بالـ animation حسب الهدف.
});

// السحب: approve / reject
bot.onText(/^\/approve_withdraw\s+(\d+)$/, async (msg, m) => {
  if (!isAdmin(msg)) return;
  const id = Number(m[1]);
  const r0 = await q(`SELECT * FROM requests WHERE id=$1`, [id]).then(r => r.rows[0]);
  if (!r0) return bot.sendMessage(msg.chat.id, "Request not found");
  if (r0.status !== "pending") return bot.sendMessage(msg.chat.id, "Not pending");
  await q(`UPDATE requests SET status='approved', updated_at=NOW() WHERE id=$1`, [id]);
  const tg = await q(`SELECT tg_id FROM users WHERE id=$1`, [r0.user_id]).then(r => r.rows[0]?.tg_id);
  bot.sendMessage(msg.chat.id, `✓ Withdraw #${id} approved`);
  if (tg) bot.sendMessage(Number(tg), `◆ تمت الموافقة على طلب السحب #${id} بقيمة $${Number(r0.amount).toFixed(2)}.`).catch(()=>{});
});

bot.onText(/^\/reject_withdraw\s+(\d+)\s+(.+)$/, async (msg, m) => {
  if (!isAdmin(msg)) return;
  const id = Number(m[1]); const reason = m[2];
  const r0 = await q(`SELECT * FROM requests WHERE id=$1`, [id]).then(r => r.rows[0]);
  if (!r0) return bot.sendMessage(msg.chat.id, "Request not found");
  if (r0.status !== "pending") return bot.sendMessage(msg.chat.id, "Not pending");
  await q(`UPDATE requests SET status='rejected', updated_at=NOW() WHERE id=$1`, [id]);
  // نرجع الرصيد
  await q(`UPDATE users SET balance = balance + $1 WHERE id=$2`, [r0.amount, r0.user_id]);
  const tg = await q(`SELECT tg_id FROM users WHERE id=$1`, [r0.user_id]).then(r => r.rows[0]?.tg_id);
  bot.sendMessage(msg.chat.id, `✓ Withdraw #${id} rejected`);
  if (tg) bot.sendMessage(Number(tg), `✗ تم رفض طلب السحب #${id}. السبب: ${reason}`).catch(()=>{});
});

// broadcast / notify
bot.onText(/^\/broadcast\s+all\s+([\s\S]+)$/, async (msg, m) => {
  if (!isAdmin(msg)) return;
  const text = m[1].trim();
  const list = await q(`SELECT tg_id FROM users WHERE tg_id IS NOT NULL`);
  let ok = 0;
  for (const row of list.rows) {
    try { await bot.sendMessage(Number(row.tg_id), text); ok++; } catch {}
  }
  bot.sendMessage(msg.chat.id, `✦ Broadcast sent to ${ok} users.`);
});

bot.onText(/^\/notify\s+(\d+)\s+([\s\S]+)$/, async (msg, m) => {
  if (!isAdmin(msg)) return;
  const tg = Number(m[1]); const text = m[2];
  try { await bot.sendMessage(tg, text); bot.sendMessage(msg.chat.id, "✓ Sent."); }
  catch (e) { bot.sendMessage(msg.chat.id, "✗ " + e.message); }
});

export default bot;
