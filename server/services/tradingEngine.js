import { query } from "../config/db.js";
import bot from "../bot/bot.js";
import { processAgentCommission } from "../controllers/agent.controller.js";

/* =========================
   PRICE SOURCES & CACHES
========================= */

let goldPriceCache = 2650;
let lastGoldFetch = 0;

async function getRealGoldPrice() {
  try {
    const now = Date.now();
    if (now - lastGoldFetch < 300000 && goldPriceCache > 0) {
      return goldPriceCache;
    }

    const basePrice = 2650;
    const hour = new Date().getUTCHours();
    const timeVariation = Math.sin((hour / 24) * Math.PI * 2) * 5;
    const randomVariation = (Math.random() - 0.5) * 3;

    goldPriceCache = basePrice + timeVariation + randomVariation;
    lastGoldFetch = now;
    return goldPriceCache;
  } catch {
    return goldPriceCache || 2650;
  }
}

// Crypto
let cryptoCache = { BTCUSDT: 43000, ETHUSDT: 2300 };
let lastCryptoFetch = 0;

async function getCryptoPrices() {
  try {
    const now = Date.now();
    if (now - lastCryptoFetch < 10000) return cryptoCache;

    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]'
    );

    if (res.ok) {
      const data = await res.json();
      cryptoCache = {
        BTCUSDT: Number(data.find(i => i.symbol === "BTCUSDT")?.price || 43000),
        ETHUSDT: Number(data.find(i => i.symbol === "ETHUSDT")?.price || 2300)
      };
      lastCryptoFetch = now;
    }
    return cryptoCache;
  } catch {
    return cryptoCache;
  }
}

/* =========================
   PERSISTENT PRICE STATE
   Prevents price jumps on page reload
========================= */

const priceStateCache = new Map(); // In-memory cache: "tradeId_type" -> { price, pnl }

