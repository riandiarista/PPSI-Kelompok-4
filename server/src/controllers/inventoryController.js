import * as inventoryService from "../services/inventoryService.js";

/**
 * Controller untuk modul Inventaris Barang dan Kategori Barang.
 * Berperan menghubungkan route HTTP dengan inventoryService.
 */

// ==========================================
// KONTROLLER KATEGORI BARANG
// ==========================================

export async function getCategories(req, res, next) {
  try {
    const search = String(req.query.search || "");
    const categories = await inventoryService.getAllCategories({ search });
    res.json({
      success: true,
      data: categories,
    });
  } catch (err) {
    next(err);
  }
}

export async function getCategoryById(req, res, next) {
  try {
    const id = Number(req.params.id);
    const category = await inventoryService.getCategoryById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Kategori tidak ditemukan",
      });
    }
    res.json({
      success: true,
      data: category,
    });
  } catch (err) {
    next(err);
  }
}

export async function createCategory(req, res, next) {
  try {
    const { category_name } = req.body;
    const newCategory = await inventoryService.createCategory({
      category_name,
      actorUserId: req.user?.user_id,
      actorName: req.user?.full_name,
    });

    res.status(201).json({
      success: true,
      message: `Kategori "${newCategory.category_name}" berhasil ditambahkan`,
      data: newCategory,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateCategory(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { category_name } = req.body;

    const updatedCategory = await inventoryService.updateCategory({
      category_id: id,
      category_name,
      actorUserId: req.user?.user_id,
      actorName: req.user?.full_name,
    });

    res.json({
      success: true,
      message: `Kategori "${updatedCategory.category_name}" berhasil diperbarui`,
      data: updatedCategory,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteCategory(req, res, next) {
  try {
    const id = Number(req.params.id);
    const result = await inventoryService.deleteCategory({
      category_id: id,
      actorUserId: req.user?.user_id,
      actorName: req.user?.full_name,
    });

    res.json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
}

// ==========================================
// KONTROLLER INVENTARIS BARANG
// ==========================================

export async function getItems(req, res, next) {
  try {
    const { search, category_id, condition, availability_status, is_active } = req.query;

    const result = await inventoryService.getItems({
      search,
      category_id,
      condition,
      availability_status,
      is_active,
    });

    res.json({
      success: true,
      data: result.items,
      stats: result.stats,
    });
  } catch (err) {
    next(err);
  }
}

export async function getItemById(req, res, next) {
  try {
    const id = Number(req.params.id);
    const item = await inventoryService.getItemById(id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Barang tidak ditemukan",
      });
    }

    res.json({
      success: true,
      data: item,
    });
  } catch (err) {
    next(err);
  }
}

export async function createItem(req, res, next) {
  try {
    const { item_name, category_id, item_condition, availability_status } = req.body;

    const newItem = await inventoryService.createItem({
      item_name,
      category_id,
      item_condition,
      availability_status,
      actorUserId: req.user?.user_id,
      actorName: req.user?.full_name,
    });

    res.status(201).json({
      success: true,
      message: `Barang "${newItem.item_name}" berhasil ditambahkan ke inventaris`,
      data: newItem,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateItem(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { item_name, category_id, item_condition, availability_status } = req.body;

    const updatedItem = await inventoryService.updateItem({
      item_id: id,
      item_name,
      category_id,
      item_condition,
      availability_status,
      actorUserId: req.user?.user_id,
      actorName: req.user?.full_name,
    });

    res.json({
      success: true,
      message: `Data barang "${updatedItem.item_name}" berhasil diperbarui`,
      data: updatedItem,
    });
  } catch (err) {
    next(err);
  }
}

export async function toggleItemActive(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { is_active } = req.body;

    const updatedItem = await inventoryService.toggleItemActive({
      item_id: id,
      is_active,
      actorUserId: req.user?.user_id,
      actorName: req.user?.full_name,
    });

    const statusText = updatedItem.is_active ? "diaktifkan kembali" : "dinonaktifkan";

    res.json({
      success: true,
      message: `Barang "${updatedItem.item_name}" berhasil ${statusText}`,
      data: updatedItem,
    });
  } catch (err) {
    next(err);
  }
}

