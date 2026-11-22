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

// "YYYY-MM-DD" tanggal dalam WIB
export function toDateStringWib(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(date));
}

export function formatTanggalWib(date) {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(date));
}

export function formatDateTimeWib(date) {
  const d = new Date(date);
  const dateStr = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(d);
  const timeStr = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(d).replace(":", ".");
  return `${dateStr}, ${timeStr} WIB`;
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

/**
 * Antrean pengajuan peminjaman untuk Ketua Departemen.
 *
 * Filter:
 *   - 'queue' / 'ready' (default): pending dengan review_queue_date <= hari ini (WIB)
 *   - 'scheduled': pending dengan review_queue_date > hari ini (WIB)
 *   - 'history': sudah diputuskan ('approved', 'rejected')
 *   - 'all': semua pengajuan
 *
 * Urutan antrean pending: terlama diajukan lebih dulu (submitted_at ASC).
 */
export async function getApprovalQueue({ tab = "queue", actorUserId, now = new Date() } = {}) {
  const today = todayWib(now);
  const selectedTab = String(tab || "queue").toLowerCase();

  let statusCondition = "r.request_status = 'pending'";
  let dateCondition = "";
  let orderClause = "ORDER BY r.submitted_at ASC, r.request_id ASC";
  const params = [];

  if (selectedTab === "scheduled") {
    statusCondition = "r.request_status = 'pending'";
    params.push(today);
    dateCondition = `AND r.review_queue_date > $${params.length}::date`;
  } else if (selectedTab === "history") {
    statusCondition = "r.request_status IN ('approved', 'rejected')";
    orderClause = "ORDER BY COALESCE(ad.decided_at, r.submitted_at) DESC, r.request_id DESC";
  } else if (selectedTab === "all") {
    statusCondition = "1=1";
  } else {
    // Default queue (siap ditinjau hari ini)
    statusCondition = "r.request_status = 'pending'";
    params.push(today);
    dateCondition = `AND (r.review_queue_date IS NULL OR r.review_queue_date <= $${params.length}::date)`;
  }

  const query = `
    SELECT
      r.request_id,
      r.borrower_id,
      u.full_name AS borrower_name,
      u.email AS borrower_email,
      ro.role_name AS borrower_role,
      COALESCE(ug.point_balance, 0)::int AS borrower_points,
      COALESCE(ug.discipline_level, 'beginner') AS borrower_discipline_level,
      r.item_id,
      i.item_name,
      c.category_name,
      i.availability_status AS item_availability_status,
      r.purpose,
      r.planned_start_at,
      r.planned_end_at,
      r.submitted_at,
      r.review_queue_date::text AS review_queue_date,
      r.request_status,
      ad.decision,
      ad.reason AS rejection_reason,
      ad.decided_at,
      approver.full_name AS approver_name,
      (
        SELECT COUNT(*)::int
          FROM loan_requests o
         WHERE o.item_id = r.item_id
           AND o.request_id <> r.request_id
           AND o.request_status = 'pending'
           AND tstzrange(o.planned_start_at, o.planned_end_at) && tstzrange(r.planned_start_at, r.planned_end_at)
      ) AS pending_overlaps,
      (
        SELECT COUNT(*)::int
          FROM loan_requests o
         WHERE o.item_id = r.item_id
           AND o.request_id <> r.request_id
           AND o.request_status = 'approved'
           AND tstzrange(o.planned_start_at, o.planned_end_at) && tstzrange(r.planned_start_at, r.planned_end_at)
      ) AS approved_overlaps
    FROM loan_requests r
    JOIN users u ON u.user_id = r.borrower_id
    LEFT JOIN roles ro ON ro.role_id = u.role_id
    LEFT JOIN user_gamifications ug ON ug.user_id = r.borrower_id
    JOIN items i ON i.item_id = r.item_id
    JOIN item_categories c ON c.category_id = i.category_id
    LEFT JOIN approval_decisions ad ON ad.request_id = r.request_id
    LEFT JOIN users approver ON approver.user_id = ad.approver_id
    WHERE ${statusCondition} ${dateCondition}
    ${orderClause}
  `;

  const countsQuery = `
    SELECT
      COUNT(*) FILTER (WHERE r.request_status = 'pending' AND (r.review_queue_date IS NULL OR r.review_queue_date <= $1::date))::int AS ready_count,
      COUNT(*) FILTER (WHERE r.request_status = 'pending' AND r.review_queue_date > $1::date)::int AS scheduled_count,
      COUNT(*) FILTER (WHERE r.request_status IN ('approved', 'rejected'))::int AS history_count
    FROM loan_requests r
  `;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query(query, params),
    db.query(countsQuery, [today]),
  ]);

  const nowTime = now.getTime();
  const items = rows.map((r) => {
    const startTime = new Date(r.planned_start_at).getTime();
    const endTime = new Date(r.planned_end_at).getTime();
    const durationDays = Math.max(1, Math.round((endTime - startTime) / DAY_MS));

    return {
      ...r,
      duration_days: durationDays,
      is_expired: endTime <= nowTime,
      is_started: startTime <= nowTime && endTime > nowTime,
    };
  });

  return {
    items,
    counts: {
      ready: countRows[0]?.ready_count || 0,
      scheduled: countRows[0]?.scheduled_count || 0,
      history: countRows[0]?.history_count || 0,
    },
    today,
  };
}