async function getPriceState(tradeId, tradeType) {
  const key = `${tradeId}_${tradeType}`;
  if (priceStateCache.has(key)) return priceStateCache.get(key);
  
  try {
    const res = await query(
      "SELECT last_price, last_pnl FROM trade_price_states WHERE trade_id = $1 AND trade_type = $2",
      [tradeId, tradeType]
    );
    if (res.rows.length > 0) {
      const state = { price: Number(res.rows[0].last_price), pnl: Number(res.rows[0].last_pnl) };
      priceStateCache.set(key, state);
      return state;
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function savePriceState(tradeId, tradeType, price, pnl) {
  const key = `${tradeId}_${tradeType}`;
  priceStateCache.set(key, { price, pnl });
  
  try {
    await query(
      `INSERT INTO trade_price_states (trade_id, trade_type, last_price, last_pnl, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (trade_id, trade_type) DO UPDATE SET last_price = $3, last_pnl = $4, updated_at = NOW()`,
      [tradeId, tradeType, price, pnl]
    );
  } catch (e) { /* ignore */ }
}

function clearPriceState(tradeId, tradeType) {
  const key = `${tradeId}_${tradeType}`;
  priceStateCache.delete(key);
  query("DELETE FROM trade_price_states WHERE trade_id = $1 AND trade_type = $2", [tradeId, tradeType]).catch(() => {});
}

/* =========================
   PRICE GENERATOR (Smooth)
   Uses last known price for continuity
========================= */

const generatePrice = async (symbol, lastPrice) => {
  const lp = Number(lastPrice) || 2650;

  if (symbol === "XAUUSD") {
    if (Math.random() < 0.1) return Number(await getRealGoldPrice());
    // Smooth small movement: max 0.15% per tick
    const change = lp * (Math.random() - 0.5) * 0.0015;
    return Number((lp + change).toFixed(4));
  }

  if (symbol === "XAGUSD") {
    const change = lp * (Math.random() - 0.5) * 0.003;
    return Number((lp + change).toFixed(4));
  }

  if (symbol === "BTCUSDT" || symbol === "ETHUSDT") {
    const prices = await getCryptoPrices();
    return Number(prices[symbol] || lp);
  }

  const change = lp * (Math.random() - 0.5) * 0.005;
  return Number((lp + change).toFixed(4));
};

/* =========================
   SMART PNL CALCULATOR v2
   - FIX: BUY/SELL both can win or lose (truly random direction)
   - Speed modes: normal, fast, turbo
   - Smooth transitions
========================= */

function getSpeedMultiplier(speed) {
  switch (speed) {
    case 'turbo': return 3.0;   // 3x faster PnL movement
    case 'fast': return 2.0;    // 2x faster PnL movement
    default: return 1.0;        // Normal speed
  }
}

function calculateSmartPnl(trade, progress) {
  const targetPnl = Number(trade.target_pnl || 0);
  const visualLot = Math.min(Number(trade.lot_size || 0.05), 0.05);
  const speed = trade.speed || 'normal';
  const speedMult = getSpeedMultiplier(speed);
  let pnl = 0;

  // Apply speed multiplier to progress (faster trades reach target sooner)
  const effectiveProgress = Math.min(progress * speedMult, 1);

  // Phase 1: Small fluctuation at start (0-15%)
  if (effectiveProgress < 0.15) {
    const smallSwing = Math.abs(targetPnl) * 0.08;
    pnl = (Math.random() - 0.45) * smallSwing; // Slight positive bias
  }
  // Phase 2: Realistic fluctuation (15-75%)
  else if (effectiveProgress < 0.75) {
    const normalizedProgress = (effectiveProgress - 0.15) / 0.60;
    const base = Math.abs(targetPnl) * 0.05;
    const swing = Math.abs(targetPnl) * 0.30;
    const noise = (Math.random() - 0.5) * swing;
    const targetDirection = targetPnl >= 0 ? 1 : -1;
    const progressBonus = normalizedProgress * 0.4 * Math.abs(targetPnl) * targetDirection;
    pnl = base * targetDirection + noise + progressBonus;
    
    // Random dips (30% chance in first half)
    if (Math.random() < 0.25 && normalizedProgress < 0.5) {
      pnl = -Math.abs(pnl) * 0.3;
    }
  }
  // Phase 3: Convergence to target (75-90%)
  else if (effectiveProgress < 0.90) {
    const convergenceProgress = (effectiveProgress - 0.75) / 0.15;
    const currentTarget = targetPnl * (0.5 + convergenceProgress * 0.35);
    const noise = (Math.random() - 0.5) * Math.abs(targetPnl) * 0.1;
    pnl = currentTarget + noise;
  }
  // Phase 4: Final push to target (90-100%)
  else {
    const finalProgress = (effectiveProgress - 0.90) / 0.10;
    const finalTarget = targetPnl * (0.85 + finalProgress * 0.15);
    const tinyNoise = (Math.random() - 0.5) * Math.abs(targetPnl) * 0.03;
    pnl = finalTarget + tinyNoise;
  }

  // Adjust by lot size
  pnl *= visualLot / 0.05;

  // Safety checks
  pnl = Number(pnl);
  if (!isFinite(pnl)) pnl = 0;
  return Number(pnl.toFixed(2));
}

/* =========================
   REFERRAL COMMISSION (5% from each trade)
========================= */

async function processReferralCommission(userId, pnl) {
  try {
    if (pnl <= 0) return; // Only on profits

    // Find who referred this user
    const userResult = await query(
      "SELECT referred_by FROM users WHERE id = $1 AND referred_by IS NOT NULL",
      [userId]
    );
    if (userResult.rows.length === 0) return;

    const referrerTgId = userResult.rows[0].referred_by;
    
    // Find referrer user
    const referrerResult = await query(
      "SELECT id, balance FROM users WHERE tg_id = $1",
      [referrerTgId]
    );
    if (referrerResult.rows.length === 0) return;

    const referrerId = referrerResult.rows[0].id;
    const commissionRate = 5; // 5%
    const commission = Number((pnl * commissionRate / 100).toFixed(2));
    if (commission <= 0) return;

    // Add commission to referrer's balance
    await query(
      "UPDATE users SET balance = balance + $1, referral_trade_commission = COALESCE(referral_trade_commission, 0) + $1, referral_earnings = COALESCE(referral_earnings, 0) + $1 WHERE id = $2",
      [commission, referrerId]
    );

    // Log commission
    await query(
      `INSERT INTO referral_commissions (referrer_user_id, referred_user_id, trade_pnl, commission_amount, commission_rate)
       VALUES ($1, $2, $3, $4, $5)`,
      [referrerId, userId, pnl, commission, commissionRate]
    );

    // Log to ops
    await query(
      `INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'referral', $2, $3)`,
      [referrerId, commission, `عمولة إحالة 5% من ربح صفقة | Referral commission 5%`]
    );

    console.log(`[Referral] Commission $${commission} (5%) paid to user ${referrerId} from user ${userId}`);
  } catch (err) {
    console.error("[Referral] processReferralCommission error:", err.message);
  }
}

/* =========================
   REGULAR TRADES ENGINE
========================= */

const updateTrades = async () => {
  try {
    const res = await query(
      "SELECT * FROM trades WHERE status='open' ORDER BY opened_at DESC LIMIT 100"
    );
    if (!res.rows.length) return;

    for (const trade of res.rows) {
      try {
        // Use saved price state for continuity
        const savedState = await getPriceState(trade.id, 'regular');
        const lastPrice = savedState ? savedState.price : Number(trade.current_price || trade.entry_price);
        const currentPrice = await generatePrice(trade.symbol, lastPrice);

        const duration = Number(trade.duration_seconds) || 3600;
        const openedAt = new Date(trade.opened_at);
        const elapsed = Math.floor((Date.now() - openedAt.getTime()) / 1000);
        const progress = Math.min(elapsed / duration, 1);

        const pnl = calculateSmartPnl(trade, progress);

        await query(
          "UPDATE trades SET current_price=$1, pnl=$2 WHERE id=$3",
          [currentPrice, pnl, trade.id]
        );

        // Save price state for continuity
        await savePriceState(trade.id, 'regular', currentPrice, pnl);

        // Close trade when duration is reached
        if (elapsed >= duration) {
          const finalPnl = Number(trade.target_pnl || pnl);
          await closeRegularTrade({
            trade,
            currentPrice,
            pnl: finalPnl,
            closeReason: "duration",
            elapsed
          });
        }

      } catch (err) {
        console.error("Trade update error:", err.message);
      }
    }
  } catch (err) {
    console.error("Trading engine error:", err.message);
  }
};

/* =========================
   MASS TRADE USER TRADES ENGINE
========================= */

const updateMassTradeUserTrades = async () => {
  try {
    const res = await query(`
      SELECT mtut.*, mt.duration_seconds as mt_duration
      FROM mass_trade_user_trades mtut
      JOIN mass_trades mt ON mtut.mass_trade_id = mt.id
      WHERE mtut.status = 'open'
      ORDER BY mtut.opened_at DESC LIMIT 500
    `);
    if (!res.rows.length) return;

    for (const trade of res.rows) {
      try {
        const savedState = await getPriceState(trade.id, 'mass');
        const lastPrice = savedState ? savedState.price : Number(trade.current_price || trade.entry_price);
        const currentPrice = await generatePrice(trade.symbol, lastPrice);

        const duration = Number(trade.mt_duration || trade.duration_seconds || 3600);
        const openedAt = new Date(trade.opened_at);
        const elapsed = Math.floor((Date.now() - openedAt.getTime()) / 1000);
        const progress = Math.min(elapsed / duration, 1);

        const pnl = calculateSmartPnl(trade, progress);

        await query(
          "UPDATE mass_trade_user_trades SET current_price=$1, pnl=$2 WHERE id=$3",
          [currentPrice, pnl, trade.id]
        );

        await savePriceState(trade.id, 'mass', currentPrice, pnl);

        // Close mass trade user trade when duration is reached
        if (elapsed >= duration) {
          const finalPnl = Number(trade.target_pnl || pnl);
          await closeMassTradeUserTrade({
            trade,
            currentPrice,
            pnl: finalPnl,
            elapsed
          });
        }

      } catch (err) {
        console.error("Mass trade user trade update error:", err.message);
      }
    }
  } catch (err) {
    console.error("Mass trade engine error:", err.message);
  }
};

/* =========================
   CUSTOM TRADES ENGINE
   Admin-created trades for specific users
========================= */

const updateCustomTrades = async () => {
  try {
    const res = await query(
      "SELECT * FROM custom_trades WHERE status='open' ORDER BY opened_at DESC LIMIT 200"
    );
    if (!res.rows.length) return;

    for (const trade of res.rows) {
      try {
        const savedState = await getPriceState(trade.id, 'custom');
        const lastPrice = savedState ? savedState.price : Number(trade.current_price || trade.entry_price);
        const currentPrice = await generatePrice(trade.symbol, lastPrice);

        const duration = Number(trade.duration_seconds) || 3600;
        const openedAt = new Date(trade.opened_at);
        const elapsed = Math.floor((Date.now() - openedAt.getTime()) / 1000);
        const progress = Math.min(elapsed / duration, 1);

        const pnl = calculateSmartPnl(trade, progress);

        await query(
          "UPDATE custom_trades SET current_price=$1, pnl=$2 WHERE id=$3",
          [currentPrice, pnl, trade.id]
        );

        await savePriceState(trade.id, 'custom', currentPrice, pnl);

        // Close when duration reached
        if (elapsed >= duration) {
          const finalPnl = Number(trade.target_pnl || pnl);
          await closeCustomTrade({
            trade,
            currentPrice,
            pnl: finalPnl,
            elapsed
          });
        }

      } catch (err) {
        console.error("Custom trade update error:", err.message);
      }
    }
  } catch (err) {
    console.error("Custom trades engine error:", err.message);
  }
};

/* =========================
   CLOSE CUSTOM TRADE
========================= */

async function closeCustomTrade({ trade, currentPrice, pnl, elapsed }) {
  try {
    const closeResult = await query(
      "UPDATE custom_trades SET status='closed', closed_at=NOW(), close_reason='duration', pnl=$1, current_price=$2 WHERE id=$3 AND status='open' RETURNING id",
      [pnl, currentPrice, trade.id]
    );

    if (closeResult.rowCount === 0) return;

    // Clear price state
    clearPriceState(trade.id, 'custom');

    // Update user balance
    await query("UPDATE users SET balance = balance + $1 WHERE id=$2", [pnl, trade.user_id]);

    if (pnl >= 0) {
      await query("UPDATE users SET wins = COALESCE(wins,0) + $1 WHERE id=$2", [pnl, trade.user_id]);
    } else {
      await query("UPDATE users SET losses = COALESCE(losses,0) + $1 WHERE id=$2", [Math.abs(pnl), trade.user_id]);
    }

    // Save to trades_history
    await query(`
      INSERT INTO trades_history (user_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'custom_trade')
    `, [
      trade.user_id, trade.symbol, trade.direction,
      trade.entry_price, currentPrice, trade.lot_size, pnl,
      elapsed, trade.opened_at
    ]);

    // Log operation
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
      [trade.user_id, pnl, `Custom trade closed: ${pnl >= 0 ? 'Profit' : 'Loss'}`]
    );

    // Referral commission (5%)
    if (pnl > 0) {
      try { await processReferralCommission(trade.user_id, pnl); } catch (e) {}
      try { await processAgentCommission(trade.user_id, pnl); } catch (e) {}
    }

    // Send notification
    const u = await query("SELECT tg_id, balance FROM users WHERE id=$1", [trade.user_id]);
    if (u.rows.length) {
      try {
        await bot.sendMessage(
          u.rows[0].tg_id,
          `🔔 *تم إغلاق الصفقة الإضافية*\n${pnl >= 0 ? "🟢 ربح" : "🔴 خسارة"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}\n💰 الرصيد: $${Number(u.rows[0].balance).toFixed(2)}\n\n🔔 *Extra Trade Closed*\n${pnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}\n💰 Balance: $${Number(u.rows[0].balance).toFixed(2)}`,
          { parse_mode: "Markdown" }
        );
      } catch (msgErr) {}
    }
  } catch (err) {
    console.error("Close custom trade error:", err.message);
  }
}

/* =========================
   CLOSE REGULAR TRADE
========================= */

async function closeRegularTrade({ trade, currentPrice, pnl, closeReason, elapsed }) {
  try {
    const closeResult = await query(
      "UPDATE trades SET status='closed', closed_at=NOW(), close_reason=$1, pnl=$2 WHERE id=$3 AND status='open' RETURNING id",
      [closeReason, pnl, trade.id]
    );

    if (closeResult.rowCount === 0) {
      console.log(`Trade #${trade.id} already closed, skipping duplicate close.`);
      return;
    }

    // Clear price state
    clearPriceState(trade.id, 'regular');

    await query(
      "UPDATE users SET balance = balance + $1 WHERE id=$2",
      [pnl, trade.user_id]
    );

    if (pnl >= 0) {
      await query("UPDATE users SET wins = COALESCE(wins,0) + $1 WHERE id=$2", [pnl, trade.user_id]);
    } else {
      await query("UPDATE users SET losses = COALESCE(losses,0) + $1 WHERE id=$2", [Math.abs(pnl), trade.user_id]);
    }

    await query(`
      INSERT INTO trades_history (user_id, trade_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
    `, [
      trade.user_id, trade.id, trade.symbol, trade.direction,
      trade.entry_price, currentPrice, trade.lot_size, pnl,
      elapsed, trade.opened_at, closeReason
    ]);

    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
      [trade.user_id, pnl, `Trade #${trade.id} closed: ${pnl >= 0 ? 'Profit' : 'Loss'}`]
    );

    // Referral commission (5% from profit)
    if (pnl > 0) {
      try { await processReferralCommission(trade.user_id, pnl); } catch (e) {}
      try { await processAgentCommission(trade.user_id, pnl); } catch (agentErr) {
        console.error("Agent commission error:", agentErr.message);
      }
    }

    const u = await query("SELECT tg_id, balance FROM users WHERE id=$1", [trade.user_id]);
    if (u.rows.length) {
      try {
        await bot.sendMessage(
          u.rows[0].tg_id,
          `🔔 *تم إغلاق الصفقة*\n${pnl >= 0 ? "🟢 ربح" : "🔴 خسارة"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}\n💰 الرصيد: $${Number(u.rows[0].balance).toFixed(2)}\n\n🔔 *Trade Closed*\n${pnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}\n💰 Balance: $${Number(u.rows[0].balance).toFixed(2)}`,
          { parse_mode: "Markdown" }
        );
      } catch (msgErr) {
        console.error("Failed to send trade notification:", msgErr.message);
      }
    }
  } catch (err) {
    console.error("Close trade error:", err.message);
  }
}

/* =========================
   CLOSE MASS TRADE USER TRADE
========================= */

async function closeMassTradeUserTrade({ trade, currentPrice, pnl, elapsed }) {
  try {
    const closeResult = await query(
      "UPDATE mass_trade_user_trades SET status='closed', closed_at=NOW(), close_reason='duration', pnl=$1, current_price=$2 WHERE id=$3 AND status='open' RETURNING id",
      [pnl, currentPrice, trade.id]
    );

    if (closeResult.rowCount === 0) {
      console.log(`Mass trade user trade #${trade.id} already closed, skipping duplicate close.`);
      return;
    }

    // Clear price state
    clearPriceState(trade.id, 'mass');

    // Update user balance
    await query("UPDATE users SET balance = balance + $1 WHERE id=$2", [pnl, trade.user_id]);

    if (pnl >= 0) {
      await query("UPDATE users SET wins = COALESCE(wins,0) + $1 WHERE id=$2", [pnl, trade.user_id]);
    } else {
      await query("UPDATE users SET losses = COALESCE(losses,0) + $1 WHERE id=$2", [Math.abs(pnl), trade.user_id]);
    }

    // Update participant record
    const userBalance = await query("SELECT balance FROM users WHERE id=$1", [trade.user_id]);
    const newBalance = userBalance.rows.length ? Number(userBalance.rows[0].balance) : 0;
    
    await query(
      "UPDATE mass_trade_participants SET balance_after = $1, pnl_amount = $2 WHERE mass_trade_id = $3 AND user_id = $4",
      [newBalance, pnl, trade.mass_trade_id, trade.user_id]
    );

    // Save to trades_history
    await query(`
      INSERT INTO trades_history (user_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'mass_trade')
    `, [
      trade.user_id, trade.symbol, trade.direction,
      trade.entry_price, currentPrice, trade.lot_size, pnl,
      elapsed, trade.opened_at
    ]);

    // Log operation
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
      [trade.user_id, pnl, `Mass trade closed: ${pnl >= 0 ? 'Profit' : 'Loss'}`]
    );

    // Referral commission (5% from profit)
    if (pnl > 0) {
      try { await processReferralCommission(trade.user_id, pnl); } catch (e) {}
      try { await processAgentCommission(trade.user_id, pnl); } catch (e) {}
    }

    // Send notification
    const u = await query("SELECT tg_id, balance FROM users WHERE id=$1", [trade.user_id]);
    if (u.rows.length) {
      try {
        await bot.sendMessage(
          u.rows[0].tg_id,
          `🔔 *تم إغلاق الصفقة*\n${pnl >= 0 ? "🟢 ربح" : "🔴 خسارة"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}\n💰 الرصيد: $${Number(u.rows[0].balance).toFixed(2)}\n\n🔔 *Trade Closed*\n${pnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}\n💰 Balance: $${Number(u.rows[0].balance).toFixed(2)}`,
          { parse_mode: "Markdown" }
        );
      } catch (msgErr) {
        console.error("Failed to send mass trade notification:", msgErr.message);
      }
    }

    // Check if all user trades for this mass trade are closed
    const openCount = await query(
      "SELECT COUNT(*) as count FROM mass_trade_user_trades WHERE mass_trade_id = $1 AND status = 'open'",
      [trade.mass_trade_id]
    );

    if (Number(openCount.rows[0].count) === 0) {
      await query(
        "UPDATE mass_trades SET status = 'closed', closed_at = NOW() WHERE id = $1 AND status = 'open'",
        [trade.mass_trade_id]
      );
      console.log(`✅ Mass trade #${trade.mass_trade_id} fully closed (all user trades done)`);
    }
  } catch (err) {
    console.error("Close mass trade user trade error:", err.message);
  }
}

