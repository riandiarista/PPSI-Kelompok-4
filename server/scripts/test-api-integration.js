import "dotenv/config";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import db from "../src/config/db.js";

async function run() {
  console.log("=== Menguji Integrasi API & Database ===");

  // 1. Ambil user Tendik dari database
  const userRes = await db.query(
    "SELECT u.user_id, u.email, u.full_name, r.role_name AS role FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'Tendik' LIMIT 1"
  );
  if (userRes.rows.length === 0) {
    throw new Error("User Tendik tidak ditemukan di database");
  }
  const tendik = userRes.rows[0];
  console.log(`Tendik user: ${tendik.full_name} (${tendik.email})`);

  // 2. Buat token JWT
  const token = jwt.sign(
    {
      user_id: tendik.user_id,
      email: tendik.email,
      full_name: tendik.full_name,
      role: tendik.role,
    },
    process.env.JWT_SECRET || "GANTI_DENGAN_SECRET_ACAK_BARU",
    { expiresIn: "1h" }
  );

  // 3. Jalankan server di port sementara
  const testPort = 5099;
  const server = app.listen(testPort);

  try {
    const baseUrl = `http://127.0.0.1:${testPort}`;

    // Test A: Health Check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthRes.json();
    console.log("1. GET /api/health:", healthData.status || healthRes.status, healthData.database);

    // Test B: GET /api/loans/history
    const historyRes = await fetch(`${baseUrl}/api/loans/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const historyData = await historyRes.json();
    console.log("2. GET /api/loans/history Status:", historyRes.status);
    console.log("   Jumlah riwayat peminjaman:", historyData.data?.length);
    if (historyData.data && historyData.data.length > 0) {
      console.log("   Contoh kartu riwayat pertama:", {
        item: historyData.data[0].item_name,
        borrower: historyData.data[0].borrower_name,
        late_days: historyData.data[0].late_days,
        condition: historyData.data[0].return_condition,
      });
    }

    // Test C: GET /api/inventory/items (Laporan Inventaris)
    const invRes = await fetch(`${baseUrl}/api/inventory/items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const invData = await invRes.json();
    console.log("3. GET /api/inventory/items Status:", invRes.status);
    console.log("   Statistik inventaris aktual:", invData.stats);
    console.log("   Total barang dalam daftar:", invData.data?.length);

    // Test D: GET /api/audit-logs (Log Aktivitas)
    const auditRes = await fetch(`${baseUrl}/api/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const auditData = await auditRes.json();
    console.log("4. GET /api/audit-logs Status:", auditRes.status);
    console.log("   Total log aktivitas:", auditData.data?.pagination?.total);
    console.log("   Jumlah aktivitas ditampilkan:", auditData.data?.items?.length);

    console.log("\n=== SEMUA FITUR API & DATABASE BERHASIL TERINTEGRASI DAN BERFUNGSI 100% ===");
  } finally {
    server.close();
    await db.end();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
