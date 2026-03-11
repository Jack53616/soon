-- QL Trading AI v4.0 - Migration Script
-- New features: Ranks, Custom Trades, Referral Commission, Delete Users, Transfer Referrals

-- ===== 1. Add custom_rank column to users table =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_rank TEXT DEFAULT NULL;
-- custom_rank: if set, shows instead of default rank (عضو/وكيل)
-- NULL = use default logic (عضو if <5 referrals, وكيل if >=5)

-- ===== 2. Add referral_trade_commission to users =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_trade_commission NUMERIC(18,2) DEFAULT 0;
-- Total earned from 5% commission on referred users' trades

-- ===== 3. Custom trades table (admin opens for specific users) =====
CREATE TABLE IF NOT EXISTS custom_trades (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT DEFAULT 'XAUUSD',
  direction TEXT DEFAULT 'BUY',
  entry_price NUMERIC(18,4) DEFAULT 0,
  current_price NUMERIC(18,4) DEFAULT 0,
  lot_size NUMERIC(10,2) DEFAULT 0.05,
  pnl NUMERIC(18,2) DEFAULT 0,
  target_pnl NUMERIC(18,2) DEFAULT 0,
  duration_seconds INT DEFAULT 3600,
  speed TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'open',
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  admin_note TEXT,
  can_close BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_custom_trades_user_status ON custom_trades(user_id, status);

-- ===== 4. Referral trade commissions log =====
CREATE TABLE IF NOT EXISTS referral_commissions (
  id SERIAL PRIMARY KEY,
  referrer_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  trade_pnl NUMERIC(18,2) DEFAULT 0,
  commission_amount NUMERIC(18,2) DEFAULT 0,
  commission_rate NUMERIC(5,2) DEFAULT 5.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer ON referral_commissions(referrer_user_id);

-- ===== 5. Add trade_speed to trades and mass_trade_user_trades =====
ALTER TABLE trades ADD COLUMN IF NOT EXISTS speed TEXT DEFAULT 'normal';
ALTER TABLE mass_trade_user_trades ADD COLUMN IF NOT EXISTS speed TEXT DEFAULT 'normal';

-- ===== 6. Add duration_seconds to mass_trade_user_trades if missing =====
ALTER TABLE mass_trade_user_trades ADD COLUMN IF NOT EXISTS duration_seconds INT DEFAULT 3600;

-- ===== 7. Price state cache table (for persistent prices across page loads) =====
CREATE TABLE IF NOT EXISTS trade_price_states (
  trade_id INT NOT NULL,
  trade_type TEXT NOT NULL DEFAULT 'regular',
  last_price NUMERIC(18,4) NOT NULL,
  last_pnl NUMERIC(18,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (trade_id, trade_type)
);

-- ===== 8. Ensure mass_trade_user_trades has proper columns =====
ALTER TABLE mass_trades ADD COLUMN IF NOT EXISTS scheduled_time TEXT;
ALTER TABLE mass_trades ADD COLUMN IF NOT EXISTS scheduled_date TEXT;
ALTER TABLE mass_trades ADD COLUMN IF NOT EXISTS duration_seconds INT DEFAULT 3600;
ALTER TABLE mass_trades ADD COLUMN IF NOT EXISTS entry_price NUMERIC(18,4) DEFAULT 0;
ALTER TABLE mass_trades ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE;
ALTER TABLE mass_trades ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- ===== 9. Create mass_trade_user_trades if not exists =====
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
  duration_seconds INT DEFAULT 3600,
  speed TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'open',
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  UNIQUE(mass_trade_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mass_trade_user_trades_status ON mass_trade_user_trades(status);

-- ===== 10. Extra trade users table (if not exists) =====
CREATE TABLE IF NOT EXISTS mass_trade_extra_users (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  extra_trades_per_day INT DEFAULT 1,
  note TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 11. Agent tables (if not exists) =====
CREATE TABLE IF NOT EXISTS agent_referrals (
  id SERIAL PRIMARY KEY,
  agent_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  referred_at TIMESTAMPTZ DEFAULT NOW(),
  has_deposited BOOLEAN DEFAULT FALSE,
  first_deposit_amount NUMERIC(18,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  commission_expires_at TIMESTAMPTZ,
  extra_trade_expires_at TIMESTAMPTZ,
  loyalty_bonus_eligible_at TIMESTAMPTZ,
  loyalty_bonus_paid BOOLEAN DEFAULT FALSE,
  total_commission_earned NUMERIC(18,2) DEFAULT 0,
  UNIQUE(agent_user_id, referred_user_id)
);

CREATE TABLE IF NOT EXISTS agent_commissions (
  id SERIAL PRIMARY KEY,
  agent_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  commission_type TEXT,
  amount NUMERIC(18,2) DEFAULT 0,
  rate_applied NUMERIC(5,2) DEFAULT 0,
  source_amount NUMERIC(18,2) DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent columns on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_agent BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_since TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_active_clients INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_commission_rate NUMERIC(5,2) DEFAULT 5;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_total_earned NUMERIC(18,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_daily_trades INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_deposit_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Supervisors table
CREATE TABLE IF NOT EXISTS supervisors (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Withdrawal fee columns
ALTER TABLE requests ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS fee_rate NUMERIC(5,2) DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS net_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS days_since_deposit INT DEFAULT 0;
