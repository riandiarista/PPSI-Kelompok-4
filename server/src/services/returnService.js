

import db from "../config/db.js";
import { DEFAULT_POINT_RULES, DEFAULT_DISCIPLINE_LEVELS } from "../constants/pointRules.js";
import { getPointSettings } from "./pointSettingsService.js";

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

// ─── Konstanta Gamifikasi ──────────────────────────────────────────────────
// Nilai BAWAAN. Nilai yang berlaku diambil dari tabel point_settings lewat
// getPointSettings() dan diteruskan ke fungsi-fungsi di bawah.
export const POINT_RULES = DEFAULT_POINT_RULES;
export const DISCIPLINE_LEVELS = DEFAULT_DISCIPLINE_LEVELS;

export function calculateLevel(balance, levels = DISCIPLINE_LEVELS) {
  for (const lvl of levels) {
    if (balance >= lvl.min) return lvl.name;
  }
  return "beginner";
}

export function calculateLateDays(dueAt, returnedAt) {
  const dueMs = new Date(dueAt).getTime();
  const returnedMs = new Date(returnedAt).getTime();
  if (!Number.isFinite(dueMs) || !Number.isFinite(returnedMs)) {
    throw httpError(400, "Format waktu pengembalian tidak valid");
  }
  return Math.max(0, Math.ceil((returnedMs - dueMs) / (24 * 60 * 60 * 1000)));
}

export function getItemStatusAfterReturn(returnCondition) {
  const statusByCondition = {
    good: "available",
    minor_damage: "maintenance",
    major_damage: "unavailable",
  };
  return statusByCondition[returnCondition];
}

/**
 * Menghitung delta poin dan keterangan berdasarkan keterlambatan & kondisi.
 *
 * @param {object} opts
 * @param {number}  opts.lateDays         - jumlah hari terlambat (>= 0)
 * @param {string}  opts.returnCondition  - 'good' | 'minor_damage' | 'major_damage'
 * @returns {{ delta: number, breakdown: object }}
 */
export function calculatePointDelta({ lateDays, returnCondition, rules = POINT_RULES }) {
  const days = Math.max(0, Math.floor(lateDays));
  let conditionPoints = 0;
  let latePoints = 0;
  let majorDamagePenalty = 0;

  // Poin kondisi (hanya berlaku jika tepat waktu; jika terlambat kondisi masih dihitung)
  if (returnCondition === "good") {
    conditionPoints = days === 0 ? rules.ON_TIME_GOOD : 0;
  } else if (returnCondition === "minor_damage") {
    conditionPoints = rules.ON_TIME_MINOR_DAMAGE;
  } else if (returnCondition === "major_damage") {
    conditionPoints = rules.ON_TIME_MAJOR_DAMAGE;
    majorDamagePenalty = rules.MAJOR_DAMAGE_PENALTY;
  }

  // Penalti keterlambatan
  latePoints = days > 0 ? rules.LATE_PER_DAY * days : 0;

  const delta = conditionPoints + latePoints + majorDamagePenalty;

  return {
    delta,
    breakdown: {
      condition_points:      conditionPoints,
      late_days:             days,
      late_points:           latePoints,
      major_damage_penalty:  majorDamagePenalty,
      total_delta:           delta,
    },
  };
}

/**
 * Mengambil daftar barang yang sedang dipinjam (siap dikembalikan).
 * Menampilkan transaction_status 'borrowed' (termasuk yang overdue).
 */
export async function getActiveLoanTransactions({ now = new Date() } = {}) {
  const { rows } = await db.query(
    `SELECT
       lt.loan_id,
       lt.request_id,
       lt.handover_by,
       tendik.full_name  AS handover_by_name,
       lt.handover_at,
       lt.due_at,
       lt.transaction_status,
       r.borrower_id,
       u.full_name        AS borrower_name,
       u.email            AS borrower_email,
       ro.role_name       AS borrower_role,
       r.item_id,
       i.item_name,
       c.category_name,
       r.purpose,
       r.planned_start_at,
       r.planned_end_at,
       -- Poin saldo peminjam saat ini
       COALESCE(ug.point_balance, 0) AS current_points,
       COALESCE(ug.discipline_level, 'beginner') AS discipline_level
     FROM loan_transactions lt
     JOIN loan_requests r ON r.request_id = lt.request_id
     JOIN users u ON u.user_id = r.borrower_id
     LEFT JOIN roles ro ON ro.role_id = u.role_id
     JOIN items i ON i.item_id = r.item_id
     JOIN item_categories c ON c.category_id = i.category_id
     JOIN users tendik ON tendik.user_id = lt.handover_by
     LEFT JOIN user_gamifications ug ON ug.user_id = r.borrower_id
     WHERE lt.transaction_status = 'borrowed'
     ORDER BY lt.due_at ASC, lt.loan_id ASC`,
    []
  );

  const nowMs = now.getTime();
  return rows.map((r) => {
    const dueMs = new Date(r.due_at).getTime();
    const isOverdue = dueMs < nowMs;
    const lateDaysEstimate = calculateLateDays(r.due_at, now);
    return {
      ...r,
      is_overdue:          isOverdue,
      late_days_estimate:  lateDaysEstimate,
    };
  });
}

