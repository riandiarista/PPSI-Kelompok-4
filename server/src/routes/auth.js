import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import db from "../config/db.js";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/jwt.js";
import { authenticate } from "../middleware/authenticate.js";
import { ROLES } from "../constants/roles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });
dotenv.config();

const router = Router();

// Hash palsu untuk timing-safe comparison saat email tidak terdaftar
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 10);

/**
 * Memverifikasi token Google ID Token dari client.
 * Mendukung verifikasi token Google resmi menggunakan google-auth-library.
 * Di lingkungan development, juga mendukung dev-mock token terenkripsi untuk kemudahan pengujian.
 */
async function verifyGoogleToken(credential) {
  if (!credential || typeof credential !== "string") {
    throw new Error("Token Google tidak valid");
  }

  // Development mock token untuk pengujian lokal tanpa credential Google Cloud aktif
  if (process.env.NODE_ENV === "development" && credential.startsWith("dev-mock:")) {
    try {
      const jsonStr = Buffer.from(credential.slice(9), "base64").toString("utf8");
      const mock = JSON.parse(jsonStr);
      if (!mock.email || !mock.sub) {
        throw new Error("Data mock Google tidak lengkap");
      }
      return {
        sub: String(mock.sub),
        email: String(mock.email).trim().toLowerCase(),
        email_verified: true,
        name: mock.name || "Pengguna Google",
        picture: mock.picture || null,
        auto_approve: Boolean(mock.auto_approve),
      };
    } catch (err) {
      throw new Error(`Token simulasi Google tidak valid: ${err.message}`);
    }
  }

  // Verifikasi resmi melalui Google Auth Library
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId || clientId.includes("your-google-client-id")) {
    throw new Error("GOOGLE_CLIENT_ID belum dikonfigurasi dengan benar di server/.env");
  }

  const googleClient = new OAuth2Client(clientId);
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
  } catch (err) {
    if (err.message?.includes("Wrong recipient") || err.message?.includes("audience")) {
      throw new Error(
        `Client ID tidak cocok antara frontend dan backend. Pastikan GOOGLE_CLIENT_ID di server/.env dan VITE_GOOGLE_CLIENT_ID di client/.env sama persis, lalu restart server backend.`
      );
    }
    throw err;
  }

  const payload = ticket.getPayload();

  if (!payload || !payload.sub || !payload.email) {
    throw new Error("Payload identitas Google tidak valid");
  }

  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    email_verified: Boolean(payload.email_verified),
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture || null,
  };
}

