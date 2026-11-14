import db from "../config/db.js";
import { LOAN_RULES, WIB_OFFSET } from "../constants/loanRules.js";

/**
 * Validasi ketersediaan barang dan bentrok jadwal peminjaman (#24).
 *
 * Model waktu:
 *   Peminjaman "tanggal D selama N hari" disimpan sebagai rentang
 *   [D 00:00 WIB, D+N 00:00 WIB). Batas akhir eksklusif, jadi peminjaman
 *   yang berakhir tanggal 27 tidak bentrok dengan yang mulai tanggal 27.
 *   Ini sama dengan perilaku tstzrange() di constraint no_overlap_approved_loans.
 *
 * Aturan bentrok:
 *   - Beririsan dengan pengajuan yang sudah DISETUJUI      -> ditolak (bentrok jadwal)
 *   - Beririsan dengan pengajuan PENDING milik sendiri      -> ditolak (duplikat)
 *   - Beririsan dengan pengajuan PENDING milik orang lain   -> boleh, tapi diberi
 *     peringatan; Kadep yang memutuskan di antrean persetujuan.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

// "YYYY-MM-DD" hari ini dalam WIB
export function todayWib(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 0 = Minggu, 6 = Sabtu
}

/**
 * Tanggal antrean review: pengajuan Sabtu/Minggu masuk antrean Senin berikutnya.
 */
export function reviewQueueDate(submittedDate) {
  const dow = dayOfWeek(submittedDate);
  if (dow === 6) return addDays(submittedDate, 2);
  if (dow === 0) return addDays(submittedDate, 1);
  return submittedDate;
}

/**
 * Memeriksa format input dan mengubahnya menjadi rentang waktu.
 * Melempar error 400 dengan pesan yang bisa langsung ditampilkan ke pengguna.
 */
export function parseLoanPeriod({ item_id, borrow_date, duration_days }, now = new Date()) {
  const itemId = Number(item_id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw httpError(400, "Barang yang diajukan tidak valid");
  }

  const date = String(borrow_date || "").trim();
  // Cek format sekaligus tanggal yang benar-benar ada (menolak misalnya 2026-02-30)
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!DATE_RE.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw httpError(400, "Tanggal pinjam tidak valid (format YYYY-MM-DD)");
  }

  const duration = Number(duration_days);
  if (!Number.isInteger(duration) || duration < 1 || duration > LOAN_RULES.MAX_DURATION_DAYS) {
    throw httpError(400, `Durasi peminjaman harus 1 sampai ${LOAN_RULES.MAX_DURATION_DAYS} hari`);
  }

  const today = todayWib(now);
  if (date < today) {
    throw httpError(400, "Tanggal pinjam tidak boleh sebelum hari ini");
  }
  if (date > addDays(today, LOAN_RULES.MAX_ADVANCE_DAYS)) {
    throw httpError(
      400,
      `Peminjaman hanya bisa diajukan paling lambat ${LOAN_RULES.MAX_ADVANCE_DAYS} hari ke depan`
    );
  }

  const start = new Date(`${date}T00:00:00${WIB_OFFSET}`);
  const end = new Date(start.getTime() + duration * DAY_MS);
  return { itemId, borrowDate: date, durationDays: duration, start, end };
}

const ITEM_UNAVAILABLE_MESSAGE = {
  borrowed: "Barang sedang dipinjam dan belum dikembalikan",
  maintenance: "Barang sedang dalam perawatan",
  unavailable: "Barang sedang tidak dapat dipinjam",
};

/**
 * Inti validasi. Mengembalikan hasil pemeriksaan tanpa mengubah data.
 * `client` bisa berupa pool atau client transaksi (supaya bisa dipakai di dalam
 * transaksi dengan baris barang yang sudah dikunci).
 */
