import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";
import { ACCESS } from "../constants/roles.js";
import * as auditLogController from "../controllers/auditLogController.js";

const router = Router();

router.use(authenticate);
router.get("/", authorize(...ACCESS.lihatAuditLog), auditLogController.listAuditLogs);

export default router;
