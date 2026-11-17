/**
 * pointsController.js — HTTP Controller untuk UC-03: Poin, Level, dan Riwayat Reward
 *                       (KF-19, KF-20, KF-21, KNF-02)
 */

import * as pointsService from "../services/pointsService.js";

/**
 * GET /api/points/me
 * Mengambil ringkasan saldo poin, level kedisiplinan aktif, dan progress user login.
 * Memenuhi KNF-02: User ID diambil dari req.user.user_id yang terautentikasi.
 */
export async function getMyPoints(req, res, next) {
  try {
    const data = await pointsService.getMyPoints(req.user.user_id);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/points/me/history
 * Mengambil riwayat transaksi poin milik pengguna login (paginasi dan filter tipe).
 * Query params: ?page=1&limit=20&type=on_time_return|late_penalty|manual_adjustment
 * Memenuhi KNF-02: Membatasi agar pengguna hanya melihat datanya sendiri.
 */
export async function getMyHistory(req, res, next) {
  try {
    const { page, limit, type } = req.query;
    const data = await pointsService.getMyPointHistory({
      userId: req.user.user_id,
      page,
      limit,
      type,
    });
    res.json({
      success: true,
      data: data.items,
      pagination: data.pagination,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/points/rewards
 * Mengambil daftar periode reward dan penerima penghargaan.
 * Terbuka untuk dibaca sebagai bentuk pengakuan/apresiasi publik bagi peraih poin tertinggi.
 */
export async function getRewardPeriods(req, res, next) {
  try {
    const data = await pointsService.getRewardPeriods();
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/points/rewards/my-awards
 * Mengambil daftar reward/penghargaan yang pernah diraih oleh pengguna yang sedang login.
 */
export async function getMyAwards(req, res, next) {
  try {
    const data = await pointsService.getMyAwards(req.user.user_id);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}
