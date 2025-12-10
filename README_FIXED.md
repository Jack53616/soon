# QL Trading AI - Secured & Optimized Version

This version of the project has been patched to address critical security vulnerabilities and structural issues while maintaining the original simulation logic.

## 🛡️ Key Fixes Implemented

### 1. Security Hardening
- **Dependencies Updated:** Patched 7 critical vulnerabilities in `form-data`, `jws`, and other packages.
- **Secret Management:** Removed hardcoded secrets from `.env`. Added `.env.example` with secure placeholders.
- **Input Validation:** Added strict validation for all bot commands to prevent negative deposits and invalid durations.
- **Rate Limiting:** Implemented a 1-second rate limit per user on the Telegram bot to prevent spam attacks.

### 2. Code Quality & Structure
- **Cleanup:** Removed duplicate controller files and misplaced database scripts.
- **Organization:** Moved `bot.js` to `server/bot/` for better separation of concerns.
- **Bug Fixes:** Fixed logic for updating User Wins/Losses to ensure accurate financial reporting.

### 3. Stability
- **Error Handling:** Added try-catch blocks to all async operations to prevent server crashes.
- **Polling Fix:** Disabled polling mode when Webhook is active to avoid conflicts.

## 🚀 Setup Instructions

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   Copy `.env.example` to `.env` and fill in your details:
   ```bash
   cp .env.example .env
   nano .env
   ```
   *Make sure to use strong, random strings for `JWT_SECRET` and `ADMIN_TOKEN`.*

3. **Database Setup:**
   Ensure you have a PostgreSQL database running and configured in `.env`.
   ```bash
   psql -U user -d database -f db.sql
   ```

4. **Start the Server:**
   ```bash
   npm start
   ```

## ⚠️ Important Note on Simulation
The project continues to use a **simulated price engine** for Gold (XAUUSD) as requested. Prices are generated algorithmically based on time of day and random variations around a base price of $2650. This is intended for demonstration or testing purposes only.

## 📂 Project Structure
- `server/` - Backend logic (Express + Bot)
  - `bot/` - Telegram bot logic (Secured)
  - `config/` - Database and app configuration
  - `controllers/` - API controllers
  - `services/` - Trading engine (Simulation)
- `client/` - Frontend assets (Static)