/**
 * Rekomendasi prioritas peminjam khusus Ketua Departemen (Kadep).
 *
 * Aturan bisnis:
 * 1. Rekomendasi bersifat NON-BINDING (keputusan akhir tetap di tangan Kadep).
 * 2. Dikelompokkan per tanggal peminjaman (planned_start_at dalam zona waktu WIB).
 * 3. Di dalam setiap tanggal, diurutkan dari total poin kedisiplinan peminjam tertinggi ke terendah.
 * 4. Tie breaker HANYA berlaku bila total poin sama pada tanggal yang sama:
 *    - Peminjam yang mengajukan lebih dulu (submitted_at ASC, lalu request_id ASC) mendapatkan peringkat lebih tinggi.
 * 5. Menyajikan:
 *    - nama peminjam
 *    - tanggal peminjaman
 *    - total poin peminjam
 *    - peringkat dalam tanggal tersebut
 *    - perbandingan poin antar peminjam di tanggal yang sama
 *    - keperluan peminjaman
 *    - status rekomendasi: 'Direkomendasikan' | 'Perlu tinjauan Kadep'
 */
export async function getPriorityRecommendations({ search = "", date = "", now = new Date() } = {}) {
  const query = `
    SELECT
      r.request_id,
      r.borrower_id,
      u.full_name AS borrower_name,
      u.email AS borrower_email,
      ro.role_name AS borrower_role,
      COALESCE(ug.point_balance, 0)::int AS total_points,
      COALESCE(ug.discipline_level, 'beginner') AS discipline_level,
      r.item_id,
      i.item_name,
      c.category_name,
      i.availability_status AS item_availability_status,
      r.purpose,
      r.planned_start_at,
      r.planned_end_at,
      r.submitted_at,
      r.review_queue_date::text AS review_queue_date,
      r.request_status,
      (
        SELECT COUNT(*)::int
          FROM loan_requests o
         WHERE o.item_id = r.item_id
           AND o.request_id <> r.request_id
           AND o.request_status = 'pending'
           AND tstzrange(o.planned_start_at, o.planned_end_at) && tstzrange(r.planned_start_at, r.planned_end_at)
      ) AS pending_overlaps,
      (
        SELECT COUNT(*)::int
          FROM loan_requests o
         WHERE o.item_id = r.item_id
           AND o.request_id <> r.request_id
           AND o.request_status = 'approved'
           AND tstzrange(o.planned_start_at, o.planned_end_at) && tstzrange(r.planned_start_at, r.planned_end_at)
      ) AS approved_overlaps
    FROM loan_requests r
    JOIN users u ON u.user_id = r.borrower_id
    LEFT JOIN roles ro ON ro.role_id = u.role_id
    LEFT JOIN user_gamifications ug ON ug.user_id = r.borrower_id
    JOIN items i ON i.item_id = r.item_id
    JOIN item_categories c ON c.category_id = i.category_id
    WHERE r.request_status = 'pending'
    ORDER BY (r.planned_start_at AT TIME ZONE 'Asia/Jakarta')::date ASC, r.submitted_at ASC, r.request_id ASC
  `;

  const { rows } = await db.query(query);
  const nowTime = now.getTime();

  // Filter search jika ada
  let filteredRows = rows;
  const q = String(search || "").trim().toLowerCase();
  if (q) {
    filteredRows = filteredRows.filter(
      (r) =>
        r.borrower_name?.toLowerCase().includes(q) ||
        r.borrower_email?.toLowerCase().includes(q) ||
        r.item_name?.toLowerCase().includes(q) ||
        r.category_name?.toLowerCase().includes(q) ||
        r.purpose?.toLowerCase().includes(q)
    );
  }

  // Filter tanggal tertentu jika ada
  if (date) {
    filteredRows = filteredRows.filter((r) => toDateStringWib(r.planned_start_at) === date);
  }

  // Kelompokkan per tanggal peminjaman (WIB)
  const dateGroupsMap = new Map();

  for (const row of filteredRows) {
    const loanDate = toDateStringWib(row.planned_start_at);
    if (!dateGroupsMap.has(loanDate)) {
      dateGroupsMap.set(loanDate, []);
    }
    dateGroupsMap.get(loanDate).push(row);
  }

  const groups = [];
  let allRankedCount = 0;

  for (const [loanDate, items] of dateGroupsMap.entries()) {
    // 1. Urutkan: Total poin tertinggi ke terendah.
    //    Tie breaker HANYA berlaku bila total poin sama pada tanggal yang sama:
    //    submitted_at ASC, request_id ASC
    items.sort((a, b) => {
      if (b.total_points !== a.total_points) {
        return b.total_points - a.total_points;
      }
      // Poin sama -> Tie Breaker aktif: peminjam yang mengajukan lebih dulu
      const tA = new Date(a.submitted_at).getTime();
      const tB = new Date(b.submitted_at).getTime();
      if (tA !== tB) return tA - tB;
      return a.request_id - b.request_id;
    });

    const totalBorrowers = items.length;
    const maxPoints = Math.max(...items.map((it) => it.total_points));
    const minPoints = Math.min(...items.map((it) => it.total_points));
    const sumPoints = items.reduce((acc, it) => acc + it.total_points, 0);
    const avgPoints = Math.round(sumPoints / totalBorrowers);

    // Hitung frekuensi poin untuk mendeteksi apakah tie breaker terjadi pada tanggal ini
    const pointFreq = {};
    for (const it of items) {
      pointFreq[it.total_points] = (pointFreq[it.total_points] || 0) + 1;
    }

    const rankedItems = items.map((it, idx) => {
      const rank = idx + 1;
      const isTieWithOthers = pointFreq[it.total_points] > 1;

      const startTime = new Date(it.planned_start_at).getTime();
      const endTime = new Date(it.planned_end_at).getTime();
      const isExpired = endTime <= nowTime;
      const durationDays = Math.max(1, Math.round((endTime - startTime) / DAY_MS));
      const hasApprovedConflict = it.approved_overlaps > 0;
      const hasPendingConflict = it.pending_overlaps > 0;

      // 2. Perbandingan poin antar peminjam di tanggal yang sama
      let pointComparison = "";
      if (totalBorrowers === 1) {
        pointComparison = "Peminjam tunggal pada tanggal ini";
      } else if (rank === 1) {
        const nextItem = items[1];
        const pointLead = it.total_points - nextItem.total_points;
        if (pointLead > 0) {
          pointComparison = `Poin tertinggi (+${pointLead} poin dibanding peringkat #2)`;
        } else {
          pointComparison = `Poin tertinggi (sama dengan peringkat #2, unggul via tie-breaker waktu pengajuan)`;
        }
      } else {
        const topItem = items[0];
        const pointDiff = topItem.total_points - it.total_points;
        if (pointDiff === 0) {
          pointComparison = `Poin sama dengan peringkat #1 (${topItem.total_points} poin), berada di peringkat #${rank} karena waktu pengajuan`;
        } else {
          pointComparison = `Selisih -${pointDiff} poin dari peringkat #1 (${topItem.total_points} poin)`;
        }
      }

      // Daftar perbandingan rekanan di tanggal yang sama
      const peersComparison = items.map((p, pIdx) => ({
        rank: pIdx + 1,
        borrower_name: p.borrower_name,
        total_points: p.total_points,
        is_current: p.request_id === it.request_id,
        diff_from_current: p.total_points - it.total_points,
      }));

      // 3. Status rekomendasi: 'Direkomendasikan' | 'Perlu tinjauan Kadep'
      let recommendationStatus = "Perlu tinjauan Kadep";
      let recommendationReason = "";

      if (isExpired) {
        recommendationStatus = "Perlu tinjauan Kadep";
        recommendationReason = "Batas waktu peminjaman sudah lewat. Aturan melarang persetujuan (sarankan ditolak).";
      } else if (hasApprovedConflict) {
        recommendationStatus = "Perlu tinjauan Kadep";
        recommendationReason = "Jadwal bentrok dengan pengajuan lain yang sudah disetujui.";
      } else if (rank === 1 && it.total_points >= 0) {
        recommendationStatus = "Direkomendasikan";
        if (isTieWithOthers) {
          recommendationReason = `Memiliki poin tertinggi (${it.total_points} poin) bersama peminjam lain, unggul peringkat via tie-breaker waktu pengajuan lebih awal.`;
        } else if (totalBorrowers > 1) {
          recommendationReason = `Memiliki poin tertinggi (${it.total_points} poin) di antara ${totalBorrowers} peminjam pada tanggal ini.`;
        } else {
          recommendationReason = `Peminjam tunggal dengan saldo ${it.total_points} poin pada tanggal ini.`;
        }
      } else {
        recommendationStatus = "Perlu tinjauan Kadep";
        if (hasPendingConflict) {
          recommendationReason = `Poin peminjam (${it.total_points} poin) berada di peringkat #${rank} dan memiliki ${it.pending_overlaps} pengajuan pending lain yang beririsan.`;
        } else {
          recommendationReason = `Poin peminjam (${it.total_points} poin) berada di peringkat #${rank} di bawah peminjam teratas (${items[0].total_points} poin).`;
        }
      }

      allRankedCount++;

      return {
        request_id: it.request_id,
        borrower_id: it.borrower_id,
        borrower_name: it.borrower_name,
        borrower_email: it.borrower_email,
        borrower_role: it.borrower_role,
        total_points: it.total_points,
        discipline_level: it.discipline_level,
        item_id: it.item_id,
        item_name: it.item_name,
        category_name: it.category_name,
        item_availability_status: it.item_availability_status,
        purpose: it.purpose,
        planned_start_at: it.planned_start_at,
        planned_end_at: it.planned_end_at,
        duration_days: durationDays,
        submitted_at: it.submitted_at,
        review_queue_date: it.review_queue_date,
        request_status: it.request_status,
        is_expired: isExpired,
        pending_overlaps: it.pending_overlaps,
        approved_overlaps: it.approved_overlaps,
        rank,
        loan_date: loanDate,
        loan_date_formatted: formatTanggalWib(it.planned_start_at),
        tie_breaker_applied: isTieWithOthers,
        tie_breaker_note: isTieWithOthers
          ? `Poin sama (${it.total_points} poin). Tie breaker menggunakan waktu pengajuan (${formatDateTimeWib(it.submitted_at)}).`
          : null,
        point_comparison: pointComparison,
        diff_from_top: it.total_points - maxPoints,
        peers_comparison: peersComparison,
        recommendation_status: recommendationStatus,
        recommendation_reason: recommendationReason,
      };
    });

    groups.push({
      loan_date: loanDate,
      loan_date_formatted: formatTanggalWib(items[0].planned_start_at),
      total_borrowers: totalBorrowers,
      max_points: maxPoints,
      min_points: minPoints,
      avg_points: avgPoints,
      has_tie: Object.values(pointFreq).some((cnt) => cnt > 1),
      items: rankedItems,
    });
  }

  return {
    disclaimer: "Rekomendasi prioritas ini bersifat non-binding (tidak mengikat). Keputusan akhir persetujuan atau penolakan tetap berada sepenuhnya pada kewenangan Ketua Departemen.",
    is_non_binding: true,
    total_dates: groups.length,
    total_requests: allRankedCount,
    today: todayWib(now),
    groups,
  };
}

