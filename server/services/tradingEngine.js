import { query } from "../config/db.js";
import bot from "../bot/bot.js";

/* ==============================
   PRICE SIMULATION (كما هو)
============================== */

let goldPriceCache = 2650;
let lastGoldFetch = 0;

async function getRealGoldPrice() {
  const now = Date.now();
  if (now - lastGoldFetch < 300000 && goldPriceCache > 0) {
    return goldPriceCache;
  }

  const basePrice = 2650;
  const hour = new Date().getUTCHours();
  const timeVariation = Math.sin(hour / 24 * Math.PI * 2) * 5;
  const randomVariation = (Math.random() - 0.5) * 3;

  goldPriceCache = basePrice + timeVariation + randomVariation;
  lastGoldFetch = now;
  return goldPriceCache;
}

let cryptoCache = { BTCUSDT: 43000, ETHUSDT: 2300 };
let lastCryptoFetch = 0;

async function getCryptoPrices() {
  const now = Date.now();
  if (now - lastCryptoFetch < 10000) return cryptoCache;

  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]'
    );
    const data = await res.json();
    cryptoCache = {
      BTCUSDT: Number(data.find(x => x.symbol === "BTCUSDT")?.price || 43000),
      ETHUSDT: Number(data.find(x => x.symbol === "ETHUSDT")?.price || 2300)
    };
    lastCryptoFetch = now;
  } catch {}
  return cryptoCache;
}

async function generatePrice(symbol, lastPrice) {
  if (symbol === "XAUUSD") {
    if (Math.random() < 0.1) return await getRealGoldPrice();
    const change = lastPrice * (Math.random() - 0.5) * 0.003;
    return Number((lastPrice + change).toFixed(4));
  }

  if (symbol === "BTCUSDT" || symbol === "ETHUSDT") {
    const prices = await getCryptoPrices();
    return prices[symbol];
  }

  const change = lastPrice * (Math.random() - 0.5) * 0.005;
  return Number((lastPrice + change).toFixed(4));
}

/* ==============================
   SMART PnL ENGINE (جديد)
============================== */

function calcSmartPnL({ elapsed, duration, targetPnl, amount, lastPnl }) {
  const progress = Math.min(elapsed / duration, 1);

  // مرحلة الضباب
  if (progress < 0.25) {
    const noise = (Math.random() - 0.5) * amount * 0.01;
    return (lastPnl || 0) + noise;
  }

  // منتصف الصفقة
  if (progress < 0.85) {
    let volatility = 0.015;
    if (targetPnl < 0 && progress < 0.35) volatility = 0.03;

    const trend = targetPnl * progress * 0.6;
    const noise = (Math.random() - 0.5) * amount * volatility;
    return trend + noise;
  }

  // نهاية الصفقة
  return targetPnl * progress;
}

/* ==============================
   UPDATE TRADES
============================== */

const updateTrades = async () => {
  const { rows: trades } = await query(
    "SELECT * FROM trades WHERE status='open' ORDER BY opened_at DESC LIMIT 100"
  );

  for (const trade of trades) {
    const lastPrice = Number(trade.current_price || trade.entry_price);
    const currentPrice = await generatePrice(trade.symbol, lastPrice);

    const elapsed = Math.floor((Date.now() - new Date(trade.opened_at)) / 1000);
    const duration = Number(trade.duration_seconds) || 3600;

    // 🔒 تصحيح اللوت للحسابات الصغيرة
    let lotSize = Number(trade.lot_size);
    if (lotSize >= 1) lotSize = 0.05;

    let pnl = 0;

    if (trade.target_pnl !== 0) {
      pnl = calcSmartPnL({
        elapsed,
        duration,
        targetPnl: Number(trade.target_pnl),
        amount: trade.amount,
        lastPnl: trade.pnl
      });
    } else {
      if (trade.direction === "BUY") {
        pnl = (currentPrice - trade.entry_price) * lotSize * 100;
      } else {
        pnl = (trade.entry_price - currentPrice) * lotSize * 100;
      }
    }

    pnl = Number(pnl.toFixed(2));

    await query(
      "UPDATE trades SET current_price=$1, pnl=$2 WHERE id=$3",
      [currentPrice, pnl, trade.id]
    );

    if (elapsed >= duration) {
      await closeTrade({ trade, currentPrice, pnl, closeReason: "duration", elapsed });
    }
  }
};

/* ==============================
   CLOSE TRADE (كما هو)
============================== */

async function closeTrade({ trade, currentPrice, pnl, closeReason, elapsed }) {
  await query(
    "UPDATE trades SET status='closed', closed_at=NOW(), close_reason=$1 WHERE id=$2",
    [closeReason, trade.id]
  );

  await query(
    "UPDATE users SET balance = balance + $1 WHERE id=$2",
    [pnl, trade.user_id]
  );

  await query(
    "INSERT INTO ops (user_id,type,amount,note) VALUES ($1,'pnl',$2,$3)",
    [trade.user_id, pnl, `Trade closed (${closeReason})`]
  );

  const { rows } = await query(
    "SELECT tg_id,balance FROM users WHERE id=$1",
    [trade.user_id]
  );

  if (rows[0]?.tg_id) {
    await bot.sendMessage(
      rows[0].tg_id,
      `🔔 Trade Closed\n${pnl >= 0 ? "🟢 Profit" : "🔴 Loss"}: $${Math.abs(pnl).toFixed(2)}`
    );
  }
}

/* ==============================
   START ENGINE
============================== */

export const startTradingEngine = () => {
  setInterval(updateTrades, 3000);
  console.log("🤖 Trading Engine Started (SMART MODE)");
};
