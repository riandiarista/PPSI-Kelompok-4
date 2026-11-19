import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config();

const { default: db } = await import("../src/config/db.js");
const {
  calculateDaysDiffWib,
  toDateStringWib,
  formatDueDateTimeWib,
  formatDueTimephrase,
  buildDueReminderEmail,
  sendDueReminders,
  getDueReminderTargets,
  NOTIFICATION_TYPE_DUE_H_MINUS_1,
  NOTIFICATION_TYPE_DUE_H_MINUS_2,
} = await import("../src/services/reminderService.js");
const { POINT_RULES } = await import("../src/services/returnService.js");

// ============================================================================
// 1. UNIT TEST: Perhitungan Tanggal & Pembuatan Isi Email (Tanpa Database)
// ============================================================================

describe("Unit: Perhitungan Selisih Hari Kalender WIB", () => {
  test("menghitung selisih hari kalender WIB dengan benar pada siang hari", () => {
    const now = new Date("2026-11-19T10:00:00+07:00");
    const dueH2 = new Date("2026-11-21T14:00:00+07:00");
    const dueH1 = new Date("2026-11-20T14:00:00+07:00");
    const dueH0 = new Date("2026-11-19T20:00:00+07:00");

    assert.equal(calculateDaysDiffWib(dueH2, now), 2);
    assert.equal(calculateDaysDiffWib(dueH1, now), 1);
    assert.equal(calculateDaysDiffWib(dueH0, now), 0);
  });

  test("selisih hari WIB benar saat due_at dekat tengah malam UTC vs WIB", () => {
    // now: 19 Nov 2026 23:30 WIB (= 19 Nov 16:30 UTC)
    const now = new Date("2026-11-19T16:30:00.000Z");
    assert.equal(toDateStringWib(now), "2026-11-19");

    // due: 20 Nov 2026 00:30 WIB (= 19 Nov 17:30 UTC)
    // Di UTC, tanggalnya 19 Nov (hanya berselisih 1 jam).
    // Namun di WIB, tanggalnya 20 Nov, sehingga selisih kalender WIB adalah 1 hari (H-1).
    const dueNearMidnight = new Date("2026-11-19T17:30:00.000Z");
    assert.equal(toDateStringWib(dueNearMidnight), "2026-11-20");

    assert.equal(
      calculateDaysDiffWib(dueNearMidnight, now),
      1,
      "due_at 00:30 WIB tanggal 20 terhadap 19 Nov harus dihitung selisih 1 hari (H-1)"
    );
  });

  test("formatDueDateTimeWib menghasilkan teks hari, tanggal, dan jam WIB sesuai contoh", () => {
    // Jumat, 20 Nov 2026 pukul 14.00 WIB
    const d = new Date("2026-11-20T07:00:00.000Z"); // 20 Nov 2026 14:00 WIB
    const formatted = formatDueDateTimeWib(d);

    assert.match(formatted, /Jumat/);
    assert.match(formatted, /20 Nov 2026/);
    assert.match(formatted, /14\.00 WIB/);
  });

  test("formatDueTimephrase menghasilkan frasa selisih yang sesuai", () => {
    assert.equal(formatDueTimephrase(2), "jatuh tempo dalam 2 hari");
    assert.equal(formatDueTimephrase(1), "jatuh tempo dalam 1 hari");
    assert.equal(formatDueTimephrase(0), "jatuh tempo dalam 0 hari (hari ini)");
  });
});

describe("Unit: Konten Email Pengingat", () => {
  test("isi email memuat nama barang, tanggal WIB, dan nilai poin dari POINT_RULES", () => {
    const dueAt = new Date("2026-11-20T07:00:00.000Z"); // Jumat, 20 Nov 2026, 14.00 WIB
    const email = buildDueReminderEmail({
      borrowerName: "Ahmad Dahlan",
      itemName: "Proyektor Epson EB-X400",
      dueAt,
      daysLeft: 1,
    });

    const expectedPenalty = Math.abs(POINT_RULES.LATE_PER_DAY);

    // Periksa Subjek
    assert.match(email.subject, /Proyektor Epson EB-X400/);
    assert.match(email.subject, /Jatuh Tempo dalam 1 Hari/);

    // Periksa Plain Text
    assert.match(email.text, /Ahmad Dahlan/);
    assert.match(email.text, /Proyektor Epson EB-X400/);
    assert.match(email.text, /jatuh tempo dalam 1 hari/);
    assert.match(email.text, /Jumat, 20 Nov 2026, 14\.00 WIB/);
    assert.match(
      email.text,
      new RegExp(`${expectedPenalty} poin per hari`),
      "Poin penalti harus diambil dari POINT_RULES"
    );
    assert.match(email.text, /Email otomatis dari Enventory, jangan dibalas/);

    // Periksa HTML
    assert.match(email.html, /Ahmad Dahlan/);
    assert.match(email.html, /Proyektor Epson EB-X400/);
    assert.match(email.html, /Jumat, 20 Nov 2026, 14\.00 WIB/);
    assert.match(email.html, new RegExp(`${expectedPenalty} poin per hari`));
    assert.match(email.html, /Email otomatis dari Enventory, jangan dibalas/);
  });
});

