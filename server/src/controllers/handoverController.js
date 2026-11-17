/**
 * handoverController.js — HTTP Controller untuk UC-13 (Serah Terima Peminjaman)
 */

import * as handoverService from "../services/handoverService.js";

/**
 * GET /api/handover/pending
 * Daftar pengajuan disetujui yang belum diserahterimakan.
 */
export async function getPendingHandovers(req, res, next) {
  try {
    const items = await handoverService.getApprovedPendingHandover();
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/handover/:requestId/confirm
 * Konfirmasi serah terima oleh Tendik.
 * Body: { handover_note? }
 */
export async function confirmHandover(req, res, next) {
  try {
    const requestId   = Number(req.params.requestId);
    const { handover_note } = req.body || {};

    const result = await handoverService.recordHandover({
      requestId,
      tendikId:    req.user.user_id,
      handoverNote: handover_note || "",
    });

    res.status(201).json({
      success: true,
      message: `Serah terima barang "${result.item_name}" berhasil dicatat. Jatuh tempo: ${new Date(result.due_at).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })}.`,
      data:    result,
    });
  } catch (err) {
    if (err.status === 404 || err.status === 400 || err.status === 409) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}