/**
 * Pratinjau perubahan poin sebelum konfirmasi pengembalian.
 * Tidak menyimpan apa pun ke DB.
 */
export async function previewReturnPoints({ loanId, returnedAt, returnCondition }) {
  const id = Number(loanId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "ID transaksi tidak valid");

  const validConditions = ["good", "minor_damage", "major_damage"];
  if (!validConditions.includes(returnCondition)) {
    throw httpError(400, "Kondisi tidak valid (harus: good / minor_damage / major_damage)");
  }

  const { rows } = await db.query(
    `SELECT lt.loan_id, lt.due_at, r.borrower_id,
            COALESCE(ug.point_balance, 0) AS current_points,
            COALESCE(ug.discipline_level, 'beginner') AS discipline_level
       FROM loan_transactions lt
       JOIN loan_requests r ON r.request_id = lt.request_id
       LEFT JOIN user_gamifications ug ON ug.user_id = r.borrower_id
      WHERE lt.loan_id = $1 AND lt.transaction_status = 'borrowed'`,
    [id]
  );

  if (!rows[0]) throw httpError(404, "Transaksi peminjaman aktif tidak ditemukan");
  const tx = rows[0];

  const returnTime = returnedAt ? new Date(returnedAt) : new Date();
  const dueTime    = new Date(tx.due_at);
  const lateDays = calculateLateDays(dueTime, returnTime);

  const settings = await getPointSettings();
  const { delta, breakdown } = calculatePointDelta({ lateDays, returnCondition, rules: settings.rules });

  const currentBalance = tx.current_points;
  const newBalance     = Math.max(0, currentBalance + delta);
  const actualDelta    = newBalance - currentBalance; // Bisa lebih kecil dari delta karena floor 0

  return {
    loan_id:          id,
    borrower_id:      tx.borrower_id,
    current_points:   currentBalance,
    discipline_level: tx.discipline_level,
    return_condition: returnCondition,
    late_days:        lateDays,
    point_delta:      actualDelta,
    new_balance:      newBalance,
    new_level:        calculateLevel(newBalance, settings.levels),
    breakdown,
  };
}

/**
 * Memproses pengembalian barang (UC-14).
 *
 * @param {object} opts
 * @param {number} opts.loanId          - ID loan_transaction
 * @param {number} opts.tendikId        - user_id Tendik yang mengkonfirmasi
 * @param {string} opts.returnCondition - 'good' | 'minor_damage' | 'major_damage'
 * @param {string} [opts.notes]         - catatan kondisi
 * @param {string} [opts.returnedAt]    - ISO timestamp waktu pengembalian (default: now)
 * @param {object} [opts.now]           - timestamp referensi
 */
