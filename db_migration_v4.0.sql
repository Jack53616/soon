-- ============================================================
-- Migration v4.0 - Agent System + Withdrawal Fees + Supervisor
-- ============================================================

-- ===== 1. USERS TABLE EXTENSIONS =====

-- Agent status fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_agent BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_since TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_active_clients INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_commission_rate NUMERIC(5,2) DEFAULT 5.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_total_earned NUMERIC(18,2) DEFAULT 0;

-- Supervisor role
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'; -- 'user', 'agent', 'supervisor', 'admin'

-- First deposit date (for withdrawal fee calculation)
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_deposit_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

-- Extra daily trades (from agent referrals)
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_daily_trades INT DEFAULT 0;

-- ===== 2. AGENT REFERRALS TABLE =====
-- Tracks each agent's referred users with commission details
CREATE TABLE IF NOT EXISTS agent_referrals (
  id SERIAL PRIMARY KEY,
  agent_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  referred_at TIMESTAMPTZ DEFAULT NOW(),
  -- Commission window: 30 days from referral
  commission_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  -- Extra trade window: 30 days from referral
  extra_trade_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  -- Status tracking
  is_active BOOLEAN DEFAULT TRUE,  -- false if referred user fully withdrew & left
  has_deposited BOOLEAN DEFAULT FALSE,
  deposit_amount NUMERIC(18,2) DEFAULT 0,
  -- Loyalty bonus: $100 if referred user stays 3 months
  loyalty_bonus_paid BOOLEAN DEFAULT FALSE,
  loyalty_bonus_eligible_at TIMESTAMPTZ,
  -- Total commission earned from this user
  total_commission_earned NUMERIC(18,2) DEFAULT 0,
  UNIQUE(agent_user_id, referred_user_id)
);

-- ===== 3. AGENT COMMISSION LOG =====
-- Every commission payment is logged here
CREATE TABLE IF NOT EXISTS agent_commissions (
  id SERIAL PRIMARY KEY,
  agent_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  commission_type TEXT NOT NULL, -- 'trade_profit', 'withdrawal_bonus', 'loyalty_bonus'
  amount NUMERIC(18,2) NOT NULL,
  rate_applied NUMERIC(5,2),
  source_amount NUMERIC(18,2), -- the profit/withdrawal amount that triggered commission
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 4. WITHDRAWAL FEES LOG =====
-- Track fee applied on each withdrawal
ALTER TABLE requests ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS fee_rate NUMERIC(5,2) DEFAULT 5.00;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS net_amount NUMERIC(18,2); -- amount after fee
ALTER TABLE requests ADD COLUMN IF NOT EXISTS days_since_deposit INT DEFAULT 0;

-- ===== 5. SUPERVISOR ACCOUNTS TABLE =====
CREATE TABLE IF NOT EXISTS supervisors (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_by_admin BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- ===== 6. INDEXES =====
CREATE INDEX IF NOT EXISTS idx_agent_referrals_agent ON agent_referrals(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_agent_referrals_referred ON agent_referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_agent_referrals_active ON agent_referrals(is_active, commission_expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_commissions_agent ON agent_commissions(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_agent ON users(is_agent);

-- ===== 7. DEFAULT SETTINGS =====
INSERT INTO settings (key, value) VALUES
  ('agent_min_clients', '5'),
  ('agent_tier1_rate', '5'),
  ('agent_tier2_rate', '7'),
  ('agent_tier2_threshold', '20'),
  ('agent_tier3_rate', '10'),
  ('agent_tier3_threshold', '50'),
  ('agent_loyalty_bonus', '100'),
  ('agent_loyalty_months', '3'),
  ('withdrawal_fee_tier1_days', '15'),
  ('withdrawal_fee_tier1_rate', '25'),
  ('withdrawal_fee_tier2_days', '30'),
  ('withdrawal_fee_tier2_rate', '15'),
  ('withdrawal_fee_tier3_rate', '5'),
  ('withdrawal_fee_loyalty_days', '90'),
  ('withdrawal_fee_loyalty_rate', '3')
ON CONFLICT (key) DO NOTHING;
