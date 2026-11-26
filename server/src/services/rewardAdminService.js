/**
 * rewardAdminService.js — Pengelolaan aturan poin & reward oleh Kadep (UC-03)
 *
 * Tanggung jawab:
 *  - Menampilkan aturan perhitungan poin & ambang level (pengubahan: pointSettingsService).
 *  - CRUD definisi reward (tabel rewards).
 *  - Membuat / mengubah periode reward (tabel reward_periods).
 *  - Papan peringkat poin peminjam dalam rentang periode.
 *  - Memberikan / mencabut penghargaan (tabel reward_awards).
 *
 * Reward adalah apresiasi, BUKAN tukar poin: saldo poin tidak berubah.
 * Setiap perubahan dicatat ke audit_logs.
 */

import db from "../config/db.js";
import { ROLES } from "../constants/roles.js";
import { getPointSettings, describeSettings } from "./pointSettingsService.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, `${label} tidak valid`);
  return id;
}

function parseText(value, label, { required = false, max = 150 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw httpError(400, `${label} wajib diisi`);
    return null;
  }
  if (typeof value !== "string") throw httpError(400, `${label} tidak valid`);
  const text = value.trim();
  if (required && !text) throw httpError(400, `${label} wajib diisi`);
  if (text.length > max) throw httpError(400, `${label} maksimal ${max} karakter`);
  return text || null;
}

function parseDate(value, label) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw httpError(400, `Format ${label} tidak valid (gunakan YYYY-MM-DD)`);
  }
  return value;
}

async function writeAudit(client, actorId, actionType, entityType, entityId, details) {
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, actionType, entityType, entityId, JSON.stringify(details)]
  );
}

// ─── Aturan poin ────────────────────────────────────────────────────────────

export async function getPointRules() {
  return describeSettings(await getPointSettings());
}

// ─── Definisi reward ────────────────────────────────────────────────────────

export async function listRewards() {
  const { rows } = await db.query(
    `SELECT r.reward_id, r.reward_name, r.description, r.created_at,
            COUNT(ra.award_id)::int AS award_count
       FROM rewards r
       LEFT JOIN reward_awards ra ON ra.reward_id = r.reward_id
      GROUP BY r.reward_id
      ORDER BY r.reward_id ASC`
  );
  return rows;
}

