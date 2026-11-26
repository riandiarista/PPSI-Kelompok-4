/**
 * pointSettingsService.js — Aturan poin & ambang level yang dapat diubah Kadep.
 *
 * Nilai disimpan di tabel point_settings (migrasi 011). Bila tabel belum ada atau
 * suatu baris hilang, dipakai nilai bawaan dari constants/pointRules.js.
 *
 * Perubahan hanya berlaku untuk pengembalian berikutnya; poin yang sudah tercatat
 * tidak dihitung ulang. Perubahan ambang level langsung memperbarui level semua pengguna.
 */

import db from "../config/db.js";
import {
  DEFAULT_POINT_RULES,
  DEFAULT_DISCIPLINE_LEVELS,
  LEVEL_DISPLAY,
} from "../constants/pointRules.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Definisi tiap aturan poin beserta batas nilai yang diizinkan
export const POINT_RULE_DEFS = Object.freeze([
  { key: "ON_TIME_GOOD",         label: "Tepat waktu, kondisi baik",                 min: 0,    max: 100 },
  { key: "ON_TIME_MINOR_DAMAGE", label: "Kerusakan ringan",                          min: -100, max: 100 },
  { key: "ON_TIME_MAJOR_DAMAGE", label: "Kerusakan besar / hilang",                  min: -100, max: 0 },
  { key: "MAJOR_DAMAGE_PENALTY", label: "Hukuman tambahan kerusakan besar / hilang", min: -100, max: 0 },
  { key: "LATE_PER_DAY",         label: "Setiap hari keterlambatan",                 min: -100, max: 0, per_day: true },
]);

// Kunci ambang level (level "beginner" selalu 0)
const LEVEL_KEYS = Object.freeze({
  pemula:     "LEVEL_PEMULA_MIN",
  terpercaya: "LEVEL_TERPERCAYA_MIN",
  teladan:    "LEVEL_TELADAN_MIN",
});
const MAX_LEVEL_POINTS = 10000;

/**
 * Mengubah baris point_settings menjadi { rules, levels }.
 * Fungsi murni — kunci yang tidak ada memakai nilai bawaan.
 */
export function buildSettings(rows = []) {
  const map = new Map(rows.map((r) => [r.setting_key, Number(r.setting_value)]));
  const rules = {};
  for (const key of Object.keys(DEFAULT_POINT_RULES)) {
    rules[key] = map.has(key) ? map.get(key) : DEFAULT_POINT_RULES[key];
  }
  const levels = DEFAULT_DISCIPLINE_LEVELS.map((lvl) => {
    const key = LEVEL_KEYS[lvl.name];
    return { name: lvl.name, min: key && map.has(key) ? map.get(key) : lvl.min };
  });
  let updatedAt = null;
  for (const r of rows) {
    if (r.updated_at && (!updatedAt || new Date(r.updated_at) > new Date(updatedAt))) updatedAt = r.updated_at;
  }
  return { rules: Object.freeze(rules), levels: Object.freeze(levels), updated_at: updatedAt };
}

/**
 * Mengambil aturan yang berlaku. `client` boleh berupa pool atau client transaksi.
 */
export async function getPointSettings(client = db) {
  try {
    const { rows } = await client.query(
      "SELECT setting_key, setting_value, updated_at FROM point_settings"
    );
    return buildSettings(rows);
  } catch (err) {
    // 42P01 = tabel belum ada (migrasi 011 belum dijalankan)
    if (err.code === "42P01") return buildSettings([]);
    throw err;
  }
}

/**
 * Info tiap level untuk ditampilkan (label, badge, warna, rentang poin).
 */
export function describeLevels(levels) {
  return levels.map((lvl, idx) => {
    const upper = idx > 0 ? levels[idx - 1].min - 1 : null;
    return {
      key: lvl.name,
      level: lvl.name,
      min: lvl.min,
      max: upper,
      range: upper === null ? `≥ ${lvl.min} poin` : `${lvl.min} – ${upper} poin`,
      ...LEVEL_DISPLAY[lvl.name],
    };
  });
}

/**
 * Bentuk data untuk halaman aturan (Kadep) dan ringkasan aturan (Peminjam).
 */
