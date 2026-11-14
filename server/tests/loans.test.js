import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.js";
import db from "../src/config/db.js";
import { parseLoanPeriod, reviewQueueDate, todayWib } from "../src/services/loanService.js";
import { LOAN_RULES } from "../src/constants/loanRules.js";

// ==========================================
// UNIT: aturan tanggal (tanpa database)
// ==========================================

describe("Aturan tanggal peminjaman", () => {
  // Rabu, 18 Nov 2026 10:00 WIB
  const now = new Date("2026-11-18T10:00:00+07:00");

  test("rentang dihitung dari 00:00 WIB dengan akhir eksklusif", () => {
    const p = parseLoanPeriod({ item_id: 1, borrow_date: "2026-11-20", duration_days: 2 }, now);
    assert.equal(p.start.toISOString(), "2026-11-19T17:00:00.000Z"); // 20 Nov 00:00 WIB
    assert.equal(p.end.toISOString(), "2026-11-21T17:00:00.000Z"); // 22 Nov 00:00 WIB
  });

  test("hari ini dalam WIB, bukan UTC", () => {
    // 19 Nov 01:00 WIB = 18 Nov 18:00 UTC
    assert.equal(todayWib(new Date("2026-11-18T18:00:00Z")), "2026-11-19");
  });

  test("menolak input yang tidak valid", () => {
    const bad = [
      [{ item_id: "abc", borrow_date: "2026-11-20", duration_days: 1 }, /Barang/],
      [{ item_id: 1, borrow_date: "20 Nov 2026", duration_days: 1 }, /format/],
      [{ item_id: 1, borrow_date: "2026-02-30", duration_days: 1 }, /format/],
      [{ item_id: 1, borrow_date: "2026-11-17", duration_days: 1 }, /sebelum hari ini/],
      [{ item_id: 1, borrow_date: "2026-11-20", duration_days: 0 }, /Durasi/],
      [{ item_id: 1, borrow_date: "2026-11-20", duration_days: 1.5 }, /Durasi/],
      [{ item_id: 1, borrow_date: "2026-11-20", duration_days: LOAN_RULES.MAX_DURATION_DAYS + 1 }, /Durasi/],
      [{ item_id: 1, borrow_date: "2027-01-30", duration_days: 1 }, /hari ke depan/],
    ];
    for (const [input, msg] of bad) {
      assert.throws(() => parseLoanPeriod(input, now), msg, JSON.stringify(input));
    }
  });

  test("hari ini dan batas maksimal hari ke depan masih diterima", () => {
    assert.doesNotThrow(() => parseLoanPeriod({ item_id: 1, borrow_date: "2026-11-18", duration_days: 1 }, now));
    assert.doesNotThrow(() => parseLoanPeriod({ item_id: 1, borrow_date: "2026-12-18", duration_days: 1 }, now));
  });

  test("pengajuan akhir pekan masuk antrean Senin", () => {
    assert.equal(reviewQueueDate("2026-11-20"), "2026-11-20"); // Jumat
    assert.equal(reviewQueueDate("2026-11-21"), "2026-11-23"); // Sabtu -> Senin
    assert.equal(reviewQueueDate("2026-11-22"), "2026-11-23"); // Minggu -> Senin
  });
});

// ==========================================
// INTEGRASI: endpoint /api/loans (database sungguhan)
// ==========================================

let server;
let baseUrl;
let peminjamToken;
let tendikToken;
let peminjamId;
let otherUserId;
let categoryId;
let itemId;
let maintenanceItemId;

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const base = addDays(todayWib(), 10);

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

const ajukan = (body, token = peminjamToken) =>
  req("/api/loans/request", { method: "POST", token, body: { item_id: itemId, purpose: "Tes otomatis", ...body } });

const cek = (q, token = peminjamToken) =>
  req(`/api/loans/availability?${new URLSearchParams({ item_id: itemId, ...q })}`, { token });

// Sisipkan pengajuan langsung ke database (untuk menyiapkan kondisi bentrok)
async function seedRequest({ borrowerId, status, date, days }) {
  await db.query(
    `INSERT INTO loan_requests (borrower_id, item_id, purpose, planned_start_at, planned_end_at, request_status)
     VALUES ($1, $2, 'seed tes', ($3 || 'T00:00:00+07:00')::timestamptz,
             ($3 || 'T00:00:00+07:00')::timestamptz + make_interval(days => $4), $5)`,
    [borrowerId, itemId, date, days, status]
  );
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const p = await login("peminjam@demo.test");
  const t = await login("tendik@demo.test");
  assert.ok(p && t, "Akun demo belum ada. Jalankan: npm run seed:dev");
  peminjamToken = p.token;
  peminjamId = p.user.user_id;
  tendikToken = t.token;
  otherUserId = t.user.user_id; // dipakai sebagai "peminjam lain" untuk data seed

  const stamp = Date.now();
  const cat = await db.query(
    "INSERT INTO item_categories (category_name) VALUES ($1) RETURNING category_id",
    [`Tes Peminjaman ${stamp}`]
  );
  categoryId = cat.rows[0].category_id;
  const items = await db.query(
    `INSERT INTO items (category_id, item_name, availability_status) VALUES
       ($1, $2, 'available'), ($1, $3, 'maintenance')
     RETURNING item_id`,
    [categoryId, `Barang Tes ${stamp}`, `Barang Perawatan ${stamp}`]
  );
  itemId = items.rows[0].item_id;
  maintenanceItemId = items.rows[1].item_id;
});

