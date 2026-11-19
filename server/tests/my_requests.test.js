import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import db from "../src/config/db.js";
import * as loanService from "../src/services/loanService.js";

test("Status & Notifikasi Peminjam (my-requests & my-notifications)", async (t) => {
  // Ambil salah satu user peminjam yang ada
  const { rows: users } = await db.query(
    `SELECT u.user_id FROM users u JOIN roles r ON u.role_id = r.role_id WHERE r.role_name = 'Peminjam' LIMIT 1`
  );
  if (users.length === 0) {
    t.skip("Tidak ada user Peminjam di database untuk pengujian");
    return;
  }
  const borrowerId = users[0].user_id;

  await t.test("getMyLoanRequests mengembalikan objek { items, counts }", async () => {
    const result = await loanService.getMyLoanRequests(borrowerId);
    assert.ok(result);
    assert.ok(Array.isArray(result.items));
    assert.ok(result.counts);
    assert.strictEqual(typeof result.counts.all, "number");
    assert.strictEqual(typeof result.counts.pending, "number");
    assert.strictEqual(typeof result.counts.approved, "number");
    assert.strictEqual(typeof result.counts.borrowed, "number");
    assert.strictEqual(typeof result.counts.returned, "number");
    assert.strictEqual(typeof result.counts.rejected, "number");
  });

  await t.test("getMyNotifications mengembalikan array notifikasi", async () => {
    const notifs = await loanService.getMyNotifications(borrowerId);
    assert.ok(Array.isArray(notifs));
  });
});
