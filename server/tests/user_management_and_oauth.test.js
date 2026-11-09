import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.js";
import db from "../src/config/db.js";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../src/config/jwt.js";

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.end();
});

// Helper untuk HTTP request
async function req(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

// Helper untuk token login
async function getAuthToken(email, password = "password123") {
  const res = await req("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return res.data?.data?.token;
}

test("Skenario A: Tendik membuat akun pengguna langsung", async () => {
  const tendikToken = await getAuthToken("tendik@demo.test");
  assert.ok(tendikToken, "Tendik login harus sukses");

  const newEmail = `user.test.${Date.now()}@test.test`;
  const createRes = await req("/api/admin/users", {
    method: "POST",
    headers: { Authorization: `Bearer ${tendikToken}` },
    body: {
      full_name: "Mahasiswa Baru Langsung",
      email: newEmail,
      password: "passwordAman123",
      role: "Peminjam",
    },
  });

  assert.equal(createRes.status, 201, "Pembuatan akun harus sukses (201)");
  assert.equal(createRes.data.success, true);
  assert.equal(createRes.data.data.email, newEmail);
  assert.equal(createRes.data.data.registration_status, "approved");
  assert.equal(createRes.data.data.is_active, true);

  // Akun langsung dapat digunakan untuk login
  const loginRes = await req("/api/auth/login", {
    method: "POST",
    body: { email: newEmail, password: "passwordAman123" },
  });

  assert.equal(loginRes.status, 200, "Akun baru harus bisa langsung login");
  assert.ok(loginRes.data.data.token);
  assert.equal(loginRes.data.data.user.role, "Peminjam");
});

test("Skenario B: Peminjam mendaftar menggunakan Google (status Pending)", async () => {
  const googleEmail = `google.mhs.${Date.now()}@student.unp.ac.id`;
  const googleSub = `sub_google_${Date.now()}`;

  // Gunakan dev-mock credential yang didukung di lingkungan dev
  const mockPayload = Buffer.from(
    JSON.stringify({
      sub: googleSub,
      email: googleEmail,
      name: "Budi Google Student",
      picture: "https://example.com/avatar.jpg",
    })
  ).toString("base64");

  const regRes = await req("/api/auth/google", {
    method: "POST",
    body: { credential: `dev-mock:${mockPayload}` },
  });

  assert.equal(regRes.status, 201, "Pendaftaran baru Google harus menghasilkan 201");
  assert.equal(regRes.data.data.registration_status, "pending");
  assert.equal(regRes.data.data.user.role, "Peminjam");

  // Saat mencoba login ulang sebelum disetujui, harus ditolak dengan status Pending
  const retryRes = await req("/api/auth/google", {
    method: "POST",
    body: { credential: `dev-mock:${mockPayload}` },
  });

  assert.equal(retryRes.status, 403, "Login akun pending harus ditolak 403");
  assert.match(retryRes.data.message, /menunggu persetujuan/i);
});

test("Skenario C: Tendik menyetujui pendaftaran Google (Accept)", async () => {
  const tendikToken = await getAuthToken("tendik@demo.test");
  const googleEmail = `google.acc.${Date.now()}@student.unp.ac.id`;
  const googleSub = `sub_google_acc_${Date.now()}`;

  const mockPayload = Buffer.from(
    JSON.stringify({
      sub: googleSub,
      email: googleEmail,
      name: "Ahmad Calon Peminjam",
    })
  ).toString("base64");

  // 1. Mendaftar via Google
  const regRes = await req("/api/auth/google", {
    method: "POST",
    body: { credential: `dev-mock:${mockPayload}` },
  });
  const userId = regRes.data.data.user.user_id;

  // 2. Tendik menyetujui (Accept)
  const approveRes = await req(`/api/admin/users/${userId}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tendikToken}` },
  });

  assert.equal(approveRes.status, 200, "Approval akun harus berhasil 200");
  assert.equal(approveRes.data.data.registration_status, "approved");
  assert.ok(approveRes.data.data.approved_at);
  assert.ok(approveRes.data.data.approved_by);

  // 3. Peminjam login kembali dengan Google -> sekarang berhasil masuk
  const loginRes = await req("/api/auth/google", {
    method: "POST",
    body: { credential: `dev-mock:${mockPayload}` },
  });

  assert.equal(loginRes.status, 200, "Akun yang sudah disetujui harus berhasil login 200");
  assert.ok(loginRes.data.data.token, "Harus mengembalikan token JWT");
  assert.equal(loginRes.data.data.user.role, "Peminjam");
});

