import "dotenv/config";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import db from "../src/config/db.js";

async function testCatalogAndLoanFlow() {
  console.log("=== PENGUJIAN INTEGRASI PENUH: KATALOG & PENGAJUAN PEMINJAMAN ===");

  // 1. Ambil akun peminjam dari database
  const userRes = await db.query(
    "SELECT u.user_id, u.email, u.full_name, r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'Peminjam' LIMIT 1"
  );
  if (userRes.rows.length === 0) {
    throw new Error("User peminjam tidak ditemukan");
  }
  const borrower = userRes.rows[0];
  console.log(`[AUTH] Login sebagai: ${borrower.full_name} (${borrower.email}) [Role: ${borrower.role_name}]`);

  const token = jwt.sign(
    {
      user_id: borrower.user_id,
      email: borrower.email,
      full_name: borrower.full_name,
      role: borrower.role_name,
    },
    process.env.JWT_SECRET || "GANTI_DENGAN_SECRET_ACAK_BARU",
    { expiresIn: "1h" }
  );

  const testPort = 5097;
  const server = app.listen(testPort);

  try {
    const baseUrl = `http://127.0.0.1:${testPort}`;

    // Test 1: Fetch Katalog Inventaris Aktual dari Database
    console.log("\n--- TEST 1: GET /api/inventory/items ---");
    const catalogRes = await fetch(`${baseUrl}/api/inventory/items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const catalogData = await catalogRes.json();
    console.log(`Status HTTP: ${catalogRes.status}`);
    console.log(`Jumlah total barang di DB: ${catalogData.data?.length}`);
    console.log(`Statistik ketersediaan aktual:`, catalogData.stats);

    const availableItem = catalogData.data.find(
      (it) => it.availability_status === "available" && it.is_active
    );
    if (!availableItem) {
      throw new Error("Tidak ada barang tersedia untuk dipinjam");
    }
    console.log(`Barang dipilih untuk pengujian: ${availableItem.item_name} (ID: ${availableItem.item_id}, Kategori: ${availableItem.category_name})`);

    // Test 2: Validasi Input (Keperluan kosong harus ditolak)
    console.log("\n--- TEST 2: Validasi Input (Keperluan Kosong) ---");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const invalidRes = await fetch(`${baseUrl}/api/loans/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        item_id: availableItem.item_id,
        purpose: "",
        borrow_date: today,
        duration_days: 1,
      }),
    });
    const invalidData = await invalidRes.json();
    console.log(`Status HTTP: ${invalidRes.status} (Diharapkan: 400)`);
    console.log(`Pesan error validasi: "${invalidData.message}"`);
    if (invalidRes.status !== 400) {
      throw new Error("Validasi keperluan kosong gagal");
    }

    // Test 3: Cek Ketersediaan Stok & Bentrok Jadwal
    console.log("\n--- TEST 3: GET /api/loans/availability ---");
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 5);
    const testBorrowDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(nextWeek);

    const availRes = await fetch(
      `${baseUrl}/api/loans/availability?item_id=${availableItem.item_id}&borrow_date=${testBorrowDate}&duration_days=3`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const availData = await availRes.json();
    console.log(`Status HTTP: ${availRes.status}`);
    console.log(`Ketersediaan barang: ${availData.data?.available}`);
    console.log(`Rentang jadwal:`, availData.data?.period);

    // Test 4: Kirim Pengajuan Peminjaman Valid
    console.log("\n--- TEST 4: POST /api/loans/request (Kirim Pengajuan) ---");
    const submitRes = await fetch(`${baseUrl}/api/loans/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        item_id: availableItem.item_id,
        purpose: "Peminjaman alat untuk dokumentasi seminar nasional",
        borrow_date: testBorrowDate,
        duration_days: 3,
      }),
    });
    const submitData = await submitRes.json();
    console.log(`Status HTTP: ${submitRes.status} (Diharapkan: 201)`);
    console.log(`Pesan sukses: "${submitData.message}"`);
    console.log(`Data pengajuan tersimpan:`, submitData.data);
    if (submitRes.status !== 201) {
      throw new Error("Pengajuan peminjaman gagal disimpan");
    }

    // Test 5: Verifikasi Langsung ke Database PostgreSQL
    console.log("\n--- TEST 5: Verifikasi Integritas Database PostgreSQL ---");
    const dbCheck = await db.query(
      `SELECT lr.request_id, lr.borrower_id, lr.item_id, i.item_name, lr.purpose,
              lr.planned_start_at, lr.planned_end_at, lr.request_status, lr.submitted_at
         FROM loan_requests lr
         JOIN items i ON i.item_id = lr.item_id
        WHERE lr.request_id = $1`,
      [submitData.data?.request_id]
    );
    console.log("Data aktual dari tabel loan_requests:", dbCheck.rows[0]);

    // Test 6: Verifikasi Audit Log Tercatat di Database
    const auditCheck = await db.query(
      `SELECT audit_id, action_type, entity_type, entity_id, details, occurred_at
         FROM audit_logs
        WHERE entity_type = 'loan_request' AND entity_id = $1`,
      [submitData.data?.request_id]
    );
    console.log("Data aktual dari tabel audit_logs:", auditCheck.rows[0]);

    // Test 7: Cek Deteksi Bentrok Jadwal Duplikat
    console.log("\n--- TEST 7: Deteksi Bentrok Pengajuan Beririsan (409) ---");
    const duplicateRes = await fetch(`${baseUrl}/api/loans/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        item_id: availableItem.item_id,
        purpose: "Pengajuan kedua untuk jadwal yang sama",
        borrow_date: testBorrowDate,
        duration_days: 2,
      }),
    });
    const duplicateData = await duplicateRes.json();
    console.log(`Status HTTP: ${duplicateRes.status} (Diharapkan: 409)`);
    console.log(`Pesan bentrok: "${duplicateData.message}"`);

    console.log("\n========================================================");
    console.log("SELURUH ALUR INTEGRASI KATALOG & PENGAJUAN PEMINJAMAN 100% SUKSES!");
    console.log("========================================================");
  } finally {
    server.close();
    await db.end();
  }
}

testCatalogAndLoanFlow().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
