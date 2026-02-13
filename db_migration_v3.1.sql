-- QL Trading AI v3.1 - Mass Trades Enhancement Migration
-- New features: Scheduled daily mass trades, pending status, per-user trades, extra trades for specific users
-- Safe to run multiple times (idempotent)

-- ============================================
-- 1. ADD NEW COLUMNS TO mass_trades TABLE
-- ============================================
DO $$
BEGIN
  -- Add scheduled_time column (e.g., '14:00', '18:00', '21:30')
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'mass_trades' AND column_name = 'scheduled_time'
  ) THEN
    ALTER TABLE mass_trades ADD COLUMN scheduled_time TEXT;
  END IF;

  -- Add scheduled_date column (the date this trade is scheduled for)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'mass_trades' AND column_name = 'scheduled_date'
  ) THEN
    ALTER TABLE mass_trades ADD COLUMN scheduled_date DATE;
  END IF;

  -- Add duration_seconds column (how long the trade stays "open" visually, default 1 hour)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'mass_trades' AND column_name = 'duration_seconds'
  ) THEN
    ALTER TABLE mass_trades ADD COLUMN duration_seconds INT DEFAULT 3600;
  END IF;

  -- Add entry_price column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'mass_trades' AND column_name = 'entry_price'
  ) THEN
    ALTER TABLE mass_trades ADD COLUMN entry_price NUMERIC(18,4) DEFAULT 0;
  END IF;

  -- Add is_scheduled column (true = auto-created by scheduler, false = manual)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'mass_trades' AND column_name = 'is_scheduled'
  ) THEN
    ALTER TABLE mass_trades ADD COLUMN is_scheduled BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add activated_at column (when admin sets the percentage and activates it)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'mass_trades' AND column_name = 'activated_at'
  ) THEN
    ALTER TABLE mass_trades ADD COLUMN activated_at TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================
-- 2. CREATE mass_trade_user_trades TABLE
-- This stores individual "visual" trades for each user in a mass trade
-- These appear in the user's "My Trades" section with live price movement
-- ============================================
CREATE TABLE IF NOT EXISTS mass_trade_user_trades (
  id SERIAL PRIMARY KEY,
  mass_trade_id INT REFERENCES mass_trades(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT DEFAULT 'XAUUSD',
  direction TEXT DEFAULT 'BUY',
  entry_price NUMERIC(18,4) DEFAULT 0,
  current_price NUMERIC(18,4) DEFAULT 0,
  lot_size NUMERIC(10,2) DEFAULT 0.05,
  pnl NUMERIC(18,2) DEFAULT 0,
  target_pnl NUMERIC(18,2) DEFAULT 0,
  status TEXT DEFAULT 'open',
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  UNIQUE(mass_trade_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mass_trade_user_trades_user ON mass_trade_user_trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_mass_trade_user_trades_mass ON mass_trade_user_trades(mass_trade_id);

-- ============================================
-- 3. CREATE mass_trade_extra_users TABLE
-- Admin can add specific users to get an extra daily trade
-- ============================================
CREATE TABLE IF NOT EXISTS mass_trade_extra_users (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  extra_trades_per_day INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_mass_trade_extra_users ON mass_trade_extra_users(user_id, is_active);

-- ============================================
-- 4. UPDATE mass_trades status values
-- New statuses: 'pending' (waiting for admin to set %), 'open' (active with live trades), 'closed' (done)
-- ============================================
-- No schema change needed, just documentation:
-- 'pending' = scheduled trade created, waiting for admin to add percentage
-- 'open' = admin activated it, user trades are live for 1 hour
-- 'closed' = trade duration ended, balances updated

-- ============================================
-- 5. ADD INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_mass_trades_scheduled ON mass_trades(scheduled_date, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_mass_trades_is_scheduled ON mass_trades(is_scheduled);
