import * as auditLogService from "../services/auditLogService.js";

export async function listAuditLogs(req, res, next) {
  try {
    const result = await auditLogService.getAuditLogs(req.query);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}