// ============================================================================
// 2. INTEGRATION TEST: Target Query, Idempotency, dan Mock Mailer (Database)
// ============================================================================

let testUserIdA;
let testUserIdB;
let testCategoryId;
let testItemIdA;
let testItemIdB;
let testItemIdC;
let testLoanIdA;
let testLoanIdB;
let testLoanIdC;

function createMockMailer({ failEmails = [] } = {}) {
  const sentMessages = [];
  return {
    sentMessages,
    async sendMail(opts) {
      if (failEmails.includes(opts.to)) {
        throw new Error(`Simulasi gagal kirim SMTP ke ${opts.to}`);
      }
      sentMessages.push(opts);
      return { messageId: `mock-msg-${sentMessages.length}` };
    },
  };
}

describe("Integrasi: Pengiriman Pengingat Jatuh Tempo H-1", () => {
  const refNow = new Date("2035-11-19T08:00:00+07:00");
  const refDueH1 = new Date("2035-11-20T14:00:00+07:00"); // Tepat H+1 WIB (Target H-1)
  const refDueH2 = new Date("2035-11-21T14:00:00+07:00"); // H+2 WIB (Bukan target H-1)

  before(async () => {
    const stamp = Date.now();

    // 1. Role Peminjam
    const roleRes = await db.query("SELECT role_id FROM roles WHERE role_name = 'Peminjam'");
    const roleId = roleRes.rows[0].role_id;

    // 2. Buat 2 user peminjam
    const uA = await db.query(
      `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
       VALUES ($1, $2, $3, 'hash123', 'approved', 'local', TRUE, TRUE)
       RETURNING user_id`,
      [roleId, `Peminjam Uji A ${stamp}`, `peminjam.a.${stamp}@test.local`]
    );
    testUserIdA = uA.rows[0].user_id;

    const uB = await db.query(
      `INSERT INTO users (role_id, full_name, email, password_hash, registration_status, auth_provider, email_verified, is_active)
       VALUES ($1, $2, $3, 'hash123', 'approved', 'local', TRUE, TRUE)
       RETURNING user_id`,
      [roleId, `Peminjam Uji B ${stamp}`, `peminjam.b.${stamp}@test.local`]
    );
    testUserIdB = uB.rows[0].user_id;

    // 3. Kategori & 3 Barang
    const cat = await db.query(
      "INSERT INTO item_categories (category_name) VALUES ($1) RETURNING category_id",
      [`Kategori Reminder Tes ${stamp}`]
    );
    testCategoryId = cat.rows[0].category_id;

    const itA = await db.query(
      `INSERT INTO items (category_id, item_name, availability_status)
       VALUES ($1, $2, 'borrowed') RETURNING item_id`,
      [testCategoryId, `Barang Uji A ${stamp}`]
    );
    testItemIdA = itA.rows[0].item_id;

    const itB = await db.query(
      `INSERT INTO items (category_id, item_name, availability_status)
       VALUES ($1, $2, 'borrowed') RETURNING item_id`,
      [testCategoryId, `Barang Uji B ${stamp}`]
    );
    testItemIdB = itB.rows[0].item_id;

    const itC = await db.query(
      `INSERT INTO items (category_id, item_name, availability_status)
       VALUES ($1, $2, 'borrowed') RETURNING item_id`,
      [testCategoryId, `Barang Uji C ${stamp}`]
    );
    testItemIdC = itC.rows[0].item_id;

    // 4. Buat loan_requests
    const reqA = await db.query(
      `INSERT INTO loan_requests (borrower_id, item_id, purpose, planned_start_at, planned_end_at, request_status)
       VALUES ($1, $2, 'Uji pengingat A (H-1)', $3, $4, 'completed') RETURNING request_id`,
      [testUserIdA, testItemIdA, refNow, refDueH1]
    );
    const reqB = await db.query(
      `INSERT INTO loan_requests (borrower_id, item_id, purpose, planned_start_at, planned_end_at, request_status)
       VALUES ($1, $2, 'Uji pengingat B (H-1)', $3, $4, 'completed') RETURNING request_id`,
      [testUserIdB, testItemIdB, refNow, refDueH1]
    );
    const reqC = await db.query(
      `INSERT INTO loan_requests (borrower_id, item_id, purpose, planned_start_at, planned_end_at, request_status)
       VALUES ($1, $2, 'Uji pengingat C (H-2)', $3, $4, 'completed') RETURNING request_id`,
      [testUserIdA, testItemIdC, refNow, refDueH2]
    );

    // 5. Buat loan_transactions (status: 'borrowed')
    // Loan A & B: due_at = refDueH1 (selisih 1 hari WIB -> target)
    // Loan C: due_at = refDueH2 (selisih 2 hari WIB -> BUKAN target)
    const txA = await db.query(
      `INSERT INTO loan_transactions (request_id, handover_by, handover_at, due_at, transaction_status)
       VALUES ($1, $2, $3, $4, 'borrowed') RETURNING loan_id`,
      [reqA.rows[0].request_id, testUserIdA, refNow, refDueH1]
    );
    testLoanIdA = txA.rows[0].loan_id;

    const txB = await db.query(
      `INSERT INTO loan_transactions (request_id, handover_by, handover_at, due_at, transaction_status)
       VALUES ($1, $2, $3, $4, 'borrowed') RETURNING loan_id`,
      [reqB.rows[0].request_id, testUserIdA, refNow, refDueH1]
    );
    testLoanIdB = txB.rows[0].loan_id;

    const txC = await db.query(
      `INSERT INTO loan_transactions (request_id, handover_by, handover_at, due_at, transaction_status)
       VALUES ($1, $2, $3, $4, 'borrowed') RETURNING loan_id`,
      [reqC.rows[0].request_id, testUserIdA, refNow, refDueH2]
    );
    testLoanIdC = txC.rows[0].loan_id;
  });

  after(async () => {
    // Bersihkan data tes
    if (testCategoryId) {
      await db.query("DELETE FROM notification_logs WHERE loan_id IN ($1, $2, $3)", [
        testLoanIdA,
        testLoanIdB,
        testLoanIdC,
      ]);
      await db.query("DELETE FROM loan_transactions WHERE loan_id IN ($1, $2, $3)", [
        testLoanIdA,
        testLoanIdB,
        testLoanIdC,
      ]);
      await db.query("DELETE FROM loan_requests WHERE item_id IN ($1, $2, $3)", [
        testItemIdA,
        testItemIdB,
        testItemIdC,
      ]);
      await db.query("DELETE FROM items WHERE category_id = $1", [testCategoryId]);
      await db.query("DELETE FROM item_categories WHERE category_id = $1", [testCategoryId]);
      await db.query("DELETE FROM users WHERE user_id IN ($1, $2)", [testUserIdA, testUserIdB]);
    }
    await db.end();
  });

  test("target query mendeteksi peminjaman H-1 (0–1 hari) dan mengabaikan H-2", async () => {
    const targets = await getDueReminderTargets({ now: refNow, client: db });
    const foundA = targets.find((t) => t.loan_id === testLoanIdA);
    const foundB = targets.find((t) => t.loan_id === testLoanIdB);
    const foundC = targets.find((t) => t.loan_id === testLoanIdC);

    assert.ok(foundA, "Loan A (H-1) harus masuk daftar target");
    assert.ok(foundB, "Loan B (H-1) harus masuk daftar target");
    assert.equal(foundA.days_diff, 1, "Selisih hari kalender WIB untuk Loan A harus 1 hari");
    assert.equal(foundC, undefined, "Loan C (H-2) tidak boleh masuk target H-1");
  });

  test("mailer mock: terkirim sekali; run kedua tidak mengirim ulang (idempoten)", async () => {
    const mockMailer = createMockMailer();

    // Run 1: Pengiriman pertama
    const res1 = await sendDueReminders({ now: refNow, mailer: mockMailer });
    assert.ok(res1.sent >= 2, "Kedua peminjaman tes H-1 harus berhasil terkirim");

    const emailSentA = mockMailer.sentMessages.find((m) =>
      m.to.includes(`peminjam.a.`)
    );
    assert.ok(emailSentA, "Email untuk Peminjam A harus terkirim");
    assert.match(emailSentA.subject, /Jatuh Tempo dalam 1 Hari/);

    // Periksa notification_logs
    const { rows: logsA } = await db.query(
      `SELECT status, attempts, last_error, sent_at
         FROM notification_logs
        WHERE loan_id = $1 AND notification_type = $2`,
      [testLoanIdA, NOTIFICATION_TYPE_DUE_H_MINUS_1]
    );
    assert.equal(logsA.length, 1);
    assert.equal(logsA[0].status, "sent");
    assert.equal(logsA[0].attempts, 1);
    assert.ok(logsA[0].sent_at !== null);

    // Periksa audit_logs
    const { rows: auditA } = await db.query(
      `SELECT action_type, entity_type, entity_id
         FROM audit_logs
        WHERE action_type = 'send_due_reminder' AND entity_id = $1`,
      [testLoanIdA]
    );
    assert.equal(auditA.length, 1);
    assert.equal(auditA[0].entity_type, "loan");

    // Run 2: Eksekusi ulang pada waktu yang sama
    const countBefore = mockMailer.sentMessages.length;
    const res2 = await sendDueReminders({ now: refNow, mailer: mockMailer });

    // Tidak boleh ada pengiriman ulang untuk loan yang sudah 'sent'
    assert.equal(
      mockMailer.sentMessages.length,
      countBefore,
      "Run kedua tidak boleh mengirim ulang email yang sudah 'sent'"
    );
  });

  test("loan berstatus returned tidak dikirimi pengingat", async () => {
    // Ubah status loan A menjadi returned
    await db.query(
      "UPDATE loan_transactions SET transaction_status = 'returned' WHERE loan_id = $1",
      [testLoanIdA]
    );

    // Hapus log notifikasi untuk menguji apakah status returned mencegah pengiriman
    await db.query(
      "DELETE FROM notification_logs WHERE loan_id = $1 AND notification_type = $2",
      [testLoanIdA, NOTIFICATION_TYPE_DUE_H_MINUS_1]
    );

    const targets = await getDueReminderTargets({ now: refNow, client: db });
    const foundReturned = targets.find((t) => t.loan_id === testLoanIdA);

    assert.equal(
      foundReturned,
      undefined,
      "Loan yang berstatus 'returned' tidak boleh menjadi target pengingat"
    );
  });

  test("satu email gagal tidak menghentikan yang lain", async () => {
    // Kembalikan status loan A ke 'borrowed'
    await db.query(
      "UPDATE loan_transactions SET transaction_status = 'borrowed' WHERE loan_id = $1",
      [testLoanIdA]
    );

    // Reset log notifikasi kedua loan
    await db.query("DELETE FROM notification_logs WHERE loan_id IN ($1, $2)", [
      testLoanIdA,
      testLoanIdB,
    ]);

    // Ambil alamat email peminjam A
    const { rows: uRows } = await db.query("SELECT email FROM users WHERE user_id = $1", [
      testUserIdA,
    ]);
    const emailA = uRows[0].email;

    // Mailer yang gagal HANYA untuk peminjam A
    const mockMailerWithFailure = createMockMailer({ failEmails: [emailA] });

    const result = await sendDueReminders({ now: refNow, mailer: mockMailerWithFailure });

    // Peminjam A harus gagal, tetapi Peminjam B harus sukses
    assert.ok(result.failed >= 1, "Peminjam A harus tercatat gagal");
    assert.ok(result.sent >= 1, "Peminjam B harus tetap sukses terkirim");

    // Periksa notification_logs Peminjam A -> 'failed'
    const { rows: logFail } = await db.query(
      "SELECT status, attempts, last_error FROM notification_logs WHERE loan_id = $1 AND notification_type = $2",
      [testLoanIdA, NOTIFICATION_TYPE_DUE_H_MINUS_1]
    );
    assert.equal(logFail[0].status, "failed");
    assert.equal(logFail[0].attempts, 1);
    assert.match(logFail[0].last_error, /Simulasi gagal kirim SMTP/);

    // Periksa notification_logs Peminjam B -> 'sent'
    const { rows: logSent } = await db.query(
      "SELECT status, attempts FROM notification_logs WHERE loan_id = $1 AND notification_type = $2",
      [testLoanIdB, NOTIFICATION_TYPE_DUE_H_MINUS_1]
    );
    assert.equal(logSent[0].status, "sent");
  });
});
