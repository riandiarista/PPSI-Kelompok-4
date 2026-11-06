import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { authorize } from "../src/middleware/authorize.js";
import { ROLES, ACCESS } from "../src/constants/roles.js";

// Pengganti sementara authenticate (#18): role diambil dari header X-Test-Role.
function fakeAuthenticate(req, res, next) {
  const role = req.get("X-Test-Role");
  if (role) req.user = { user_id: 1, role };
  next();
}

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(fakeAuthenticate);
  app.get("/approval", authorize(...ACCESS.approvalPeminjaman), (req, res) => res.json({ ok: true }));
  app.get("/laporan", authorize(ROLES.TENDIK, ROLES.KADEP), (req, res) => res.json({ ok: true }));

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => server.close());

const call = (path, role) =>
  fetch(baseUrl + path, { headers: role ? { "X-Test-Role": role } : {} });

test("tanpa login -> 401", async () => {
  const res = await call("/approval");
  assert.equal(res.status, 401);
});

test("role yang diizinkan -> 200", async () => {
  assert.equal((await call("/approval", ROLES.KADEP)).status, 200);
  assert.equal((await call("/laporan", ROLES.TENDIK)).status, 200);
  assert.equal((await call("/laporan", ROLES.KADEP)).status, 200);
});

test("role yang tidak diizinkan -> 403", async () => {
  assert.equal((await call("/approval", ROLES.PEMINJAM)).status, 403);
  assert.equal((await call("/approval", ROLES.TENDIK)).status, 403);
  assert.equal((await call("/laporan", ROLES.PEMINJAM)).status, 403);
});

test("role palsu di token -> 403", async () => {
  assert.equal((await call("/laporan", "Admin")).status, 403);
});

test("salah ketik nama role langsung error saat setup", () => {
  assert.throws(() => authorize("kadep"), /Role tidak dikenal/);
  assert.throws(() => authorize(), /minimal satu role/);
});

test("semua role di ACCESS valid", () => {
  for (const roles of Object.values(ACCESS)) {
    assert.doesNotThrow(() => authorize(...roles));
  }
});
