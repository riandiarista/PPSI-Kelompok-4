/**
 * returnController.js — HTTP Controller untuk UC-14 (Konfirmasi Pengembalian)
 */

import * as returnService from "../services/returnService.js";

/**
 * GET /api/handover/active
 * Daftar transaksi yang sedang dipinjam (siap dikembalikan).
 */
export async function getActiveLoans(req, res, next) {
  try {
    const items = await returnService.getActiveLoanTransactions();
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/handover/returns/:loanId/preview
 * Pratinjau perubahan poin sebelum konfirmasi pengembalian.
 * Query: ?return_condition=good|minor_damage|major_damage&returned_at=ISO_STRING
 */
export async function previewReturn(req, res, next) {
  try {
    const loanId          = Number(req.params.loanId);
    const returnCondition = req.query.return_condition;
    const returnedAt      = req.query.returned_at || null;

    const preview = await returnService.previewReturnPoints({
      loanId,
      returnedAt,
      returnCondition,
    });

    res.json({ success: true, data: preview });
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

/**
 * POST /api/handover/returns/:loanId/confirm
 * Konfirmasi pengembalian dan kondisi barang.
 * Body: { return_condition, notes?, returned_at? }
 */
export async function confirmReturn(req, res, next) {
  try {
    const loanId = Number(req.params.loanId);
    const { return_condition, notes, returned_at } = req.body || {};

    const result = await returnService.confirmReturn({
      loanId,
      tendikId:        req.user.user_id,
      returnCondition: return_condition,
      notes:           notes || "",
      returnedAt:      returned_at || null,
    });

    const { gamification } = result;
    let pointMsg = "";
    if (gamification.point_delta > 0) {
      pointMsg = ` Poin peminjam bertambah +${gamification.point_delta} → ${gamification.new_balance} poin.`;
    } else if (gamification.point_delta < 0) {
      pointMsg = ` Poin peminjam berkurang ${gamification.point_delta} → ${gamification.new_balance} poin.`;
    }
    if (gamification.level_changed) {
      pointMsg += ` Level naik ke "${gamification.new_level}".`;
    }

    res.status(201).json({
      success: true,
      message: `Pengembalian barang "${result.item_name}" berhasil dikonfirmasi.${pointMsg}`,
      data:    result,
    });
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}
