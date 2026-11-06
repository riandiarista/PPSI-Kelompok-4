import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

// Satu pool koneksi yang dipakai bersama oleh seluruh aplikasi.
// Pemakaian: import db from "../config/db.js";
//            const { rows } = await db.query("SELECT * FROM users WHERE user_id = $1", [id]);
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

pool.on("error", (err) => {
  console.error("Koneksi database idle error:", err.message);
});

export default pool;
