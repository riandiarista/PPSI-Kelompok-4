import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";
import { ACCESS } from "../constants/roles.js";
import * as inventoryController from "../controllers/inventoryController.js";

const router = Router();

// Semua endpoint membutuhkan autentikasi
router.use(authenticate);

// ==========================================
// RUTE KATEGORI BARANG
// ==========================================

// GET /api/inventory/categories -> Melihat daftar kategori (bisa diakses sesuai ACCESS.lihatBarang)
router.get(
  "/categories",
  authorize(...ACCESS.lihatBarang),
  inventoryController.getCategories
);

// GET /api/inventory/categories/:id -> Detail kategori
router.get(
  "/categories/:id",
  authorize(...ACCESS.lihatBarang),
  inventoryController.getCategoryById
);

// POST /api/inventory/categories -> Tambah kategori (hanya Tendik)
router.post(
  "/categories",
  authorize(...ACCESS.kelolaKategori),
  inventoryController.createCategory
);

// PUT /api/inventory/categories/:id -> Edit kategori (hanya Tendik)
router.put(
  "/categories/:id",
  authorize(...ACCESS.kelolaKategori),
  inventoryController.updateCategory
);

// DELETE /api/inventory/categories/:id -> Hapus kategori (hanya Tendik)
router.delete(
  "/categories/:id",
  authorize(...ACCESS.kelolaKategori),
  inventoryController.deleteCategory
);

// ==========================================
// RUTE INVENTARIS BARANG
// ==========================================

// GET /api/inventory/items -> Melihat daftar inventaris barang (sesuai ACCESS.lihatBarang)
router.get(
  "/items",
  authorize(...ACCESS.lihatBarang),
  inventoryController.getItems
);

// GET /api/inventory/items/:id -> Detail barang
router.get(
  "/items/:id",
  authorize(...ACCESS.lihatBarang),
  inventoryController.getItemById
);

// POST /api/inventory/items -> Tambah barang baru (hanya Tendik)
router.post(
  "/items",
  authorize(...ACCESS.kelolaBarang),
  inventoryController.createItem
);

// PUT /api/inventory/items/:id -> Ubah data barang (hanya Tendik)
router.put(
  "/items/:id",
  authorize(...ACCESS.kelolaBarang),
  inventoryController.updateItem
);

// PATCH /api/inventory/items/:id/status -> Nonaktifkan / Aktifkan barang (hanya Tendik)
router.patch(
  "/items/:id/status",
  authorize(...ACCESS.kelolaBarang),
  inventoryController.toggleItemActive
);

export default router;

