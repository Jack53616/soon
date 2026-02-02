import { query } from "../config/db.js";
import bot from "../bot/bot.js";

/* =========================
   PRICE SOURCES & CACHES
========================= */

// Gold
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]',
      { signal: controller.signal }
    );

    clearTimeout(timeout);

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
  try {
    const lp = Number(lastPrice) || 2650;

    if (symbol === "XAUUSD") {
      if (Math.random() < 0.1) {
        return Number(await getRealGoldPrice());
      }
      const change = lp * (Math.random() - 0.5) * 0.005;
      return Number((lp + change).toFixed(4));
    }

    if (symbol === "XAGUSD") {
      const change = lp * (Math.random() - 0.5) * 0.008;
      return Number((lp + change).toFixed(4));
    }

    if (symbol === "BTCUSDT" || symbol === "ETHUSDT") {
      const prices = await getCryptoPrices();
      return Number(prices[symbol] || lp);
    }

    const change = lp * (Math.random() - 0.5) * 0.01;
    return Number((lp + change).toFixed(4));
  } catch {
    return Number(lastPrice) || 2650;
  }
};

/* =========================
   TRADES ENGINE
========================= */

const updateTrades = async () => {
  try {
    const res = await query(
      "SELECT * FROM trades WHERE status='open' ORDER BY opened_at DESC LIMIT 100"
    );

    if (!res.rows.length) return;

    const updates = [];
    const closures = [];

    for (const trade of res.rows) {
      try {
        const lastPrice = Number(trade.current_price || trade.entry_price || 2650);
        const currentPrice = await generatePrice(trade.symbol, lastPrice);

        const entryPrice = Number(trade.entry_price);
        const lotSize = Number(trade.lot_size);

        const duration = Number(trade.duration_seconds) || 3600;
        const elapsed = Math.floor((Date.now() - new Date(trade.opened_at)) / 1000);

        const targetPnl = Number(trade.target_pnl || 0);

        let pnl = 0;

        // 🎯 SMART TARGET MODE
        if (targetPnl !== 0) {
          const progress = Math.min(elapsed / duration, 1);
          const basePnl = targetPnl * progress;

          const volatility =
            Math.sin(progress * Math.PI) * Math.abs(targetPnl) * 0.3;
          const noise = (Math.random() - 0.5) * 2 * volatility;

          pnl = basePnl + noise;

          if (progress >= 0.99) pnl = targetPnl;
        } else {
          // 📈 NORMAL MODE
          if (trade.direction === "BUY") {
            pnl = (currentPrice - entryPrice) * lotSize * 100;
          } else {
            pnl = (entryPrice - currentPrice) * lotSize * 100;
          }
        }

        // 🛡️ PNL SAFETY FIX (IMPORTANT)
        pnl = Number(pnl);
        if (isNaN(pnl) || !isFinite(pnl)) pnl = 0;
        pnl = Number(pnl.toFixed(2));

        updates.push({
          id: trade.id,
          currentPrice,
          pnl
        });

        // ❌ DO NOT FORCE CLOSE – SYSTEM DECIDES
        let shouldClose = false;
        let closeReason = null;

        if (targetPnl > 0 && pnl >= targetPnl) {
          shouldClose = true;
          closeReason = "target";
        } else if (targetPnl < 0 && pnl <= targetPnl) {
          shouldClose = true;
          closeReason = "target";
        } else if (elapsed >= duration) {
          shouldClose = true;
          closeReason = "duration";
        }

        if (shouldClose) {
          closures.push({ trade, currentPrice, pnl, closeReason, elapsed });
        }
      } catch (e) {
        console.error(`Trade ${trade.id} error:`, e.message);
      }
    }

    // 🔄 APPLY UPDATES
    for (const u of updates) {
      await query(
        "UPDATE trades SET current_price=$1, pnl=$2 WHERE id=$3",
        [u.currentPrice, u.pnl, u.id]
      );
    }

    // 🔒 CLOSE TRADES
    for (const c of closures) {
      await closeTrade(c);
    }

  } catch (e) {
    console.error("Trading engine fatal:", e.message);
  }
};

/* =========================
   CLOSE TRADE
========================= */

async function closeTrade({ trade, currentPrice, pnl, closeReason, elapsed }) {
  try {
    await query(
      "UPDATE trades SET status='closed', closed_at=NOW(), close_reason=$1 WHERE id=$2",
      [closeReason, trade.id]
    );

    await query(
      "UPDATE users SET balance = balance + $1 WHERE id=$2",
      [pnl, trade.user_id]
    );

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

    await query(
      "INSERT INTO ops (user_id,type,amount,note) VALUES ($1,'pnl',$2,$3)",
      [trade.user_id, pnl, `Trade closed by ${closeReason}`]
    );

    const u = await query(
      "SELECT tg_id,balance,wins,losses FROM users WHERE id=$1",
      [trade.user_id]
    );

    if (u.rows.length) {
      const user = u.rows[0];
      const net = Number(user.wins || 0) - Number(user.losses || 0);

      await bot.sendMessage(
        user.tg_id,
        `🔔 Trade Closed
${pnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}
💰 Balance: $${Number(user.balance).toFixed(2)}
📊 Net: ${net >= 0 ? "+" : ""}$${net.toFixed(2)}`
      );
    }

    console.log(`✅ Trade #${trade.id} closed (${closeReason})`);
  } catch (e) {
    console.error("Close trade error:", e.message);
  }
}

/* =========================
   ENGINE START
========================= */

export const startTradingEngine = () => {
  setInterval(updateTrades, 3000);
  console.log("🤖 Trading Engine Started (SMART MODE)");
};
