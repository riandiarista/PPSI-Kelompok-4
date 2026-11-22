import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.js";
import db from "../src/config/db.js";
import { todayWib } from "../src/services/loanService.js";

let server;
let baseUrl;
let peminjamToken;
let tendikToken;
let kadepToken;
let peminjamId;
let tendikId;
let kadepId;

let testCategoryId;
let testItemId;
let userAId;
let userBId;
let userCId;
let createdRequestIds = [];

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function req(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function login(email) {
  const res = await req("/api/auth/login", { method: "POST", body: { email, password: "password123" } });
  return res.body?.data;
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const p = await login("peminjam@demo.test");
  const t = await login("tendik@demo.test");
  const k = await login("kadep@demo.test");
  assert.ok(p && t && k, "Akun demo belum lengkap. Jalankan: npm run seed:dev");

  peminjamToken = p.token;
  peminjamId = p.user.user_id;
  tendikToken = t.token;
  tendikId = t.user.user_id;
  kadepToken = k.token;
  kadepId = k.user.user_id;

  const stamp = Date.now();

  // Buat kategori dan barang khusus pengujian rekomendasi
  const cat = await db.query(
    "INSERT INTO item_categories (category_name) VALUES ($1) RETURNING category_id",
    [`Kategori Prioritas Tes ${stamp}`]
  );
  testCategoryId = cat.rows[0].category_id;

  const item = await db.query(
    `INSERT INTO items (category_id, item_name, availability_status)
     VALUES ($1, $2, 'available')
     RETURNING item_id`,
    [testCategoryId, `Barang Prioritas Tes ${stamp}`]
  );
  testItemId = item.rows[0].item_id;

  // Dapatkan role_id Peminjam
  const roleRes = await db.query("SELECT role_id FROM roles WHERE role_name = 'Peminjam'");
  const rolePeminjamId = roleRes.rows[0].role_id;

  // Buat 3 user peminjam khusus pengujian dengan poin berbeda
  // User A: 300 poin
  const uA = await db.query(
    `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
     VALUES ($1, $2, $3, 'hash123', 'approved', 'local', TRUE, TRUE)
     RETURNING user_id`,
    [rolePeminjamId, `Peminjam A Poin 300 ${stamp}`, `peminjam.a.${stamp}@test.local`]
  );
  userAId = uA.rows[0].user_id;
  await db.query(
    `INSERT INTO user_gamifications (user_id, point_balance, discipline_level)
     VALUES ($1, 300, 'gold')
     ON CONFLICT (user_id) DO UPDATE SET point_balance = 300, discipline_level = 'gold'`,
    [userAId]
  );

  // User B: 150 poin
  const uB = await db.query(
    `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
     VALUES ($1, $2, $3, 'hash123', 'approved', 'local', TRUE, TRUE)
     RETURNING user_id`,
    [rolePeminjamId, `Peminjam B Poin 150 ${stamp}`, `peminjam.b.${stamp}@test.local`]
  );
  userBId = uB.rows[0].user_id;
  await db.query(
    `INSERT INTO user_gamifications (user_id, point_balance, discipline_level)
     VALUES ($1, 150, 'silver')
     ON CONFLICT (user_id) DO UPDATE SET point_balance = 150, discipline_level = 'silver'`,
    [userBId]
  );

  // User C: 150 poin (sama dengan User B untuk uji tie breaker)
  const uC = await db.query(
    `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
     VALUES ($1, $2, $3, 'hash123', 'approved', 'local', TRUE, TRUE)
     RETURNING user_id`,
    [rolePeminjamId, `Peminjam C Poin 150 ${stamp}`, `peminjam.c.${stamp}@test.local`]
  );
  userCId = uC.rows[0].user_id;
  await db.query(
    `INSERT INTO user_gamifications (user_id, point_balance, discipline_level)
     VALUES ($1, 150, 'silver')
     ON CONFLICT (user_id) DO UPDATE SET point_balance = 150, discipline_level = 'silver'`,
    [userCId]
  );
});

