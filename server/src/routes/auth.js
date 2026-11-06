import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../config/db.js";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/jwt.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// Hash palsu untuk dibandingkan saat email tidak terdaftar, supaya waktu respon
// sama dan penyerang tidak bisa menebak email mana yang terdaftar.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 10);

// POST /api/auth/login  { email, password }
router.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email dan password wajib diisi",
    });
  }

  const { rows } = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.password_hash, u.is_active, r.role_name AS role
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
      WHERE LOWER(u.email) = $1`,
    [email]
  );
  const user = rows[0];

  const passwordOk = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !passwordOk) {
    return res.status(401).json({
      success: false,
      message: "Email atau password salah",
    });
  }

  if (!user.is_active) {
    return res.status(403).json({
      success: false,
      message: "Akun Anda sudah dinonaktifkan. Hubungi admin.",
    });
  }

  const token = jwt.sign({ user_id: user.user_id, role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  res.json({
    success: true,
    message: "Login berhasil",
    data: {
      token,
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
    },
  });
});

// GET /api/auth/me  -> data user yang sedang login (untuk cek sesi di frontend)
router.get("/me", authenticate, (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

// POST /api/auth/logout
// JWT bersifat stateless: logout dilakukan dengan menghapus token di frontend
// (localStorage). Endpoint ini ada supaya alurnya jelas dan bisa ditambah
// pencatatan audit log nanti.
router.post("/logout", authenticate, (req, res) => {
  res.json({ success: true, message: "Logout berhasil" });
});

export default router;
