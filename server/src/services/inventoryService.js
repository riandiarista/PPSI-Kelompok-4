import db from "../config/db.js";

/**
 * Service untuk pengelolaan data Inventaris Barang dan Kategori Barang.
 * Mengimplementasikan aturan bisnis:
 * 1. Pemisahan tegas kondisi fisik (good, minor_damage, major_damage) dan status operasional (available, borrowed, maintenance, unavailable).
 * 2. Barang yang dinonaktifkan (is_active = false) tidak dapat dipinjam di katalog, riwayat peminjaman tetap utuh.
 * 3. Barang yang sedang berstatus 'borrowed' (Sedang dipinjam) dilarang keras untuk dinonaktifkan.
 * 4. Setiap penambahan, pengubahan, dan penonaktifan barang/kategori dicatat di tabel audit_logs.
 */

// ==========================================
// KELOLA KATEGORI BARANG
// ==========================================

export async function getAllCategories({ search = "" } = {}) {
  const params = [];
  let where = "";

  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    where = `WHERE c.category_name ILIKE $1`;
  }

  const query = `
    SELECT
      c.category_id,
      c.category_name,
      c.created_at,
      c.updated_at,
      COUNT(i.item_id)::int AS total_items,
      COUNT(i.item_id) FILTER (WHERE i.is_active = TRUE)::int AS active_items
    FROM item_categories c
    LEFT JOIN items i ON i.category_id = c.category_id
    ${where}
    GROUP BY c.category_id, c.category_name, c.created_at, c.updated_at
    ORDER BY c.category_name ASC
  `;

  const { rows } = await db.query(query, params);
  return rows;
}

export async function getCategoryById(categoryId) {
  const query = `
    SELECT
      c.category_id,
      c.category_name,
      c.created_at,
      c.updated_at,
      COUNT(i.item_id)::int AS total_items
    FROM item_categories c
    LEFT JOIN items i ON i.category_id = c.category_id
    WHERE c.category_id = $1
    GROUP BY c.category_id, c.category_name, c.created_at, c.updated_at
  `;
  const { rows } = await db.query(query, [categoryId]);
  return rows[0] || null;
}

export async function createCategory({ category_name, actorUserId, actorName }) {
  const name = String(category_name || "").trim();
  if (!name || name.length < 2) {
    const err = new Error("Nama kategori wajib diisi minimal 2 karakter");
    err.status = 400;
    throw err;
  }

  // Cek duplikasi nama kategori
  const { rows: existing } = await db.query(
    "SELECT category_id FROM item_categories WHERE LOWER(category_name) = LOWER($1)",
    [name]
  );
  if (existing.length > 0) {
    const err = new Error(`Kategori dengan nama "${name}" sudah ada`);
    err.status = 409;
    throw err;
  }

  const { rows } = await db.query(
    `INSERT INTO item_categories (category_name)
     VALUES ($1)
     RETURNING category_id, category_name, created_at, updated_at`,
    [name]
  );
  const newCat = rows[0];

  // Catat audit log
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
     VALUES ($1, 'create_category', 'category', $2, $3)`,
    [
      actorUserId || null,
      newCat.category_id,
      JSON.stringify({
        category_name: newCat.category_name,
        actor_name: actorName || "Tendik",
      }),
    ]
  );

  return newCat;
}

export async function updateCategory({ category_id, category_name, actorUserId, actorName }) {
  const id = Number(category_id);
  const name = String(category_name || "").trim();

  if (!Number.isInteger(id)) {
    const err = new Error("ID kategori tidak valid");
    err.status = 400;
    throw err;
  }

  if (!name || name.length < 2) {
    const err = new Error("Nama kategori wajib diisi minimal 2 karakter");
    err.status = 400;
    throw err;
  }

  // Cek keberadaan kategori
  const { rows: currentRows } = await db.query(
    "SELECT category_id, category_name FROM item_categories WHERE category_id = $1",
    [id]
  );
  if (currentRows.length === 0) {
    const err = new Error("Kategori tidak ditemukan");
    err.status = 404;
    throw err;
  }
  const oldCategory = currentRows[0];

  // Cek duplikasi nama jika berganti nama
  const { rows: existing } = await db.query(
    "SELECT category_id FROM item_categories WHERE LOWER(category_name) = LOWER($1) AND category_id <> $2",
    [name, id]
  );
  if (existing.length > 0) {
    const err = new Error(`Kategori dengan nama "${name}" sudah digunakan`);
    err.status = 409;
    throw err;
  }

  const { rows } = await db.query(
    `UPDATE item_categories
        SET category_name = $1,
            updated_at = NOW()
      WHERE category_id = $2
      RETURNING category_id, category_name, created_at, updated_at`,
    [name, id]
  );
  const updatedCat = rows[0];

  // Catat audit log
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
     VALUES ($1, 'update_category', 'category', $2, $3)`,
    [
      actorUserId || null,
      id,
      JSON.stringify({
        old_name: oldCategory.category_name,
        new_name: updatedCat.category_name,
        actor_name: actorName || "Tendik",
      }),
    ]
  );

  return updatedCat;
}