after(async () => {
  if (createdRequestIds.length > 0) {
    await db.query("DELETE FROM approval_decisions WHERE request_id = ANY($1)", [createdRequestIds]);
    await db.query("DELETE FROM loan_requests WHERE request_id = ANY($1)", [createdRequestIds]);
  }
  if (testItemId) {
    await db.query("DELETE FROM items WHERE item_id = $1", [testItemId]);
  }
  if (testCategoryId) {
    await db.query("DELETE FROM item_categories WHERE category_id = $1", [testCategoryId]);
  }
  if (userAId && userBId && userCId) {
    await db.query("DELETE FROM user_gamifications WHERE user_id IN ($1, $2, $3)", [userAId, userBId, userCId]);
    await db.query("DELETE FROM users WHERE user_id IN ($1, $2, $3)", [userAId, userBId, userCId]);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.end();
});

describe("Rekomendasi Prioritas Peminjam Khusus Kadep", () => {
  test("Otorisasi: Hanya Kadep yang boleh mengakses rekomendasi prioritas", async () => {
    // Tanpa token -> 401
    const resNoAuth = await req("/api/loans/priority-recommendations");
    assert.equal(resNoAuth.status, 401);

    // Peminjam -> 403
    const resPeminjam = await req("/api/loans/priority-recommendations", { token: peminjamToken });
    assert.equal(resPeminjam.status, 403);

    // Tendik -> 403
    const resTendik = await req("/api/loans/priority-recommendations", { token: tendikToken });
    assert.equal(resTendik.status, 403);

    // Kadep -> 200
    const resKadep = await req("/api/loans/priority-recommendations", { token: kadepToken });
    assert.equal(resKadep.status, 200);
    assert.equal(resKadep.body.success, true);
    assert.equal(resKadep.body.data.is_non_binding, true);
    assert.match(resKadep.body.data.disclaimer, /non-binding/i);
  });

  test("Dikelompokkan per tanggal peminjaman dan diurutkan total poin tertinggi ke terendah", async () => {
    const targetDate1 = addDays(todayWib(), 7); // Tanggal 1
    const targetDate2 = addDays(todayWib(), 8); // Tanggal 2

    // Buat pengajuan di Tanggal 1 untuk User A (300 poin) dan User B (150 poin)
    const req1A = await db.query(
      `INSERT INTO loan_requests
         (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
       VALUES ($1, $2, 'Riset Robotik A', $3::timestamptz, $3::timestamptz + INTERVAL '2 days', NOW() - INTERVAL '1 hour', $4, 'pending')
       RETURNING request_id`,
      [userAId, testItemId, `${targetDate1}T00:00:00+07:00`, todayWib()]
    );
    createdRequestIds.push(req1A.rows[0].request_id);

    const req1B = await db.query(
      `INSERT INTO loan_requests
         (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
       VALUES ($1, $2, 'Praktikum B', $3::timestamptz, $3::timestamptz + INTERVAL '2 days', NOW() - INTERVAL '2 hours', $4, 'pending')
       RETURNING request_id`,
      [userBId, testItemId, `${targetDate1}T00:00:00+07:00`, todayWib()]
    );
    createdRequestIds.push(req1B.rows[0].request_id);

    // Buat pengajuan di Tanggal 2 untuk User B (150 poin)
    const req2B = await db.query(
      `INSERT INTO loan_requests
         (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
       VALUES ($1, $2, 'Seminar C', $3::timestamptz, $3::timestamptz + INTERVAL '1 day', NOW(), $4, 'pending')
       RETURNING request_id`,
      [userBId, testItemId, `${targetDate2}T00:00:00+07:00`, todayWib()]
    );
    createdRequestIds.push(req2B.rows[0].request_id);

    // Panggil API rekomendasi
    const res = await req("/api/loans/priority-recommendations", { token: kadepToken });
    assert.equal(res.status, 200);

    const groups = res.body.data.groups;
    const group1 = groups.find((g) => g.loan_date === targetDate1);
    const group2 = groups.find((g) => g.loan_date === targetDate2);

    assert.ok(group1, `Grup untuk tanggal ${targetDate1} harus ditemukan`);
    assert.ok(group2, `Grup untuk tanggal ${targetDate2} harus ditemukan`);

    // Di Tanggal 1: User A (300 poin) harus peringkat lebih tinggi daripada User B (150 poin)
    const testItems = group1.items.filter((it) => it.item_id === testItemId);
    assert.equal(testItems.length, 2);
    const rank1 = testItems[0];
    const rank2 = testItems[1];

    assert.equal(rank1.borrower_id, userAId);
    assert.equal(rank1.total_points, 300);
    assert.equal(rank1.recommendation_status, "Direkomendasikan");
    assert.match(rank1.point_comparison, /\+150 poin/);

    assert.equal(rank2.borrower_id, userBId);
    assert.equal(rank2.total_points, 150);
    assert.equal(rank2.recommendation_status, "Perlu tinjauan Kadep");
    assert.match(rank2.point_comparison, /-150 poin/);

    // Tie breaker TIDAK berlaku di tanggal 1 karena poin berbeda (300 vs 150)
    assert.equal(rank1.tie_breaker_applied, false);
    assert.equal(rank2.tie_breaker_applied, false);
  });

  test("Tie breaker HANYA berlaku bila total poin sama pada tanggal yang sama", async () => {
    const targetDateTie = addDays(todayWib(), 12);

    // User B (150 poin) mengajukan lebih lambat (jam 10:00)
    // User C (150 poin) mengajukan lebih awal (jam 08:00)
    const timeB = new Date(`${targetDateTie}T10:00:00+07:00`);
    const timeC = new Date(`${targetDateTie}T08:00:00+07:00`);

    const reqB = await db.query(
      `INSERT INTO loan_requests
         (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
       VALUES ($1, $2, 'Proyek B (Sama Poin)', $3::timestamptz, $3::timestamptz + INTERVAL '2 days', $4, $5, 'pending')
       RETURNING request_id`,
      [userBId, testItemId, `${targetDateTie}T00:00:00+07:00`, timeB, todayWib()]
    );
    createdRequestIds.push(reqB.rows[0].request_id);

    const reqC = await db.query(
      `INSERT INTO loan_requests
         (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
       VALUES ($1, $2, 'Proyek C (Sama Poin Lebih Awal)', $3::timestamptz, $3::timestamptz + INTERVAL '2 days', $4, $5, 'pending')
       RETURNING request_id`,
      [userCId, testItemId, `${targetDateTie}T00:00:00+07:00`, timeC, todayWib()]
    );
    createdRequestIds.push(reqC.rows[0].request_id);

    const res = await req(`/api/loans/priority-recommendations?date=${targetDateTie}`, { token: kadepToken });
    assert.equal(res.status, 200);

    const groups = res.body.data.groups;
    const groupTie = groups.find((g) => g.loan_date === targetDateTie);
    assert.ok(groupTie, `Grup tie-breaker untuk tanggal ${targetDateTie} harus ditemukan`);
    const testTieItems = groupTie.items.filter((it) => it.item_id === testItemId);
    assert.equal(testTieItems.length, 2);

    const topItem = testTieItems[0];
    const secondItem = testTieItems[1];

    // Karena poin sama (150 vs 150), User C yang mengajukan lebih dulu (08:00) harus menjadi prioritas lebih tinggi dibanding User B (10:00)
    assert.equal(topItem.borrower_id, userCId, "User C harus peringkat lebih tinggi karena mengajukan lebih awal");
    assert.equal(topItem.total_points, 150);
    assert.equal(topItem.tie_breaker_applied, true, "Tie breaker harus aktif karena poin sama");
    assert.ok(topItem.tie_breaker_note, "Harus ada catatan penjelasan tie breaker");

    assert.equal(secondItem.borrower_id, userBId, "User B harus berada di bawah User C karena mengajukan lebih lambat");
    assert.equal(secondItem.total_points, 150);
    assert.equal(secondItem.tie_breaker_applied, true);

    // Keduanya memuat perbandingan poin
    assert.match(topItem.point_comparison, /tie-breaker/i);
    assert.match(secondItem.point_comparison, /peringkat #2 karena waktu pengajuan/i);
  });

  test("Rekomendasi menampilkan semua atribut wajib: nama, tanggal, total poin, peringkat, perbandingan poin, keperluan, dan status", async () => {
    const res = await req("/api/loans/priority-recommendations", { token: kadepToken });
    assert.equal(res.status, 200);

    const groups = res.body.data.groups;
    assert.ok(groups.length > 0, "Harus ada minimal satu grup tanggal");

    for (const group of groups) {
      assert.ok(group.loan_date, "Grup harus memuat tanggal peminjaman (loan_date)");
      assert.ok(group.loan_date_formatted, "Grup harus memuat format tanggal peminjaman");

      for (const item of group.items) {
        // 1. Nama
        assert.ok(item.borrower_name, "Item harus memuat nama peminjam");
        // 2. Tanggal
        assert.ok(item.loan_date, "Item harus memuat tanggal peminjaman");
        // 3. Total Poin
        assert.equal(typeof item.total_points, "number", "Item harus memuat total poin numerik");
        // 4. Peringkat
        assert.ok(item.rank >= 1, "Item harus memuat peringkat (rank >= 1)");
        // 5. Perbandingan poin antar peminjam di tanggal yang sama
        assert.ok(item.point_comparison, "Item harus memuat teks perbandingan poin");
        assert.ok(Array.isArray(item.peers_comparison), "Item harus memuat array perbandingan rekanan");
        // 6. Keperluan
        assert.ok(item.purpose, "Item harus memuat keperluan peminjaman");
        // 7. Status (Direkomendasikan / Perlu tinjauan Kadep)
        assert.ok(
          ["Direkomendasikan", "Perlu tinjauan Kadep"].includes(item.recommendation_status),
          `Status harus 'Direkomendasikan' atau 'Perlu tinjauan Kadep', dapat: ${item.recommendation_status}`
        );
      }
    }
  });

  test("Rekomendasi bersifat non-binding: Kadep tetap bisa menyetujui pengajuan peringkat ke-2", async () => {
    // Ambil pengajuan peringkat ke-2 dari tes sebelumnya
    const targetDateTie = addDays(todayWib(), 12);
    const res = await req(`/api/loans/priority-recommendations?date=${targetDateTie}`, { token: kadepToken });
    const group = res.body.data.groups.find((g) => g.loan_date === targetDateTie);
    const testItems = group.items.filter((it) => it.item_id === testItemId);
    const secondRankItem = testItems.find((it) => it.borrower_id === userBId);

    assert.ok(secondRankItem, "Pengajuan User B (prioritas kedua) harus ada");
    assert.equal(secondRankItem.recommendation_status, "Perlu tinjauan Kadep");

    // Kadep memutuskan menyetujui pengajuan peringkat 2 (non-binding decision)
    const approveRes = await req(`/api/loans/${secondRankItem.request_id}/approve`, {
      method: "POST",
      token: kadepToken,
    });
    assert.equal(approveRes.status, 200, "Kadep harus berhasil menyetujui pengajuan peringkat 2");
    assert.equal(approveRes.body.data.request_status, "approved");
  });
});
