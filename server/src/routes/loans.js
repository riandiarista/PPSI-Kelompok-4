import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";
import { ACCESS } from "../constants/roles.js";
import * as loanController from "../controllers/loanController.js";

const router = Router();

router.use(authenticate);

// GET /api/loans/availability -> cek ketersediaan & bentrok jadwal sebelum mengajukan
router.get("/availability", authorize(...ACCESS.lihatBarang), loanController.checkAvailability);

// POST /api/loans/request -> ajukan peminjaman (hanya Peminjam)
router.post("/request", authorize(...ACCESS.ajukanPeminjaman), loanController.createLoanRequest);

// GET /api/loans/queue -> antrean persetujuan peminjaman (hanya Kadep)
router.get("/queue", authorize(...ACCESS.approvalPeminjaman), loanController.getApprovalQueue);
router.get("/history", authorize(...ACCESS.lihatLaporan), loanController.getLoanHistory);
router.get("/late-report", authorize(...ACCESS.lihatLaporan), loanController.getLateLoanReport);

// POST /api/loans/:id/approve & reject -> keputusan persetujuan peminjaman (hanya Kadep)
router.post("/:id/approve", authorize(...ACCESS.approvalPeminjaman), loanController.approveLoanRequest);
router.post("/:id/reject", authorize(...ACCESS.approvalPeminjaman), loanController.rejectLoanRequest);
router.post("/:id/decision", authorize(...ACCESS.approvalPeminjaman), loanController.decideLoanRequest);

// Alias dengan prefix /requests/:id/...
router.post("/requests/:id/approve", authorize(...ACCESS.approvalPeminjaman), loanController.approveLoanRequest);
router.post("/requests/:id/reject", authorize(...ACCESS.approvalPeminjaman), loanController.rejectLoanRequest);
router.post("/requests/:id/decision", authorize(...ACCESS.approvalPeminjaman), loanController.decideLoanRequest);

export default router;
