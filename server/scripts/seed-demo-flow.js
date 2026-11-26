// Mengisi data demo untuk SELURUH alur aplikasi:
//   akun → kategori & barang → pengajuan (antrean Kadep) → disetujui (serah terima Tendik)
//   → sedang dipinjam / terlambat (pengembalian Tendik) → riwayat pengembalian + poin & level
//   → periode reward + pemenang (aturan poin & reward Kadep) → audit log.
//
//   npm run seed:demo
//
// Aman dijalankan berulang: akun, kategori, barang, reward, dan periode dicari berdasarkan
// nama/email; data peminjaman hanya dibuat sekali (dilewati kalau sudah pernah di-seed).
// Tanggal pengajuan aktif dihitung relatif terhadap hari ini supaya antrean, serah terima,
// dan keterlambatan selalu terlihat. Riwayat memakai tanggal tetap (Feb–Nov 2026).
import "dotenv/config";
import bcrypt from "bcryptjs";
import db from "../src/config/db.js";
import { calculateLevel as calcLevel, calculatePointDelta as calcDelta, getItemStatusAfterReturn } from "../src/services/returnService.js";
import { getPointSettings } from "../src/services/pointSettingsService.js";

if (process.env.NODE_ENV === "production") {
  console.error("seed:demo tidak boleh dijalankan di production");
  process.exit(1);
}

const PASSWORD = "password123";
const DAY = 24 * 60 * 60 * 1000;

// ─── Data master ────────────────────────────────────────────────────────────

const STAFF = [
  { key: "tendik", full_name: "Demo Tendik", email: "tendik@demo.test", role: "Tendik" },
  { key: "kadep", full_name: "Demo Kadep", email: "kadep@demo.test", role: "Kadep" },
];

const BORROWERS = [
  { key: "demo", full_name: "Demo Peminjam", email: "peminjam@demo.test" },
  { key: "rina", full_name: "Rina Marlina", email: "rina.marlina@demo.test" },
  { key: "fajar", full_name: "Fajar Pratama", email: "fajar.pratama@demo.test" },
  { key: "siti", full_name: "Siti Aisyah", email: "siti.aisyah@demo.test" },
  { key: "dimas", full_name: "Dimas Saputra", email: "dimas.saputra@demo.test" },
  { key: "nadia", full_name: "Nadia Putri", email: "nadia.putri@demo.test" },
  { key: "yoga", full_name: "Yoga Pranata", email: "yoga.pranata@demo.test" },
];

const CATEGORIES = ["Proyektor & Layar", "Kamera & Dokumentasi", "Audio", "Laptop", "Aksesoris Presentasi", "Alat Praktikum"];

const ITEMS = [
  { key: "epson", name: "Proyektor Epson EB-X51", cat: "Proyektor & Layar" },
  { key: "benq", name: "Proyektor BenQ MS560", cat: "Proyektor & Layar" },
  { key: "layar", name: "Layar Proyektor Tripod 70 inci", cat: "Proyektor & Layar" },
  { key: "canon", name: "Kamera Canon EOS 90D", cat: "Kamera & Dokumentasi" },
  { key: "tripod", name: "Tripod Takara ECO-196A", cat: "Kamera & Dokumentasi" },
  { key: "jbl", name: "Speaker Portabel JBL EON One", cat: "Audio" },
  { key: "mic", name: "Mikrofon Nirkabel Shure BLX", cat: "Audio" },
  { key: "lenovo", name: "Laptop Lenovo ThinkPad E14", cat: "Laptop" },
  { key: "asus", name: "Laptop ASUS VivoBook 14", cat: "Laptop" },
  { key: "pointer", name: "Pointer Presentasi Logitech R400", cat: "Aksesoris Presentasi" },
  { key: "hdmi", name: "Kabel HDMI 10 Meter", cat: "Aksesoris Presentasi" },
  { key: "arduino", name: "Arduino Starter Kit", cat: "Alat Praktikum" },
];

const REWARDS = [
  { name: "Peminjam Paling Disiplin", description: "Diberikan kepada peminjam dengan poin tertinggi pada periode tertentu." },
  { name: "Peminjam Paling Bertanggung Jawab", description: "Diberikan kepada peminjam yang selalu mengembalikan barang tepat waktu dan dalam kondisi baik." },
  { name: "Peminjam Teraktif", description: "Diberikan kepada peminjam dengan jumlah peminjaman terbanyak dan poin tertinggi pada periode tertentu." },
];

