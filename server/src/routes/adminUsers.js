import { Router } from "express";
import bcrypt from "bcryptjs";
import db from "../config/db.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";
import { ACCESS } from "../constants/roles.js";

const router = Router();

// Semua endpoint admin pengguna hanya dapat diakses oleh role Tendik (kelolaAkun)
router.use(authenticate, authorize(...ACCESS.kelolaAkun));

// GET /api/admin/roles -> Daftar role yang tersedia dari database
router.get("/roles", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT role_id, role_name FROM roles ORDER BY role_id ASC");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Gagal mengambil daftar role: " + err.message });
  }
});

// GET /api/admin/users -> Daftar pengguna dengan fitur pencarian dan filter
router.get("/users", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const roleFilter = String(req.query.role || "").trim();
    const statusFilter = String(req.query.status || "").trim();
    const providerFilter = String(req.query.provider || "").trim();
    const activeFilter = req.query.is_active;

    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }

    if (roleFilter && roleFilter !== "all") {
      params.push(roleFilter);
      conditions.push(`r.role_name = $${params.length}`);
    }

    if (statusFilter && statusFilter !== "all") {
      params.push(statusFilter);
      conditions.push(`u.registration_status = $${params.length}`);
    }

    if (providerFilter && providerFilter !== "all") {
      params.push(providerFilter);
      conditions.push(`u.auth_provider = $${params.length}`);
    }

    if (activeFilter !== undefined && activeFilter !== "" && activeFilter !== "all") {
      params.push(activeFilter === "true");
      conditions.push(`u.is_active = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.role_id,
        r.role_name AS role,
        u.is_active,
        u.registration_status,
        u.auth_provider,
        u.google_id,
        u.avatar_url,
        u.email_verified,
        u.must_change_password,
        u.created_at,
        u.updated_at,
        u.approved_at,
        u.approved_by,
        appr.full_name AS approved_by_name,
        u.rejected_at,
        u.rejected_by,
        rej.full_name AS rejected_by_name,
        u.rejection_reason
      FROM users u
      JOIN roles r ON r.role_id = u.role_id
      LEFT JOIN users appr ON appr.user_id = u.approved_by
      LEFT JOIN users rej ON rej.user_id = u.rejected_by
      ${whereClause}
      ORDER BY
        CASE WHEN u.registration_status = 'pending' THEN 0 ELSE 1 END,
        u.created_at DESC
    `;

    const { rows } = await db.query(query, params);

    // Ambil statistik ringkas untuk tab filter
    const { rows: statsRows } = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE registration_status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE registration_status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE registration_status = 'rejected') AS rejected
      FROM users
    `);

    res.json({
      success: true,
      data: rows,
      stats: {
        total: Number(statsRows[0]?.total || 0),
        pending: Number(statsRows[0]?.pending || 0),
        approved: Number(statsRows[0]?.approved || 0),
        rejected: Number(statsRows[0]?.rejected || 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Gagal mengambil daftar pengguna: " + err.message });
  }
});

// GET /api/admin/users/:id -> Detail pengguna
router.get("/users/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: "ID pengguna tidak valid" });
    }

    const { rows } = await db.query(
      `SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.role_id,
        r.role_name AS role,
        u.is_active,
        u.registration_status,
        u.auth_provider,
        u.google_id,
        u.avatar_url,
        u.email_verified,
        u.must_change_password,
        u.created_at,
        u.updated_at,
        u.approved_at,
        u.approved_by,
        appr.full_name AS approved_by_name,
        u.rejected_at,
        u.rejected_by,
        rej.full_name AS rejected_by_name,
        u.rejection_reason
      FROM users u
      JOIN roles r ON r.role_id = u.role_id
      LEFT JOIN users appr ON appr.user_id = u.approved_by
      LEFT JOIN users rej ON rej.user_id = u.rejected_by
      WHERE u.user_id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Gagal mengambil detail pengguna: " + err.message });
  }
});

// POST /api/admin/users -> Pembuatan akun pengguna secara langsung oleh Tendik
router.post("/users", async (req, res) => {
  try {
    const fullName = String(req.body?.full_name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const roleName = String(req.body?.role || "").trim();
    const mustChangePassword = Boolean(req.body?.must_change_password);

    // Validasi field wajib
    if (!fullName || fullName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Nama lengkap wajib diisi minimal 2 karakter",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Format email tidak valid",
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Kata sandi wajib diisi minimal 6 karakter",
      });
    }

    if (!roleName) {
      return res.status(400).json({
        success: false,
        message: "Role pengguna wajib dipilih",
      });
    }

    // Periksa apakah role terdaftar di database
    const { rows: roleRows } = await db.query(
      "SELECT role_id, role_name FROM roles WHERE role_name = $1",
      [roleName]
    );

    if (roleRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Role "${roleName}" tidak terdaftar di sistem`,
      });
    }

    const roleId = roleRows[0].role_id;

    // Periksa keunikan email
    const { rows: existingUser } = await db.query(
      "SELECT user_id FROM users WHERE LOWER(email) = $1",
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email sudah terdaftar untuk akun lain",
      });
    }

    // Hash kata sandi menggunakan bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    // Akun yang dibuat Tendik otomatis berstatus aktif dan approved
    const { rows: createdRows } = await db.query(
      `INSERT INTO users (
        role_id, full_name, email, password_hash, is_active,
        registration_status, auth_provider, email_verified,
        approved_at, approved_by, must_change_password
      ) VALUES (
        $1, $2, $3, $4, TRUE,
        'approved', 'local', TRUE,
        NOW(), $5, $6
      )
      RETURNING
        user_id, full_name, email, role_id, is_active,
        registration_status, auth_provider, email_verified,
        must_change_password, created_at`,
      [roleId, fullName, email, passwordHash, req.user.user_id, mustChangePassword]
    );

    const newUser = createdRows[0];
    newUser.role = roleName;

    // Inisialisasi gamifikasi jika role Peminjam
    if (roleName === "Peminjam") {
      await db.query(
        "INSERT INTO user_gamifications (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [newUser.user_id]
      );
    }

    // Catat ke audit log
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'create_user', 'user', $2, $3)`,
      [
        req.user.user_id,
        newUser.user_id,
        JSON.stringify({
          created_email: newUser.email,
          role: roleName,
          created_by: req.user.full_name,
        }),
      ]
    );

    res.status(201).json({
      success: true,
      message: "Akun pengguna berhasil dibuat",
      data: newUser,
    });
  } catch (err) {
    console.error("Gagal membuat akun pengguna:", err);
    res.status(500).json({ success: false, message: "Gagal membuat akun: " + err.message });
  }
});

