// Membuat akun demo untuk development (satu per role).
//   npm run seed:dev
// Aman dijalankan berulang: akun yang emailnya sudah ada tidak diubah.
import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

if (process.env.NODE_ENV === "production") {
  console.error("seed:dev tidak boleh dijalankan di production");
  process.exit(1);
}

const PASSWORD = "password123";
const USERS = [
  { full_name: "Demo Peminjam", email: "peminjam@demo.test", role: "Peminjam" },
  { full_name: "Demo Tendik", email: "tendik@demo.test", role: "Tendik" },
  { full_name: "Demo Kadep", email: "kadep@demo.test", role: "Kadep" },
];

const client = new pg.Client({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  await client.connect();
  const hash = await bcrypt.hash(PASSWORD, 10);

  for (const u of USERS) {
    const { rowCount } = await client.query(
      `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
       SELECT role_id, $1, $2, $3, 'approved', 'local', TRUE, TRUE FROM roles WHERE role_name = $4
       ON CONFLICT (email) DO NOTHING`,
      [u.full_name, u.email, hash, u.role]
    );
    console.log(`${rowCount ? "BARU " : "ADA  "} ${u.email} (${u.role})`);
  }
  console.log(`Password semua akun demo: ${PASSWORD}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