const PERIODS = [
  { key: "genap", name: "Semester Genap 2025/2026", start: "2026-02-01", end: "2026-07-31", active: false },
  { key: "ganjil", name: "Semester Ganjil 2026/2027", start: "2026-08-01", end: "2027-01-31", active: true },
];

// Pemenang periode lalu (periode aktif sengaja dikosongkan agar Kadep bisa mencoba memberi reward)
const AWARDS = [
  { period: "genap", reward: "Peminjam Paling Disiplin", user: "rina", note: "Poin tertinggi semester genap, selalu tepat waktu." },
  { period: "genap", reward: "Peminjam Paling Bertanggung Jawab", user: "siti", note: "Barang selalu kembali dalam kondisi baik." },
];

// Riwayat peminjaman yang sudah dikembalikan (tanggal WIB, jam 08:00 serah terima).
// late = hari keterlambatan, cond = kondisi saat kembali.
const HISTORY = [
  // Semester Genap 2025/2026
  { user: "rina", item: "epson", start: "2026-02-16", days: 2, late: 0, cond: "good", purpose: "Presentasi seminar proposal" },
  { user: "siti", item: "canon", start: "2026-03-02", days: 3, late: 0, cond: "good", purpose: "Dokumentasi kegiatan himpunan" },
  { user: "fajar", item: "lenovo", start: "2026-03-09", days: 5, late: 0, cond: "good", purpose: "Pengolahan data penelitian" },
  { user: "rina", item: "pointer", start: "2026-03-23", days: 1, late: 0, cond: "good", purpose: "Sidang skripsi" },
  { user: "nadia", item: "jbl", start: "2026-04-06", days: 2, late: 1, cond: "good", purpose: "Acara bedah buku" },
  { user: "siti", item: "tripod", start: "2026-04-20", days: 2, late: 0, cond: "good", purpose: "Perekaman video tutorial" },
  { user: "fajar", item: "hdmi", start: "2026-05-11", days: 1, late: 0, cond: "good", purpose: "Rapat koordinasi kelas" },
  { user: "rina", item: "benq", start: "2026-05-25", days: 2, late: 0, cond: "good", purpose: "Kuliah tamu" },
  { user: "nadia", item: "mic", start: "2026-06-08", days: 1, late: 0, cond: "good", purpose: "Lomba debat" },
  { user: "dimas", item: "asus", start: "2026-06-15", days: 3, late: 0, cond: "good", purpose: "Praktikum pemrograman" },

  // Semester Ganjil 2026/2027 (periode aktif)
  { user: "rina", item: "canon", start: "2026-08-10", days: 2, late: 0, cond: "good", purpose: "Dokumentasi PKKMB" },
  { user: "fajar", item: "epson", start: "2026-08-17", days: 1, late: 0, cond: "good", purpose: "Presentasi tugas kelompok" },
  { user: "siti", item: "lenovo", start: "2026-08-24", days: 4, late: 0, cond: "minor_damage", purpose: "Analisis data skripsi", notes: "Satu tombol keyboard agak macet" },
  { user: "demo", item: "pointer", start: "2026-08-31", days: 1, late: 0, cond: "good", purpose: "Presentasi mata kuliah" },
  { user: "dimas", item: "tripod", start: "2026-09-07", days: 2, late: 3, cond: "good", purpose: "Syuting video profil", notes: "Terlambat karena jadwal syuting mundur" },
  { user: "rina", item: "jbl", start: "2026-09-14", days: 1, late: 0, cond: "good", purpose: "Senam pagi departemen" },
  { user: "nadia", item: "benq", start: "2026-09-21", days: 2, late: 0, cond: "good", purpose: "Workshop menulis ilmiah" },
  { user: "fajar", item: "mic", start: "2026-09-28", days: 1, late: 1, cond: "good", purpose: "Seminar nasional" },
  { user: "siti", item: "canon", start: "2026-10-05", days: 2, late: 0, cond: "good", purpose: "Liputan kegiatan dosen" },
  { user: "demo", item: "hdmi", start: "2026-10-07", days: 1, late: 0, cond: "good", purpose: "Nonton bareng materi kuliah" },
  { user: "yoga", item: "epson", start: "2026-10-12", days: 2, late: 2, cond: "good", purpose: "Presentasi KKN" },
  { user: "rina", item: "asus", start: "2026-10-19", days: 3, late: 0, cond: "good", purpose: "Lomba karya tulis" },
  { user: "dimas", item: "arduino", start: "2026-10-26", days: 3, late: 0, cond: "major_damage", purpose: "Proyek mikrokontroler", notes: "Board Arduino terbakar, sensor hilang" },
  { user: "fajar", item: "layar", start: "2026-11-02", days: 1, late: 0, cond: "good", purpose: "Pemutaran film edukasi" },
  { user: "siti", item: "pointer", start: "2026-11-04", days: 1, late: 0, cond: "good", purpose: "Seminar hasil" },
  { user: "demo", item: "mic", start: "2026-11-09", days: 1, late: 0, cond: "minor_damage", purpose: "Acara diskusi kelas", notes: "Busa mikrofon sobek" },
  { user: "rina", item: "tripod", start: "2026-11-11", days: 2, late: 0, cond: "good", purpose: "Rekaman podcast" },
  { user: "nadia", item: "hdmi", start: "2026-11-16", days: 1, late: 0, cond: "good", purpose: "Presentasi magang" },
];

