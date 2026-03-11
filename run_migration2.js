import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: "postgresql://jack_is2t_user:xUCymi9CMft6fG1ZpkVaxEyBRXaWZB47@dpg-d4s8o3vpm1nc7390j2l0-a.virginia-postgres.render.com/jack_is2t",
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const queries = [
    // custom_rank on users
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_rank TEXT DEFAULT NULL`,
    // referral_trade_commission on users
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_trade_commission NUMERIC(18,2) DEFAULT 0`,
    // custom_trades table
    `CREATE TABLE IF NOT EXISTS custom_trades (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_custom_trades_user_status ON custom_trades(user_id, status)`,
    // referral_commissions table
    `CREATE TABLE IF NOT EXISTS referral_commissions (
      id SERIAL PRIMARY KEY,
      referrer_user_id INT REFERENCES users(id) ON DELETE CASCADE,
      referred_user_id INT REFERENCES users(id) ON DELETE CASCADE,
      trade_pnl NUMERIC(18,2) DEFAULT 0,
      commission_amount NUMERIC(18,2) DEFAULT 0,
      commission_rate NUMERIC(5,2) DEFAULT 5.00,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer ON referral_commissions(referrer_user_id)`,
    // trade_price_states table
    `CREATE TABLE IF NOT EXISTS trade_price_states (
      trade_id INT NOT NULL,
      trade_type TEXT NOT NULL DEFAULT 'regular',
      last_price NUMERIC(18,4) NOT NULL,
      last_pnl NUMERIC(18,2) DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (trade_id, trade_type)
    )`,
    // speed columns
    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS speed TEXT DEFAULT 'normal'`,
    `ALTER TABLE mass_trade_user_trades ADD COLUMN IF NOT EXISTS speed TEXT DEFAULT 'normal'`,
    // supervisors
    `CREATE TABLE IF NOT EXISTS supervisors (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // mass_trade_extra_users
    `CREATE TABLE IF NOT EXISTS mass_trade_extra_users (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      extra_trades_per_day INT DEFAULT 1,
      note TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  for (const q of queries) {
    try {
      await pool.query(q);
      console.log('✅', q.substring(0, 70).replace(/\n/g, ' '));
    } catch (err) {
      console.log('⚠️', q.substring(0, 70).replace(/\n/g, ' '), '→', err.message);
    }
  }

  console.log('\n✅ Migration 2 complete!');
  await pool.end();
}

run().catch(console.error);
