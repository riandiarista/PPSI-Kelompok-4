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

export default router;
