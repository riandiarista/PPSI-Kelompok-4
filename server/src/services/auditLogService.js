import db from "../config/db.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseInteger(value, fallback, label, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw httpError(400, `${label} tidak valid`);
  }
  return parsed;
}

function parseDate(value, label) {
  if (value === undefined || value === "") return null;
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw httpError(400, `Format ${label} tidak valid (gunakan YYYY-MM-DD)`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  date.setTime(date.getTime() - WIB_OFFSET_MS);
  return date;
}

function nextWibDay(date) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate;
}

function parseTextFilter(value, label, maxLength) {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw httpError(400, `${label} maksimal ${maxLength} karakter`);
  }
  return value.trim();
}

export async function getAuditLogs(query = {}) {
  const page = parseInteger(query.page, 1, "Nomor halaman");
  const pageSize = parseInteger(query.page_size, DEFAULT_PAGE_SIZE, "Ukuran halaman", MAX_PAGE_SIZE);
  const actionType = parseTextFilter(query.action_type, "Jenis aktivitas", 50);
  const entityType = parseTextFilter(query.entity_type, "Jenis data", 50);
  const search = parseTextFilter(query.search, "Pencarian", 100);
  const sortBy = parseTextFilter(query.sort_by, "Kolom pengurutan", 30) || "occurred_at";
  const sortOrder = parseTextFilter(query.sort_order, "Arah pengurutan", 4) || "desc";
  const from = parseDate(query.from, "tanggal awal");
  const to = parseDate(query.to, "tanggal akhir");
  const sortColumns = {
    occurred_at: "al.occurred_at",
    action_type: "al.action_type",
    actor_name: "u.full_name",
    entity_type: "al.entity_type",
  };

  if (!sortColumns[sortBy]) throw httpError(400, "Kolom pengurutan tidak valid");
  if (!["asc", "desc"].includes(sortOrder)) throw httpError(400, "Arah pengurutan harus asc atau desc");
  if (from && to && from > to) {
    throw httpError(400, "Tanggal awal tidak boleh setelah tanggal akhir");
  }

  const conditions = [];
  const params = [];
  const addCondition = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };

  if (actionType) addCondition("al.action_type = ?", actionType);
  if (entityType) addCondition("al.entity_type = ?", entityType);
  if (from) addCondition("al.occurred_at >= ?", from);
  if (to) addCondition("al.occurred_at < ?", nextWibDay(to));
  if (search) {
    params.push(`%${search}%`);
    const placeholder = `$${params.length}`;
    conditions.push(`(
      u.full_name ILIKE ${placeholder}
      OR u.email ILIKE ${placeholder}
      OR al.action_type ILIKE ${placeholder}
      OR al.entity_type ILIKE ${placeholder}
      OR al.entity_id::text ILIKE ${placeholder}
      OR al.details::text ILIKE ${placeholder}
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total
       FROM audit_logs al
       LEFT JOIN users u ON u.user_id = al.actor_user_id
       ${whereClause}`,
    params
  );
  const total = countResult.rows[0].total;
  const offset = (page - 1) * pageSize;
  const listParams = [...params, pageSize, offset];

  const { rows } = await db.query(
    `SELECT al.audit_id, al.actor_user_id, al.action_type, al.entity_type,
            al.entity_id, al.details, al.occurred_at,
            u.full_name AS actor_name, u.email AS actor_email,
            r.role_name AS actor_role
       FROM audit_logs al
       LEFT JOIN users u ON u.user_id = al.actor_user_id
       LEFT JOIN roles r ON r.role_id = u.role_id
       ${whereClause}
      ORDER BY ${sortColumns[sortBy]} ${sortOrder.toUpperCase()} NULLS LAST,
               al.occurred_at DESC, al.audit_id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    listParams
  );

  return {
    items: rows,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.ceil(total / pageSize),
    },
  };
}