// POST /api/auth/login  { email, password }
router.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email dan kata sandi wajib diisi",
    });
  }

  const { rows } = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.password_hash, u.is_active,
            u.registration_status, u.auth_provider, u.avatar_url, u.must_change_password,
            u.rejection_reason, r.role_name AS role
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
      WHERE LOWER(u.email) = $1`,
    [email]
  );
  const user = rows[0];

  const passwordOk = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !user.password_hash || !passwordOk) {
    return res.status(401).json({
      success: false,
      message: "Email atau kata sandi salah",
    });
  }

  if (user.registration_status === "pending") {
    return res.status(403).json({
      success: false,
      message: "Pendaftaran Anda sedang menunggu persetujuan administrator. Silakan coba kembali setelah akun disetujui.",
      data: {
        registration_status: "pending",
      },
    });
  }

  if (user.registration_status === "rejected") {
    return res.status(403).json({
      success: false,
      message: user.rejection_reason
        ? `Pendaftaran Anda ditolak: ${user.rejection_reason}`
        : "Pendaftaran Anda ditolak dan Anda tidak dapat mengakses aplikasi.",
      data: {
        registration_status: "rejected",
        rejection_reason: user.rejection_reason,
      },
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
        auth_provider: user.auth_provider,
        avatar_url: user.avatar_url,
        registration_status: user.registration_status,
        must_change_password: user.must_change_password,
      },
    },
  });
});

// POST /api/auth/google  { credential }
router.post("/google", async (req, res) => {
  const credential = req.body?.credential;
  if (!credential) {
    return res.status(400).json({
      success: false,
      message: "Token autentikasi Google wajib disertakan",
    });
  }

  let googleUser;
  try {
    googleUser = await verifyGoogleToken(credential);
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: `Verifikasi Google gagal: ${err.message}`,
    });
  }

  if (!googleUser.email_verified) {
    return res.status(400).json({
      success: false,
      message: "Email Google belum terverifikasi oleh Google.",
    });
  }

  // 1. Periksa apakah sudah ada akun dengan Google User ID (sub) ini
  const { rows: existingGoogle } = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.is_active, u.registration_status,
            u.auth_provider, u.avatar_url, u.rejection_reason, r.role_name AS role
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
      WHERE u.google_id = $1`,
    [googleUser.sub]
  );

  if (existingGoogle.length > 0) {
    const user = existingGoogle[0];

    // Status: Pending
    if (user.registration_status === "pending") {
      return res.status(403).json({
        success: false,
        message: "Pendaftaran Anda sedang menunggu persetujuan administrator. Silakan coba kembali setelah akun disetujui.",
        data: {
          registration_status: "pending",
          email: user.email,
          full_name: user.full_name,
        },
      });
    }

    // Status: Rejected
    if (user.registration_status === "rejected") {
      return res.status(403).json({
        success: false,
        message: user.rejection_reason
          ? `Pendaftaran Anda ditolak: ${user.rejection_reason}`
          : "Pendaftaran Anda ditolak dan Anda tidak dapat mengakses aplikasi.",
        data: {
          registration_status: "rejected",
          rejection_reason: user.rejection_reason,
        },
      });
    }

    // Status: Approved tapi nonaktif
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Akun Anda sudah dinonaktifkan. Hubungi admin.",
      });
    }

    // Status: Approved dan aktif -> Berikan token login
    const token = jwt.sign({ user_id: user.user_id, role: user.role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.json({
      success: true,
      message: "Login dengan akun Google berhasil",
      data: {
        token,
        user: {
          user_id: user.user_id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
          avatar_url: user.avatar_url,
          registration_status: user.registration_status,
          auth_provider: user.auth_provider,
        },
      },
    });
  }

  // 2. Periksa apakah email sudah terdaftar lewat metode lain (Lokal)
  const { rows: existingEmail } = await db.query(
    `SELECT user_id, email, auth_provider FROM users WHERE LOWER(email) = $1`,
    [googleUser.email]
  );

  if (existingEmail.length > 0) {
    return res.status(409).json({
      success: false,
      message: "Email ini sudah terdaftar melalui metode lain. Silakan masuk menggunakan email dan kata sandi Anda.",
    });
  }

  // 3. Pendaftaran Akun Google Baru
  // Otomatis mendapatkan role 'Peminjam' dan status 'pending'
  const client = await db.getClient ? await db.getClient() : db;
  try {
    const { rows: roleRows } = await db.query(
      `SELECT role_id FROM roles WHERE role_name = $1`,
      [ROLES.PEMINJAM]
    );

    if (roleRows.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Role Peminjam belum dikonfigurasi di sistem",
      });
    }

    const peminjamRoleId = roleRows[0].role_id;
    const autoApprove = process.env.AUTO_APPROVE_GOOGLE === "true" || Boolean(googleUser.auto_approve);
    const initialStatus = autoApprove ? "approved" : "pending";

    const { rows: newUsers } = await db.query(
      `INSERT INTO users (
         role_id, full_name, email, google_id, avatar_url,
         email_verified, registration_status, auth_provider, is_active, approved_at
       ) VALUES (
         $1, $2, $3, $4, $5, TRUE, $6, 'google', TRUE, $7
       )
       RETURNING user_id, full_name, email, registration_status, auth_provider, created_at`,
      [
        peminjamRoleId,
        googleUser.name,
        googleUser.email,
        googleUser.sub,
        googleUser.picture,
        initialStatus,
        autoApprove ? new Date() : null,
      ]
    );

    const newUser = newUsers[0];

    // Inisialisasi buku gamifikasi peminjam
    await db.query(
      `INSERT INTO user_gamifications (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [newUser.user_id]
    );

    // Catat log pendaftaran Google
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'google_registration', 'user', $1, $2)`,
      [
        newUser.user_id,
        JSON.stringify({
          email: newUser.email,
          full_name: newUser.full_name,
          google_id: googleUser.sub,
          auto_approved: autoApprove,
        }),
      ]
    );

    if (autoApprove) {
      const token = jwt.sign({ user_id: newUser.user_id, role: ROLES.PEMINJAM }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
      });

      return res.status(201).json({
        success: true,
        message: "Pendaftaran dan login dengan Google berhasil",
        data: {
          token,
          user: {
            user_id: newUser.user_id,
            full_name: newUser.full_name,
            email: newUser.email,
            role: ROLES.PEMINJAM,
            avatar_url: googleUser.picture,
            registration_status: "approved",
            auth_provider: "google",
          },
        },
      });
    }

    return res.status(201).json({
      success: true,
      message: "Pendaftaran Anda sedang menunggu persetujuan administrator. Silakan coba kembali setelah akun disetujui.",
      data: {
        registration_status: "pending",
        user: {
          user_id: newUser.user_id,
          full_name: newUser.full_name,
          email: newUser.email,
          role: ROLES.PEMINJAM,
          registration_status: "pending",
          auth_provider: "google",
        },
      },
    });
  } catch (err) {
    console.error("Gagal mendaftarkan akun Google:", err);
    return res.status(500).json({
      success: false,
      message: "Gagal memproses pendaftaran Google: " + err.message,
    });
  }
});

// POST /api/auth/change-password  (untuk pengguna yang diwajibkan ganti password saat login pertama)
router.post("/change-password", authenticate, async (req, res) => {
  const oldPassword = String(req.body?.old_password || "");
  const newPassword = String(req.body?.new_password || "");

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Kata sandi baru minimal 6 karakter",
    });
  }

  const { rows } = await db.query(
    `SELECT user_id, password_hash, must_change_password FROM users WHERE user_id = $1`,
    [req.user.user_id]
  );
  const user = rows[0];

  if (!user) {
    return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
  }

  if (user.password_hash) {
    const match = await bcrypt.compare(oldPassword, user.password_hash);
    if (!match) {
      return res.status(400).json({
        success: false,
        message: "Kata sandi lama salah",
      });
    }
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await db.query(
    `UPDATE users
        SET password_hash = $1,
            must_change_password = FALSE,
            updated_at = NOW()
      WHERE user_id = $2`,
    [newHash, req.user.user_id]
  );

  res.json({
    success: true,
    message: "Kata sandi berhasil diperbarui",
  });
});

// GET /api/auth/me  -> data user yang sedang login (untuk cek sesi di frontend)
router.get("/me", authenticate, (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

// POST /api/auth/logout
router.post("/logout", authenticate, (req, res) => {
  res.json({ success: true, message: "Logout berhasil" });
});

export default router;
