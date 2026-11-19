import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const client = new pg.Client({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "inventaris_unp",
});

async function main() {
  await client.connect();
  console.log("Connected to PostgreSQL for seeding history & inventory data...");

  const hash = await bcrypt.hash("password123", 10);

  // 1. Pastikan user Tendik & Kadep ada
  const tendikRes = await client.query(
    "SELECT user_id FROM users WHERE email = 'tendik@demo.test'"
  );
  let tendikId = tendikRes.rows[0]?.user_id;
  if (!tendikId) {
    const insertTendik = await client.query(
      `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
       SELECT role_id, 'Demo Tendik', 'tendik@demo.test', $1, 'approved', 'local', TRUE, TRUE
       FROM roles WHERE role_name = 'Tendik'
       RETURNING user_id`,
      [hash]
    );
    tendikId = insertTendik.rows[0].user_id;
  }

  const kadepRes = await client.query(
    "SELECT user_id FROM users WHERE email = 'kadep@demo.test'"
  );
  let kadepId = kadepRes.rows[0]?.user_id;
  if (!kadepId) {
    const insertKadep = await client.query(
      `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
       SELECT role_id, 'Demo Kadep', 'kadep@demo.test', $1, 'approved', 'local', TRUE, TRUE
       FROM roles WHERE role_name = 'Kadep'
       RETURNING user_id`,
      [hash]
    );
    kadepId = insertKadep.rows[0].user_id;
  }

  // 2. Buat Peminjam C, D, E, F sesuai gambar
  const borrowers = [
    { name: "Peminjam C", email: "peminjam.c@demo.test" },
    { name: "Peminjam D", email: "peminjam.d@demo.test" },
    { name: "Peminjam E", email: "peminjam.e@demo.test" },
    { name: "Peminjam F", email: "peminjam.f@demo.test" },
  ];

  const borrowerIds = {};
  for (const b of borrowers) {
    const res = await client.query(
      "SELECT user_id FROM users WHERE email = $1",
      [b.email]
    );
    if (res.rows.length > 0) {
      borrowerIds[b.name] = res.rows[0].user_id;
    } else {
      const ins = await client.query(
        `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
         SELECT role_id, $1, $2, $3, 'approved', 'local', TRUE, TRUE
         FROM roles WHERE role_name = 'Peminjam'
         RETURNING user_id`,
        [b.name, b.email, hash]
      );
      borrowerIds[b.name] = ins.rows[0].user_id;
      console.log(`Created user ${b.name} (${ins.rows[0].user_id})`);
    }
  }

  // 3. Kategori
  const categories = ["Buku", "Kamera", "Proyektor", "Elektronik"];
  const categoryIds = {};
  for (const catName of categories) {
    const res = await client.query(
      "SELECT category_id FROM item_categories WHERE category_name = $1",
      [catName]
    );
    if (res.rows.length > 0) {
      categoryIds[catName] = res.rows[0].category_id;
    } else {
      const ins = await client.query(
        "INSERT INTO item_categories (category_name) VALUES ($1) RETURNING category_id",
        [catName]
      );
      categoryIds[catName] = ins.rows[0].category_id;
      console.log(`Created category ${catName} (${ins.rows[0].category_id})`);
    }
  }

  // 4. Barang sesuai UI:
  // - Buku sumbangan dosen (Buku, Tersedia)
  // - Kamera DSLR (Kamera, Tersedia)
  // - Proyektor (infokus) 01 (Proyektor, Tersedia)
  // - Proyektor (infokus) 02 (Proyektor, Dipinjam)
  // - Speaker portabel (Elektronik, Tersedia)
  // - Tripod (Kamera, Tersedia)
  // - Mikrofon Nirkabel (Elektronik, Perbaikan)
  const itemsData = [
    { name: "Buku sumbangan dosen", cat: "Buku", cond: "good", status: "available" },
    { name: "Kamera DSLR", cat: "Kamera", cond: "good", status: "available" },
    { name: "Proyektor (infokus) 01", cat: "Proyektor", cond: "good", status: "available" },
    { name: "Proyektor (infokus) 02", cat: "Proyektor", cond: "good", status: "borrowed" },
    { name: "Speaker portabel", cat: "Elektronik", cond: "good", status: "available" },
    { name: "Tripod", cat: "Kamera", cond: "good", status: "available" },
    { name: "Mikrofon Nirkabel", cat: "Elektronik", cond: "minor_damage", status: "maintenance" },
  ];

  const itemIds = {};
  for (const it of itemsData) {
    const res = await client.query(
      "SELECT item_id FROM items WHERE item_name = $1",
      [it.name]
    );
    if (res.rows.length > 0) {
      itemIds[it.name] = res.rows[0].item_id;
      await client.query(
        "UPDATE items SET availability_status = $1, item_condition = $2 WHERE item_id = $3",
        [it.status, it.cond, res.rows[0].item_id]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO items (category_id, item_name, item_condition, availability_status, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING item_id`,
        [categoryIds[it.cat], it.name, it.cond, it.status]
      );
      itemIds[it.name] = ins.rows[0].item_id;
      console.log(`Created item ${it.name} (${ins.rows[0].item_id})`);
    }
  }

  // 5. Riwayat Peminjaman sesuai gambar UI:
  // Card 1: Buku sumbangan dosen | Peminjam C | 1 – 8 Okt · kembali 8 Okt | Tepat waktu | Kondisi rusak
  // Card 2: Kamera DSLR | Peminjam E | 1 – 2 Okt · kembali 3 Okt | Terlambat 1 hari | Kondisi baik
  // Card 3: Proyektor (infokus) 01 | Peminjam D | 12 – 14 Okt · kembali 14 Okt | Tepat waktu | Kondisi baik
  // Card 4: Speaker portabel | Peminjam F | 5 – 6 Okt · kembali 6 Okt | Tepat waktu | Kondisi baik
  // Card 5: Tripod | Peminjam E | 15 – 16 Okt · kembali 16 Okt | Tepat waktu | Kondisi baik
  const historyData = [
    {
      itemName: "Buku sumbangan dosen",
      borrowerName: "Peminjam C",
      purpose: "Referensi skripsi mahasiswa",
      start: "2026-10-01T08:00:00Z",
      end: "2026-10-08T16:00:00Z",
      handover: "2026-10-01T08:30:00Z",
      due: "2026-10-08T16:00:00Z",
      returned: "2026-10-08T14:30:00Z",
      lateDays: 0,
      returnCond: "minor_damage",
      notes: "Cover buku sedikit terlipat",
    },
    {
      itemName: "Kamera DSLR",
      borrowerName: "Peminjam E",
      purpose: "Dokumentasi kegiatan seminar departemen",
      start: "2026-10-01T08:00:00Z",
      end: "2026-10-02T17:00:00Z",
      handover: "2026-10-01T08:15:00Z",
      due: "2026-10-02T17:00:00Z",
      returned: "2026-10-03T10:00:00Z",
      lateDays: 1,
      returnCond: "good",
      notes: "Pengembalian lewat 1 hari karena acara selesai malam",
    },
    {
      itemName: "Proyektor (infokus) 01",
      borrowerName: "Peminjam D",
      purpose: "Presentasi tugas akhir kuliah",
      start: "2026-10-12T08:00:00Z",
      end: "2026-10-14T15:00:00Z",
      handover: "2026-10-12T08:00:00Z",
      due: "2026-10-14T15:00:00Z",
      returned: "2026-10-14T14:45:00Z",
      lateDays: 0,
      returnCond: "good",
      notes: "Kondisi baik dan kabel lengkap",
    },
    {
      itemName: "Speaker portabel",
      borrowerName: "Peminjam F",
      purpose: "Latihan debat mahasiswa",
      start: "2026-10-05T09:00:00Z",
      end: "2026-10-06T16:00:00Z",
      handover: "2026-10-05T09:00:00Z",
      due: "2026-10-06T16:00:00Z",
      returned: "2026-10-06T15:30:00Z",
      lateDays: 0,
      returnCond: "good",
      notes: "Baterai terisi penuh, kondisi baik",
    },
    {
      itemName: "Tripod",
      borrowerName: "Peminjam E",
      purpose: "Perekaman video pembelajaran",
      start: "2026-10-15T08:00:00Z",
      end: "2026-10-16T16:00:00Z",
      handover: "2026-10-15T08:00:00Z",
      due: "2026-10-16T16:00:00Z",
      returned: "2026-10-16T15:00:00Z",
      lateDays: 0,
      returnCond: "good",
      notes: "Kaki tripod kokoh dan fungsi normal",
    },
  ];

  for (const h of historyData) {
    const itemId = itemIds[h.itemName];
    const borrowerId = borrowerIds[h.borrowerName];

    // Cek apakah loan request ini sudah ada
    const checkReq = await client.query(
      "SELECT request_id FROM loan_requests WHERE item_id = $1 AND borrower_id = $2 AND planned_start_at = $3",
      [itemId, borrowerId, h.start]
    );

    let requestId;
    if (checkReq.rows.length > 0) {
      requestId = checkReq.rows[0].request_id;
    } else {
      const insReq = await client.query(
        `INSERT INTO loan_requests (borrower_id, item_id, purpose, planned_start_at, planned_end_at, request_status)
         VALUES ($1, $2, $3, $4, $5, 'completed')
         RETURNING request_id`,
        [borrowerId, itemId, h.purpose, h.start, h.end]
      );
      requestId = insReq.rows[0].request_id;

      // Approval
      await client.query(
        `INSERT INTO approval_decisions (request_id, approver_id, decision, reason)
         VALUES ($1, $2, 'approved', 'Disetujui untuk kegiatan akademik')
         ON CONFLICT (request_id) DO NOTHING`,
        [requestId, kadepId]
      );
    }

    // Loan transaction
    const checkLt = await client.query(
      "SELECT loan_id FROM loan_transactions WHERE request_id = $1",
      [requestId]
    );

    let loanId;
    if (checkLt.rows.length > 0) {
      loanId = checkLt.rows[0].loan_id;
    } else {
      const insLt = await client.query(
        `INSERT INTO loan_transactions (request_id, handover_by, handover_at, due_at, transaction_status)
         VALUES ($1, $2, $3, $4, 'returned')
         RETURNING loan_id`,
        [requestId, tendikId, h.handover, h.due]
      );
      loanId = insLt.rows[0].loan_id;
    }

    // Return inspection
    await client.query(
      `INSERT INTO return_inspections (loan_id, confirmed_by, returned_at, return_condition, notes, late_days)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (loan_id) DO UPDATE
       SET return_condition = EXCLUDED.return_condition,
           late_days = EXCLUDED.late_days,
           notes = EXCLUDED.notes`,
      [loanId, tendikId, h.returned, h.returnCond, h.notes, h.lateDays]
    );

    console.log(`Seeded history loan for ${h.itemName} - ${h.borrowerName}`);
  }

  // 6. Seed beberapa log aktivitas ke audit_logs
  const auditEntries = [
    {
      actor_id: tendikId,
      action: "confirm_return",
      entity_type: "loan",
      entity_id: 1,
      details: { item_name: "Buku sumbangan dosen", borrower: "Peminjam C", condition: "minor_damage" },
      occurred_at: "2026-10-08T14:30:00Z",
    },
    {
      actor_id: tendikId,
      action: "confirm_return",
      entity_type: "loan",
      entity_id: 2,
      details: { item_name: "Kamera DSLR", borrower: "Peminjam E", late_days: 1 },
      occurred_at: "2026-10-03T10:00:00Z",
    },
    {
      actor_id: kadepId,
      action: "approve_loan_request",
      entity_type: "loan_request",
      entity_id: 1,
      details: { item_name: "Buku sumbangan dosen", borrower: "Peminjam C" },
      occurred_at: "2026-09-30T09:00:00Z",
    },
    {
      actor_id: tendikId,
      action: "create_item",
      entity_type: "item",
      entity_id: 1,
      details: { item_name: "Kamera DSLR", category: "Kamera" },
      occurred_at: "2026-09-20T10:00:00Z",
    },
  ];

  for (const a of auditEntries) {
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [a.actor_id, a.action, a.entity_type, a.entity_id, JSON.stringify(a.details), a.occurred_at]
    );
  }
  console.log("Seeded audit logs successfully.");

  console.log("All history and inventory database records seeded successfully!");
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