export async function getLoanHistory({ search = "", sortBy = "returned_at", sortOrder = "desc" } = {}) {
  const query = String(search || "").trim();
  if (query.length > 100) {
    throw httpError(400, "Pencarian maksimal 100 karakter");
  }

  const sortColumns = {
    returned_at: "ri.returned_at",
    handover_at: "lt.handover_at",
    item_name: "i.item_name",
    borrower_name: "u.full_name",
    late_days: "ri.late_days",
  };
  const column = sortColumns[sortBy];
  const direction = String(sortOrder).toLowerCase();
  if (!column) throw httpError(400, "Kolom pengurutan riwayat tidak valid");
  if (!["asc", "desc"].includes(direction)) {
    throw httpError(400, "Arah pengurutan harus asc atau desc");
  }

  const params = [];
  let searchCondition = "";
  if (query) {
    params.push(`%${query}%`);
    searchCondition = `AND (
      i.item_name ILIKE $1
      OR c.category_name ILIKE $1
      OR u.full_name ILIKE $1
      OR u.email ILIKE $1
    )`;
  }

  const { rows } = await db.query(
    `SELECT lt.loan_id, r.request_id, r.borrower_id, r.item_id,
            i.item_name, i.category_id, c.category_name,
            u.full_name AS borrower_name, u.email AS borrower_email,
            lt.handover_at, lt.due_at, lt.transaction_status,
            ri.returned_at, ri.late_days, ri.return_condition, ri.notes
       FROM loan_transactions lt
       JOIN loan_requests r ON r.request_id = lt.request_id
       JOIN items i ON i.item_id = r.item_id
       JOIN item_categories c ON c.category_id = i.category_id
       JOIN users u ON u.user_id = r.borrower_id
       JOIN return_inspections ri ON ri.loan_id = lt.loan_id
      WHERE lt.transaction_status = 'returned'
        ${searchCondition}
      ORDER BY ${column} ${direction.toUpperCase()} NULLS LAST,
               lt.loan_id DESC`,
    params
  );
  return rows;
}