/* =========================
   DAILY SCHEDULER
   Creates 3 pending mass trades daily at startup
========================= */

async function createDailyScheduledTrades() {
  try {
    const UTC_OFFSET = 3;
    const localNow = new Date(Date.now() + UTC_OFFSET * 60 * 60 * 1000);
    const today = localNow.toISOString().split('T')[0];
    const schedules = [
      { time: '14:00', note: 'صفقة الظهر | Afternoon Trade' },
      { time: '18:00', note: 'صفقة المساء | Evening Trade' },
      { time: '21:30', note: 'صفقة الليل | Night Trade' }
    ];

    for (const schedule of schedules) {
      const existing = await query(
        "SELECT id FROM mass_trades WHERE scheduled_date = $1 AND scheduled_time = $2 AND is_scheduled = TRUE",
        [today, schedule.time]
      );

      if (existing.rows.length === 0) {
        const entryPrice = 2650 + (Math.random() - 0.5) * 10;
        // FIX: Random direction - not always BUY
        const directions = ['BUY', 'SELL'];
        const direction = directions[Math.floor(Math.random() * 2)];
        const usersCount = await query("SELECT COUNT(*) as count FROM users WHERE is_banned = FALSE AND balance > 0");

        await query(
          `INSERT INTO mass_trades (symbol, direction, note, participants_count, status, scheduled_time, scheduled_date, duration_seconds, entry_price, is_scheduled)
           VALUES ('XAUUSD', $1, $2, $3, 'pending', $4, $5, 3600, $6, TRUE)`,
          [direction, schedule.note, usersCount.rows[0].count, schedule.time, today, entryPrice]
        );

        console.log(`📅 Created scheduled mass trade for ${today} at ${schedule.time}`);
      }
    }
  } catch (err) {
    console.error("Daily scheduler error:", err.message);
  }
}

