-- QL Trading AI v3.0 - Migration Script
-- Adds: Referral System, Ban System Enhancement, Mass Trades, Broadcast Fix

-- ============================================
-- 1. REFERRAL SYSTEM
-- ============================================

-- Add referral columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_earnings NUMERIC(18,2) DEFAULT 0;

-- Referrals tracking table
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_tg_id BIGINT NOT NULL,
  referred_tg_id BIGINT NOT NULL,
  bonus_amount NUMERIC(18,2) DEFAULT 0,
  deposit_amount NUMERIC(18,2) DEFAULT 0,
  status TEXT DEFAULT 'pending',  -- pending / credited / paid
  created_at TIMESTAMPTZ DEFAULT NOW(),
  credited_at TIMESTAMPTZ,
  UNIQUE(referred_tg_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_tg_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_tg_id);

-- ============================================
-- 2. BAN SYSTEM ENHANCEMENT
-- ============================================

-- Add ban reason column
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

-- ============================================
-- 3. MASS TRADES SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS mass_trades (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'open',  -- open / closed
  symbol TEXT DEFAULT 'XAUUSD',
  direction TEXT DEFAULT 'BUY',
  percentage NUMERIC(10,4) DEFAULT 0,  -- +5% or -3%
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

CREATE INDEX IF NOT EXISTS idx_mass_trades_status ON mass_trades(status);
CREATE INDEX IF NOT EXISTS idx_mass_trade_participants ON mass_trade_participants(mass_trade_id);
