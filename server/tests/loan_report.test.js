import test from "node:test";
import assert from "node:assert/strict";
import { getLateLoanReport } from "../src/services/loanService.js";

test("Rekap keterlambatan memvalidasi periode dan opsi pengurutan", async () => {
  await assert.rejects(getLateLoanReport({ month: "2026-13" }), (error) => error.status === 400);
  await assert.rejects(
    getLateLoanReport({ month: "2026-10", sortBy: "unsafe_column" }),
    (error) => error.status === 400
  );
  await assert.rejects(
    getLateLoanReport({ month: "2026-10", sortOrder: "sideways" }),
    (error) => error.status === 400
  );
});

test("Rekap keterlambatan membatasi panjang pencarian", async () => {
  await assert.rejects(
    getLateLoanReport({ month: "2026-10", search: "x".repeat(101) }),
    (error) => error.status === 400
  );
});
