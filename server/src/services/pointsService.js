/**
 * pointsService.js — UC-03: Poin, Level, dan Riwayat Reward
 *                   (KF-19, KF-20, KF-21)
 *
 * Tanggung jawab:
 *  - Mengambil saldo poin dan level aktif pengguna dari user_gamifications.
 *  - Mengambil riwayat perubahan poin dari point_transactions (hanya milik sendiri, KNF-02).
 *  - Menghitung statistik ringkasan (total penambahan, pengurangan, dll).
 *  - Mengambil data reward_periods dan pemenang reward_awards.
 *
 * Level Kedisiplinan (sesuai konstanta di returnService.js / spesifikasi A3):
 *   gold     ≥ 300 poin
 *   silver   ≥ 150 poin
 *   bronze   ≥ 50  poin
 *   beginner ≥ 0   poin (default)
 */

import db from "../config/db.js";
import { DISCIPLINE_LEVELS } from "./returnService.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Label tampilan level untuk frontend
export const LEVEL_META = {
  teladan:    { label: "Teladan",        color: "#B7791F", badge: "🥇", min: 70, next: null },
  terpercaya: { label: "Terpercaya",     color: "#64748B", badge: "🥈", min: 50, next: 70   },
  pemula:     { label: "Pemula",         color: "#9A3412", badge: "🥉", min: 30, next: 50   },
  beginner:   { label: "Belum Pemula",   color: "#4A5B56", badge: "🌱", min: 0,  next: 30   },
};

export const ALL_LEVELS_INFO = [
  { key: "teladan",    label: "Teladan",      min: 70, badge: "🥇", color: "#B7791F" },
  { key: "terpercaya", label: "Terpercaya",   min: 50, badge: "🥈", color: "#64748B" },
  { key: "pemula",     label: "Pemula",       min: 30, badge: "🥉", color: "#9A3412" },
  { key: "beginner",   label: "Belum Pemula", min: 0,  badge: "🌱", color: "#4A5B56" },
];

export function getLevelMeta(balance) {
  for (const lvl of DISCIPLINE_LEVELS) {
    if (balance >= lvl.min) {
      return { name: lvl.name, ...LEVEL_META[lvl.name] };
    }
  }
  return { name: "beginner", ...LEVEL_META.beginner };
}

/**
 * Menghitung progress (%) menuju level berikutnya.
 * Jika sudah gold (level tertinggi), progress = 100.
 */
export function calculateProgress(balance, levelMeta) {
  if (!levelMeta.next) return 100; // Level tertinggi
  const rangeStart = levelMeta.min;
  const rangeEnd   = levelMeta.next;
  const progress   = ((balance - rangeStart) / (rangeEnd - rangeStart)) * 100;
  return Math.min(100, Math.max(0, Math.round(progress)));
}

// ─── Endpoint: Ringkasan Poin & Level ──────────────────────────────────────

/**
 * Mengambil saldo poin, level aktif, dan statistik ringkasan user yang login.
 * Peminjam hanya bisa mengakses milik sendiri (KNF-02 — validasi di service).
 *
 * @param {number} userId - user_id dari req.user (sudah divalidasi JWT)
 */
export async function getMyPoints(userId) {
  // Pastikan userId valid
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "User ID tidak valid");

  // Ambil saldo gamifikasi (upsert agar tidak error jika baris belum ada)
  const { rows: gamRows } = await db.query(
    `INSERT INTO user_gamifications (user_id, point_balance, discipline_level)
     VALUES ($1, 0, 'beginner')
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING point_balance, discipline_level, updated_at`,
    [id]
  );
  const gam = gamRows[0];
  const balance = gam.point_balance;

  // Statistik ringkasan dari point_transactions
  const { rows: statRows } = await db.query(
    `SELECT
       COUNT(*)::int                                                       AS total_transactions,
       COALESCE(SUM(points_delta) FILTER (WHERE points_delta > 0), 0)::int AS total_earned,
       COALESCE(ABS(SUM(points_delta) FILTER (WHERE points_delta < 0)), 0)::int AS total_deducted,
       COUNT(*) FILTER (WHERE transaction_type = 'on_time_return')::int   AS on_time_count,
       COUNT(*) FILTER (WHERE transaction_type = 'late_penalty')::int     AS late_count,
       COUNT(*) FILTER (WHERE transaction_type = 'manual_adjustment')::int AS adjustment_count
     FROM point_transactions
     WHERE user_id = $1`,
    [id]
  );
  const stats = statRows[0];

  const levelMeta = getLevelMeta(balance);
  const progress  = calculateProgress(balance, levelMeta);

  return {
    user_id:         id,
    point_balance:   balance,
    discipline_level: levelMeta.name,
    level_label:     levelMeta.label,
    level_badge:     levelMeta.badge,
    level_color:     levelMeta.color,
    level_min:       levelMeta.min,
    level_next:      levelMeta.next,
    level_progress:  progress,
    updated_at:      gam.updated_at,
    stats: {
      total_transactions: stats.total_transactions,
      total_earned:       stats.total_earned,
      total_deducted:     stats.total_deducted,
      on_time_count:      stats.on_time_count,
      late_count:         stats.late_count,
      adjustment_count:   stats.adjustment_count,
    },
  };
}

// ─── Endpoint: Riwayat Poin ─────────────────────────────────────────────────

