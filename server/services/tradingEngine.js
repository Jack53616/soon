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
   TRADING ENGINE
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

        const targetPnl = Number(trade.target_pnl || 0);

        // Lot size for calculations
        const visualLot = Math.min(Number(trade.lot_size || 0.05), 0.05);

        let pnl = 0;

        /* =========================
           PHASED SMART BEHAVIOR
        ========================= */

        // Phase 1: Small profit at start (0-20%)
        if (progress < 0.2) {
          pnl = Math.abs(targetPnl) * 0.03 * (1 + Math.random() * 0.5);
        }

        // Phase 2: Realistic fluctuation (20-85%)
        else if (progress < 0.85) {
          const base = Math.abs(targetPnl) * 0.05;
          const swing = Math.abs(targetPnl) * 0.25;
          const noise = (Math.random() - 0.5) * swing;
          
          // Gradually move towards target
          const targetDirection = targetPnl >= 0 ? 1 : -1;
          const progressBonus = progress * 0.3 * Math.abs(targetPnl) * targetDirection;
          
          pnl = base + noise + progressBonus;
          
          // Random sign flip for realism
          if (Math.random() < 0.3 && progress < 0.6) {
            pnl *= -0.5;
          }
        }

        // Phase 3: Final push (85-100%)
        else {
          const finalProgress = (progress - 0.85) / 0.15; // 0 to 1 in final phase
          const finalImpact = Math.abs(targetPnl) * (0.7 + finalProgress * 0.25);
          pnl = targetPnl >= 0 ? finalImpact : -finalImpact;
        }

        // Adjust by lot size
        pnl *= visualLot / 0.05;

        // Safety checks
        pnl = Number(pnl);
        if (!isFinite(pnl)) pnl = 0;
        pnl = Number(pnl.toFixed(2));

        await query(
          "UPDATE trades SET current_price=$1, pnl=$2 WHERE id=$3",
          [currentPrice, pnl, trade.id]
        );

        // Close trade when duration is reached
        if (elapsed >= duration) {
          // Use target PnL for final closing
          const finalPnl = Number(trade.target_pnl || pnl);
          await closeTrade({
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
   CLOSE TRADE
========================= */

async function closeTrade({ trade, currentPrice, pnl, closeReason, elapsed }) {
  try {
    // Update trade status
    await query(
      "UPDATE trades SET status='closed', closed_at=NOW(), close_reason=$1, pnl=$2 WHERE id=$3",
      [closeReason, pnl, trade.id]
    );

    // Update user balance
    await query(
      "UPDATE users SET balance = balance + $1 WHERE id=$2",
      [pnl, trade.user_id]
    );

    // Update wins/losses
    if (pnl >= 0) {
      await query(
        "UPDATE users SET wins = COALESCE(wins,0) + $1 WHERE id=$2",
        [pnl, trade.user_id]
      );
    } else {
      await query(
        "UPDATE users SET losses = COALESCE(losses,0) + $1 WHERE id=$2",
        [Math.abs(pnl), trade.user_id]
      );
    }

    // Save to trade history
    await query(`
      INSERT INTO trades_history (user_id, trade_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
    `, [
      trade.user_id,
      trade.id,
      trade.symbol,
      trade.direction,
      trade.entry_price,
      currentPrice,
      trade.lot_size,
      pnl,
      elapsed,
      trade.opened_at,
      closeReason
    ]);

    // Log operation
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
      [trade.user_id, pnl, `Trade #${trade.id} closed: ${pnl >= 0 ? 'Profit' : 'Loss'}`]
    );

    // Send notification
    const u = await query(
      "SELECT tg_id, balance FROM users WHERE id=$1",
      [trade.user_id]
    );

    if (u.rows.length) {
      try {
        await bot.sendMessage(
          u.rows[0].tg_id,
          `🔔 *Trade Closed*
${pnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}
💰 Balance: $${Number(u.rows[0].balance).toFixed(2)}`,
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
   START ENGINE
========================= */

export const startTradingEngine = () => {
  setInterval(updateTrades, 3000);
  console.log("🤖 Trading Engine Started (Enhanced Mode)");
};
