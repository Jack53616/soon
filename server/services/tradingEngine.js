import { query } from "../config/db.js";
import bot from "../bot/bot.js";

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
   PRICE GENERATOR
========================= */

const generatePrice = async (symbol, lastPrice) => {
  const lp = Number(lastPrice) || 2650;

  if (symbol === "XAUUSD") {
    if (Math.random() < 0.1) return Number(await getRealGoldPrice());
    return Number((lp + lp * (Math.random() - 0.5) * 0.003).toFixed(4));
  }

  if (symbol === "XAGUSD") {
    return Number((lp + lp * (Math.random() - 0.5) * 0.006).toFixed(4));
  }

  if (symbol === "BTCUSDT" || symbol === "ETHUSDT") {
    const prices = await getCryptoPrices();
    return Number(prices[symbol] || lp);
  }

  return Number((lp + lp * (Math.random() - 0.5) * 0.01).toFixed(4));
};

/* =========================
   SMART PNL CALCULATOR
========================= */

function calculateSmartPnl(trade, progress) {
  const targetPnl = Number(trade.target_pnl || 0);
  const visualLot = Math.min(Number(trade.lot_size || 0.05), 0.05);
  let pnl = 0;

  // Phase 1: Small profit at start (0-20%)
  if (progress < 0.2) {
    pnl = Math.abs(targetPnl) * 0.03 * (1 + Math.random() * 0.5);
  }
  // Phase 2: Realistic fluctuation (20-85%)
  else if (progress < 0.85) {
    const base = Math.abs(targetPnl) * 0.05;
    const swing = Math.abs(targetPnl) * 0.25;
    const noise = (Math.random() - 0.5) * swing;
    const targetDirection = targetPnl >= 0 ? 1 : -1;
    const progressBonus = progress * 0.3 * Math.abs(targetPnl) * targetDirection;
    pnl = base + noise + progressBonus;
    if (Math.random() < 0.3 && progress < 0.6) {
      pnl *= -0.5;
    }
  }
  // Phase 3: Final push (85-100%)
  else {
    const finalProgress = (progress - 0.85) / 0.15;
    const finalImpact = Math.abs(targetPnl) * (0.7 + finalProgress * 0.25);
    pnl = targetPnl >= 0 ? finalImpact : -finalImpact;
  }

  // Adjust by lot size
  pnl *= visualLot / 0.05;

  // Safety checks
  pnl = Number(pnl);
  if (!isFinite(pnl)) pnl = 0;
  return Number(pnl.toFixed(2));
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
        const lastPrice = Number(trade.current_price || trade.entry_price);
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
        const lastPrice = Number(trade.current_price || trade.entry_price);
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
   CLOSE REGULAR TRADE
========================= */

async function closeRegularTrade({ trade, currentPrice, pnl, closeReason, elapsed }) {
  try {
    await query(
      "UPDATE trades SET status='closed', closed_at=NOW(), close_reason=$1, pnl=$2 WHERE id=$3",
      [closeReason, pnl, trade.id]
    );

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

    const u = await query("SELECT tg_id, balance FROM users WHERE id=$1", [trade.user_id]);
    if (u.rows.length) {
      try {
        await bot.sendMessage(
          u.rows[0].tg_id,
          `🔔 *Trade Closed*\n${pnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}\n💰 Balance: $${Number(u.rows[0].balance).toFixed(2)}`,
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
    // Close the user trade
    await query(
      "UPDATE mass_trade_user_trades SET status='closed', closed_at=NOW(), close_reason='duration', pnl=$1, current_price=$2 WHERE id=$3",
      [pnl, currentPrice, trade.id]
    );

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
      // All user trades closed, close the mass trade itself
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
    const today = new Date().toISOString().split('T')[0];
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
   Creates daily trades if they don't exist yet
========================= */

let lastScheduleCheck = '';

async function checkScheduler() {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Only check once per day
    if (lastScheduleCheck === today) return;
    lastScheduleCheck = today;

    await createDailyScheduledTrades();
    console.log(`📅 Daily schedule check completed for ${today}`);
  } catch (err) {
    console.error("Scheduler check error:", err.message);
  }
}

/* =========================
   START ENGINE
========================= */

export const startTradingEngine = () => {
  // Regular trades update every 3 seconds
  setInterval(updateTrades, 3000);
  
  // Mass trade user trades update every 3 seconds
  setInterval(updateMassTradeUserTrades, 3000);
  
  // Check daily scheduler every 60 seconds
  setInterval(checkScheduler, 60000);
  
  // Run scheduler immediately on startup
  checkScheduler();
  
  console.log("🤖 Trading Engine Started (Enhanced Mode v3.1 with Mass Trades)");
};
