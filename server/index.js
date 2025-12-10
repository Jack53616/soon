import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { securityHeaders, apiLimiter } from "./config/security.js";
import pool from "./config/db.js";

// Routes
import authRoutes from "./routes/auth.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import tradesRoutes from "./routes/trades.routes.js";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import marketsRoutes from "./routes/markets.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import leaderboardRoutes from "./routes/leaderboard.routes.js";

// Bot
import bot from "./bot/bot.js";

// Services
import { startTradingEngine } from "./services/tradingEngine.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// CRITICAL: Enable trust proxy for Render
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(securityHeaders);

// Serve static files
app.use(express.static(path.join(__dirname, "../client")));
app.use("/public", express.static(path.join(__dirname, "../public")));

// Health check (no rate limit)
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "running", timestamp: new Date().toISOString() });
});

// Keep-alive endpoint for Render (prevents sleeping)
app.get("/ping", (req, res) => {
  res.json({ ok: true, pong: Date.now() });
});

// API Routes (with rate limiting)
app.use("/api", apiLimiter);
app.use("/api", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/trades", tradesRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/markets", marketsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/leaderboard", leaderboardRoutes);

// Telegram Webhook
app.post(`/webhook/${process.env.BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🟢 QL Trading AI Server started on port ${PORT}`);
  console.log(`📅 ${new Date().toISOString()}`);
  
  // Set webhook (disable polling to avoid conflicts)
  if (process.env.WEBHOOK_URL && process.env.BOT_TOKEN) {
    const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/${process.env.BOT_TOKEN}`;
    try {
      // Delete any existing webhook first
      await bot.deleteWebHook({ drop_pending_updates: true });
      console.log('✅ Cleared old webhook');
      
      // Set new webhook
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Telegram webhook set to: ${webhookUrl}`);
    } catch (error) {
      console.error("❌ Failed to set webhook:", error.message);
    }
  }

  // Start trading engine
  startTradingEngine();
  console.log("🤖 Trading engine started with real Binance prices");
  
  // Start keep-alive service for Render
  startKeepAlive();
});

// Keep-alive service to prevent Render from sleeping
function startKeepAlive() {
  if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
    setInterval(async () => {
      try {
        const response = await fetch(`${process.env.WEBHOOK_URL}/ping`);
        if (response.ok) {
          console.log('✅ Keep-alive ping successful');
        }
      } catch (error) {
        console.log('⚠️ Keep-alive ping failed:', error.message);
      }
    }, 14 * 60 * 1000); // Ping every 14 minutes (Render free tier sleeps after 15 min)
    
    console.log('🔄 Keep-alive service started (14 min intervals)');
  }
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  pool.end(() => {
    console.log("Database pool closed");
    process.exit(0);
  });
});