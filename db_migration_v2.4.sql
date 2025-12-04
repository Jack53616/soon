-- QL Trading AI v2.4 - Database Migration
-- Fix missing columns and optimize performance

-- 1. Add missing wins and losses columns to users table
DO $$ 
BEGIN
  -- Add wins column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'wins'
  ) THEN
    ALTER TABLE users ADD COLUMN wins NUMERIC(18,2) DEFAULT 0;
    RAISE NOTICE 'Added wins column to users table';
  END IF;
  
  -- Add losses column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'losses'
  ) THEN
    ALTER TABLE users ADD COLUMN losses NUMERIC(18,2) DEFAULT 0;
    RAISE NOTICE 'Added losses column to users table';
  END IF;
END $$;

-- 2. Optimize indexes for better performance
CREATE INDEX IF NOT EXISTS idx_trades_status_opened ON trades(status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_targets_active_user ON daily_targets(active, user_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ops_created ON ops(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_history_closed ON trades_history(closed_at DESC);

-- 3. Add composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trades_user_status_opened ON trades(user_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status_created ON requests(status, created_at DESC);

-- 4. Update existing users to have default values
UPDATE users SET wins = 0 WHERE wins IS NULL;
UPDATE users SET losses = 0 WHERE losses IS NULL;

-- 5. Analyze tables for query optimization
ANALYZE users;
ANALYZE trades;
ANALYZE trades_history;
ANALYZE ops;
ANALYZE daily_targets;

-- Migration completed successfully