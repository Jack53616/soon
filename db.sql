-- QL Trading AI v3.0 - Complete Database Schema
-- Includes: Referral System, Ban Enhancement, Mass Trades

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT UNIQUE,
  name TEXT,
  email TEXT,
  balance NUMERIC(18,2) DEFAULT 0,
  frozen_balance NUMERIC(18,2) DEFAULT 0,
  wins NUMERIC(18,2) DEFAULT 0,
  losses NUMERIC(18,2) DEFAULT 0,
  total_deposited NUMERIC(18,2) DEFAULT 0,
  total_withdrawn NUMERIC(18,2) DEFAULT 0,
  level TEXT DEFAULT 'Bronze',
  lang TEXT DEFAULT 'en',
  sub_expires TIMESTAMPTZ,
  is_banned BOOLEAN DEFAULT FALSE,
  ban_reason TEXT,
  banned_at TIMESTAMPTZ,
  trading_locked BOOLEAN DEFAULT FALSE,
  referral_code TEXT UNIQUE,
  referral_earnings NUMERIC(18,2) DEFAULT 0,
  referred_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscription keys
CREATE TABLE IF NOT EXISTS subscription_keys (
  id SERIAL PRIMARY KEY,
  key_code TEXT UNIQUE NOT NULL,
  days INT DEFAULT 30,
  used_by BIGINT,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions (optional JWT storage)
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Operations log (activity feed)
CREATE TABLE IF NOT EXISTS ops (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  type TEXT,           -- deposit / withdraw / pnl / open / close / admin / info / referral
  amount NUMERIC(18,2) DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Active trades (with duration_seconds and target_pnl)
CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT DEFAULT 'XAUUSD',
  direction TEXT DEFAULT 'BUY',
  entry_price NUMERIC(18,4) DEFAULT 0,
  current_price NUMERIC(18,4) DEFAULT 0,
  lot_size NUMERIC(10,2) DEFAULT 0.01,
  stop_loss NUMERIC(18,4),
  take_profit NUMERIC(18,4),
  pnl NUMERIC(18,2) DEFAULT 0,
  target_pnl NUMERIC(18,2) DEFAULT 0,
  duration_seconds INT DEFAULT 3600,
  status TEXT DEFAULT 'open',
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT
);

-- Trade history
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

-- Withdraw requests
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  method TEXT,
  address TEXT,
  amount NUMERIC(18,2) NOT NULL,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deposit logs
CREATE TABLE IF NOT EXISTS deposit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(18,2) NOT NULL,
  method TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved withdrawal methods
CREATE TABLE IF NOT EXISTS withdraw_methods (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  address TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, method)
);

-- Daily targets (for gradual balance movement)
CREATE TABLE IF NOT EXISTS daily_targets (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT DEFAULT 'XAUUSD',
  target NUMERIC(18,2) NOT NULL,
  current NUMERIC(18,2) DEFAULT 0,
  duration_sec INT DEFAULT 1800,
  step_interval INT DEFAULT 5,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System messages (broadcasts)
CREATE TABLE IF NOT EXISTS system_messages (
  id SERIAL PRIMARY KEY,
  title TEXT,
  message TEXT NOT NULL,
  target_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System settings
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users(tg_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_history_user ON trades_history(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_user_status ON requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ops_user ON ops(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_targets_active ON daily_targets(user_id, active);
CREATE INDEX IF NOT EXISTS idx_system_messages_user ON system_messages(target_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_tg_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_tg_id);
CREATE INDEX IF NOT EXISTS idx_mass_trades_status ON mass_trades(status);
CREATE INDEX IF NOT EXISTS idx_mass_trade_participants ON mass_trade_participants(mass_trade_id);

-- Insert default settings
INSERT INTO settings (key, value) VALUES 
  ('trading_enabled', 'true'),
  ('maintenance_mode', 'false'),
  ('min_withdrawal', '10'),
  ('max_withdrawal', '10000')
ON CONFLICT (key) DO NOTHING;