test("Skenario D: Tendik menolak pendaftaran Google (Decline)", async () => {
  const tendikToken = await getAuthToken("tendik@demo.test");
  const googleEmail = `google.dec.${Date.now()}@student.unp.ac.id`;
  const googleSub = `sub_google_dec_${Date.now()}`;

  const mockPayload = Buffer.from(
    JSON.stringify({
      sub: googleSub,
      email: googleEmail,
      name: "Ditolak Karena Bukan Mahasiswa UNP",
    })
  ).toString("base64");

  // 1. Mendaftar via Google
  const regRes = await req("/api/auth/google", {
    method: "POST",
    body: { credential: `dev-mock:${mockPayload}` },
  });
  const userId = regRes.data.data.user.user_id;

  // 2. Tendik menolak (Decline) dengan alasan
  const declineRes = await req(`/api/admin/users/${userId}/decline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tendikToken}` },
    body: { reason: "Bukan mahasiswa Departemen Bahasa Inggris" },
  });

  assert.equal(declineRes.status, 200, "Penolakan pendaftaran harus 200");
  assert.equal(declineRes.data.data.registration_status, "rejected");
  assert.equal(declineRes.data.data.rejection_reason, "Bukan mahasiswa Departemen Bahasa Inggris");
  assert.ok(declineRes.data.data.rejected_at);

  // 3. Coba login kembali -> harus ditolak dan menyampaikan alasan
  const retryRes = await req("/api/auth/google", {
    method: "POST",
    body: { credential: `dev-mock:${mockPayload}` },
  });

  assert.equal(retryRes.status, 403, "Login akun rejected harus ditolak 403");
  assert.match(retryRes.data.message, /ditolak/i);
});

test("Skenario E: Keamanan dan Hak Akses", async () => {
  const peminjamToken = await getAuthToken("peminjam@demo.test");
  const tendikToken = await getAuthToken("tendik@demo.test");

  // 1. Peminjam mencoba mengakses endpoint admin pengguna -> harus 403
  const forbiddenRes = await req("/api/admin/users", {
    headers: { Authorization: `Bearer ${peminjamToken}` },
  });
  assert.equal(forbiddenRes.status, 403, "Peminjam tidak boleh mengakses Kelola Akun");

  // 2. Coba mendaftarkan email yang sudah ada dengan Google -> harus 409
  const dupEmail = "peminjam@demo.test";
  const dupPayload = Buffer.from(
    JSON.stringify({
      sub: `different_sub_${Date.now()}`,
      email: dupEmail,
      name: "Imposter",
    })
  ).toString("base64");

  const dupRes = await req("/api/auth/google", {
    method: "POST",
    body: { credential: `dev-mock:${dupPayload}` },
  });
  assert.equal(dupRes.status, 409, "Pendaftaran duplikat harus menghasilkan conflict 409");

  // 3. Coba approve akun yang sudah berstatus rejected atau approved -> harus 400
  const invalidApproveRes = await req("/api/admin/users/1/accept", {
    method: "POST",
    headers: { Authorization: `Bearer ${tendikToken}` },
  });
  assert.equal(invalidApproveRes.status, 400, "Menyetujui akun non-pending harus ditolak 400");

  // 4. Token Google tidak valid / kosong -> harus 400/401
  const badTokenRes = await req("/api/auth/google", {
    method: "POST",
    body: { credential: "invalid-token" },
  });
  assert.equal(badTokenRes.status, 401, "Token tidak valid harus ditolak 401");
});