export async function createReward(actorId, body = {}) {
  const name = parseText(body.reward_name, "Nama reward", { required: true });
  const description = parseText(body.description, "Deskripsi", { max: 1000 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO rewards (reward_name, description) VALUES ($1, $2)
       RETURNING reward_id, reward_name, description, created_at`,
      [name, description]
    );
    await writeAudit(client, actorId, "create_reward", "reward", rows[0].reward_id, { reward_name: name });
    await client.query("COMMIT");
    return { ...rows[0], award_count: 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateReward(actorId, rewardId, body = {}) {
  const id = parseId(rewardId, "ID reward");
  const name = parseText(body.reward_name, "Nama reward", { required: true });
  const description = parseText(body.description, "Deskripsi", { max: 1000 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE rewards SET reward_name = $1, description = $2 WHERE reward_id = $3
       RETURNING reward_id, reward_name, description, created_at`,
      [name, description, id]
    );
    if (rows.length === 0) throw httpError(404, "Reward tidak ditemukan");
    await writeAudit(client, actorId, "update_reward", "reward", id, { reward_name: name });
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteReward(actorId, rewardId) {
  const id = parseId(rewardId, "ID reward");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: used } = await client.query(
      "SELECT 1 FROM reward_awards WHERE reward_id = $1 LIMIT 1",
      [id]
    );
    if (used.length > 0) {
      throw httpError(409, "Reward sudah pernah diberikan, tidak dapat dihapus");
    }
    const { rows } = await client.query(
      "DELETE FROM rewards WHERE reward_id = $1 RETURNING reward_name",
      [id]
    );
    if (rows.length === 0) throw httpError(404, "Reward tidak ditemukan");
    await writeAudit(client, actorId, "delete_reward", "reward", id, { reward_name: rows[0].reward_name });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Periode reward ─────────────────────────────────────────────────────────

function parsePeriodBody(body = {}) {
  const name = parseText(body.period_name, "Nama periode", { required: true });
  const startedAt = parseDate(body.started_at, "tanggal mulai");
  const endedAt = parseDate(body.ended_at, "tanggal selesai");
  if (endedAt < startedAt) throw httpError(400, "Tanggal selesai tidak boleh sebelum tanggal mulai");
  const isActive = body.is_active === undefined ? true : body.is_active === true;
  return { name, startedAt, endedAt, isActive };
}

export async function createPeriod(actorId, body) {
  const p = parsePeriodBody(body);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO reward_periods (period_name, started_at, ended_at, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING period_id, period_name, started_at::text, ended_at::text, is_active, created_at`,
      [p.name, p.startedAt, p.endedAt, p.isActive]
    );
    await writeAudit(client, actorId, "create_reward_period", "reward_period", rows[0].period_id, {
      period_name: p.name, started_at: p.startedAt, ended_at: p.endedAt, is_active: p.isActive,
    });
    await client.query("COMMIT");
    return { ...rows[0], awards: [] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updatePeriod(actorId, periodId, body) {
  const id = parseId(periodId, "ID periode");
  const p = parsePeriodBody(body);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE reward_periods
          SET period_name = $1, started_at = $2, ended_at = $3, is_active = $4
        WHERE period_id = $5
       RETURNING period_id, period_name, started_at::text, ended_at::text, is_active, created_at`,
      [p.name, p.startedAt, p.endedAt, p.isActive, id]
    );
    if (rows.length === 0) throw httpError(404, "Periode tidak ditemukan");
    await writeAudit(client, actorId, "update_reward_period", "reward_period", id, {
      period_name: p.name, started_at: p.startedAt, ended_at: p.endedAt, is_active: p.isActive,
    });
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Papan peringkat ────────────────────────────────────────────────────────

/**
 * Peringkat peminjam berdasarkan total poin yang diperoleh selama periode
 * (tanggal dihitung dalam WIB, inklusif tanggal selesai).
 */
export async function getPeriodLeaderboard(periodId, { limit = 20 } = {}) {
  const id = parseId(periodId, "ID periode");
  const max = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 20));

  const { rows: periodRows } = await db.query(
    `SELECT period_id, period_name, started_at::text, ended_at::text, is_active
       FROM reward_periods WHERE period_id = $1`,
    [id]
  );
  if (periodRows.length === 0) throw httpError(404, "Periode tidak ditemukan");

  const { rows } = await db.query(
    `SELECT u.user_id,
            u.full_name,
            u.email,
            COALESCE(SUM(pt.points_delta), 0)::int                              AS period_points,
            COUNT(pt.point_transaction_id) FILTER (WHERE pt.points_delta > 0)::int AS positive_count,
            COUNT(pt.point_transaction_id) FILTER (WHERE pt.points_delta < 0)::int AS negative_count,
            COALESCE(ug.point_balance, 0)                                       AS current_points,
            COALESCE(ug.discipline_level, 'beginner')                           AS discipline_level
       FROM users u
       JOIN roles ro ON ro.role_id = u.role_id AND ro.role_name = $1
       JOIN point_transactions pt
         ON pt.user_id = u.user_id
        AND pt.created_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Jakarta'
        AND pt.created_at <  ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'
       LEFT JOIN user_gamifications ug ON ug.user_id = u.user_id
      GROUP BY u.user_id, ug.point_balance, ug.discipline_level
      ORDER BY period_points DESC, positive_count DESC, u.full_name ASC
      LIMIT $4`,
    [ROLES.PEMINJAM, periodRows[0].started_at, periodRows[0].ended_at, max]
  );

  return {
    period: periodRows[0],
    leaderboard: rows.map((r, idx) => ({ rank: idx + 1, ...r })),
  };
}

// ─── Penghargaan ────────────────────────────────────────────────────────────

export async function giveAward(actorId, periodId, body = {}) {
  const pid = parseId(periodId, "ID periode");
  const rewardId = parseId(body.reward_id, "Reward");
  const userId = parseId(body.user_id, "Penerima");
  const note = parseText(body.note, "Catatan", { max: 500 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: periodRows } = await client.query(
      "SELECT period_name FROM reward_periods WHERE period_id = $1",
      [pid]
    );
    if (periodRows.length === 0) throw httpError(404, "Periode tidak ditemukan");

    const { rows: rewardRows } = await client.query(
      "SELECT reward_name FROM rewards WHERE reward_id = $1",
      [rewardId]
    );
    if (rewardRows.length === 0) throw httpError(404, "Reward tidak ditemukan");

    const { rows: userRows } = await client.query(
      `SELECT u.full_name FROM users u
         JOIN roles ro ON ro.role_id = u.role_id
        WHERE u.user_id = $1 AND ro.role_name = $2`,
      [userId, ROLES.PEMINJAM]
    );
    if (userRows.length === 0) throw httpError(404, "Penerima harus akun peminjam");

    const { rows } = await client.query(
      `INSERT INTO reward_awards (period_id, reward_id, user_id, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (period_id, reward_id, user_id) DO NOTHING
       RETURNING award_id, period_id, reward_id, user_id, awarded_at, note`,
      [pid, rewardId, userId, note]
    );
    if (rows.length === 0) {
      throw httpError(409, "Peminjam ini sudah menerima reward tersebut pada periode ini");
    }

    await writeAudit(client, actorId, "give_reward_award", "reward_award", rows[0].award_id, {
      period_id: pid,
      period_name: periodRows[0].period_name,
      reward_id: rewardId,
      reward_name: rewardRows[0].reward_name,
      user_id: userId,
      winner_name: userRows[0].full_name,
      note,
    });
    await client.query("COMMIT");
    return {
      ...rows[0],
      reward_name: rewardRows[0].reward_name,
      winner_name: userRows[0].full_name,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeAward(actorId, awardId) {
  const id = parseId(awardId, "ID penghargaan");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "DELETE FROM reward_awards WHERE award_id = $1 RETURNING period_id, reward_id, user_id",
      [id]
    );
    if (rows.length === 0) throw httpError(404, "Penghargaan tidak ditemukan");
    await writeAudit(client, actorId, "revoke_reward_award", "reward_award", id, rows[0]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