export function describeSettings(settings) {
  return {
    point_rules: POINT_RULE_DEFS.map((d) => ({ ...d, points: settings.rules[d.key] })),
    levels: describeLevels(settings.levels),
    updated_at: settings.updated_at,
  };
}

function parseIntInRange(value, label, min, max) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(n)) throw httpError(400, `${label} harus bilangan bulat`);
  if (n < min || n > max) throw httpError(400, `${label} harus di antara ${min} dan ${max}`);
  return n;
}

/**
 * Validasi isi permintaan ubah aturan. Fungsi murni.
 * body: { point_rules: { ON_TIME_GOOD: 10, ... }, levels: { pemula: 30, terpercaya: 50, teladan: 70 } }
 * Semua nilai wajib dikirim.
 * @returns {Array<[string, number]>} pasangan [setting_key, nilai]
 */
export function validateSettingsInput(body = {}) {
  const rulesIn = body.point_rules || {};
  const levelsIn = body.levels || {};
  const entries = [];

  for (const d of POINT_RULE_DEFS) {
    entries.push([d.key, parseIntInRange(rulesIn[d.key], `Poin "${d.label}"`, d.min, d.max)]);
  }

  const pemula = parseIntInRange(levelsIn.pemula, "Batas level Pemula", 1, MAX_LEVEL_POINTS);
  const terpercaya = parseIntInRange(levelsIn.terpercaya, "Batas level Terpercaya", 1, MAX_LEVEL_POINTS);
  const teladan = parseIntInRange(levelsIn.teladan, "Batas level Teladan", 1, MAX_LEVEL_POINTS);
  if (!(pemula < terpercaya && terpercaya < teladan)) {
    throw httpError(400, "Batas level harus berurutan: Pemula < Terpercaya < Teladan");
  }
  entries.push([LEVEL_KEYS.pemula, pemula], [LEVEL_KEYS.terpercaya, terpercaya], [LEVEL_KEYS.teladan, teladan]);
  return entries;
}

/**
 * Menyimpan aturan baru (Kadep), memperbarui level semua pengguna, dan mencatat audit log.
 */
export async function updatePointSettings(actorId, body) {
  const entries = validateSettingsInput(body);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Kunci agar dua Kadep yang menyimpan bersamaan tidak saling menimpa sebagian
    await client.query("LOCK TABLE point_settings IN SHARE ROW EXCLUSIVE MODE");

    const before = await getPointSettings(client);

    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO point_settings (setting_key, setting_value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (setting_key) DO UPDATE
           SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by
           WHERE point_settings.setting_value IS DISTINCT FROM EXCLUDED.setting_value`,
        [key, value, actorId]
      );
    }

    const after = await getPointSettings(client);

    // Perbarui level tersimpan semua pengguna sesuai ambang baru
    const { rowCount: levelChanged } = await client.query(
      `UPDATE user_gamifications
          SET discipline_level = CASE
                WHEN point_balance >= $1 THEN 'teladan'
                WHEN point_balance >= $2 THEN 'terpercaya'
                WHEN point_balance >= $3 THEN 'pemula'
                ELSE 'beginner'
              END
        WHERE discipline_level IS DISTINCT FROM CASE
                WHEN point_balance >= $1 THEN 'teladan'
                WHEN point_balance >= $2 THEN 'terpercaya'
                WHEN point_balance >= $3 THEN 'pemula'
                ELSE 'beginner'
              END`,
      [
        after.levels.find((l) => l.name === "teladan").min,
        after.levels.find((l) => l.name === "terpercaya").min,
        after.levels.find((l) => l.name === "pemula").min,
      ]
    );

    const changes = {};
    for (const [key, value] of entries) {
      const oldValue = key in before.rules
        ? before.rules[key]
        : before.levels.find((l) => LEVEL_KEYS[l.name] === key)?.min;
      if (oldValue !== value) changes[key] = { from: oldValue, to: value };
    }

    if (Object.keys(changes).length > 0) {
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
         VALUES ($1, 'update_point_settings', 'point_settings', 1, $2)`,
        [actorId, JSON.stringify({ changes, users_level_changed: levelChanged })]
      );
    }

    await client.query("COMMIT");
    return { ...describeSettings(after), changed_keys: Object.keys(changes), users_level_changed: levelChanged };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