after(async () => {
  // Bersihkan data tes (audit_logs memang tidak bisa dihapus, dan tidak perlu)
  if (categoryId) {
    await db.query("DELETE FROM loan_requests WHERE item_id IN ($1, $2)", [itemId, maintenanceItemId]);
    await db.query("DELETE FROM items WHERE category_id = $1", [categoryId]);
    await db.query("DELETE FROM item_categories WHERE category_id = $1", [categoryId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.end();
});

describe("API pengajuan peminjaman", () => {
  test("hanya Peminjam yang boleh mengajukan", async () => {
    const res = await ajukan({ borrow_date: base, duration_days: 1 }, tendikToken);
    assert.equal(res.status, 403);
  });

  test("input tidak valid -> 400 dengan pesan jelas", async () => {
    const tanpaKeperluan = await ajukan({ purpose: "  ", borrow_date: base, duration_days: 1 });
    assert.equal(tanpaKeperluan.status, 400);
    assert.match(tanpaKeperluan.body.message, /Keperluan/);

    const formatSalah = await ajukan({ borrow_date: "23 Okt 2026", duration_days: 1 });
    assert.equal(formatSalah.status, 400);
  });

  test("barang tidak ada -> 404, barang perawatan -> 409", async () => {
    const tidakAda = await ajukan({ item_id: 999999, borrow_date: base, duration_days: 1 });
    assert.equal(tidakAda.status, 404);

    const perawatan = await ajukan({ item_id: maintenanceItemId, borrow_date: base, duration_days: 1 });
    assert.equal(perawatan.status, 409);
    assert.match(perawatan.body.message, /perawatan/);
  });

  test("pengajuan valid tersimpan sebagai pending", async () => {
    const res = await ajukan({ borrow_date: base, duration_days: 2 });
    assert.equal(res.status, 201, res.body?.message);
    assert.equal(res.body.data.request_status, "pending");
    assert.equal(res.body.data.duration_days, 2);
  });

  test("mengajukan lagi di jadwal beririsan milik sendiri -> 409 duplikat", async () => {
    const res = await ajukan({ borrow_date: addDays(base, 1), duration_days: 1 });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /sudah mengajukan/);
  });

  test("tepat setelah jadwal sebelumnya selesai -> tidak bentrok", async () => {
    // Pengajuan sebelumnya: base selama 2 hari = [base, base+2)
    const res = await ajukan({ borrow_date: addDays(base, 2), duration_days: 1 });
    assert.equal(res.status, 201, res.body?.message);
  });

  test("beririsan dengan pending orang lain -> boleh, tapi diberi tanda", async () => {
    await seedRequest({ borrowerId: otherUserId, status: "pending", date: addDays(base, 5), days: 2 });
    const res = await ajukan({ borrow_date: addDays(base, 6), duration_days: 1 });
    assert.equal(res.status, 201, res.body?.message);
    assert.equal(res.body.data.pending_overlaps, 1);
  });

  test("beririsan dengan pengajuan yang sudah disetujui -> 409 bentrok jadwal", async () => {
    await seedRequest({ borrowerId: otherUserId, status: "approved", date: addDays(base, 10), days: 3 });

    const cekRes = await cek({ borrow_date: addDays(base, 11), duration_days: 1 });
    assert.equal(cekRes.status, 200);
    assert.equal(cekRes.body.data.available, false);
    assert.equal(cekRes.body.data.conflicts.length, 1);
    assert.equal(cekRes.body.data.conflicts[0].borrower_id, undefined, "identitas peminjam lain tidak boleh bocor");

    const res = await ajukan({ borrow_date: addDays(base, 9), duration_days: 2 });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /bentrok/i);
    assert.equal(res.body.data.conflicts.length, 1);
  });

  test("cek ketersediaan di tanggal kosong -> tersedia", async () => {
    const res = await cek({ borrow_date: addDays(base, 15), duration_days: 3 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.available, true);
    assert.equal(res.body.data.pending_overlaps, 0);
  });

  test("dua pengajuan bersamaan di jadwal sama -> hanya satu yang lolos", async () => {
    const date = addDays(base, 20);
    const [a, b] = await Promise.all([
      ajukan({ borrow_date: date, duration_days: 1 }),
      ajukan({ borrow_date: date, duration_days: 1 }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  });

  test("audit log tercatat untuk pengajuan baru", async () => {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_logs
        WHERE action_type = 'create_loan_request' AND actor_user_id = $1
          AND (details->>'item_id')::int = $2`,
      [peminjamId, itemId]
    );
    assert.ok(rows[0].n >= 3);
  });
});
