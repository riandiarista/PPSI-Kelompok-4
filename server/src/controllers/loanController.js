import * as loanService from "../services/loanService.js";

/**
 * Controller modul peminjaman: validasi ketersediaan & bentrok jadwal (#24).
 */

// GET /api/loans/availability?item_id=1&borrow_date=2026-11-20&duration_days=2
export async function checkAvailability(req, res, next) {
  try {
    const result = await loanService.checkAvailability({
      item_id: req.query.item_id,
      borrow_date: req.query.borrow_date,
      duration_days: req.query.duration_days,
      borrowerId: req.user.user_id,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// POST /api/loans/request  { item_id, purpose, borrow_date, duration_days }
export async function createLoanRequest(req, res, next) {
  try {
    const { item_id, purpose, borrow_date, duration_days } = req.body || {};
    const request = await loanService.createLoanRequest({
      item_id,
      purpose,
      borrow_date,
      duration_days,
      borrowerId: req.user.user_id,
    });

    let message = "Pengajuan peminjaman berhasil dikirim dan menunggu persetujuan Ketua Departemen";
    if (request.queued_next_workday) {
      message += ". Karena diajukan di akhir pekan, pengajuan diproses pada hari kerja berikutnya";
    }

    res.status(201).json({ success: true, message, data: request });
  } catch (err) {
    // 409 = barang tidak tersedia / bentrok jadwal; sertakan jadwal yang bentrok
    if (err.status === 409) {
      return res.status(409).json({
        success: false,
        message: err.message,
        data: { conflicts: err.conflicts || [] },
      });
    }
    next(err);
  }
}

// GET /api/loans/queue?tab=queue|scheduled|history|all
export async function getApprovalQueue(req, res, next) {
  try {
    const tab = String(req.query.tab || "queue").toLowerCase();
    const result = await loanService.getApprovalQueue({
      tab,
      actorUserId: req.user.user_id,
    });
    res.json({
      success: true,
      data: result.items,
      counts: result.counts,
      today: result.today,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/loans/priority-recommendations -> rekomendasi prioritas peminjam khusus Kadep
export async function getPriorityRecommendations(req, res, next) {
  try {
    const result = await loanService.getPriorityRecommendations({
      search: req.query.search,
      date: req.query.date,
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/loans/history?search=&sort_by=returned_at&sort_order=desc
export async function getLoanHistory(req, res, next) {
  try {
    const items = await loanService.getLoanHistory({
      search: req.query.search,
      sortBy: req.query.sort_by || "returned_at",
      sortOrder: req.query.sort_order || "desc",
    });
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
}

// GET /api/loans/late-report?month=YYYY-MM
export async function getLateLoanReport(req, res, next) {
  try {
    const report = await loanService.getLateLoanReport({
      month: req.query.month,
      search: req.query.search,
      sortBy: req.query.sort_by || "due_at",
      sortOrder: req.query.sort_order || "asc",
    });
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
}

// POST /api/loans/:id/approve
export async function approveLoanRequest(req, res, next) {
  try {
    const requestId = Number(req.params.id);
    const result = await loanService.approveLoanRequest({
      requestId,
      approverId: req.user.user_id,
    });
    res.json({
      success: true,
      message: "Pengajuan peminjaman berhasil disetujui",
      data: result,
    });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({
        success: false,
        message: err.message,
        data: { conflicts: err.conflicts || [] },
      });
    }
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
      });
    }
    next(err);
  }
}

// POST /api/loans/:id/reject
export async function rejectLoanRequest(req, res, next) {
  try {
    const requestId = Number(req.params.id);
    const { reason } = req.body || {};
    const result = await loanService.rejectLoanRequest({
      requestId,
      approverId: req.user.user_id,
      reason,
    });
    res.json({
      success: true,
      message: "Pengajuan peminjaman berhasil ditolak",
      data: result,
    });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({
        success: false,
        message: err.message,
      });
    }
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
      });
    }
    next(err);
  }
}

// POST /api/loans/:id/decision  { decision: 'approved' | 'rejected', reason }
export async function decideLoanRequest(req, res, next) {
  const { decision, reason } = req.body || {};
  if (decision === "approved") {
    return approveLoanRequest(req, res, next);
  }
  if (decision === "rejected") {
    return rejectLoanRequest(req, res, next);
  }
  return res.status(400).json({
    success: false,
    message: "Keputusan harus berupa 'approved' atau 'rejected'",
  });
}

// GET /api/loans/my-requests?tab=all|pending|approved|borrowed|returned|rejected&search=
export async function getMyLoanRequests(req, res, next) {
  try {
    const result = await loanService.getMyLoanRequests(req.user.user_id, {
      tab: req.query.tab,
      search: req.query.search,
    });
    res.json({
      success: true,
      data: result.items,
      counts: result.counts,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/loans/my-notifications
export async function getMyNotifications(req, res, next) {
  try {
    const notifications = await loanService.getMyNotifications(req.user.user_id);
    res.json({
      success: true,
      data: notifications,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/loans/my-requests/:id/cancel
export async function cancelLoanRequest(req, res, next) {
  try {
    const result = await loanService.cancelLoanRequest({
      requestId: req.params.id,
      borrowerId: req.user.user_id,
    });
    res.json({
      success: true,
      message: "Pengajuan peminjaman berhasil dibatalkan",
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
      });
    }
    next(err);
  }
}
