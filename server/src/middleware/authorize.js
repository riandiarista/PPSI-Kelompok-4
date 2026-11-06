import { ROLES } from "../constants/roles.js";

const VALID_ROLES = new Set(Object.values(ROLES));

/**
 * Membatasi route hanya untuk role tertentu.
 *
 * Harus dipasang SETELAH middleware authenticate (#18), yang mengisi
 * req.user = { user_id, role } dari token JWT.
 *
 * Contoh:
 *   router.post("/items", authenticate, authorize(...ACCESS.kelolaBarang), handler);
 *   router.get("/reports", authenticate, authorize(ROLES.TENDIK, ROLES.KADEP), handler);
 */
export function authorize(...allowedRoles) {
  const allowed = allowedRoles.flat();

  // Tangkap salah ketik nama role saat server start, bukan saat request.
  if (allowed.length === 0) {
    throw new Error("authorize() butuh minimal satu role");
  }
  for (const role of allowed) {
    if (!VALID_ROLES.has(role)) {
      throw new Error(`Role tidak dikenal di authorize(): "${role}"`);
    }
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Silakan login terlebih dahulu",
      });
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Anda tidak memiliki akses ke fitur ini",
      });
    }

    next();
  };
}
