import express from "express";

const router = express.Router();

// Cache for prices
let priceCache = {
  XAUUSD: 2650,
  XAGUSD: 24,
  BTCUSDT: 43000,
  ETHUSDT: 2300
};
let lastUpdate = 0;

// FIXED: Improved Binance API with better error handling
async function fetchCryptoPrices() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]',
      {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        }
      }
    );
    
    clearTimeout(timeout);
    
    if (response.ok) {
      const data = await response.json();
      return {
        BTCUSDT: parseFloat(data.find(item => item.symbol === 'BTCUSDT')?.price || 43000),
        ETHUSDT: parseFloat(data.find(item => item.symbol === 'ETHUSDT')?.price || 2300)
      };
    }
    
    return null;
  } catch (error) {
    console.log('Binance API temporary issue, using cache');
    return null;
  }
}

// Realistic Gold price simulation
function generateGoldPrice() {
  const basePrice = 2650;
  const hour = new Date().getUTCHours();
  
  // Market hours variation (London/NY sessions are more volatile)
  const isActiveHours = (hour >= 8 && hour <= 16) || (hour >= 13 && hour <= 21);
  const volatility = isActiveHours ? 0.008 : 0.003;
  
  // Time-based trend
  const timeVariation = Math.sin(hour / 24 * Math.PI * 2) * 5;
  
  // Random walk
  const randomVariation = (Math.random() - 0.5) * basePrice * volatility;
  
  return Number((basePrice + timeVariation + randomVariation).toFixed(2));
}

// Realistic Silver price simulation
function generateSilverPrice() {
  const basePrice = 24;
  const hour = new Date().getUTCHours();
  
  const isActiveHours = (hour >= 8 && hour <= 16) || (hour >= 13 && hour <= 21);
  const volatility = isActiveHours ? 0.01 : 0.005;
  
  const timeVariation = Math.sin(hour / 24 * Math.PI * 2) * 0.5;
  const randomVariation = (Math.random() - 0.5) * basePrice * volatility;
  
  return Number((basePrice + timeVariation + randomVariation).toFixed(2));
}

// Check if market is closed (weekend)
function isMarketClosed() {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  
  // Weekend: Saturday (6) and Sunday (7) until 22:00 UTC
  if (day === 6 || (day === 0 && hour < 22)) {
    return true;
  }
  
  return false;
}

// Get all market prices
router.get("/", async (req, res) => {
  try {
    const now = Date.now();
    
    // Update cache every 3 seconds
    if (now - lastUpdate > 3000) {
      // Fetch crypto prices from Binance
      const cryptoPrices = await fetchCryptoPrices();
      
      if (cryptoPrices) {
        priceCache.BTCUSDT = cryptoPrices.BTCUSDT;
        priceCache.ETHUSDT = cryptoPrices.ETHUSDT;
      }
      
      // Generate realistic Gold and Silver prices
      priceCache.XAUUSD = generateGoldPrice();
      priceCache.XAGUSD = generateSilverPrice();
      
      lastUpdate = now;
    }
    
    res.json({
      ok: true,
      marketClosed: isMarketClosed(),
      data: priceCache,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Markets API error:", error.message);
    res.json({
      ok: true,
      marketClosed: false,
      data: priceCache, // Return cache on error
      timestamp: new Date().toISOString()
    });
  }
});

// Get specific symbol price
router.get("/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const now = Date.now();
    
    // Update if needed
    if (now - lastUpdate > 3000) {
      if (symbol === 'BTCUSDT' || symbol === 'ETHUSDT') {
        const cryptoPrices = await fetchCryptoPrices();
        if (cryptoPrices) {
          priceCache.BTCUSDT = cryptoPrices.BTCUSDT;
          priceCache.ETHUSDT = cryptoPrices.ETHUSDT;
        }
      } else if (symbol === 'XAUUSD') {
        priceCache.XAUUSD = generateGoldPrice();
      } else if (symbol === 'XAGUSD') {
        priceCache.XAGUSD = generateSilverPrice();
      }
      
      lastUpdate = now;
    }
    
    const price = priceCache[symbol];
    
    if (!price) {
      return res.status(404).json({ ok: false, error: "Symbol not found" });
    }
    
    res.json({
      ok: true,
      symbol,
      price,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Symbol price error:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;