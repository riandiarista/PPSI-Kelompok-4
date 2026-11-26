/**
 * pointsController.js — HTTP Controller untuk UC-03: Poin, Level, dan Riwayat Reward
 *                       (KF-19, KF-20, KF-21, KNF-02)
 */

import * as pointsService from "../services/pointsService.js";
import * as rewardAdminService from "../services/rewardAdminService.js";
import * as pointSettingsService from "../services/pointSettingsService.js";

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

// ─── Kadep: Aturan Poin & Reward ────────────────────────────────────────────


function handle(fn, status = 200) {
  return async (req, res, next) => {
    try {
      const data = await fn(req);
      if (status === 204) return res.status(204).end();
      res.status(status).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };
}

/** GET /api/points/admin/rules — aturan perhitungan poin & ambang level */
export const getPointRules = handle(() => rewardAdminService.getPointRules());

/** PUT /api/points/admin/rules — ubah aturan poin & ambang level */
export const updatePointRules = handle((req) =>
  pointSettingsService.updatePointSettings(req.user.user_id, req.body)
);

/** GET /api/points/admin/rewards — daftar definisi reward */
export const listRewards = handle(() => rewardAdminService.listRewards());

/** POST /api/points/admin/rewards */
export const createReward = handle(
  (req) => rewardAdminService.createReward(req.user.user_id, req.body),
  201
);

/** PUT /api/points/admin/rewards/:id */
export const updateReward = handle((req) =>
  rewardAdminService.updateReward(req.user.user_id, req.params.id, req.body)
);

/** DELETE /api/points/admin/rewards/:id */
export const deleteReward = handle(
  (req) => rewardAdminService.deleteReward(req.user.user_id, req.params.id),
  204
);

/** POST /api/points/admin/periods */
export const createPeriod = handle(
  (req) => rewardAdminService.createPeriod(req.user.user_id, req.body),
  201
);

/** PUT /api/points/admin/periods/:id */
export const updatePeriod = handle((req) =>
  rewardAdminService.updatePeriod(req.user.user_id, req.params.id, req.body)
);

/** GET /api/points/admin/periods/:id/leaderboard?limit=20 */
export const getPeriodLeaderboard = handle((req) =>
  rewardAdminService.getPeriodLeaderboard(req.params.id, { limit: req.query.limit })
);

/** POST /api/points/admin/periods/:id/awards — { reward_id, user_id, note } */
export const giveAward = handle(
  (req) => rewardAdminService.giveAward(req.user.user_id, req.params.id, req.body),
  201
);

/** DELETE /api/points/admin/awards/:id */
export const revokeAward = handle(
  (req) => rewardAdminService.revokeAward(req.user.user_id, req.params.id),
  204
);