/**
 * Riwayat point_transactions milik user (paginasi).
 *
 * @param {object} opts
 * @param {number}  opts.userId  - harus sama dengan user yang login (KNF-02)
 * @param {number}  [opts.page]  - halaman (default 1)
 * @param {number}  [opts.limit] - baris per halaman (default 20, maks 100)
 * @param {string}  [opts.type]  - filter: 'on_time_return' | 'late_penalty' | 'manual_adjustment' | '' (semua)
 */
export async function getMyPointHistory({ userId, page = 1, limit = 20, type = "" }) {
  const id      = Number(userId);
  const pageNum = Math.max(1, Math.floor(Number(page)));
  const perPage = Math.min(100, Math.max(1, Math.floor(Number(limit))));
  const offset  = (pageNum - 1) * perPage;

  const validTypes = ["on_time_return", "late_penalty", "manual_adjustment"];
  const typeFilter = validTypes.includes(type) ? type : null;

  const params = [id];
  let typeClause = "";
  if (typeFilter) {
    params.push(typeFilter);
    typeClause = `AND pt.transaction_type = $${params.length}`;
  }

  const countParams = [...params];
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM point_transactions pt
     WHERE pt.user_id = $1 ${typeClause}`,
    countParams
  );
  const total = countRows[0]?.total || 0;

  params.push(perPage, offset);
  const { rows } = await db.query(
    `SELECT
       pt.point_transaction_id,
       pt.user_id,
       pt.loan_id,
       pt.points_delta,
       pt.transaction_type,
       pt.reason,
       pt.created_at,
       -- Info barang yang dipinjam (jika ada loan_id)
       i.item_name,
       c.category_name
     FROM point_transactions pt
     LEFT JOIN loan_transactions lt ON lt.loan_id = pt.loan_id
     LEFT JOIN loan_requests lr ON lr.request_id = lt.request_id
     LEFT JOIN items i ON i.item_id = lr.item_id
     LEFT JOIN item_categories c ON c.category_id = i.category_id
     WHERE pt.user_id = $1 ${typeClause}
     ORDER BY pt.created_at DESC, pt.point_transaction_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const TYPE_LABELS = {
    on_time_return:    "Pengembalian Tepat Waktu",
    late_penalty:      "Penalti Keterlambatan",
    manual_adjustment: "Penyesuaian Manual",
  };

  const items = rows.map((r) => ({
    ...r,
    type_label:   TYPE_LABELS[r.transaction_type] || r.transaction_type,
    is_positive:  r.points_delta > 0,
  }));

  return {
    items,
    pagination: {
      page:        pageNum,
      limit:       perPage,
      total,
      total_pages: Math.ceil(total / perPage),
      has_next:    pageNum < Math.ceil(total / perPage),
      has_prev:    pageNum > 1,
    },
  };
}

// ─── Endpoint: Reward & Pemenang ────────────────────────────────────────────

/**
 * Daftar semua reward_periods beserta pemenang & reward yang mereka terima.
 * Reward adalah bentuk apresiasi — tidak mempengaruhi saldo poin.
 */
export async function getRewardPeriods() {
  // Ambil semua periode
  const { rows: periods } = await db.query(
    `SELECT period_id, period_name, started_at::text, ended_at::text, is_active, created_at
     FROM reward_periods
     ORDER BY started_at DESC`,
    []
  );

  if (periods.length === 0) return [];

  // Ambil semua award sekaligus (lebih efisien daripada N+1 query)
  const { rows: awards } = await db.query(
    `SELECT
       ra.award_id,
       ra.period_id,
       ra.reward_id,
       ra.user_id,
       ra.awarded_at,
       ra.note,
       u.full_name AS winner_name,
       u.email     AS winner_email,
       r.reward_name,
       r.description AS reward_description,
       -- Saldo poin pemenang saat ini
       COALESCE(ug.point_balance, 0) AS winner_points,
       COALESCE(ug.discipline_level, 'beginner') AS winner_level
     FROM reward_awards ra
     JOIN users u ON u.user_id = ra.user_id
     JOIN rewards r ON r.reward_id = ra.reward_id
     LEFT JOIN user_gamifications ug ON ug.user_id = ra.user_id
     ORDER BY ra.period_id, ra.awarded_at ASC`,
    []
  );

  // Kelompokkan award per periode
  const awardsByPeriod = {};
  for (const aw of awards) {
    if (!awardsByPeriod[aw.period_id]) awardsByPeriod[aw.period_id] = [];
    awardsByPeriod[aw.period_id].push(aw);
  }

  return periods.map((p) => ({
    ...p,
    awards: awardsByPeriod[p.period_id] || [],
  }));
}

/**
 * Reward yang pernah diterima user tertentu (untuk panel "Penghargaan Saya").
 *
 * @param {number} userId - user_id dari user yang login
 */
export async function getMyAwards(userId) {
  const id = Number(userId);
  const { rows } = await db.query(
    `SELECT
       ra.award_id,
       ra.period_id,
       ra.reward_id,
       ra.awarded_at,
       ra.note,
       r.reward_name,
       r.description AS reward_description,
       rp.period_name,
       rp.started_at::text,
       rp.ended_at::text
     FROM reward_awards ra
     JOIN rewards r ON r.reward_id = ra.reward_id
     JOIN reward_periods rp ON rp.period_id = ra.period_id
     WHERE ra.user_id = $1
     ORDER BY ra.awarded_at DESC`,
    [id]
  );
  return rows;
}
