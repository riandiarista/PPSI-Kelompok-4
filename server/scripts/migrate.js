// Menjalankan file .sql di folder migrations secara berurutan.
//   npm run migrate        -> jalankan migration yang belum pernah dijalankan
//   npm run migrate:reset  -> HAPUS semua tabel lalu jalankan ulang (khusus development)
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pastikan .env dari folder server selalu terbaca terlepas dari mana perintah dijalankan
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD ?? ''),
  database: process.env.DB_NAME,
});

const dir = path.join(__dirname, '..', 'migrations');

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset && process.env.NODE_ENV === 'production') {
    throw new Error('Reset tidak boleh dijalankan di production');
  }

  const client = await pool.connect();
  try {
    if (reset) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      console.log('Schema direset');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    const done = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
    );
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

    let count = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`OK   ${file}`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Gagal di ${file}: ${err.message}`);
      }
    }
    console.log(count ? `${count} migration dijalankan` : 'Database sudah up to date');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || 5432;
  const user = process.env.DB_USER || 'postgres';
  const dbName = process.env.DB_NAME || 'inventaris_unp';

  if (err.code === '28P01' || err.message?.includes('SASL') || err.message?.includes('password')) {
    console.error(`Gagal autentikasi: Password database salah atau belum diisi untuk user "${user}". Periksa DB_PASSWORD di server/.env.`);
  } else if (err.code === '3D000') {
    console.error(`Database "${dbName}" tidak ditemukan. Silakan buat database ini di pgAdmin terlebih dahulu.`);
  } else if (err.code === 'ECONNREFUSED' || err.code === 'EACCES') {
    console.error(`Tidak dapat terhubung ke PostgreSQL di ${host}:${port}. Pastikan service PostgreSQL sudah berjalan.`);
  } else {
    console.error('Error saat menjalankan migrasi:', err.message || err);
  }
  process.exit(1);
});