// Pengajuan / peminjaman aktif — tanggal relatif terhadap hari ini (WIB)
//   stage: pending   → antrean persetujuan Kadep
//          rejected  → riwayat persetujuan (ditolak)
//          approved  → menunggu serah terima Tendik
//          borrowed  → sedang dipinjam (offset negatif pada due = terlambat)
const ACTIVE = [
  { stage: "borrowed", user: "nadia", item: "lenovo", start: -2, days: 4, purpose: "Pengerjaan laporan magang" },
  { stage: "borrowed", user: "demo", item: "canon", start: -1, days: 4, purpose: "Dokumentasi lomba fotografi" },
  { stage: "borrowed", user: "dimas", item: "jbl", start: -5, days: 3, purpose: "Acara malam keakraban" },
  { stage: "borrowed", user: "yoga", item: "hdmi", start: -3, days: 2, purpose: "Persiapan sidang KKN" },
  { stage: "approved", user: "fajar", item: "epson", start: 0, days: 2, purpose: "Presentasi proposal PKM", startHour: 13 },
  { stage: "approved", user: "siti", item: "tripod", start: 1, days: 2, purpose: "Perekaman wawancara narasumber" },
  { stage: "pending", user: "demo", item: "benq", start: 2, days: 2, purpose: "Presentasi tugas besar kelompok" },
  { stage: "pending", user: "siti", item: "benq", start: 3, days: 2, purpose: "Seminar proposal skripsi" },
  { stage: "pending", user: "rina", item: "mic", start: 1, days: 1, purpose: "MC acara wisuda departemen" },
  { stage: "pending", user: "yoga", item: "asus", start: 1, days: 3, purpose: "Input data posyandu KKN" },
  { stage: "pending", user: "nadia", item: "pointer", start: 4, days: 1, purpose: "Presentasi lomba esai" },
  { stage: "rejected", user: "dimas", item: "canon", start: 5, days: 3, purpose: "Liburan pribadi", reason: "Keperluan bukan kegiatan akademik/departemen" },
];

// ─── Helper waktu (WIB = UTC+7) ─────────────────────────────────────────────