export async function getLateLoanReport({
  month = todayWib().slice(0, 7),
  search = "",
  sortBy = "due_at",
  sortOrder = "asc",
} = {}) {
  const selectedMonth = String(month || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) {
    throw httpError(400, "Periode harus menggunakan format YYYY-MM");
  }

  const query = String(search || "").trim();
  if (query.length > 100) {
    throw httpError(400, "Pencarian maksimal 100 karakter");
  }

  const sortColumns = {
    due_at: "lt.due_at",
    item_name: "i.item_name",
    borrower_name: "u.full_name",
    late_days: `CASE
      WHEN ri.inspection_id IS NULL
        THEN CEIL(EXTRACT(EPOCH FROM (NOW() - lt.due_at)) / 86400)::int
      ELSE ri.late_days
    END`,
  };
  const column = sortColumns[sortBy];
  const direction = String(sortOrder).toLowerCase();
  if (!column) throw httpError(400, "Kolom pengurutan rekap keterlambatan tidak valid");
  if (!["asc", "desc"].includes(direction)) {
    throw httpError(400, "Arah pengurutan harus asc atau desc");
  }

  const [year, monthNumber] = selectedMonth.split("-").map(Number);
  const startAt = new Date(Date.UTC(year, monthNumber - 1, 1) - 7 * 60 * 60 * 1000);
  const endAt = new Date(Date.UTC(year, monthNumber, 1) - 7 * 60 * 60 * 1000);
  const params = [startAt, endAt];
  let searchCondition = "";
  if (query) {
    params.push(`%${query}%`);
    searchCondition = `AND (
      i.item_name ILIKE $3
      OR c.category_name ILIKE $3
      OR u.full_name ILIKE $3
      OR u.email ILIKE $3
    )`;
  }

  const { rows } = await db.query(
    `SELECT lt.loan_id, r.request_id, r.borrower_id, r.item_id,
            i.item_name, c.category_name,
            u.full_name AS borrower_name, u.email AS borrower_email,
            lt.handover_at, lt.due_at, lt.transaction_status,
            ri.returned_at, ri.return_condition,
            CASE
              WHEN ri.inspection_id IS NOT NULL THEN ri.late_days
              ELSE CEIL(EXTRACT(EPOCH FROM (NOW() - lt.due_at)) / 86400)::int
            END AS late_days,
            (ri.inspection_id IS NOT NULL) AS is_returned
       FROM loan_transactions lt
       JOIN loan_requests r ON r.request_id = lt.request_id
       JOIN items i ON i.item_id = r.item_id
       JOIN item_categories c ON c.category_id = i.category_id
       JOIN users u ON u.user_id = r.borrower_id
       LEFT JOIN return_inspections ri ON ri.loan_id = lt.loan_id
      WHERE lt.due_at >= $1
        AND lt.due_at < $2
        AND (
          (ri.inspection_id IS NOT NULL AND ri.late_days > 0)
          OR (
            ri.inspection_id IS NULL
            AND lt.transaction_status IN ('borrowed', 'overdue')
            AND lt.due_at < NOW()
          )
        )
        ${searchCondition}
      ORDER BY ${column} ${direction.toUpperCase()} NULLS LAST,
               lt.loan_id DESC`,
    params
  );

  return { month: selectedMonth, items: rows };
}

