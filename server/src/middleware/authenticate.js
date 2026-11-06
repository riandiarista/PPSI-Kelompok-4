import jwt from "jsonwebtoken";
import db from "../config/db.js";
import { JWT_SECRET } from "../config/jwt.js";

/**
 * Memastikan request membawa token JWT yang valid
 * (header: Authorization: Bearer <token>).
 *
 * Kalau valid, mengisi req.user = { user_id, role, full_name, email }.
 * Data user diambil ulang dari database setiap request, jadi akun yang
 * dinonaktifkan atau diganti role-nya (#20) langsung berlaku tanpa
 * menunggu token kedaluwarsa.
 */
export async function authenticate(req, res, next) {
  const header = req.get("Authorization") || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      success: false,
      message: "Silakan login terlebih dahulu",
    });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    return res.status(401).json({
      success: false,
      message: expired ? "Sesi berakhir, silakan login kembali" : "Token tidak valid",
    });
  }

  const { rows } = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.is_active, r.role_name AS role
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = $1`,
    [payload.user_id]
  );
  const user = rows[0];

  if (!user || !user.is_active) {
    return res.status(401).json({
      success: false,
      message: "Akun tidak ditemukan atau sudah dinonaktifkan",
    });
  }

  req.user = {
    user_id: user.user_id,
    role: user.role,
    full_name: user.full_name,
    email: user.email,
  };
  next();
}