// POST /api/admin/users/:id/accept -> Menyetujui pendaftaran mandiri (Pending -> Approved)
// Mendukung juga rute alternatif PUT /api/admin/users/:id/approve
const handleApprove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: "ID pengguna tidak valid" });
    }

    const { rows: userRows } = await db.query(
      `SELECT u.user_id, u.full_name, u.email, u.registration_status, r.role_name AS role
         FROM users u
         JOIN roles r ON r.role_id = u.role_id
        WHERE u.user_id = $1`,
      [id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
    }

    const targetUser = userRows[0];

    // Backend memvalidasi bahwa akun masih berstatus Pending
    if (targetUser.registration_status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Hanya akun berstatus "Menunggu Persetujuan" yang dapat disetujui. Status saat ini: ${targetUser.registration_status}`,
      });
    }

    const { rows: updatedRows } = await db.query(
      `UPDATE users
          SET registration_status = 'approved',
              approved_at = NOW(),
              approved_by = $1,
              rejected_at = NULL,
              rejected_by = NULL,
              rejection_reason = NULL,
              updated_at = NOW()
        WHERE user_id = $2
        RETURNING *`,
      [req.user.user_id, id]
    );

    // Pastikan gamifikasi sudah terinisialisasi
    await db.query(
      "INSERT INTO user_gamifications (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [id]
    );

    // Catat ke audit log
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'approve_user_registration', 'user', $2, $3)`,
      [
        req.user.user_id,
        id,
        JSON.stringify({
          user_email: targetUser.email,
          approved_by_email: req.user.email,
        }),
      ]
    );

    res.json({
      success: true,
      message: `Pendaftaran ${targetUser.full_name} berhasil disetujui. Pengguna kini dapat mengakses aplikasi.`,
      data: updatedRows[0],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Gagal menyetujui akun: " + err.message });
  }
};

router.post("/users/:id/accept", handleApprove);
router.put("/users/:id/approve", handleApprove);

// POST /api/admin/users/:id/decline -> Menolak pendaftaran mandiri (Pending -> Rejected)
// Mendukung juga rute alternatif PUT /api/admin/users/:id/reject
const handleDecline = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: "ID pengguna tidak valid" });
    }

    const reason = String(req.body?.reason || "").trim();

    const { rows: userRows } = await db.query(
      `SELECT u.user_id, u.full_name, u.email, u.registration_status
         FROM users u
        WHERE u.user_id = $1`,
      [id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
    }

    const targetUser = userRows[0];

    // Backend memvalidasi bahwa akun masih berstatus Pending
    if (targetUser.registration_status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Hanya akun berstatus "Menunggu Persetujuan" yang dapat ditolak. Status saat ini: ${targetUser.registration_status}`,
      });
    }

    const { rows: updatedRows } = await db.query(
      `UPDATE users
          SET registration_status = 'rejected',
              rejected_at = NOW(),
              rejected_by = $1,
              rejection_reason = $2,
              updated_at = NOW()
        WHERE user_id = $3
        RETURNING *`,
      [req.user.user_id, reason || null, id]
    );

    // Catat ke audit log
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'reject_user_registration', 'user', $2, $3)`,
      [
        req.user.user_id,
        id,
        JSON.stringify({
          user_email: targetUser.email,
          rejected_by_email: req.user.email,
          reason: reason || null,
        }),
      ]
    );

    res.json({
      success: true,
      message: `Pendaftaran ${targetUser.full_name} telah ditolak.`,
      data: updatedRows[0],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Gagal menolak akun: " + err.message });
  }
};

router.post("/users/:id/decline", handleDecline);
router.put("/users/:id/reject", handleDecline);

// PATCH /api/admin/users/:id/status -> Toggle status aktif / nonaktif akun
router.patch("/users/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: "ID pengguna tidak valid" });
    }

    if (id === req.user.user_id) {
      return res.status(400).json({
        success: false,
        message: "Anda tidak dapat mengubah status keaktifan akun Anda sendiri",
      });
    }

    const isActive = Boolean(req.body?.is_active);

    const { rows } = await db.query(
      `UPDATE users
          SET is_active = $1,
              updated_at = NOW()
        WHERE user_id = $2
        RETURNING user_id, full_name, email, is_active`,
      [isActive, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
    }

    // Catat ke audit log
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, details)
       VALUES ($1, 'toggle_user_active', 'user', $2, $3)`,
      [
        req.user.user_id,
        id,
        JSON.stringify({
          is_active: isActive,
          user_email: rows[0].email,
        }),
      ]
    );

    res.json({
      success: true,
      message: `Status akun ${rows[0].full_name} berhasil ${isActive ? "diaktifkan" : "dinonaktifkan"}`,
      data: rows[0],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Gagal mengubah status akun: " + err.message });
  }
});

export default router;

