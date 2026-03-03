-- ============================================================
-- Migration v4.2 - Username, Country, Account Age
-- ============================================================

-- 1. Add tg_username column (Telegram @username)
ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_username TEXT DEFAULT NULL;

-- 2. Add country column for flag display
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT DEFAULT NULL;

-- 3. Index for username search
CREATE INDEX IF NOT EXISTS idx_users_tg_username ON users(tg_username);

-- Done
