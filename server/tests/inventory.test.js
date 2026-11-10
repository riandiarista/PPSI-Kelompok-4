import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.js";
import db from "../src/config/db.js";

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.end();
});

// Helper HTTP Request
async function req(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

// Helper Auth Token
async function getAuthToken(email, password = "password123") {
  const res = await req("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return res.data?.data?.token;
}

test("Modul Inventaris: Otorisasi & CRUD Kategori dan Barang", async () => {
  const tendikToken = await getAuthToken("tendik@demo.test");
  const peminjamToken = await getAuthToken("peminjam@demo.test");

  assert.ok(tendikToken, "Tendik token harus valid");
  assert.ok(peminjamToken, "Peminjam token harus valid");

  // 1. Peminjam TIDAK BOLEH menambah kategori (403 Forbidden)
  const forbiddenCatRes = await req("/api/inventory/categories", {
    method: "POST",
    headers: { Authorization: `Bearer ${peminjamToken}` },
    body: { category_name: "Kategori Dilarang" },
  });
  assert.equal(forbiddenCatRes.status, 403, "Peminjam harus ditolak (403) saat membuat kategori");

  // 2. Tendik BERHASIL menambah kategori baru
  const uniqueCategoryName = `Elektronik Lab ${Date.now()}`;
  const createCatRes = await req("/api/inventory/categories", {
    method: "POST",
    headers: { Authorization: `Bearer ${tendikToken}` },
    body: { category_name: uniqueCategoryName },
  });
  assert.equal(createCatRes.status, 201, "Tendik harus berhasil membuat kategori baru");
  assert.ok(createCatRes.data.data.category_id);
  const categoryId = createCatRes.data.data.category_id;

  // 3. Tendik membuat barang baru dengan pemisahan kondisi fisik dan status operasional
  const itemName = `Proyektor Epson ${Date.now()}`;
  const createItemRes = await req("/api/inventory/items", {
    method: "POST",
    headers: { Authorization: `Bearer ${tendikToken}` },
    body: {
      category_id: categoryId,
      item_name: itemName,
      item_condition: "good", // Kondisi fisik: Baik
      availability_status: "available", // Status operasional: Tersedia
    },
  });
  assert.equal(createItemRes.status, 201, "Tendik harus berhasil menambahkan barang baru");
  assert.equal(createItemRes.data.data.item_condition, "good");
  assert.equal(createItemRes.data.data.availability_status, "available");
  assert.equal(createItemRes.data.data.is_active, true);
  const itemId = createItemRes.data.data.item_id;

  // 4. Tendik memperbarui data barang (misal kondisi fisik menjadi rusak ringan)
  const updateItemRes = await req(`/api/inventory/items/${itemId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${tendikToken}` },
    body: {
      category_id: categoryId,
      item_name: `${itemName} (Revisi)`,
      item_condition: "minor_damage",
      availability_status: "maintenance",
    },
  });
  assert.equal(updateItemRes.status, 200, "Tendik harus berhasil mengubah data barang");
  assert.equal(updateItemRes.data.data.item_condition, "minor_damage");
  assert.equal(updateItemRes.data.data.availability_status, "maintenance");

  // 5. ATURAN BISNIS: Barang yang sedang 'borrowed' DILARANG KERAS untuk dinonaktifkan
  // Kita simulasikan status barang diubah ke 'borrowed'
  await db.query(
    "UPDATE items SET availability_status = 'borrowed' WHERE item_id = $1",
    [itemId]
  );

  const deactiveBorrowedRes = await req(`/api/inventory/items/${itemId}/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tendikToken}` },
    body: { is_active: false },
  });
  assert.equal(
    deactiveBorrowedRes.status,
    400,
    "Penonaktifan barang yang sedang berstatus 'borrowed' harus ditolak (400)"
  );
  assert.match(
    deactiveBorrowedRes.data.message,
    /dilarang keras/i,
    "Pesan error harus menjelaskan larangan penonaktifan barang yang sedang dipinjam"
  );

  // 6. Saat barang kembali berstatus selain 'borrowed' (misal available), penonaktifan berhasil (soft-delete)
  await db.query(
    "UPDATE items SET availability_status = 'available' WHERE item_id = $1",
    [itemId]
  );

  const deactiveRes = await req(`/api/inventory/items/${itemId}/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tendikToken}` },
    body: { is_active: false },
  });
  assert.equal(deactiveRes.status, 200, "Barang available harus bisa dinonaktifkan");
  assert.equal(deactiveRes.data.data.is_active, false);

  // 7. Pengaktifan kembali
  const reactiveRes = await req(`/api/inventory/items/${itemId}/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tendikToken}` },
    body: { is_active: true },
  });
  assert.equal(reactiveRes.status, 200, "Barang harus bisa diaktifkan kembali");
  assert.equal(reactiveRes.data.data.is_active, true);

  // 8. Kategori yang masih memiliki barang DILARANG dihapus
  const deleteCatFailRes = await req(`/api/inventory/categories/${categoryId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${tendikToken}` },
  });
  assert.equal(deleteCatFailRes.status, 400, "Kategori dengan barang tidak boleh dihapus");

  // 9. Periksa apakah audit log tercatat
  const { rows: logs } = await db.query(
    "SELECT action_type, entity_type, entity_id FROM audit_logs WHERE entity_id = $1 AND entity_type = 'item'",
    [itemId]
  );
  assert.ok(logs.length >= 3, "Harus ada minimal 3 log aktivitas untuk item ini (create, update, toggle)");
});