export async function deleteCategory({ category_id, actorUserId, actorName }) {
  const id = Number(category_id);
  if (!Number.isInteger(id)) {
    const err = new Error("ID kategori tidak valid");
    err.status = 400;
    throw err;
  }

  // Cek keberadaan kategori
  const { rows: currentRows } = await db.query(
    "SELECT category_id, category_name FROM item_categories WHERE category_id = $1",
    [id]
  );
  if (currentRows.length === 0) {
    const err = new Error("Kategori tidak ditemukan");
    err.status = 404;
    throw err;
  }
  const targetCategory = currentRows[0];

  // Cek apakah masih ada barang yang terhubung ke kategori ini
  const { rows: itemRows } = await db.query(
    "SELECT COUNT(*)::int AS count FROM items WHERE category_id = $1",
    [id]
  );
  const itemCount = itemRows[0]?.count || 0;
  if (itemCount > 0) {
    const err = new Error(
      `Tidak dapat menghapus kategori "${targetCategory.category_name}" karena masih memiliki ${itemCount} barang yang terkait. Pindahkan atau hapus barang terlebih dahulu.`
    );
    err.status = 400;
    throw err;
  }

  await db.query("DELETE FROM item_categories WHERE category_id = $1", [id]);

  // Catat audit log
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
     VALUES ($1, 'delete_category', 'category', $2, $3)`,
    [
      actorUserId || null,
      id,
      JSON.stringify({
        deleted_category_name: targetCategory.category_name,
        actor_name: actorName || "Tendik",
      }),
    ]
  );

  return { success: true, message: `Kategori "${targetCategory.category_name}" berhasil dihapus` };
}

// ==========================================
// KELOLA INVENTARIS BARANG
// ==========================================

export async function getItems({
  search = "",
  category_id,
  condition,
  availability_status,
  is_active,
} = {}) {
  const conditions = [];
  const params = [];

  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`(i.item_name ILIKE $${params.length})`);
  }

  if (category_id && category_id !== "all") {
    const catIdNum = Number(category_id);
    if (Number.isInteger(catIdNum)) {
      params.push(catIdNum);
      conditions.push(`i.category_id = $${params.length}`);
    }
  }

  if (condition && condition !== "all") {
    params.push(condition);
    conditions.push(`i.item_condition = $${params.length}`);
  }

  if (availability_status && availability_status !== "all") {
    params.push(availability_status);
    conditions.push(`i.availability_status = $${params.length}`);
  }

  if (is_active !== undefined && is_active !== "" && is_active !== "all") {
    params.push(is_active === "true" || is_active === true);
    conditions.push(`i.is_active = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      i.item_id,
      i.item_name,
      i.category_id,
      c.category_name,
      i.item_condition,
      i.availability_status,
      i.is_active,
      i.created_at,
      i.updated_at
    FROM items i
    JOIN item_categories c ON c.category_id = i.category_id
    ${whereClause}
    ORDER BY i.is_active DESC, i.created_at DESC
  `;

  const { rows } = await db.query(query, params);

  // Ambil data ringkasan statistik inventaris untuk kartu informasi Tendik
  const { rows: statsRows } = await db.query(`
    SELECT
      COUNT(*)::int AS total_items,
      COUNT(*) FILTER (WHERE availability_status = 'available' AND is_active = TRUE)::int AS available_items,
      COUNT(*) FILTER (WHERE availability_status = 'borrowed')::int AS borrowed_items,
      COUNT(*) FILTER (WHERE availability_status = 'maintenance')::int AS maintenance_items,
      COUNT(*) FILTER (WHERE is_active = FALSE)::int AS inactive_items
    FROM items
  `);

  return {
    items: rows,
    stats: statsRows[0] || {
      total_items: 0,
      available_items: 0,
      borrowed_items: 0,
      maintenance_items: 0,
      inactive_items: 0,
    },
  };
}

export async function getItemById(itemId) {
  const id = Number(itemId);
  if (!Number.isInteger(id)) {
    const err = new Error("ID barang tidak valid");
    err.status = 400;
    throw err;
  }

  const query = `
    SELECT
      i.item_id,
      i.item_name,
      i.category_id,
      c.category_name,
      i.item_condition,
      i.availability_status,
      i.is_active,
      i.created_at,
      i.updated_at
    FROM items i
    JOIN item_categories c ON c.category_id = i.category_id
    WHERE i.item_id = $1
  `;
  const { rows } = await db.query(query, [id]);
  return rows[0] || null;
}

export async function createItem({
  item_name,
  category_id,
  item_condition = "good",
  availability_status = "available",
  actorUserId,
  actorName,
}) {
  const name = String(item_name || "").trim();
  const catId = Number(category_id);

  if (!name || name.length < 2) {
    const err = new Error("Nama barang wajib diisi minimal 2 karakter");
    err.status = 400;
    throw err;
  }

  if (!Number.isInteger(catId)) {
    const err = new Error("Kategori barang wajib dipilih");
    err.status = 400;
    throw err;
  }

  // Validasi kategori ada di database
  const { rows: catRows } = await db.query(
    "SELECT category_id, category_name FROM item_categories WHERE category_id = $1",
    [catId]
  );
  if (catRows.length === 0) {
    const err = new Error("Kategori yang dipilih tidak valid");
    err.status = 400;
    throw err;
  }
  const categoryName = catRows[0].category_name;

  // Validasi domain kondisi fisik
  const validConditions = ["good", "minor_damage", "major_damage"];
  if (!validConditions.includes(item_condition)) {
    const err = new Error("Kondisi fisik barang tidak valid (pilih: good, minor_damage, atau major_damage)");
    err.status = 400;
    throw err;
  }

  // Validasi domain status ketersediaan
  const validStatuses = ["available", "borrowed", "maintenance", "unavailable"];
  if (!validStatuses.includes(availability_status)) {
    const err = new Error("Status operasional barang tidak valid (pilih: available, borrowed, maintenance, atau unavailable)");
    err.status = 400;
    throw err;
  }

  const { rows } = await db.query(
    `INSERT INTO items (
       category_id, item_name, item_condition, availability_status, is_active
     ) VALUES ($1, $2, $3, $4, TRUE)
     RETURNING item_id, category_id, item_name, item_condition, availability_status, is_active, created_at, updated_at`,
    [catId, name, item_condition, availability_status]
  );

  const newItem = rows[0];
  newItem.category_name = categoryName;

  // Catat ke audit log
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
     VALUES ($1, 'create_item', 'item', $2, $3)`,
    [
      actorUserId || null,
      newItem.item_id,
      JSON.stringify({
        item_name: newItem.item_name,
        category_name: categoryName,
        item_condition: newItem.item_condition,
        availability_status: newItem.availability_status,
        actor_name: actorName || "Tendik",
      }),
    ]
  );

  return newItem;
}

