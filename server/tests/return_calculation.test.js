import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateLateDays,
  getItemStatusAfterReturn,
} from "../src/services/returnService.js";

test("Perhitungan hari keterlambatan membulatkan hari parsial ke atas", () => {
  const dueAt = "2026-11-18T10:00:00.000Z";

  assert.equal(calculateLateDays(dueAt, "2026-11-18T10:00:00.000Z"), 0);
  assert.equal(calculateLateDays(dueAt, "2026-11-18T10:00:01.000Z"), 1);
  assert.equal(calculateLateDays(dueAt, "2026-11-19T10:00:00.000Z"), 1);
  assert.equal(calculateLateDays(dueAt, "2026-11-20T10:00:01.000Z"), 3);
  assert.throws(() => calculateLateDays(dueAt, "waktu-tidak-valid"), /Format waktu/);
});

test("Status barang mengikuti kondisi saat dikembalikan", () => {
  assert.equal(getItemStatusAfterReturn("good"), "available");
  assert.equal(getItemStatusAfterReturn("minor_damage"), "maintenance");
  assert.equal(getItemStatusAfterReturn("major_damage"), "unavailable");
});
