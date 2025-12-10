import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Explicitly load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

const sslConfig = { rejectUnauthorized: false };

console.log("🧪 Testing Database Connection...");

// Fallback to hardcoded URL if env var is wrong
const CORRECT_DB_URL = "postgresql://jack_is2t_user:xUCymi9CMft6fG1ZpkVaxEyBRXaWZB47@dpg-d4s8o3vpm1nc7390j2l0-a.virginia-postgres.render.com/jack_is2t";
const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgres") 
  ? process.env.DATABASE_URL 
  : CORRECT_DB_URL;

console.log("🎯 Target Host:", dbUrl.split("@")[1].split("/")[0]);

const pool = new Pool({
  connectionString: dbUrl,
  ssl: sslConfig,
  connectionTimeoutMillis: 5000,
});

(async () => {
  try {
    const client = await pool.connect();
    console.log("✅ Connection Successful!");
    
    const res = await client.query("SELECT NOW() as time");
    console.log("🕒 Database Time:", res.rows[0].time);
    
    client.release();
    process.exit(0);
  } catch (err) {
    console.error("❌ Connection Failed Full Error:", err);
    process.exit(1);
  }
})();
