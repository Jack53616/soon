import pg from 'pg';
import fs from 'fs';
const { Pool } = pg;

const pool = new Pool({
  connectionString: "postgresql://jack_is2t_user:xUCymi9CMft6fG1ZpkVaxEyBRXaWZB47@dpg-d4s8o3vpm1nc7390j2l0-a.virginia-postgres.render.com/jack_is2t",
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const sql = fs.readFileSync('./migration_v4.sql', 'utf8');
  const statements = sql.split(';').filter(s => s.trim().length > 0);
  
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    try {
      await pool.query(trimmed);
      console.log('✅', trimmed.substring(0, 60).replace(/\n/g, ' ') + '...');
    } catch (err) {
      console.log('⚠️', trimmed.substring(0, 60).replace(/\n/g, ' ') + '...', '→', err.message);
    }
  }
  
  console.log('\n✅ Migration complete!');
  await pool.end();
}

run().catch(console.error);
