-- QL Trading AI v3.0 - Migration Script
-- Run this if you already have v2.x database and need to upgrade to v3.0
-- Safe to run multiple times (idempotent)

-- ============================================
-- 1. ADD NEW COLUMNS TO USERS TABLE
-- ============================================

-- Using DO $$ block for compatibility with all PostgreSQL versions
DO $$
BEGIN
  -- Add ban_reason column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'ban_reason'
  ) THEN
    ALTER TABLE users ADD COLUMN ban_reason TEXT;
  END IF;

  -- Add banned_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'banned_at'
  ) THEN
    ALTER TABLE users ADD COLUMN banned_at TIMESTAMPTZ;
  END IF;

  -- Add referral_code column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'referral_code'
  ) THEN
    ALTER TABLE users ADD COLUMN referral_code TEXT;
  END IF;

  -- Add referral_earnings column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'referral_earnings'
  ) THEN
    ALTER TABLE users ADD COLUMN referral_earnings NUMERIC(18,2) DEFAULT 0;
  END IF;

  -- Add referred_by column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'referred_by'
  ) THEN
    ALTER TABLE users ADD COLUMN referred_by BIGINT;
  END IF;

  -- Add frozen_balance column (in case missing from older versions)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'frozen_balance'
  ) THEN
    ALTER TABLE users ADD COLUMN frozen_balance NUMERIC(18,2) DEFAULT 0;
  END IF;

  -- Add trading_locked column (in case missing)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'trading_locked'
  ) THEN
    ALTER TABLE users ADD COLUMN trading_locked BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add is_banned column (in case missing)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'is_banned'
  ) THEN
    ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add duration_seconds to trades (in case missing)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'duration_seconds'
  ) THEN
    ALTER TABLE trades ADD COLUMN duration_seconds INT DEFAULT 3600;
  END IF;

  -- Add target_pnl to trades (in case missing)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'target_pnl'
  ) THEN
    ALTER TABLE trades ADD COLUMN target_pnl NUMERIC(18,2) DEFAULT 0;
  END IF;
END $$;

-- Add unique index on referral_code (ignore if exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'users' AND indexname = 'users_referral_code_key'
  ) THEN
    CREATE UNIQUE INDEX users_referral_code_key ON users(referral_code) WHERE referral_code IS NOT NULL;
  END IF;
END $$;

-- ============================================
-- 2. CREATE NEW TABLES
-- ============================================

-- Referrals tracking table
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_tg_id BIGINT NOT NULL,
  referred_tg_id BIGINT NOT NULL,
  referred_name TEXT,
  bonus_amount NUMERIC(18,2) DEFAULT 0,
  deposit_amount NUMERIC(18,2) DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  credited_at TIMESTAMPTZ,
  UNIQUE(referred_tg_id)
);

-- Mass trades
CREATE TABLE IF NOT EXISTS mass_trades (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'open',
  symbol TEXT DEFAULT 'XAUUSD',
  direction TEXT DEFAULT 'BUY',
  percentage NUMERIC(10,4) DEFAULT 0,
  note TEXT,
  participants_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

-- Individual overrides for mass trades
CREATE TABLE IF NOT EXISTS mass_trade_overrides (
  id SERIAL PRIMARY KEY,
  mass_trade_id INT REFERENCES mass_trades(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  custom_percentage NUMERIC(10,4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mass_trade_id, user_id)
);

-- Mass trade participants log
CREATE TABLE IF NOT EXISTS mass_trade_participants (
  id SERIAL PRIMARY KEY,
  mass_trade_id INT REFERENCES mass_trades(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  balance_before NUMERIC(18,2),
  balance_after NUMERIC(18,2),
  pnl_amount NUMERIC(18,2),
  percentage_applied NUMERIC(10,4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mass_trade_id, user_id)
);

-- Trade history (create if not exists)
CREATE TABLE IF NOT EXISTS trades_history (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  trade_id INT,
  symbol TEXT,
  direction TEXT,
  entry_price NUMERIC(18,4),
  exit_price NUMERIC(18,4),
  lot_size NUMERIC(10,2),
  pnl NUMERIC(18,2),
  duration_seconds INT,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  close_reason TEXT
);

-- Deposit logs (create if not exists)
CREATE TABLE IF NOT EXISTS deposit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(18,2) NOT NULL,
  method TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System messages (create if not exists)
CREATE TABLE IF NOT EXISTS system_messages (
  id SERIAL PRIMARY KEY,
  title TEXT,
  message TEXT NOT NULL,
  target_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. CREATE INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_tg_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_tg_id);
CREATE INDEX IF NOT EXISTS idx_mass_trades_status ON mass_trades(status);
CREATE INDEX IF NOT EXISTS idx_mass_trade_participants ON mass_trade_participants(mass_trade_id);
CREATE INDEX IF NOT EXISTS idx_trades_history_user ON trades_history(user_id);
CREATE INDEX IF NOT EXISTS idx_system_messages_user ON system_messages(target_user_id);

-- ============================================
-- 4. ADD referred_name COLUMN TO referrals (if missing)
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'referrals' AND column_name = 'referred_name'
  ) THEN
    ALTER TABLE referrals ADD COLUMN referred_name TEXT;
  END IF;
END $$;
