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
let otherPeminjamId;
let kadepId;
let categoryId;
let itemId;

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const base = addDays(todayWib(), 5);

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

// Helper untuk memasukkan pengajuan peminjaman langsung ke database
async function insertLoanRequest({
  borrowerId,
  itemId: targetItemId = itemId,
  purpose = "Keperluan riset",
  startDate,
  days = 2,
  submittedAt = new Date(),
  reviewQueueDate = todayWib(),
  status = "pending",
}) {
  const startIso = `${startDate}T00:00:00+07:00`;
  const { rows } = await db.query(
    `INSERT INTO loan_requests
       (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
     VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(days => $5), $6, $7, $8)
     RETURNING request_id, borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status`,
    [borrowerId, targetItemId, purpose, startIso, days, submittedAt, reviewQueueDate, status]
  );
  return rows[0];
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
  kadepToken = k.token;
  kadepId = k.user.user_id;
  otherPeminjamId = t.user.user_id; // User lain untuk data bentrok/peminjam kedua

  const stamp = Date.now();
  const cat = await db.query(
    "INSERT INTO item_categories (category_name) VALUES ($1) RETURNING category_id",
    [`Kategori Approval Tes ${stamp}`]
  );
  categoryId = cat.rows[0].category_id;

  const itemRes = await db.query(
    `INSERT INTO items (category_id, item_name, availability_status)
     VALUES ($1, $2, 'available')
     RETURNING item_id`,
    [categoryId, `Barang Approval Tes ${stamp}`]
  );
  itemId = itemRes.rows[0].item_id;
});

