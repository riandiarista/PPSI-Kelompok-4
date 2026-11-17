/**
 * handoverService.js — UC-13: Pencatatan Serah Terima Peminjaman (KF-13, KF-17, KF-25)
 *
 * Tanggung jawab:
 *  - Memvalidasi pengajuan berstatus 'approved' sebelum serah terima dilakukan.
 *  - Mencatat baris baru ke tabel loan_transactions (handover_by, handover_at, due_at).
 *  - Mengubah availability_status item menjadi 'borrowed'.
 *  - Mengubah request_status pengajuan menjadi 'completed' (proses dimulai).
 *  - Mencatat audit log KF-25.
 */

import db from "../config/db.js";
import { WIB_OFFSET } from "../constants/loanRules.js";

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

/**
 * Mengambil daftar pengajuan berstatus 'approved' yang siap diserahterimakan.
 * Hanya menampilkan pengajuan yang planned_start_at-nya sudah lewat atau hari ini
 * dan belum punya loan_transaction (artinya belum diserahterimakan).
 *
 * @param {object} opts
 * @param {object} [opts.now] - tanggal referensi (default: now)
 */
export async function getApprovedPendingHandover({ now = new Date() } = {}) {
  const { rows } = await db.query(
    `SELECT
       r.request_id,
       r.borrower_id,
       u.full_name   AS borrower_name,
       u.email       AS borrower_email,
       ro.role_name  AS borrower_role,
       r.item_id,
       i.item_name,
       c.category_name,
       i.availability_status,
       r.purpose,
       r.planned_start_at,
       r.planned_end_at,
       r.submitted_at,
       ad.decided_at AS approved_at,
       approver.full_name AS approved_by_name,
       -- Hitung durasi dalam hari bulat ke atas
       CEIL(EXTRACT(EPOCH FROM (r.planned_end_at - r.planned_start_at)) / 86400)::int AS duration_days
     FROM loan_requests r
     JOIN users u ON u.user_id = r.borrower_id
     LEFT JOIN roles ro ON ro.role_id = u.role_id
     JOIN items i ON i.item_id = r.item_id
     JOIN item_categories c ON c.category_id = i.category_id
     LEFT JOIN approval_decisions ad ON ad.request_id = r.request_id
     LEFT JOIN users approver ON approver.user_id = ad.approver_id
     -- Belum punya loan_transaction (belum diserahterimakan)
     LEFT JOIN loan_transactions lt ON lt.request_id = r.request_id
     WHERE r.request_status = 'approved'
       AND lt.loan_id IS NULL
     ORDER BY r.planned_start_at ASC, r.request_id ASC`,
    []
  );

  const nowMs = now.getTime();
  return rows.map((r) => {
    const startMs = new Date(r.planned_start_at).getTime();
    const endMs   = new Date(r.planned_end_at).getTime();
    return {
      ...r,
      is_started:   startMs <= nowMs && endMs > nowMs,
      is_not_started: startMs > nowMs,
      is_expired:   endMs <= nowMs,
    };
  });
}

/**
 * Mencatat serah terima barang (UC-13).
 *
 * @param {object} opts
 * @param {number} opts.requestId   - ID pengajuan peminjaman (request_id)
 * @param {number} opts.tendikId    - user_id Tendik yang melakukan serah terima
 * @param {string} [opts.handoverNote] - catatan opsional (tidak disimpan ke DB, hanya audit)
 * @param {object} [opts.now]       - timestamp referensi (default: now)
 */
export async function recordHandover({ requestId, tendikId, handoverNote = "", now = new Date() }) {
  const reqId = Number(requestId);
  if (!Number.isInteger(reqId) || reqId <= 0) {
    throw httpError(400, "ID pengajuan tidak valid");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Kunci baris pengajuan dan item sekaligus
    const { rows: loanRows } = await client.query(
      `SELECT
         r.request_id,
         r.borrower_id,
         r.item_id,
         r.purpose,
         r.planned_start_at,
         r.planned_end_at,
         r.request_status,
         i.item_name,
         i.availability_status
       FROM loan_requests r
       JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = $1
         FOR UPDATE OF r, i`,
      [reqId]
    );

    const loan = loanRows[0];
    if (!loan) {
      throw httpError(404, "Pengajuan peminjaman tidak ditemukan");
    }

    // Validasi: hanya 'approved' yang bisa diserahterimakan
    if (loan.request_status !== "approved") {
      throw httpError(
        409,
        `Pengajuan tidak dapat diserahterimakan karena berstatus '${loan.request_status}' (harus 'approved')`
      );
    }

    // Validasi: cek belum ada loan_transaction (idempoten guard)
    const { rows: existingTx } = await client.query(
      `SELECT loan_id FROM loan_transactions WHERE request_id = $1`,
      [reqId]
    );
    if (existingTx.length > 0) {
      throw httpError(409, "Serah terima untuk pengajuan ini sudah pernah dicatat");
    }

    // due_at = planned_end_at dari pengajuan (batas akhir sesuai jadwal persetujuan)
    const dueAt = new Date(loan.planned_end_at);
    const handoverAt = now;

    // Validasi: due_at harus setelah handover_at
    if (dueAt.getTime() <= handoverAt.getTime()) {
      throw httpError(
        409,
        "Jatuh tempo sudah terlewat. Tidak dapat mencatat serah terima untuk pengajuan yang sudah kedaluwarsa."
      );
    }

    // 1. Catat loan_transaction
    const { rows: txRows } = await client.query(
      `INSERT INTO loan_transactions
         (request_id, handover_by, handover_at, due_at, transaction_status)
       VALUES ($1, $2, $3, $4, 'borrowed')
       RETURNING loan_id, handover_at, due_at, transaction_status`,
      [reqId, tendikId, handoverAt, dueAt]
    );
    const transaction = txRows[0];

    // 2. Ubah availability_status item menjadi 'borrowed'
    await client.query(
      `UPDATE items SET availability_status = 'borrowed' WHERE item_id = $1`,
      [loan.item_id]
    );

    // 3. Ubah request_status menjadi 'completed' (proses peminjaman aktif)
    await client.query(
      `UPDATE loan_requests SET request_status = 'completed' WHERE request_id = $1`,
      [reqId]
    );

    // 4. Catat audit log (KF-25)
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'handover_loan', 'loan_transaction', $2, $3)`,
      [
        tendikId,
        transaction.loan_id,
        JSON.stringify({
          request_id:   reqId,
          item_id:      loan.item_id,
          item_name:    loan.item_name,
          borrower_id:  loan.borrower_id,
          handover_at:  handoverAt.toISOString(),
          due_at:       dueAt.toISOString(),
          note:         handoverNote || null,
        }),
      ]
    );

    await client.query("COMMIT");

    return {
      loan_id:            transaction.loan_id,
      request_id:         reqId,
      item_id:            loan.item_id,
      item_name:          loan.item_name,
      borrower_id:        loan.borrower_id,
      handover_at:        transaction.handover_at,
      due_at:             transaction.due_at,
      transaction_status: transaction.transaction_status,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
