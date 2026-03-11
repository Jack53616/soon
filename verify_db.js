import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: 'postgresql://jack_is2t_user:xUCymi9CMft6fG1ZpkVaxEyBRXaWZB47@dpg-d4s8o3vpm1nc7390j2l0-a.virginia-postgres.render.com/jack_is2t',
  ssl: { rejectUnauthorized: false }
});

async function verify() {
  const client = await pool.connect();
  try {
    // Check all required tables
    const tables = ['users', 'trades', 'trades_history', 'requests', 'keys', 'mass_trades', 'mass_trade_user_trades', 'custom_trades', 'referral_commissions', 'user_ranks'];
    
    console.log('=== TABLE CHECK ===');
    for (const t of tables) {
      const r = await client.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`, [t]);
      console.log(`${t}: ${r.rows[0].exists ? '✓ EXISTS' : '✗ MISSING'}`);
    }

    // Check key columns in users table
    console.log('\n=== USERS COLUMNS ===');
    const userCols = ['id', 'tg_id', 'name', 'email', 'balance', 'frozen_balance', 'referred_by', 'custom_rank', 'display_rank', 'referral_earnings', 'is_banned', 'ban_reason'];
    const colRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`);
    const existingCols = colRes.rows.map(r => r.column_name);
    for (const c of userCols) {
      console.log(`  ${c}: ${existingCols.includes(c) ? '✓' : '✗ MISSING'}`);
    }

    // Check trades columns
    console.log('\n=== TRADES COLUMNS ===');
    const tradeCols = ['id', 'user_id', 'symbol', 'direction', 'status', 'target_pnl', 'duration_seconds', 'entry_price', 'current_price', 'lot_size', 'speed', 'pnl'];
    const tradeColRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'trades'`);
    const existingTradeCols = tradeColRes.rows.map(r => r.column_name);
    for (const c of tradeCols) {
      console.log(`  ${c}: ${existingTradeCols.includes(c) ? '✓' : '✗ MISSING'}`);
    }

    // Check custom_trades columns
    console.log('\n=== CUSTOM_TRADES COLUMNS ===');
    const ctColRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'custom_trades'`);
    const existingCtCols = ctColRes.rows.map(r => r.column_name);
    console.log('  Columns:', existingCtCols.join(', '));

    // Check mass_trades columns
    console.log('\n=== MASS_TRADES COLUMNS ===');
    const mtColRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'mass_trades'`);
    const existingMtCols = mtColRes.rows.map(r => r.column_name);
    console.log('  Columns:', existingMtCols.join(', '));

    // Check referral_commissions
    console.log('\n=== REFERRAL_COMMISSIONS COLUMNS ===');
    const rcColRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'referral_commissions'`);
    const existingRcCols = rcColRes.rows.map(r => r.column_name);
    console.log('  Columns:', existingRcCols.join(', '));

    // Check user_ranks
    console.log('\n=== USER_RANKS COLUMNS ===');
    const urColRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'user_ranks'`);
    const existingUrCols = urColRes.rows.map(r => r.column_name);
    console.log('  Columns:', existingUrCols.join(', '));

    console.log('\n=== DONE ===');
  } finally {
    client.release();
    pool.end();
  }
}

verify().catch(e => { console.error(e); process.exit(1); });
