import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ 
  connectionString: 'postgresql://jack_is2t_user:xUCymi9CMft6fG1ZpkVaxEyBRXaWZB47@dpg-d4s8o3vpm1nc7390j2l0-a.virginia-postgres.render.com/jack_is2t', 
  ssl: { rejectUnauthorized: false } 
});

const queries = [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS days_override INTEGER DEFAULT NULL',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
  "UPDATE users SET join_date = created_at WHERE join_date IS NULL AND created_at IS NOT NULL",
];

for (const q of queries) {
  try {
    const r = await pool.query(q);
    console.log('OK:', q.substring(0, 70));
  } catch(e) {
    console.log('SKIP:', e.message.substring(0, 80));
  }
}
await pool.end();
console.log('✅ Database updated!');
