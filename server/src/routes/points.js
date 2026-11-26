/**
 * points.js — Router untuk modul Poin, Level, dan Riwayat Reward (UC-03 / KF-19, KF-20, KF-21)
 *
 * Rute:
 *   GET /api/points/me                → Saldo poin & level kedisiplinan aktif user login (KNF-02)
 *   GET /api/points/me/history        → Riwayat transaksi poin milik user login (KNF-02)
 *   GET /api/points/rewards           → Daftar periode reward dan pemenang apresiasi
 *   GET /api/points/rewards/my-awards → Daftar penghargaan yang diraih user login
 *   /api/points/admin/*               → Khusus Kadep: aturan poin, reward, periode, pemenang
 */

import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";
import { ACCESS } from "../constants/roles.js";
import * as pointsController from "../controllers/pointsController.js";

const router = Router();

// Semua rute wajib menyertakan token JWT autentikasi
router.use(authenticate);

// Ringkasan poin dan level pengguna (Peminjam)
router.get(
  "/me",
  authorize(...ACCESS.lihatPoinSendiri),
  pointsController.getMyPoints
);

// Riwayat mutasi poin (Peminjam hanya bisa melihat riwayatnya sendiri - KNF-02)
router.get(
  "/me/history",
  authorize(...ACCESS.lihatPoinSendiri),
  pointsController.getMyHistory
);

// Periode reward dan pengumuman pemenang apresiasi
router.get(
  "/rewards",
  pointsController.getRewardPeriods
);

// Penghargaan yang pernah diterima oleh pengguna yang login
router.get(
  "/rewards/my-awards",
  authorize(...ACCESS.lihatPoinSendiri),
  pointsController.getMyAwards
);

// ─── Kadep: Aturan Poin & Reward ────────────────────────────────────────────
const kadepOnly = authorize(...ACCESS.aturPoinReward);

router.get("/admin/rules", kadepOnly, pointsController.getPointRules);
router.put("/admin/rules", kadepOnly, pointsController.updatePointRules);

router.get("/admin/rewards", kadepOnly, pointsController.listRewards);
router.post("/admin/rewards", kadepOnly, pointsController.createReward);
router.put("/admin/rewards/:id", kadepOnly, pointsController.updateReward);
router.delete("/admin/rewards/:id", kadepOnly, pointsController.deleteReward);

router.post("/admin/periods", kadepOnly, pointsController.createPeriod);
router.put("/admin/periods/:id", kadepOnly, pointsController.updatePeriod);
router.get("/admin/periods/:id/leaderboard", kadepOnly, pointsController.getPeriodLeaderboard);
router.post("/admin/periods/:id/awards", kadepOnly, pointsController.giveAward);

router.delete("/admin/awards/:id", kadepOnly, pointsController.revokeAward);

export default router;