export async function confirmReturn({
  loanId,
  tendikId,
  returnCondition,
  notes = "",
  returnedAt,
  now = new Date(),
}) {
  const id = Number(loanId);
  if (!Number.isInteger(id) || id <= 0) {
    throw httpError(400, "ID transaksi tidak valid");
  }

  const validConditions = ["good", "minor_damage", "major_damage"];
  if (!validConditions.includes(returnCondition)) {
    throw httpError(400, "Kondisi tidak valid (harus: good / minor_damage / major_damage)");
  }

  const returnTime = returnedAt ? new Date(returnedAt) : now;
  if (isNaN(returnTime.getTime())) {
    throw httpError(400, "Format waktu pengembalian tidak valid");
  }

  const notesTrimmed = String(notes || "").trim();

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Kunci baris loan_transaction + item
    const { rows: txRows } = await client.query(
      `SELECT
         lt.loan_id,
         lt.request_id,
         lt.due_at,
         lt.transaction_status,
         r.borrower_id,
         r.item_id,
         i.item_name,
         i.availability_status
       FROM loan_transactions lt
       JOIN loan_requests r ON r.request_id = lt.request_id
       JOIN items i ON i.item_id = r.item_id
       WHERE lt.loan_id = $1
         FOR UPDATE OF lt, i`,
      [id]
    );

    const tx = txRows[0];
    if (!tx) throw httpError(404, "Transaksi peminjaman tidak ditemukan");

    if (tx.transaction_status !== "borrowed") {
      throw httpError(
        409,
        `Transaksi sudah berstatus '${tx.transaction_status}', tidak dapat diproses ulang`
      );
    }

    // Hitung keterlambatan
    const lateDays = calculateLateDays(tx.due_at, returnTime);
    const itemStatus = getItemStatusAfterReturn(returnCondition);

    // Hitung poin
    const settings = await getPointSettings(client);
    const { delta: rawDelta, breakdown } = calculatePointDelta({ lateDays, returnCondition, rules: settings.rules });

    // Ambil / buat baris gamifikasi (upsert)
    const { rows: gamRows } = await client.query(
      `INSERT INTO user_gamifications (user_id, point_balance, discipline_level)
       VALUES ($1, 0, 'beginner')
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING point_balance, discipline_level`,
      [tx.borrower_id]
    );
    const currentBalance = gamRows[0].point_balance;
    const newBalance     = Math.max(0, currentBalance + rawDelta);
    const actualDelta    = newBalance - currentBalance;
    const newLevel       = calculateLevel(newBalance, settings.levels);

    // 1. Catat return_inspections
    const { rows: inspRows } = await client.query(
      `INSERT INTO return_inspections
         (loan_id, confirmed_by, returned_at, return_condition, notes, late_days)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING inspection_id, returned_at, confirmed_at`,
      [id, tendikId, returnTime, returnCondition, notesTrimmed || null, lateDays]
    );
    const inspection = inspRows[0];

    // 2. Ubah transaction_status → 'returned'
    await client.query(
      `UPDATE loan_transactions SET transaction_status = 'returned' WHERE loan_id = $1`,
      [id]
    );

    // 3. Simpan kondisi fisik dan status operasional barang sesuai hasil inspeksi.
    await client.query(
      `UPDATE items
          SET item_condition = $1,
              availability_status = $2
        WHERE item_id = $3`,
      [returnCondition, itemStatus, tx.item_id]
    );

    // 4. Perbarui user_gamifications (hanya jika delta ≠ 0)
    if (actualDelta !== 0) {
      await client.query(
        `UPDATE user_gamifications
            SET point_balance    = $1,
                discipline_level = $2
          WHERE user_id = $3`,
        [newBalance, newLevel, tx.borrower_id]
      );
    } else {
      // Tetap update level jika berubah (misalnya upsert baru saja dibuat)
      await client.query(
        `UPDATE user_gamifications
            SET discipline_level = $1
          WHERE user_id = $2`,
        [newLevel, tx.borrower_id]
      );
    }

    // 5. Catat point_transaction (hanya jika ada perubahan poin)
    let pointTxId = null;
    if (actualDelta !== 0) {
      const txType = lateDays > 0
        ? "late_penalty"
        : returnCondition === "good"
        ? "on_time_return"
        : "on_time_return"; // minor/major juga on_time_return jika tidak terlambat

      const { rows: ptRows } = await client.query(
        `INSERT INTO point_transactions
           (user_id, loan_id, points_delta, transaction_type, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING point_transaction_id`,
        [
          tx.borrower_id,
          id,
          actualDelta,
          txType,
          `Pengembalian ${tx.item_name}: ${
            lateDays > 0 ? `terlambat ${lateDays} hari, ` : "tepat waktu, "
          }kondisi ${returnCondition}`,
        ]
      );
      pointTxId = ptRows[0].point_transaction_id;
    }

    // 6. Catat audit log (KF-25)
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'confirm_return', 'return_inspection', $2, $3)`,
      [
        tendikId,
        inspection.inspection_id,
        JSON.stringify({
          loan_id:          id,
          item_id:          tx.item_id,
          item_name:        tx.item_name,
          borrower_id:      tx.borrower_id,
          return_condition: returnCondition,
          item_status:     itemStatus,
          late_days:        lateDays,
          returned_at:      returnTime.toISOString(),
          point_delta:      actualDelta,
          new_balance:      newBalance,
          new_level:        newLevel,
          breakdown,
        }),
      ]
    );

    await client.query("COMMIT");

    return {
      inspection_id:    inspection.inspection_id,
      loan_id:          id,
      item_id:          tx.item_id,
      item_name:        tx.item_name,
      borrower_id:      tx.borrower_id,
      return_condition: returnCondition,
      availability_status: itemStatus,
      late_days:        lateDays,
      returned_at:      inspection.returned_at,
      confirmed_at:     inspection.confirmed_at,
      gamification: {
        previous_balance:  currentBalance,
        point_delta:       actualDelta,
        new_balance:       newBalance,
        previous_level:    gamRows[0].discipline_level,
        new_level:         newLevel,
        level_changed:     gamRows[0].discipline_level !== newLevel,
        breakdown,
      },
      point_transaction_id: pointTxId,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
