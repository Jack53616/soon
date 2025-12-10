import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Explicitly load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Force SSL for Render/Neon databases
const sslConfig = { rejectUnauthorized: false };

// Fallback to hardcoded URL if env var is still wrong (Safety Net)
const CORRECT_DB_URL = "postgresql://jack_is2t_user:xUCymi9CMft6fG1ZpkVaxEyBRXaWZB47@dpg-d4s8o3vpm1nc7390j2l0-a.virginia-postgres.render.com/jack_is2t";
const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgres") 
  ? process.env.DATABASE_URL 
  : CORRECT_DB_URL;

console.log("🔌 Connecting to database...");
console.log("🎯 Target Host:", dbUrl.split("@")[1].split("/")[0]);

const pool = new Pool({
  connectionString: dbUrl,
  ssl: sslConfig, // Always enforce SSL
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("connect", () => {
  console.log("✅ PostgreSQL connected successfully");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL connection error:", err);
});

export const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`⚠️ Slow query (${duration}ms):`, text.substring(0, 50));
    }
    return res;
  } catch (error) {
    console.error("❌ Query error:", error.message);
    throw error;
  }
};

export const getClient = async () => {
  return await pool.connect();
};

export default pool;