function todayWib() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Tanggal "YYYY-MM-DD" + jam WIB → Date
function wib(dateStr, hour = 8, minute = 0) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dateStr}T${hh}:${mm}:00+07:00`);
}

// ─── Seeder ─────────────────────────────────────────────────────────────────

const client = await db.connect();

async function audit(actorId, action, entityType, entityId, details, occurredAt) {
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, action, entityType, entityId, JSON.stringify(details), occurredAt]
  );
}

async function upsertUser(u, role, hash) {
  const { rows } = await client.query(
    `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
     SELECT role_id, $1, $2, $3, 'approved', 'local', TRUE, TRUE FROM roles WHERE role_name = $4
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING user_id`,
    [u.full_name, u.email, hash, role]
  );
  return rows[0].user_id;
}

try {
  await client.query("BEGIN");
  const hash = await bcrypt.hash(PASSWORD, 10);
  const today = todayWib();

  // Aturan poin & level yang sedang berlaku (bisa sudah diubah Kadep)
  const settings = await getPointSettings(client);
  const calculateLevel = (balance) => calcLevel(balance, settings.levels);
  const calculatePointDelta = (opts) => calcDelta({ ...opts, rules: settings.rules });

  // 1. Akun
  const ids = {};
  for (const s of STAFF) ids[s.key] = await upsertUser(s, s.role, hash);
  for (const b of BORROWERS) ids[b.key] = await upsertUser(b, "Peminjam", hash);
  console.log(`Akun siap: ${STAFF.length} staf, ${BORROWERS.length} peminjam`);

  // 2. Kategori & barang
  const catIds = {};
  for (const name of CATEGORIES) {
    const { rows } = await client.query(
      `INSERT INTO item_categories (category_name) VALUES ($1)
       ON CONFLICT (category_name) DO UPDATE SET category_name = EXCLUDED.category_name
       RETURNING category_id`,
      [name]
    );
    catIds[name] = rows[0].category_id;
  }
  const itemIds = {};
  const itemNames = {};
  let newItems = 0;
  for (const it of ITEMS) {
    const found = await client.query("SELECT item_id FROM items WHERE item_name = $1 LIMIT 1", [it.name]);
    if (found.rows.length) {
      itemIds[it.key] = found.rows[0].item_id;
    } else {
      const { rows } = await client.query(
        `INSERT INTO items (category_id, item_name, item_condition, availability_status, is_active, created_at)
         VALUES ($1, $2, 'good', 'available', TRUE, '2026-01-15T09:00:00+07:00') RETURNING item_id`,
        [catIds[it.cat], it.name]
      );
      itemIds[it.key] = rows[0].item_id;
      newItems++;
      await audit(ids.tendik, "create_item", "item", rows[0].item_id,
        { item_name: it.name, category: it.cat }, "2026-01-15T09:00:00+07:00");
    }
    itemNames[it.key] = it.name;
  }
  console.log(`Kategori: ${CATEGORIES.length}, barang: ${ITEMS.length} (${newItems} baru)`);

  // 3. Reward & periode
  const rewardIds = {};
  for (const r of REWARDS) {
    const found = await client.query("SELECT reward_id FROM rewards WHERE reward_name = $1 LIMIT 1", [r.name]);
    rewardIds[r.name] = found.rows[0]?.reward_id
      ?? (await client.query("INSERT INTO rewards (reward_name, description) VALUES ($1, $2) RETURNING reward_id",
        [r.name, r.description])).rows[0].reward_id;
  }
  const periodIds = {};
  for (const p of PERIODS) {
    const found = await client.query("SELECT period_id FROM reward_periods WHERE period_name = $1 LIMIT 1", [p.name]);
    if (found.rows.length) {
      periodIds[p.key] = found.rows[0].period_id;
    } else {
      const { rows } = await client.query(
        `INSERT INTO reward_periods (period_name, started_at, ended_at, is_active) VALUES ($1, $2, $3, $4) RETURNING period_id`,
        [p.name, p.start, p.end, p.active]
      );
      periodIds[p.key] = rows[0].period_id;
      await audit(ids.kadep, "create_reward_period", "reward_period", rows[0].period_id,
        { period_name: p.name, started_at: p.start, ended_at: p.end, is_active: p.active }, wib(p.start, 7));
    }
  }
  console.log(`Reward: ${REWARDS.length}, periode: ${PERIODS.length}`);

  // 4. Peminjaman — hanya sekali
  const already = await client.query(
    "SELECT 1 FROM loan_requests WHERE borrower_id = $1 LIMIT 1",
    [ids.rina]
  );
  if (already.rows.length) {
    console.log("Data peminjaman demo sudah ada — dilewati.");
  } else {
    // Saldo poin berjalan per peminjam (mulai dari saldo yang sudah ada)
    const balance = {};
    for (const b of BORROWERS) {
      const { rows } = await client.query(
        `INSERT INTO user_gamifications (user_id, point_balance, discipline_level) VALUES ($1, 0, 'beginner')
         ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING point_balance`,
        [ids[b.key]]
      );
      balance[b.key] = rows[0].point_balance;
    }
    const itemState = {}; // kondisi & status terakhir tiap barang

    // 4a. Riwayat pengembalian (urut kronologis supaya saldo dihitung benar)
    const history = [...HISTORY].sort((a, b) => a.start.localeCompare(b.start));
    let pointTxCount = 0;
    for (const h of history) {
      const borrowerId = ids[h.user];
      const itemId = itemIds[h.item];
      const startAt = wib(h.start, 8);
      const dueAt = wib(addDays(h.start, h.days), 16);
      const submittedAt = wib(addDays(h.start, -2), 10);
      const decidedAt = wib(addDays(h.start, -1), 9);
      const returnedAt = h.late > 0 ? wib(addDays(h.start, h.days + h.late), 10) : wib(addDays(h.start, h.days), 14);

      const { rows: req } = await client.query(
        `INSERT INTO loan_requests (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed') RETURNING request_id`,
        [borrowerId, itemId, h.purpose, startAt, dueAt, submittedAt, addDays(h.start, -2)]
      );
      const requestId = req[0].request_id;
      await client.query(
        `INSERT INTO approval_decisions (request_id, approver_id, decision, reason, decided_at) VALUES ($1, $2, 'approved', NULL, $3)`,
        [requestId, ids.kadep, decidedAt]
      );
      const { rows: lt } = await client.query(
        `INSERT INTO loan_transactions (request_id, handover_by, handover_at, due_at, transaction_status)
         VALUES ($1, $2, $3, $4, 'returned') RETURNING loan_id`,
        [requestId, ids.tendik, startAt, dueAt]
      );
      const loanId = lt[0].loan_id;
      const { rows: insp } = await client.query(
        `INSERT INTO return_inspections (loan_id, confirmed_by, returned_at, confirmed_at, return_condition, notes, late_days)
         VALUES ($1, $2, $3, $3, $4, $5, $6) RETURNING inspection_id`,
        [loanId, ids.tendik, returnedAt, h.cond, h.notes ?? null, h.late]
      );

      // Poin — rumus sama dengan returnService.confirmReturn
      const { delta, breakdown } = calculatePointDelta({ lateDays: h.late, returnCondition: h.cond });
      const newBalance = Math.max(0, balance[h.user] + delta);
      const actualDelta = newBalance - balance[h.user];
      balance[h.user] = newBalance;
      if (actualDelta !== 0) {
        await client.query(
          `INSERT INTO point_transactions (user_id, loan_id, points_delta, transaction_type, reason, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            borrowerId, loanId, actualDelta, h.late > 0 ? "late_penalty" : "on_time_return",
            `Pengembalian ${itemNames[h.item]}: ${h.late > 0 ? `terlambat ${h.late} hari, ` : "tepat waktu, "}kondisi ${h.cond}`,
            returnedAt,
          ]
        );
        pointTxCount++;
      }
      itemState[h.item] = { cond: h.cond, status: getItemStatusAfterReturn(h.cond) };

      await audit(ids.kadep, "approve_loan_request", "loan_request", requestId,
        { item_name: itemNames[h.item], borrower_id: borrowerId }, decidedAt);
      await audit(ids.tendik, "handover_loan", "loan_transaction", loanId,
        { request_id: requestId, item_name: itemNames[h.item], due_at: dueAt }, startAt);
      await audit(ids.tendik, "confirm_return", "return_inspection", insp[0].inspection_id, {
        loan_id: loanId, item_name: itemNames[h.item], borrower_id: borrowerId, return_condition: h.cond,
        late_days: h.late, point_delta: actualDelta, new_balance: newBalance, new_level: calculateLevel(newBalance), breakdown,
      }, returnedAt);
    }

    for (const b of BORROWERS) {
      await client.query(
        "UPDATE user_gamifications SET point_balance = $1, discipline_level = $2 WHERE user_id = $3",
        [balance[b.key], calculateLevel(balance[b.key]), ids[b.key]]
      );
    }
    for (const [key, st] of Object.entries(itemState)) {
      await client.query(
        "UPDATE items SET item_condition = $1, availability_status = $2 WHERE item_id = $3",
        [st.cond, st.status, itemIds[key]]
      );
    }
    console.log(`Riwayat: ${history.length} pengembalian, ${pointTxCount} transaksi poin`);

    // 4b. Pengajuan & peminjaman aktif
    const counts = {};
    for (const a of ACTIVE) {
      const borrowerId = ids[a.user];
      const itemId = itemIds[a.item];
      const startDate = addDays(today, a.start);
      const startAt = wib(startDate, a.startHour ?? 8);
      const endAt = wib(addDays(startDate, a.days), 16);
      const submittedAt = a.stage === "pending"
        ? new Date(Date.now() - (2 + Math.floor(Math.random() * 20)) * 60 * 60 * 1000)
        : wib(addDays(today, Math.min(a.start, 0) - 2), 10);
      const status = a.stage === "borrowed" ? "completed" : a.stage;

      const { rows: req } = await client.query(
        `INSERT INTO loan_requests (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8) RETURNING request_id`,
        [borrowerId, itemId, a.purpose, startAt, endAt, submittedAt,
          a.stage === "pending" ? today : addDays(today, Math.min(a.start, 0) - 2), status]
      );
      const requestId = req[0].request_id;
      await audit(borrowerId, "create_loan_request", "loan_request", requestId,
        { item_id: itemId, item_name: itemNames[a.item], purpose: a.purpose }, submittedAt);

      if (a.stage !== "pending") {
        const decidedAt = new Date(submittedAt.getTime() + 3 * 60 * 60 * 1000);
        const decision = a.stage === "rejected" ? "rejected" : "approved";
        await client.query(
          `INSERT INTO approval_decisions (request_id, approver_id, decision, reason, decided_at) VALUES ($1, $2, $3, $4, $5)`,
          [requestId, ids.kadep, decision, a.reason ?? null, decidedAt]
        );
        await audit(ids.kadep, `${decision === "approved" ? "approve" : "reject"}_loan_request`, "loan_request", requestId,
          { item_name: itemNames[a.item], borrower_id: borrowerId, reason: a.reason ?? null }, decidedAt);
      }

      if (a.stage === "borrowed") {
        const { rows: lt } = await client.query(
          `INSERT INTO loan_transactions (request_id, handover_by, handover_at, due_at, transaction_status)
           VALUES ($1, $2, $3, $4, 'borrowed') RETURNING loan_id`,
          [requestId, ids.tendik, startAt, endAt]
        );
        await client.query("UPDATE items SET availability_status = 'borrowed' WHERE item_id = $1", [itemId]);
        await audit(ids.tendik, "handover_loan", "loan_transaction", lt[0].loan_id,
          { request_id: requestId, item_name: itemNames[a.item], due_at: endAt }, startAt);
      }
      const label = a.stage === "borrowed" && endAt.getTime() < Date.now() ? "terlambat" : a.stage;
      counts[label] = (counts[label] || 0) + 1;
    }
    console.log("Pengajuan aktif:", counts);
  }

  // 5. Pemenang periode lalu
  let newAwards = 0;
  for (const aw of AWARDS) {
    const period = PERIODS.find((p) => p.key === aw.period);
    const { rows } = await client.query(
      `INSERT INTO reward_awards (period_id, reward_id, user_id, note, awarded_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (period_id, reward_id, user_id) DO NOTHING RETURNING award_id`,
      [periodIds[aw.period], rewardIds[aw.reward], ids[aw.user], aw.note, wib(addDays(period.end, 3), 10)]
    );
    if (rows.length) {
      newAwards++;
      await audit(ids.kadep, "give_reward_award", "reward_award", rows[0].award_id, {
        period_name: period.name, reward_name: aw.reward, user_id: ids[aw.user], note: aw.note,
      }, wib(addDays(period.end, 3), 10));
    }
  }
  console.log(`Pemenang reward baru: ${newAwards}`);

  await client.query("COMMIT");

  const { rows: summary } = await db.query(
    `SELECT u.full_name, ug.point_balance, ug.discipline_level
       FROM user_gamifications ug JOIN users u USING (user_id)
      WHERE u.email = ANY($1) ORDER BY ug.point_balance DESC`,
    [BORROWERS.map((b) => b.email)]
  );
  console.table(summary);
  console.log(`\nLogin (password: ${PASSWORD}):`);
  for (const u of [...STAFF, ...BORROWERS]) console.log(`  ${u.email}`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Seed gagal:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await db.end();
}
