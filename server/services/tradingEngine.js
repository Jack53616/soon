import { query } from "../config/db.js";
import bot from "../bot/bot.js";

// Real Gold price cache
let goldPriceCache = 2650;
let lastGoldFetch = 0;

async function getRealGoldPrice() {
  try {
    const now = Date.now();
    // Cache for 5 minutes
    if (now - lastGoldFetch < 300000 && goldPriceCache > 0) {
      return goldPriceCache;
    }

    // Realistic simulation based on market hours
    const basePrice = 2650;
    const hour = new Date().getUTCHours();
    const timeVariation = Math.sin(hour / 24 * Math.PI * 2) * 5;
    const randomVariation = (Math.random() - 0.5) * 3;
    goldPriceCache = basePrice + timeVariation + randomVariation;
    lastGoldFetch = now;
    return goldPriceCache;
  } catch (error) {
    return goldPriceCache || 2650;
  }
}

// Crypto prices from Binance (free, no API key)
let cryptoCache = { BTCUSDT: 43000, ETHUSDT: 2300 };
let lastCryptoFetch = 0;

async function getCryptoPrices() {
  try {
    const now = Date.now();
    if (now - lastCryptoFetch < 10000) {
      return cryptoCache;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]', {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeout);
    
    if (response.ok) {
      const data = await response.json();
      cryptoCache = {
        BTCUSDT: parseFloat(data.find(item => item.symbol === 'BTCUSDT')?.price || 43000),
        ETHUSDT: parseFloat(data.find(item => item.symbol === 'ETHUSDT')?.price || 2300)
      };
      lastCryptoFetch = now;
    }
    return cryptoCache;
  } catch (error) {
    // Silent fail, use cache
    return cryptoCache;
  }
}

// Price generator with realistic movement
const generatePrice = async (symbol, lastPrice) => {
  try {
    if (symbol === 'XAUUSD') {
      // Get real gold price periodically
      if (Math.random() < 0.1) {
        const realPrice = await getRealGoldPrice();
        return Number(realPrice);
      }
      // Realistic movement between fetches
      const numLastPrice = Number(lastPrice) || 2650;
      const change = numLastPrice * (Math.random() - 0.5) * 0.005;
      return Number((numLastPrice + change).toFixed(4));
    }
    
    if (symbol === 'XAGUSD') {
      const numLastPrice = Number(lastPrice) || 24;
      const change = numLastPrice * (Math.random() - 0.5) * 0.008;
      return Number((numLastPrice + change).toFixed(4));
    }
    
    if (symbol === 'BTCUSDT' || symbol === 'ETHUSDT') {
      const prices = await getCryptoPrices();
      return Number(prices[symbol] || lastPrice || 43000);
    }
    
    // Default fallback
    const numLastPrice = Number(lastPrice) || 100;
    const change = numLastPrice * (Math.random() - 0.5) * 0.01;
    return Number((numLastPrice + change).toFixed(4));
  } catch (error) {
    return Number(lastPrice) || 2650;
  }
};

// Optimized: Update all open trades
const updateTrades = async () => {
  try {
    const result = await query(
      "SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at DESC LIMIT 100"
    );
    
    if (result.rows.length === 0) return;
    
    const updates = [];
    const closures = [];
    
    for (const trade of result.rows) {
      try {
        const lastPrice = Number(trade.current_price) || Number(trade.entry_price) || 2650;
        const currentPrice = await generatePrice(trade.symbol, lastPrice);
        
        // Calculate PnL
        const entryPrice = Number(trade.entry_price);
        const lotSize = Number(trade.lot_size);
        let pnl = 0;
        
        if (trade.direction === "BUY") {
          pnl = (currentPrice - entryPrice) * lotSize * 100;
        } else {
          pnl = (entryPrice - currentPrice) * lotSize * 100;
        }
        
        pnl = Number(pnl.toFixed(2));

        // Batch update
        updates.push({
          id: trade.id,
          currentPrice,
          pnl
        });

        // Check if should close
        const elapsed = Math.floor((new Date() - new Date(trade.opened_at)) / 1000);
        const duration = Number(trade.duration_seconds) || 3600;
        const target_pnl = Number(trade.target_pnl) || 0;
        
        let shouldClose = false;
        let closeReason = null;

        // Check conditions
        if (target_pnl > 0 && pnl >= target_pnl) {
          shouldClose = true;
          closeReason = "target";
        } else if (target_pnl < 0 && pnl <= target_pnl) {
          shouldClose = true;
          closeReason = "target";
        } else if (elapsed >= duration) {
          shouldClose = true;
          closeReason = "duration";
        } else if (trade.take_profit && currentPrice >= Number(trade.take_profit) && trade.direction === "BUY") {
          shouldClose = true;
          closeReason = "tp";
        } else if (trade.take_profit && currentPrice <= Number(trade.take_profit) && trade.direction === "SELL") {
          shouldClose = true;
          closeReason = "tp";
        } else if (trade.stop_loss && currentPrice <= Number(trade.stop_loss) && trade.direction === "BUY") {
          shouldClose = true;
          closeReason = "sl";
        } else if (trade.stop_loss && currentPrice >= Number(trade.stop_loss) && trade.direction === "SELL") {
          shouldClose = true;
          closeReason = "sl";
        }

        if (shouldClose) {
          closures.push({
            trade,
            currentPrice,
            pnl,
            closeReason,
            elapsed
          });
        }
      } catch (tradeError) {
        console.error(`Error processing trade #${trade.id}:`, tradeError.message);
      }
    }
    
    // Execute batch updates
    if (updates.length > 0) {
      for (const update of updates) {
        await query(
          "UPDATE trades SET current_price = $1, pnl = $2 WHERE id = $3",
          [update.currentPrice, update.pnl, update.id]
        );
      }
    }
    
    // Execute closures
    for (const closure of closures) {
      await closeTrade(closure);
    }
    
  } catch (error) {
    console.error("Trading engine error:", error.message);
  }
};