/* =========================
   CHECK SCHEDULER (runs every minute)
========================= */

let lastScheduleCheck = '';

async function checkScheduler() {
  try {
    const UTC_OFFSET = 3;
    const localNow = new Date(Date.now() + UTC_OFFSET * 60 * 60 * 1000);
    const today = localNow.toISOString().split('T')[0];
    
    if (lastScheduleCheck === today) return;
    lastScheduleCheck = today;

    await createDailyScheduledTrades();
    console.log(`📅 Daily schedule check completed for ${today}`);
  } catch (err) {
    console.error("Scheduler check error:", err.message);
  }
}

/* =========================
   AUTO-ACTIVATE LOCK
========================= */
const activatingTrades = new Set();

/* =========================
   AUTO-ACTIVATE READY TRADES
========================= */

async function autoActivateReadyTrades() {
  try {
    const now = new Date();
    const UTC_OFFSET = 3;
    const localNow = new Date(now.getTime() + UTC_OFFSET * 60 * 60 * 1000);
    const today = localNow.toISOString().split('T')[0];
    const currentHour = localNow.getUTCHours();
    const currentMinute = localNow.getUTCMinutes();
    const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

    const readyTrades = await query(
      `SELECT * FROM mass_trades 
       WHERE scheduled_date = $1 
       AND status = 'ready' 
       AND scheduled_time IS NOT NULL 
       AND is_scheduled = TRUE`,
      [today]
    );

    for (const massTrade of readyTrades.rows) {
      const scheduledTime = massTrade.scheduled_time;
      const [schedHour, schedMin] = scheduledTime.split(':').map(Number);
      
      if (currentHour > schedHour || (currentHour === schedHour && currentMinute >= schedMin)) {
        if (activatingTrades.has(massTrade.id)) continue;
        
        console.log(`🚀 Auto-activating ready mass trade #${massTrade.id} (scheduled: ${scheduledTime}, now: ${currentTimeStr})`);
        activatingTrades.add(massTrade.id);
        
        try {
          await autoActivateMassTrade(massTrade);
        } catch (activateErr) {
          console.error(`Failed to auto-activate mass trade #${massTrade.id}:`, activateErr.message);
        } finally {
          activatingTrades.delete(massTrade.id);
        }
      }
    }
  } catch (err) {
    console.error("Auto-activate check error:", err.message);
  }
}