after(async () => {
  if (categoryId) {
    await db.query("DELETE FROM approval_decisions WHERE request_id IN (SELECT request_id FROM loan_requests WHERE item_id = $1)", [itemId]);
    await db.query("DELETE FROM loan_requests WHERE item_id = $1", [itemId]);
    await db.query("DELETE FROM items WHERE category_id = $1", [categoryId]);
    await db.query("DELETE FROM item_categories WHERE category_id = $1", [categoryId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.end();
});

describe("Persetujuan / Penolakan Peminjaman oleh Kadep", () => {
  test("Otorisasi: Hanya role Kadep yang boleh mengakses antrean dan memutuskan", async () => {
    const queuePeminjam = await req("/api/loans/queue", { token: peminjamToken });
    assert.equal(queuePeminjam.status, 403);

    const queueTendik = await req("/api/loans/queue", { token: tendikToken });
    assert.equal(queueTendik.status, 403);

    const queueKadep = await req("/api/loans/queue", { token: kadepToken });
    assert.equal(queueKadep.status, 200);
    assert.ok(Array.isArray(queueKadep.body.data));
    assert.ok(queueKadep.body.counts !== undefined);

    // Coba aksi persetujuan oleh non-Kadep
    const approveTendik = await req("/api/loans/999999/approve", { method: "POST", token: tendikToken });
    assert.equal(approveTendik.status, 403);

    const rejectPeminjam = await req("/api/loans/999999/reject", {
      method: "POST",
      token: peminjamToken,
      body: { reason: "coba tolak" },
    });
    assert.equal(rejectPeminjam.status, 403);
  });

  test("Menyetujui pengajuan pending berhasil dan TIDAK mengubah items.availability_status", async () => {
    const loan = await insertLoanRequest({
      borrowerId: peminjamId,
      startDate: addDays(base, 1),
      days: 2,
    });

    const res = await req(`/api/loans/${loan.request_id}/approve`, {
      method: "POST",
      token: kadepToken,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.request_status, "approved");

    // Periksa tabel loan_requests
    const { rows: reqRows } = await db.query(
      "SELECT request_status FROM loan_requests WHERE request_id = $1",
      [loan.request_id]
    );
    assert.equal(reqRows[0].request_status, "approved");

    // Periksa tabel approval_decisions
    const { rows: decRows } = await db.query(
      "SELECT approver_id, decision, reason FROM approval_decisions WHERE request_id = $1",
      [loan.request_id]
    );
    assert.equal(decRows.length, 1);
    assert.equal(decRows[0].approver_id, kadepId);
    assert.equal(decRows[0].decision, "approved");
    assert.equal(decRows[0].reason, null);

    // Periksa items.availability_status: HARUS TETAP 'available' (aturan #4)
    const { rows: itemRows } = await db.query(
      "SELECT availability_status FROM items WHERE item_id = $1",
      [itemId]
    );
    assert.equal(
      itemRows[0].availability_status,
      "available",
      "Persetujuan tidak boleh mengubah items.availability_status"
    );

    // Periksa audit_logs
    const { rows: auditRows } = await db.query(
      `SELECT action_type, actor_user_id, entity_id FROM audit_logs
        WHERE action_type = 'approve_loan_request' AND entity_id = $1`,
      [loan.request_id]
    );
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].actor_user_id, kadepId);
  });

  test("Hanya pengajuan berstatus 'pending' yang bisa diputuskan -> 409 jika sudah diputuskan", async () => {
    const loan = await insertLoanRequest({
      borrowerId: peminjamId,
      startDate: addDays(base, 5),
      days: 1,
    });

    // Keputusan pertama: setujui
    const first = await req(`/api/loans/${loan.request_id}/approve`, {
      method: "POST",
      token: kadepToken,
    });
    assert.equal(first.status, 200);

    // Keputusan kedua pada pengajuan yang sama: harus ditolak dengan 409 (bukan 500)
    const secondApprove = await req(`/api/loans/${loan.request_id}/approve`, {
      method: "POST",
      token: kadepToken,
    });
    assert.equal(secondApprove.status, 409);
    assert.match(secondApprove.body.message, /sudah berstatus 'approved'/);

    const secondReject = await req(`/api/loans/${loan.request_id}/reject`, {
      method: "POST",
      token: kadepToken,
      body: { reason: "Tolak yang sudah disetujui" },
    });
    assert.equal(secondReject.status, 409);
    assert.match(secondReject.body.message, /sudah berstatus/);
  });

  test("Menolak WAJIB menyertakan alasan (trim, tidak kosong, maks 500 karakter)", async () => {
    const loan = await insertLoanRequest({
      borrowerId: peminjamId,
      startDate: addDays(base, 8),
      days: 2,
    });

    // Tanpa alasan -> 400
    const noReason = await req(`/api/loans/${loan.request_id}/reject`, {
      method: "POST",
      token: kadepToken,
      body: {},
    });
    assert.equal(noReason.status, 400);
    assert.match(noReason.body.message, /Alasan penolakan wajib diisi/);

    // Alasan hanya spasi putih -> 400
    const emptySpaces = await req(`/api/loans/${loan.request_id}/reject`, {
      method: "POST",
      token: kadepToken,
      body: { reason: "     " },
    });
    assert.equal(emptySpaces.status, 400);
    assert.match(emptySpaces.body.message, /Alasan penolakan wajib diisi/);

    // Alasan lebih dari 500 karakter -> 400
    const tooLong = await req(`/api/loans/${loan.request_id}/reject`, {
      method: "POST",
      token: kadepToken,
      body: { reason: "A".repeat(501) },
    });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body.message, /maksimal 500 karakter/);

    // Alasan valid (dengan spasi di awal/akhir) -> 200, ditrim di database
    const valid = await req(`/api/loans/${loan.request_id}/reject`, {
      method: "POST",
      token: kadepToken,
      body: { reason: "  Barang sedang dialokasikan untuk kegiatan akreditasi departemen.  " },
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.body.success, true);
    assert.equal(valid.body.data.request_status, "rejected");

    const { rows } = await db.query(
      "SELECT reason FROM approval_decisions WHERE request_id = $1",
      [loan.request_id]
    );
    assert.equal(rows[0].reason, "Barang sedang dialokasikan untuk kegiatan akreditasi departemen.");
  });

  test("Pengajuan yang planned_end_at-nya sudah lewat tidak boleh disetujui (409, sarankan ditolak)", async () => {
    // Buat pengajuan di masa lampau: kemarin sampai tadi pagi
    const { rows } = await db.query(
      `INSERT INTO loan_requests
         (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
       VALUES ($1, $2, 'lampau', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '2 days', CURRENT_DATE, 'pending')
       RETURNING request_id`,
      [peminjamId, itemId]
    );
    const expiredLoanId = rows[0].request_id;

    // Menyetujui harus gagal dengan 409
    const approveRes = await req(`/api/loans/${expiredLoanId}/approve`, {
      method: "POST",
      token: kadepToken,
    });
    assert.equal(approveRes.status, 409);
    assert.match(approveRes.body.message, /batas waktu peminjaman sudah lewat/);
    assert.match(approveRes.body.message, /tolak/);

    // Namun pengajuan yang sudah expired TETAP BOLEH ditolak oleh Kadep
    const rejectRes = await req(`/api/loans/${expiredLoanId}/reject`, {
      method: "POST",
      token: kadepToken,
      body: { reason: "Waktu pengajuan sudah kadaluarsa" },
    });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.data.request_status, "rejected");
  });

  test("Pengajuan yang planned_start_at-nya sudah lewat tapi belum berakhir masih boleh disetujui", async () => {
    // Peminjaman mulai 1 jam lalu, berakhir besok
    const { rows } = await db.query(
      `INSERT INTO loan_requests
         (borrower_id, item_id, purpose, planned_start_at, planned_end_at, submitted_at, review_queue_date, request_status)
       VALUES ($1, $2, 'sedang berjalan', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 day', NOW(), CURRENT_DATE, 'pending')
       RETURNING request_id`,
      [peminjamId, itemId]
    );
    const ongoingLoanId = rows[0].request_id;

    const res = await req(`/api/loans/${ongoingLoanId}/approve`, {
      method: "POST",
      token: kadepToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.request_status, "approved");
  });

  test("Bentrok dengan approved lain melempar 23P01 -> ditangkap isApprovedOverlapError -> 409 dengan daftar konflik tanpa identitas peminjam", async () => {
    const dateSlot = addDays(base, 15);

    // Pengajuan A: [dateSlot, dateSlot+3) -> disetujui
    const loanA = await insertLoanRequest({
      borrowerId: peminjamId,
      startDate: dateSlot,
      days: 3,
    });
    const approveA = await req(`/api/loans/${loanA.request_id}/approve`, {
      method: "POST",
      token: kadepToken,
    });
    assert.equal(approveA.status, 200);

    // Pengajuan B: [dateSlot+1, dateSlot+2) untuk barang yang sama oleh peminjam lain
    const loanB = await insertLoanRequest({
      borrowerId: otherPeminjamId,
      startDate: addDays(dateSlot, 1),
      days: 1,
    });

    // Menyetujui B harus gagal karena bentrok dengan A yang sudah approved (constraint 23P01)
    const approveB = await req(`/api/loans/${loanB.request_id}/approve`, {
      method: "POST",
      token: kadepToken,
    });
    assert.equal(approveB.status, 409);
    assert.match(approveB.body.message, /Jadwal bentrok dengan pengajuan lain yang sudah disetujui/);
    assert.ok(Array.isArray(approveB.body.data?.conflicts));
    assert.equal(approveB.body.data.conflicts.length, 1);
    assert.equal(approveB.body.data.conflicts[0].status, "approved");

    // Pastikan identitas peminjam lain TIDAK bocor di conflicts
    assert.equal(approveB.body.data.conflicts[0].borrower_id, undefined);
    assert.equal(approveB.body.data.conflicts[0].borrower_name, undefined);
  });

  test("Pengajuan pending lain yang beririsan OTOMATIS ditolak saat salah satu disetujui Kadep", async () => {
    const slot = addDays(base, 20);

    // Buat 3 pengajuan yang saling beririsan pada barang yang sama
    const req1 = await insertLoanRequest({
      borrowerId: peminjamId,
      startDate: slot,
      days: 2,
      submittedAt: new Date(Date.now() - 3000),
    });
    const req2 = await insertLoanRequest({
      borrowerId: otherPeminjamId,
      startDate: addDays(slot, 1),
      days: 2,
      submittedAt: new Date(Date.now() - 2000),
    });
    const req3 = await insertLoanRequest({
      borrowerId: peminjamId,
      startDate: slot,
      days: 1,
      submittedAt: new Date(Date.now() - 1000),
    });

    // Ambil antrean Kadep
    const queueRes = await req("/api/loans/queue?tab=queue", { token: kadepToken });
    assert.equal(queueRes.status, 200);

    const qItem1 = queueRes.body.data.find((x) => x.request_id === req1.request_id);
    const qItem2 = queueRes.body.data.find((x) => x.request_id === req2.request_id);
    assert.ok(qItem1 && qItem2);

    // Penanda / jumlah beririsan dengan pending lain
    assert.ok(qItem1.pending_overlaps >= 2, "req1 harus mendeteksi overlap dengan req2 dan req3");
    assert.ok(qItem2.pending_overlaps >= 1, "req2 harus mendeteksi overlap");

    // Setujui req1
    const app1 = await req(`/api/loans/${req1.request_id}/approve`, {
      method: "POST",
      token: kadepToken,
    });
    assert.equal(app1.status, 200);
    assert.equal(app1.body.data.auto_rejected_count, 2);
    assert.deepEqual(
      app1.body.data.auto_rejected_requests.sort(),
      [req2.request_id, req3.request_id].sort()
    );

    // req2 dan req3 OTOMATIS ditolak oleh sistem, statusnya menjadi 'rejected'
    const { rows: checkReq2 } = await db.query(
      `SELECT lr.request_status, ad.decision, ad.reason
         FROM loan_requests lr
         LEFT JOIN approval_decisions ad ON lr.request_id = ad.request_id
        WHERE lr.request_id = $1`,
      [req2.request_id]
    );
    assert.equal(checkReq2[0].request_status, "rejected");
    assert.equal(checkReq2[0].decision, "rejected");
    assert.match(checkReq2[0].reason, /ditolak otomatis/i);

    const { rows: checkReq3 } = await db.query(
      `SELECT lr.request_status, ad.decision, ad.reason
         FROM loan_requests lr
         LEFT JOIN approval_decisions ad ON lr.request_id = ad.request_id
        WHERE lr.request_id = $1`,
      [req3.request_id]
    );
    assert.equal(checkReq3[0].request_status, "rejected");
    assert.equal(checkReq3[0].decision, "rejected");
    assert.match(checkReq3[0].reason, /ditolak otomatis/i);

    // Saat mencoba menyetujui req2, gagal dengan 409 karena statusnya sudah bukan pending ('rejected')
    const app2 = await req(`/api/loans/${req2.request_id}/approve`, {
      method: "POST",
      token: kadepToken,
    });
    assert.equal(app2.status, 409);
    assert.match(app2.body.message, /sudah berstatus 'rejected'/i);
  });

  test("Antrean Kadep: filter tab 'queue' (<= hari ini WIB), 'scheduled' (> hari ini), dan urut terlama diajukan lebih dulu", async () => {
    const today = todayWib();
    const tomorrow = addDays(today, 1);

    // Pengajuan untuk antrean hari ini
    const rToday1 = await insertLoanRequest({
      borrowerId: peminjamId,
      startDate: addDays(today, 25),
      days: 1,
      submittedAt: new Date(Date.now() - 5000), // Lebih lama
      reviewQueueDate: today,
    });
    const rToday2 = await insertLoanRequest({
      borrowerId: peminjamId,
      startDate: addDays(today, 26),
      days: 1,
      submittedAt: new Date(Date.now() - 1000), // Lebih baru
      reviewQueueDate: today,
    });

    // Pengajuan terjadwal di masa depan (misalnya diajukan weekend)
    const rFuture = await insertLoanRequest({
      borrowerId: peminjamId,
      startDate: addDays(today, 27),
      days: 1,
      submittedAt: new Date(),
      reviewQueueDate: tomorrow,
    });

    // 1. Tab Default / Ready (review_queue_date <= hari ini)
    const resDefault = await req("/api/loans/queue?tab=queue", { token: kadepToken });
    assert.equal(resDefault.status, 200);
    const idsDefault = resDefault.body.data.map((x) => x.request_id);

    assert.ok(idsDefault.includes(rToday1.request_id), "rToday1 harus masuk tab default");
    assert.ok(idsDefault.includes(rToday2.request_id), "rToday2 harus masuk tab default");
    assert.ok(!idsDefault.includes(rFuture.request_id), "rFuture tidak boleh muncul sebelum harinya");

    // Verifikasi urutan: terlama diajukan lebih dulu
    const idx1 = idsDefault.indexOf(rToday1.request_id);
    const idx2 = idsDefault.indexOf(rToday2.request_id);
    assert.ok(idx1 < idx2, "Pengajuan yang diajukan lebih dulu harus berada di posisi lebih depan");

    // 2. Tab Terjadwal (review_queue_date > hari ini)
    const resScheduled = await req("/api/loans/queue?tab=scheduled", { token: kadepToken });
    assert.equal(resScheduled.status, 200);
    const idsScheduled = resScheduled.body.data.map((x) => x.request_id);

    assert.ok(idsScheduled.includes(rFuture.request_id), "rFuture harus muncul di tab Terjadwal");
    assert.ok(!idsScheduled.includes(rToday1.request_id), "rToday1 tidak boleh di tab Terjadwal");
  });
});