/**
 * Menyetujui pengajuan peminjaman oleh Kadep.
 *
 * Aturan:
 *   - Hanya pengajuan berstatus 'pending' yang bisa disetujui (selain itu -> 409).
 *   - Pengajuan yang planned_end_at-nya sudah lewat tidak boleh disetujui (409, sarankan tolak).
 *   - Pengajuan yang planned_start_at-nya sudah lewat tapi belum berakhir masih boleh disetujui.
 *   - Persetujuan TIDAK mengubah items.availability_status.
 *   - Jika terjadi bentrok dengan approved lain -> DB melempar 23P01 -> tangkap dan lempar 409.
 */
export async function approveLoanRequest({ requestId, approverId, now = new Date() }) {
  const reqId = Number(requestId);
  if (!Number.isInteger(reqId) || reqId <= 0) {
    throw httpError(400, "ID pengajuan tidak valid");
  }

  const client = await db.connect();
  let loan = null;
  try {
    await client.query("BEGIN");

    // Kunci baris pengajuan peminjaman
    const { rows: loanRows } = await client.query(
      `SELECT r.request_id, r.borrower_id, r.item_id, r.purpose,
              r.planned_start_at, r.planned_end_at, r.request_status,
              i.item_name, i.availability_status
         FROM loan_requests r
         JOIN items i ON i.item_id = r.item_id
        WHERE r.request_id = $1
          FOR UPDATE OF r`,
      [reqId]
    );

    loan = loanRows[0];
    if (!loan) {
      throw httpError(404, "Pengajuan peminjaman tidak ditemukan");
    }

    if (loan.request_status !== "pending") {
      throw httpError(
        409,
        `Pengajuan tidak dapat diputuskan karena sudah berstatus '${loan.request_status}'`
      );
    }

    const plannedEnd = new Date(loan.planned_end_at);
    if (plannedEnd.getTime() <= now.getTime()) {
      throw httpError(
        409,
        "Pengajuan tidak dapat disetujui karena batas waktu peminjaman sudah lewat. Silakan tolak pengajuan ini."
      );
    }

    // Ubah status pengajuan menjadi 'approved'
    await client.query(
      `UPDATE loan_requests
          SET request_status = 'approved'
        WHERE request_id = $1`,
      [reqId]
    );

    // Simpan keputusan ke approval_decisions
    await client.query(
      `INSERT INTO approval_decisions (request_id, approver_id, decision, reason)
       VALUES ($1, $2, 'approved', NULL)`,
      [reqId, approverId]
    );

    // Catat audit log
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'approve_loan_request', 'loan_request', $2, $3)`,
      [
        approverId,
        reqId,
        JSON.stringify({
          item_id: loan.item_id,
          item_name: loan.item_name,
          borrower_id: loan.borrower_id,
          planned_start_at: loan.planned_start_at,
          planned_end_at: loan.planned_end_at,
        }),
      ]
    );

    await client.query("COMMIT");

    return {
      request_id: reqId,
      request_status: "approved",
      item_id: loan.item_id,
      item_name: loan.item_name,
      planned_start_at: loan.planned_start_at,
      planned_end_at: loan.planned_end_at,
    };
  } catch (err) {
    await client.query("ROLLBACK");

    if (isApprovedOverlapError(err)) {
      let conflicts = [];
      if (loan) {
        const { rows: conflictRows } = await db.query(
          `SELECT request_status, planned_start_at, planned_end_at
             FROM loan_requests
            WHERE item_id = $1
              AND request_status = 'approved'
              AND tstzrange(planned_start_at, planned_end_at) && tstzrange($2::timestamptz, $3::timestamptz)
            ORDER BY planned_start_at`,
          [loan.item_id, loan.planned_start_at, loan.planned_end_at]
        );
        conflicts = conflictRows.map((r) => ({
          status: r.request_status,
          start: r.planned_start_at,
          end: r.planned_end_at,
        }));
      }

      throw httpError(
        409,
        "Jadwal bentrok dengan pengajuan lain yang sudah disetujui",
        { conflicts }
      );
    }

    throw err;
  } finally {
    client.release();
  }
}

/**
 * Menolak pengajuan peminjaman oleh Kadep.
 *
 * Aturan:
 *   - Menolak WAJIB menyertakan alasan (trim, tidak kosong, maks 500 karakter).
 *   - Hanya pengajuan berstatus 'pending' yang bisa ditolak (selain itu -> 409).
 */
export async function rejectLoanRequest({ requestId, approverId, reason, now = new Date() }) {
  const reqId = Number(requestId);
  if (!Number.isInteger(reqId) || reqId <= 0) {
    throw httpError(400, "ID pengajuan tidak valid");
  }

  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) {
    throw httpError(400, "Alasan penolakan wajib diisi");
  }
  if (text.length > 500) {
    throw httpError(400, "Alasan penolakan maksimal 500 karakter");
  }

  const client = await db.connect();
  let loan = null;
  try {
    await client.query("BEGIN");

    // Kunci baris pengajuan peminjaman
    const { rows: loanRows } = await client.query(
      `SELECT r.request_id, r.borrower_id, r.item_id, r.purpose,
              r.planned_start_at, r.planned_end_at, r.request_status,
              i.item_name
         FROM loan_requests r
         JOIN items i ON i.item_id = r.item_id
        WHERE r.request_id = $1
          FOR UPDATE OF r`,
      [reqId]
    );

    loan = loanRows[0];
    if (!loan) {
      throw httpError(404, "Pengajuan peminjaman tidak ditemukan");
    }

    if (loan.request_status !== "pending") {
      throw httpError(
        409,
        `Pengajuan tidak dapat diputuskan karena sudah berstatus '${loan.request_status}'`
      );
    }

    // Ubah status pengajuan menjadi 'rejected'
    await client.query(
      `UPDATE loan_requests
          SET request_status = 'rejected'
        WHERE request_id = $1`,
      [reqId]
    );

    // Simpan keputusan ke approval_decisions
    await client.query(
      `INSERT INTO approval_decisions (request_id, approver_id, decision, reason)
       VALUES ($1, $2, 'rejected', $3)`,
      [reqId, approverId, text]
    );

    // Catat audit log
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'reject_loan_request', 'loan_request', $2, $3)`,
      [
        approverId,
        reqId,
        JSON.stringify({
          item_id: loan.item_id,
          item_name: loan.item_name,
          borrower_id: loan.borrower_id,
          reason: text,
        }),
      ]
    );

    await client.query("COMMIT");

    return {
      request_id: reqId,
      request_status: "rejected",
      item_id: loan.item_id,
      item_name: loan.item_name,
      reason: text,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Helper router untuk memutuskan pengajuan (approved/rejected).
 */
export async function decideLoanRequest({ requestId, approverId, decision, reason, now = new Date() }) {
  if (decision === "approved") {
    return approveLoanRequest({ requestId, approverId, now });
  }
  if (decision === "rejected") {
    return rejectLoanRequest({ requestId, approverId, reason, now });
  }
  throw httpError(400, "Keputusan tidak valid (harus 'approved' atau 'rejected')");
}

/**
 * Mengambil daftar pengajuan dan peminjaman milik peminjam yang sedang login.
 */
export async function getMyLoanRequests(borrowerId, { tab = "all", search = "" } = {}) {
  const query = `
    SELECT 
      lr.request_id,
      lr.borrower_id,
      lr.item_id,
      lr.purpose,
      lr.planned_start_at,
      lr.planned_end_at,
      lr.submitted_at,
      lr.review_queue_date,
      lr.request_status,
      i.item_name,
      i.item_condition,
      i.availability_status as item_availability,
      c.category_name,
      ad.decision,
      ad.reason AS rejection_reason,
      ad.decided_at,
      approver.full_name AS approver_name,
      lt.loan_id,
      lt.transaction_status,
      lt.handover_at,
      lt.due_at,
      handover_user.full_name AS handover_by_name,
      ri.inspection_id,
      ri.returned_at,
      ri.return_condition,
      ri.notes AS return_notes,
      ri.late_days,
      return_user.full_name AS return_confirmed_by_name
    FROM loan_requests lr
    JOIN items i ON lr.item_id = i.item_id
    JOIN item_categories c ON i.category_id = c.category_id
    LEFT JOIN approval_decisions ad ON lr.request_id = ad.request_id
    LEFT JOIN users approver ON ad.approver_id = approver.user_id
    LEFT JOIN loan_transactions lt ON lr.request_id = lt.request_id
    LEFT JOIN users handover_user ON lt.handover_by = handover_user.user_id
    LEFT JOIN return_inspections ri ON lt.loan_id = ri.loan_id
    LEFT JOIN users return_user ON ri.confirmed_by = return_user.user_id
    WHERE lr.borrower_id = $1
    ORDER BY lr.submitted_at DESC, lr.request_id DESC
  `;

  const { rows } = await db.query(query, [borrowerId]);

  // Hitung status terpadu dan kategori filter
  const processed = rows.map((r) => {
    let currentStatus = r.request_status;
    let statusLabel = "Menunggu Persetujuan";
    let statusCategory = "pending";

    if (r.transaction_status === "returned") {
      currentStatus = "returned";
      statusLabel = "Selesai Dikembalikan";
      statusCategory = "returned";
    } else if (r.transaction_status === "borrowed" || r.transaction_status === "overdue") {
      currentStatus = r.transaction_status;
      statusLabel = r.transaction_status === "overdue" ? "Terlambat Dikembalikan" : "Sedang Dipinjam";
      statusCategory = "borrowed";
    } else if (r.request_status === "rejected") {
      currentStatus = "rejected";
      statusLabel = "Ditolak Kadep";
      statusCategory = "rejected";
    } else if (r.request_status === "approved") {
      currentStatus = "approved";
      statusLabel = "Disetujui (Menunggu Serah Terima)";
      statusCategory = "approved";
    } else if (r.request_status === "cancelled") {
      currentStatus = "cancelled";
      statusLabel = "Dibatalkan";
      statusCategory = "cancelled";
    } else {
      currentStatus = "pending";
      statusLabel = "Menunggu Persetujuan";
      statusCategory = "pending";
    }

    return {
      ...r,
      current_status: currentStatus,
      status_label: statusLabel,
      status_category: statusCategory,
    };
  });

  // Hitung counts per kategori
  const counts = {
    all: processed.length,
    pending: processed.filter((item) => item.status_category === "pending").length,
    approved: processed.filter((item) => item.status_category === "approved").length,
    borrowed: processed.filter((item) => item.status_category === "borrowed").length,
    returned: processed.filter((item) => item.status_category === "returned").length,
    rejected: processed.filter((item) => item.status_category === "rejected").length,
  };

  // Filter tab jika bukan 'all'
  let filtered = processed;
  if (tab && tab !== "all") {
    filtered = filtered.filter((item) => item.status_category === tab);
  }

  // Filter search
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (item) =>
        (item.item_name && item.item_name.toLowerCase().includes(q)) ||
        (item.purpose && item.purpose.toLowerCase().includes(q)) ||
        (item.category_name && item.category_name.toLowerCase().includes(q))
    );
  }

  return {
    items: filtered,
    counts,
  };
}