export async function updateItem({
  item_id,
  item_name,
  category_id,
  item_condition,
  availability_status,
  actorUserId,
  actorName,
}) {
  const id = Number(item_id);
  const name = String(item_name || "").trim();
  const catId = Number(category_id);

  if (!Number.isInteger(id)) {
    const err = new Error("ID barang tidak valid");
    err.status = 400;
    throw err;
  }

  if (!name || name.length < 2) {
    const err = new Error("Nama barang wajib diisi minimal 2 karakter");
    err.status = 400;
    throw err;
  }

  if (!Number.isInteger(catId)) {
    const err = new Error("Kategori barang wajib dipilih");
    err.status = 400;
    throw err;
  }

  // Cek keberadaan barang
  const { rows: currentRows } = await db.query(
    "SELECT item_id, item_name, category_id, item_condition, availability_status, is_active FROM items WHERE item_id = $1",
    [id]
  );
  if (currentRows.length === 0) {
    const err = new Error("Barang tidak ditemukan");
    err.status = 404;
    throw err;
  }
  const oldItem = currentRows[0];

  // Cek keberadaan kategori
  const { rows: catRows } = await db.query(
    "SELECT category_id, category_name FROM item_categories WHERE category_id = $1",
    [catId]
  );
  if (catRows.length === 0) {
    const err = new Error("Kategori yang dipilih tidak valid");
    err.status = 400;
    throw err;
  }
  const categoryName = catRows[0].category_name;

  // Validasi nilai kondisi fisik
  const validConditions = ["good", "minor_damage", "major_damage"];
  if (item_condition && !validConditions.includes(item_condition)) {
    const err = new Error("Kondisi fisik barang tidak valid");
    err.status = 400;
    throw err;
  }

  // Validasi nilai status ketersediaan
  const validStatuses = ["available", "borrowed", "maintenance", "unavailable"];
  if (availability_status && !validStatuses.includes(availability_status)) {
    const err = new Error("Status ketersediaan barang tidak valid");
    err.status = 400;
    throw err;
  }

  // Aturan Bisnis: Jika barang sedang dipinjam (borrowed), status operasionalnya tidak boleh langsung diubah sembarangan tanpa melalui alur pengembalian
  if (oldItem.availability_status === "borrowed" && availability_status && availability_status !== "borrowed") {
    // Periksa apakah ada transaksi pinjam yang aktif
    const { rows: activeLoans } = await db.query(
      `SELECT lt.loan_id
         FROM loan_transactions lt
         JOIN loan_requests lr ON lr.request_id = lt.request_id
        WHERE lr.item_id = $1 AND lt.transaction_status = 'borrowed'`,
      [id]
    );

    if (activeLoans.length > 0) {
      const err = new Error(
        "Barang saat ini masih berstatus 'Sedang dipinjam' dalam transaksi peminjaman aktif. Status operasional hanya dapat berubah melalui modul Serah Terima & Pengembalian."
      );
      err.status = 400;
      throw err;
    }
  }

  const targetCondition = item_condition || oldItem.item_condition;
  const targetStatus = availability_status || oldItem.availability_status;

  const { rows } = await db.query(
    `UPDATE items
        SET item_name = $1,
            category_id = $2,
            item_condition = $3,
            availability_status = $4,
            updated_at = NOW()
      WHERE item_id = $5
      RETURNING item_id, category_id, item_name, item_condition, availability_status, is_active, created_at, updated_at`,
    [name, catId, targetCondition, targetStatus, id]
  );

  const updatedItem = rows[0];
  updatedItem.category_name = categoryName;

  // Catat audit log
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
     VALUES ($1, 'update_item', 'item', $2, $3)`,
    [
      actorUserId || null,
      id,
      JSON.stringify({
        item_name: updatedItem.item_name,
        old_data: {
          item_name: oldItem.item_name,
          category_id: oldItem.category_id,
          item_condition: oldItem.item_condition,
          availability_status: oldItem.availability_status,
        },
        new_data: {
          item_name: updatedItem.item_name,
          category_id: updatedItem.category_id,
          item_condition: updatedItem.item_condition,
          availability_status: updatedItem.availability_status,
        },
        actor_name: actorName || "Tendik",
      }),
    ]
  );

  return updatedItem;
}

export async function toggleItemActive({ item_id, is_active, actorUserId, actorName }) {
  const id = Number(item_id);
  if (!Number.isInteger(id)) {
    const err = new Error("ID barang tidak valid");
    err.status = 400;
    throw err;
  }

  const targetActive = Boolean(is_active);

  // Cek keberadaan barang dan status ketersediaan saat ini
  const { rows: currentRows } = await db.query(
    `SELECT i.item_id, i.item_name, i.availability_status, i.is_active, c.category_name
       FROM items i
       JOIN item_categories c ON c.category_id = i.category_id
      WHERE i.item_id = $1`,
    [id]
  );

  if (currentRows.length === 0) {
    const err = new Error("Barang tidak ditemukan");
    err.status = 404;
    throw err;
  }

  const currentItem = currentRows[0];

  // ATURAN BISNIS UTAMA:
  // "Barang yang sedang berstatus Sedang dipinjam dilarang keras untuk dinonaktifkan oleh Tendik"
  if (!targetActive) {
    // 1. Cek langsung dari availability_status
    if (currentItem.availability_status === "borrowed") {
      const err = new Error(
        `Barang "${currentItem.item_name}" sedang berstatus 'Sedang dipinjam'. Barang yang sedang dipinjam dilarang keras untuk dinonaktifkan.`
      );
      err.status = 400;
      throw err;
    }

    // 2. Cek apakah ada transaksi peminjaman aktif yang belum selesai di loan_transactions
    const { rows: activeLoans } = await db.query(
      `SELECT lt.loan_id
         FROM loan_transactions lt
         JOIN loan_requests lr ON lr.request_id = lt.request_id
        WHERE lr.item_id = $1 AND lt.transaction_status = 'borrowed'`,
      [id]
    );

    if (activeLoans.length > 0) {
      const err = new Error(
        `Barang "${currentItem.item_name}" masih memiliki transaksi peminjaman aktif yang belum dikembalikan. Selesaikan proses pengembalian terlebih dahulu sebelum menonaktifkan barang.`
      );
      err.status = 400;
      throw err;
    }
  }

  const { rows } = await db.query(
    `UPDATE items
        SET is_active = $1,
            updated_at = NOW()
      WHERE item_id = $2
      RETURNING item_id, item_name, category_id, item_condition, availability_status, is_active, updated_at`,
    [targetActive, id]
  );

  const updatedItem = rows[0];
  updatedItem.category_name = currentItem.category_name;

  // Catat audit log
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
     VALUES ($1, 'toggle_item_active', 'item', $2, $3)`,
    [
      actorUserId || null,
      id,
      JSON.stringify({
        item_name: currentItem.item_name,
        is_active: targetActive,
        previous_active: currentItem.is_active,
        actor_name: actorName || "Tendik",
      }),
    ]
  );

  return updatedItem;
}

