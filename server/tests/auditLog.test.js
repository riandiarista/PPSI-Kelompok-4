import test from "node:test";
import assert from "node:assert/strict";
import { getAuditLogs } from "../src/services/auditLogService.js";

test("Filter audit log menolak pagination yang tidak valid", async () => {
  await assert.rejects(getAuditLogs({ page: "0" }), (error) => error.status === 400);
  await assert.rejects(getAuditLogs({ page_size: "101" }), (error) => error.status === 400);
});

test("Filter audit log memvalidasi format dan rentang tanggal", async () => {
  await assert.rejects(getAuditLogs({ from: "2026-02-30" }), (error) => error.status === 400);
  await assert.rejects(
    getAuditLogs({ from: "2026-11-19", to: "2026-11-18" }),
    (error) => error.status === 400
  );
});
