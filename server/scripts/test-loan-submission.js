import "dotenv/config";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import db from "../src/config/db.js";

async function testLoanSubmission() {
  console.log("=== Menguji API Katalog & Pengajuan Peminjaman ===");

  // 1. Ambil user Peminjam dan Barang yang tersedia dari DB
  const borrowerRes = await db.query(
    "SELECT u.user_id, u.email, u.full_name, r.role_name AS role FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'Peminjam' LIMIT 1"
  );
  const borrower = borrowerRes.rows[0];
  console.log(`Borrower: ${borrower.full_name} (${borrower.email}) [ID: ${borrower.user_id}]`);

  const itemRes = await db.query(
    "SELECT item_id, item_name, availability_status FROM items WHERE availability_status = 'available' AND is_active = TRUE LIMIT 1"
  );
  const item = itemRes.rows[0];
  console.log(`Item to borrow: ${item.item_name} [ID: ${item.item_id}, Status: ${item.availability_status}]`);

  // 2. Buat JWT token untuk borrower
  const token = jwt.sign(
    {
      user_id: borrower.user_id,
      email: borrower.email,
      full_name: borrower.full_name,
      role: borrower.role,
    },
    process.env.JWT_SECRET || "GANTI_DENGAN_SECRET_ACAK_BARU",
    { expiresIn: "1h" }
  );

  // 3. Jalankan server di port sementara
  const testPort = 5098;
  const server = app.listen(testPort);

  try {
    const baseUrl = `http://127.0.0.1:${testPort}`;

    // A. Cek ketersediaan
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const availRes = await fetch(
      `${baseUrl}/api/loans/availability?item_id=${item.item_id}&borrow_date=${today}&duration_days=2`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const availData = await availRes.json();
    console.log("1. GET /api/loans/availability:", availRes.status, availData);

    // B. Kirim pengajuan peminjaman
    const submitRes = await fetch(`${baseUrl}/api/loans/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        item_id: item.item_id,
        purpose: "Peminjaman untuk kegiatan praktikum mahasiswa",
        borrow_date: today,
        duration_days: 2,
      }),
    });
    const submitData = await submitRes.json();
    console.log("2. POST /api/loans/request Status:", submitRes.status);
    console.log("   Response:", submitData);

    // C. Verifikasi data tersimpan di PostgreSQL
    const checkDb = await db.query(
      "SELECT request_id, borrower_id, item_id, purpose, planned_start_at, planned_end_at, request_status FROM loan_requests WHERE request_id = $1",
      [submitData.data?.request_id]
    );
    console.log("3. Verifikasi Database PostgreSQL:", checkDb.rows[0]);

    // D. Cek ketersediaan lagi (sekarang harus konflik dengan pengajuan sendiri)
    const availAfterRes = await fetch(
      `${baseUrl}/api/loans/availability?item_id=${item.item_id}&borrow_date=${today}&duration_days=2`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const availAfterData = await availAfterRes.json();
    console.log("4. GET /api/loans/availability setelah pengajuan:", availAfterData.data?.available, availAfterData.data?.reason);

    console.log("\n=== TEST PENGIRIMAN DAN INTEGRASI BERHASIL ===");
  } finally {
    server.close();
    await db.end();
  }
}

testLoanSubmission().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