/**
 * Membatalkan pengajuan yang masih berstatus 'pending'.
 */
export async function cancelLoanRequest({ requestId, borrowerId }) {
  const reqId = Number(requestId);
  if (!Number.isInteger(reqId) || reqId <= 0) {
    throw httpError(400, "ID pengajuan tidak valid");
  }

  const { rows } = await db.query(
    `SELECT request_id, request_status, item_id FROM loan_requests WHERE request_id = $1 AND borrower_id = $2`,
    [reqId, borrowerId]
  );

  if (rows.length === 0) {
    throw httpError(404, "Pengajuan peminjaman tidak ditemukan");
  }

  const loan = rows[0];
  if (loan.request_status !== "pending") {
    throw httpError(400, "Hanya pengajuan berstatus menunggu persetujuan yang dapat dibatalkan");
  }

  await db.query(
    `UPDATE loan_requests SET request_status = 'cancelled' WHERE request_id = $1`,
    [reqId]
  );

  return { request_id: reqId, request_status: "cancelled" };
}

/**
 * Mengambil daftar notifikasi untuk peminjam.
 */
export async function getMyNotifications(borrowerId) {
  const notifications = [];

  // 1. Notifikasi dari log pengingat (notification_logs)
  const logQuery = `
    SELECT 
      nl.notification_id,
      nl.notification_type,
      nl.status,
      nl.sent_at,
      nl.created_at,
      lt.loan_id,
      lt.due_at,
      i.item_name
    FROM notification_logs nl
    JOIN loan_transactions lt ON nl.loan_id = lt.loan_id
    JOIN loan_requests lr ON lt.request_id = lr.request_id
    JOIN items i ON lr.item_id = i.item_id
    WHERE nl.user_id = $1 AND nl.status = 'sent'
    ORDER BY nl.created_at DESC
  `;
  const { rows: logs } = await db.query(logQuery, [borrowerId]);
  for (const log of logs) {
    if (
      log.notification_type === "due_h_minus_1" ||
      log.notification_type === "due_reminder_h1" ||
      log.notification_type === "due_h_minus_2" ||
      log.notification_type === "due_reminder_h2"
    ) {
      const isH2 = log.notification_type.includes("2");
      notifications.push({
        id: `reminder-${log.notification_id}`,
        type: "reminder",
        title: isH2 ? "Pengingat Jatuh Tempo (H-2)" : "Pengingat Jatuh Tempo (H-1)",
        message: `Email pengingat jatuh tempo untuk peminjaman barang "${log.item_name}" telah dikirim ke email Anda. Harap kembalikan tepat waktu untuk menghindari pengurangan poin.`,
        date: log.sent_at || log.created_at,
        severity: "warning",
      });
    }
  }

  // 2. Notifikasi keputusan persetujuan/penolakan
  const decisionQuery = `
    SELECT 
      ad.decision_id,
      ad.decision,
      ad.reason,
      ad.decided_at,
      i.item_name,
      lr.request_id
    FROM approval_decisions ad
    JOIN loan_requests lr ON ad.request_id = lr.request_id
    JOIN items i ON lr.item_id = i.item_id
    WHERE lr.borrower_id = $1
    ORDER BY ad.decided_at DESC
  `;
  const { rows: decisions } = await db.query(decisionQuery, [borrowerId]);
  for (const dec of decisions) {
    if (dec.decision === "approved") {
      notifications.push({
        id: `decision-${dec.decision_id}`,
        type: "approval_approved",
        title: "Pengajuan Peminjaman Disetujui",
        message: `Pengajuan peminjaman barang "${dec.item_name}" telah disetujui oleh Ketua Departemen. Silakan temui Tendik di laboratorium untuk serah terima barang.`,
        date: dec.decided_at,
        severity: "success",
      });
    } else if (dec.decision === "rejected") {
      notifications.push({
        id: `decision-${dec.decision_id}`,
        type: "approval_rejected",
        title: "Pengajuan Peminjaman Ditolak",
        message: `Pengajuan peminjaman barang "${dec.item_name}" ditolak oleh Ketua Departemen. Alasan: ${dec.reason}`,
        date: dec.decided_at,
        severity: "error",
      });
    }
  }

  // 3. Notifikasi serah terima barang
  const handoverQuery = `
    SELECT 
      lt.loan_id,
      lt.handover_at,
      lt.due_at,
      i.item_name
    FROM loan_transactions lt
    JOIN loan_requests lr ON lt.request_id = lr.request_id
    JOIN items i ON lr.item_id = i.item_id
    WHERE lr.borrower_id = $1
    ORDER BY lt.handover_at DESC
  `;
  const { rows: handovers } = await db.query(handoverQuery, [borrowerId]);
  for (const h of handovers) {
    notifications.push({
      id: `handover-${h.loan_id}`,
      type: "handover",
      title: "Barang Berhasil Diserahterimakan",
      message: `Barang "${h.item_name}" telah diserahkan oleh Tendik dan masa pinjam telah dimulai.`,
      date: h.handover_at,
      severity: "info",
    });
  }

  // 4. Notifikasi pengembalian
  const returnQuery = `
    SELECT 
      ri.inspection_id,
      ri.returned_at,
      ri.return_condition,
      ri.late_days,
      i.item_name
    FROM return_inspections ri
    JOIN loan_transactions lt ON ri.loan_id = lt.loan_id
    JOIN loan_requests lr ON lt.request_id = lr.request_id
    JOIN items i ON lr.item_id = i.item_id
    WHERE lr.borrower_id = $1
    ORDER BY ri.returned_at DESC
  `;
  const { rows: returns } = await db.query(returnQuery, [borrowerId]);
  for (const ret of returns) {
    const isLate = ret.late_days > 0;
    notifications.push({
      id: `return-${ret.inspection_id}`,
      type: "return",
      title: isLate ? "Pengembalian Barang Selesai (Terlambat)" : "Pengembalian Barang Selesai",
      message: `Barang "${ret.item_name}" telah diterima kembali oleh Tendik (kondisi: ${ret.return_condition}${isLate ? `, terlambat ${ret.late_days} hari` : ""}).`,
      date: ret.returned_at,
      severity: isLate ? "warning" : "success",
    });
  }

  // Urutkan semua notifikasi dari yang terbaru
  notifications.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return notifications;
}