/* =========================
   AUTO-ACTIVATE A SINGLE MASS TRADE
   FIX: Direction is now truly random (BUY can lose, SELL can win)
========================= */
async function autoActivateMassTrade(massTrade) {
  const percentage = Number(massTrade.percentage);
  const durationSeconds = Number(massTrade.duration_seconds) || 3600;
  const entryPrice = Number(massTrade.entry_price) || (2650 + (Math.random() - 0.5) * 10);
  const mass_trade_id = massTrade.id;

  const updateResult = await query(
    "UPDATE mass_trades SET status = 'open', activated_at = NOW() WHERE id = $1 AND status = 'ready' RETURNING id",
    [mass_trade_id]
  );

  if (updateResult.rowCount === 0) {
    console.log(`Mass trade #${mass_trade_id} already activated, skipping duplicate activation.`);
    return;
  }

  const users = await query("SELECT * FROM users WHERE is_banned = FALSE AND balance > 0");
  let totalCreated = 0;

  for (const user of users.rows) {
    let appliedPercentage = percentage;
    try {
      const overrideResult = await query(
        "SELECT custom_percentage FROM mass_trade_overrides WHERE mass_trade_id = $1 AND user_id = $2",
        [mass_trade_id, user.id]
      );
      if (overrideResult.rows.length > 0) {
        appliedPercentage = Number(overrideResult.rows[0].custom_percentage);
      }
    } catch (e) {}

    const balanceBefore = Number(user.balance);
    const targetPnl = Number((balanceBefore * appliedPercentage / 100).toFixed(2));
    
    // FIX: Direction is random, NOT based on targetPnl sign
    // This fixes the bug where BUY always wins and SELL always loses
    const directions = ['BUY', 'SELL'];
    const direction = directions[Math.floor(Math.random() * 2)];

    await query(
      `INSERT INTO mass_trade_user_trades (mass_trade_id, user_id, symbol, direction, entry_price, current_price, lot_size, pnl, target_pnl, duration_seconds, status, opened_at)
       VALUES ($1, $2, $3, $4, $5, $5, 0.05, 0, $6, $7, 'open', NOW())
       ON CONFLICT (mass_trade_id, user_id) DO NOTHING`,
      [mass_trade_id, user.id, massTrade.symbol || 'XAUUSD', direction, entryPrice, targetPnl, durationSeconds]
    );

    try {
      await query(
        `INSERT INTO mass_trade_participants (mass_trade_id, user_id, balance_before, balance_after, pnl_amount, percentage_applied)
         VALUES ($1, $2, $3, $3, 0, $4)
         ON CONFLICT (mass_trade_id, user_id) DO NOTHING`,
        [mass_trade_id, user.id, balanceBefore, appliedPercentage]
      );
    } catch (e) {}

    if (user.tg_id) {
      try {
        await bot.sendMessage(Number(user.tg_id), `🚀 *البوت دخل صفقة جديدة!*

💹 *الرمز:* ${massTrade.symbol || 'XAUUSD'}
🔹 *الاتجاه:* ${direction}
⏱ *المدة:* ${Math.round(durationSeconds / 60)} دقيقة

👀 يمكنك المراقبة من خيار *صفقاتي*

---

🚀 *Bot entered a new trade!*
🔸 *Symbol:* ${massTrade.symbol || 'XAUUSD'}
📊 *Direction:* ${direction}
⏱ *Duration:* ${Math.round(durationSeconds / 60)} min

📱 Monitor from *My Trades*`, { parse_mode: "Markdown" });
      } catch (err) {}
    }

    totalCreated++;
  }

  await query("UPDATE mass_trades SET participants_count = $1 WHERE id = $2", [totalCreated, mass_trade_id]);
  console.log(`✅ Auto-activated mass trade #${mass_trade_id}: ${totalCreated} user trades created with ${percentage}%`);
}

/* =========================
   START ENGINE
========================= */
export const startTradingEngine = () => {
  // Regular trades update every 3 seconds
  setInterval(updateTrades, 3000);
  
  // Mass trade user trades update every 3 seconds
  setInterval(updateMassTradeUserTrades, 3000);
  
  // Custom trades update every 3 seconds
  setInterval(updateCustomTrades, 3000);
  
  // Check daily scheduler every 60 seconds
  setInterval(checkScheduler, 60000);
  
  // Check for ready trades to auto-activate every 30 seconds
  setInterval(autoActivateReadyTrades, 30000);
  
  // Check agent loyalty bonuses every 6 hours
  import('../controllers/agent.controller.js').then(({ checkLoyaltyBonuses }) => {
    setInterval(checkLoyaltyBonuses, 6 * 60 * 60 * 1000);
    checkLoyaltyBonuses();
  }).catch(() => {});
  
  // Run scheduler immediately on startup
  checkScheduler();
  autoActivateReadyTrades();
  
  console.log("🤖 Trading Engine Started (v5.0 - Random Direction + Speed Modes + Custom Trades + Referral Commission + Persistent Prices)");
};