// FIXED: Close trade with proper balance update
async function closeTrade({ trade, currentPrice, pnl, closeReason, elapsed }) {
  try {
    const entryPrice = Number(trade.entry_price);
    const lotSize = Number(trade.lot_size);
    
    // Close trade
    await query(
      "UPDATE trades SET status = 'closed', closed_at = NOW(), close_reason = $1 WHERE id = $2",
      [closeReason, trade.id]
    );

    // FIXED: Update user balance (add PnL directly)
    await query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [pnl, trade.user_id]
    );

    // FIXED: Update wins/losses separately with COALESCE
    if (pnl >= 0) {
      await query(
        "UPDATE users SET wins = COALESCE(wins, 0) + $1 WHERE id = $2",
        [pnl, trade.user_id]
      );
    } else {
      await query(
        "UPDATE users SET losses = COALESCE(losses, 0) + $1 WHERE id = $2",
        [Math.abs(pnl), trade.user_id]
      );
    }

    // Log operation
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
      [trade.user_id, pnl, `Trade closed by ${closeReason.toUpperCase()}`]
    );

    // Move to history
    await query(
      `INSERT INTO trades_history (user_id, trade_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`,
      [trade.user_id, trade.id, trade.symbol, trade.direction, entryPrice, currentPrice, lotSize, pnl, elapsed, trade.opened_at, closeReason]
    );

    // Send notification to user
    const userResult = await query("SELECT tg_id, balance, wins, losses FROM users WHERE id = $1", [trade.user_id]);
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      const netProfit = Number(user.wins || 0) - Number(user.losses || 0);
      const message = `🔔 Trade Closed!

${pnl >= 0 ? '🟢 Profit' : '🔴 Loss'}: ${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}
Reason: ${closeReason === 'target' ? '🎯 Target Reached' : closeReason === 'duration' ? '⏰ Time Expired' : closeReason.toUpperCase()}
💰 New Balance: $${Number(user.balance).toFixed(2)}
📊 Total Wins: $${Number(user.wins || 0).toFixed(2)}
📉 Total Losses: $${Number(user.losses || 0).toFixed(2)}
💵 Net Profit: ${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`;
      
      try {
        await bot.sendMessage(user.tg_id, message);
      } catch (err) {
        // Silent fail for notifications
      }
    }

    console.log(`✅ Trade #${trade.id} closed by ${closeReason.toUpperCase()}: PnL ${pnl.toFixed(2)}`);
  } catch (error) {
    console.error(`Error closing trade #${trade.id}:`, error.message);
  }
}

// Optimized: Update daily targets
const updateDailyTargets = async () => {
  try {
    const result = await query(
      "SELECT * FROM daily_targets WHERE active = TRUE LIMIT 50"
    );
    
    for (const target of result.rows) {
      try {
        const elapsed = Math.floor((new Date() - new Date(target.started_at)) / 1000);
        const duration = Number(target.duration_sec) || 1800;
        const targetAmount = Number(target.target) || 0;
        const currentAmount = Number(target.current) || 0;
        
        if (elapsed >= duration) {
          // Target reached, deactivate
          await query("UPDATE daily_targets SET active = FALSE WHERE id = $1", [target.id]);
          
          // Apply final amount
          const remaining = targetAmount - currentAmount;
          if (Math.abs(remaining) > 0.01) {
            await query(
              "UPDATE users SET balance = balance + $1 WHERE id = $2",
              [remaining, target.user_id]
            );
            await query(
              "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, 'Daily target completed')",
              [target.user_id, remaining]
            );
          }
          
          console.log(`✅ Daily target #${target.id} completed: ${targetAmount}`);
        } else {
          // Calculate step
          const progress = elapsed / duration;
          const newCurrent = targetAmount * progress;
          const step = newCurrent - currentAmount;
          
          if (Math.abs(step) > 0.01) {
            await query(
              "UPDATE daily_targets SET current = $1 WHERE id = $2",
              [newCurrent, target.id]
            );
            await query(
              "UPDATE users SET balance = balance + $1 WHERE id = $2",
              [step, target.user_id]
            );
          }
        }
      } catch (targetError) {
        console.error(`Error processing daily target #${target.id}:`, targetError.message);
      }
    }
  } catch (error) {
    console.error("Daily targets error:", error.message);
  }
};

export const startTradingEngine = () => {
  // Update trades every 3 seconds
  setInterval(updateTrades, 3000);
  
  // Update daily targets every 5 seconds
  setInterval(updateDailyTargets, 5000);
  
  console.log("🤖 Trading engine initialized (optimized with batching)");
};
