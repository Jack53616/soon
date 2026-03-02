-- QL Trading AI v3.2 - Bug Fixes Migration
-- Fixes: Trade duplication, auto-activation timing issues
-- Safe to run multiple times (idempotent)

-- ============================================
-- 1. ADD UNIQUE CONSTRAINT TO mass_trade_user_trades
-- Prevents duplicate user trades for the same mass trade
-- (Already exists in v3.1, but ensure it's there)
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'mass_trade_user_trades_mass_trade_id_user_id_key'
  ) THEN
    ALTER TABLE mass_trade_user_trades 
    ADD CONSTRAINT mass_trade_user_trades_mass_trade_id_user_id_key 
    UNIQUE (mass_trade_id, user_id);
  END IF;
END $$;

-- ============================================
-- 2. ADD UNIQUE CONSTRAINT TO mass_trade_participants
-- Prevents duplicate participant records
-- (Already exists in v3.0, but ensure it's there)
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'mass_trade_participants_mass_trade_id_user_id_key'
  ) THEN
    ALTER TABLE mass_trade_participants 
    ADD CONSTRAINT mass_trade_participants_mass_trade_id_user_id_key 
    UNIQUE (mass_trade_id, user_id);
  END IF;
END $$;

-- ============================================
-- 3. ADD 'ready' STATUS SUPPORT TO mass_trades
-- The 'ready' status means: percentage is set, waiting for scheduled time
-- ============================================
-- No schema change needed - status is TEXT field, already supports 'ready'
-- Just documentation:
-- 'pending' = created, waiting for admin to set percentage
-- 'ready'   = percentage set by admin, waiting for scheduled time to auto-activate
-- 'open'    = activated, user trades are live
-- 'closed'  = all user trades done, balances updated

-- ============================================
-- 4. ADD INDEX FOR FASTER READY TRADE LOOKUPS
-- Used by auto-activation scheduler
-- ============================================
CREATE INDEX IF NOT EXISTS idx_mass_trades_ready_scheduled 
ON mass_trades(status, scheduled_date, scheduled_time) 
WHERE status = 'ready';

-- ============================================
-- 5. ADD INDEX FOR FASTER OPEN TRADE LOOKUPS
-- Used by trading engine
-- ============================================
CREATE INDEX IF NOT EXISTS idx_mass_trade_user_trades_open 
ON mass_trade_user_trades(status, opened_at) 
WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_trades_open 
ON trades(status, opened_at) 
WHERE status = 'open';

-- ============================================
-- 6. FIX: Remove any duplicate mass_trade_user_trades that may exist
-- Keep only the most recent one per (mass_trade_id, user_id)
-- ============================================
DELETE FROM mass_trade_user_trades
WHERE id NOT IN (
  SELECT DISTINCT ON (mass_trade_id, user_id) id
  FROM mass_trade_user_trades
  ORDER BY mass_trade_id, user_id, opened_at DESC
);

-- ============================================
-- 7. FIX: Remove any duplicate mass_trade_participants that may exist
-- Keep only the most recent one per (mass_trade_id, user_id)
-- ============================================
DELETE FROM mass_trade_participants
WHERE id NOT IN (
  SELECT DISTINCT ON (mass_trade_id, user_id) id
  FROM mass_trade_participants
  ORDER BY mass_trade_id, user_id, created_at DESC
);

-- ============================================
-- 8. ADD withdrawal_enabled default setting if missing
-- ============================================
INSERT INTO settings (key, value) VALUES ('withdrawal_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES ('maintenance_mode', 'false')
ON CONFLICT (key) DO NOTHING;

-- Done!
SELECT 'Migration v3.2 completed successfully' as status;
