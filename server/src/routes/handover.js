/**
 * handover.js — Router untuk modul Serah Terima & Pengembalian (Tendik only)
 *
 * Rute:
 *   GET  /api/handover/pending               → daftar pengajuan disetujui (siap serah terima)
 *   POST /api/handover/:requestId/confirm    → catat serah terima (UC-13)
 *   GET  /api/handover/active               → daftar barang sedang dipinjam
 *   GET  /api/handover/returns/:loanId/preview → pratinjau poin pengembalian
 *   POST /api/handover/returns/:loanId/confirm  → konfirmasi pengembalian (UC-14)
 */

import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";
import { ACCESS } from "../constants/roles.js";
import * as handoverController from "../controllers/handoverController.js";
import * as returnController from "../controllers/returnController.js";

const router = Router();

router.use(authenticate);

// ── UC-13: Serah Terima ───────────────────────────────────────────────────
// Daftar pengajuan disetujui yang belum diserahterimakan
router.get(
  "/pending",
  authorize(...ACCESS.serahTerimaBarang),
  handoverController.getPendingHandovers
);

// Konfirmasi serah terima
router.post(
  "/:requestId/confirm",
  authorize(...ACCESS.serahTerimaBarang),
  handoverController.confirmHandover
);

// ── UC-14: Pengembalian ───────────────────────────────────────────────────
// Daftar barang yang sedang dipinjam
router.get(
  "/active",
  authorize(...ACCESS.cekPengembalian),
  returnController.getActiveLoans
);

// Pratinjau poin sebelum konfirmasi
router.get(
  "/returns/:loanId/preview",
  authorize(...ACCESS.cekPengembalian),
  returnController.previewReturn
);

// Konfirmasi pengembalian dan kondisi barang
router.post(
  "/returns/:loanId/confirm",
  authorize(...ACCESS.cekPengembalian),
  returnController.confirmReturn
);

export default router;