export async function evaluateAvailability(client, { itemId, start, end, borrowerId }) {
  const { rows: itemRows } = await client.query(
    `SELECT i.item_id, i.item_name, i.availability_status, i.is_active, c.category_name
       FROM items i
       JOIN item_categories c ON c.category_id = i.category_id
      WHERE i.item_id = $1`,
    [itemId]
  );
  const item = itemRows[0];
  if (!item) {
    throw httpError(404, "Barang tidak ditemukan");
  }

  const result = {
    item: {
      item_id: item.item_id,
      item_name: item.item_name,
      category_name: item.category_name,
      availability_status: item.availability_status,
    },
    available: true,
    reason: null,
    conflicts: [],
    pending_overlaps: 0,
  };

  if (!item.is_active) {
    return { ...result, available: false, reason: "Barang sudah tidak aktif di inventaris" };
  }
  if (item.availability_status !== "available") {
    return {
      ...result,
      available: false,
      reason: ITEM_UNAVAILABLE_MESSAGE[item.availability_status] || "Barang sedang tidak tersedia",
    };
  }

  // Pengajuan lain untuk barang yang sama dengan rentang waktu beririsan
  const { rows: overlaps } = await client.query(
    `SELECT request_id, borrower_id, request_status, planned_start_at, planned_end_at
       FROM loan_requests
      WHERE item_id = $1
        AND request_status IN ('approved', 'pending')
        AND tstzrange(planned_start_at, planned_end_at) && tstzrange($2::timestamptz, $3::timestamptz)
      ORDER BY planned_start_at`,
    [itemId, start, end]
  );

  // Identitas peminjam lain tidak dikirim ke klien, cukup jadwalnya
  const toPublic = (r) => ({
    status: r.request_status,
    start: r.planned_start_at,
    end: r.planned_end_at,
  });

  const approved = overlaps.filter((r) => r.request_status === "approved");
  if (approved.length > 0) {
    return {
      ...result,
      available: false,
      reason: "Jadwal bentrok: barang sudah dipesan pada rentang tanggal tersebut",
      conflicts: approved.map(toPublic),
    };
  }

  const ownPending = overlaps.filter(
    (r) => r.request_status === "pending" && r.borrower_id === borrowerId
  );
  if (ownPending.length > 0) {
    return {
      ...result,
      available: false,
      reason: "Anda sudah mengajukan barang ini pada rentang tanggal yang beririsan",
      conflicts: ownPending.map(toPublic),
    };
  }

  // Pending milik orang lain: boleh diajukan, Kadep yang memutuskan
  result.pending_overlaps = overlaps.length;
  return result;
}

/**
 * Cek ketersediaan untuk ditampilkan di form (tidak menyimpan apa pun).
 */
export async function checkAvailability({ item_id, borrow_date, duration_days, borrowerId }) {
  const period = parseLoanPeriod({ item_id, borrow_date, duration_days });
  const evaluation = await evaluateAvailability(db, { ...period, borrowerId });
  return {
    ...evaluation,
    period: { borrow_date: period.borrowDate, duration_days: period.durationDays, start: period.start, end: period.end },
  };
}

/**
 * Membuat pengajuan peminjaman setelah lolos validasi ketersediaan & bentrok jadwal.
 * Baris barang dikunci (FOR UPDATE) selama transaksi, jadi dua pengajuan yang
 * dikirim bersamaan untuk barang yang sama diperiksa satu per satu.
 */
export async function createLoanRequest({ item_id, purpose, borrow_date, duration_days, borrowerId }) {
  const text = String(purpose || "").trim();
  if (!text) {
    throw httpError(400, "Keperluan peminjaman wajib diisi");
  }
  if (text.length > LOAN_RULES.MAX_PURPOSE_LENGTH) {
    throw httpError(400, `Keperluan maksimal ${LOAN_RULES.MAX_PURPOSE_LENGTH} karakter`);
  }

  const now = new Date();
  const period = parseLoanPeriod({ item_id, borrow_date, duration_days }, now);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM items WHERE item_id = $1 FOR UPDATE", [period.itemId]);

    const evaluation = await evaluateAvailability(client, { ...period, borrowerId });
    if (!evaluation.available) {
      throw httpError(409, evaluation.reason, { conflicts: evaluation.conflicts });
    }

    const queueDate = reviewQueueDate(todayWib(now));
    const { rows } = await client.query(
      `INSERT INTO loan_requests
         (borrower_id, item_id, purpose, planned_start_at, planned_end_at, review_queue_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING request_id, item_id, purpose, planned_start_at, planned_end_at,
                 submitted_at, review_queue_date, request_status`,
      [borrowerId, period.itemId, text, period.start, period.end, queueDate]
    );
    const request = rows[0];

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'create_loan_request', 'loan_request', $2, $3)`,
      [
        borrowerId,
        request.request_id,
        JSON.stringify({
          item_id: period.itemId,
          item_name: evaluation.item.item_name,
          borrow_date: period.borrowDate,
          duration_days: period.durationDays,
          pending_overlaps: evaluation.pending_overlaps,
        }),
      ]
    );

    await client.query("COMMIT");

    return {
      ...request,
      // review_queue_date dari pg berupa Date lokal; kirim sebagai YYYY-MM-DD
      review_queue_date: queueDate,
      item_name: evaluation.item.item_name,
      category_name: evaluation.item.category_name,
      duration_days: period.durationDays,
      pending_overlaps: evaluation.pending_overlaps,
      queued_next_workday: queueDate !== todayWib(now),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Untuk modul persetujuan (Kadep): error dari constraint no_overlap_approved_loans
 * berarti ada pengajuan lain yang sudah disetujui pada jadwal yang beririsan.
 */
export function isApprovedOverlapError(err) {
  return err?.code === "23P01" && err?.constraint === "no_overlap_approved_loans";
}
