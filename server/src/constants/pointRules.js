// Nilai BAWAAN aturan poin & ambang level.
// Nilai yang berlaku disimpan di tabel point_settings dan dapat diubah Kadep
// (lihat services/pointSettingsService.js). Konstanta ini dipakai sebagai nilai awal
// migrasi 011 dan sebagai cadangan bila tabel belum ada / baris hilang.

export const DEFAULT_POINT_RULES = Object.freeze({
  ON_TIME_GOOD:         +10,  // Tepat waktu, kondisi baik
  ON_TIME_MINOR_DAMAGE: +2,   // Kerusakan ringan
  ON_TIME_MAJOR_DAMAGE: -5,   // Kerusakan besar / hilang
  LATE_PER_DAY:         -2,   // Per hari keterlambatan
  MAJOR_DAMAGE_PENALTY: -20,  // Tambahan hukuman kerusakan besar / hilang
});

// Urut dari level tertinggi ke terendah. "beginner" selalu mulai dari 0.
export const DEFAULT_DISCIPLINE_LEVELS = Object.freeze([
  Object.freeze({ name: "teladan",    min: 70 }),
  Object.freeze({ name: "terpercaya", min: 50 }),
  Object.freeze({ name: "pemula",     min: 30 }),
  Object.freeze({ name: "beginner",   min: 0  }),
]);

// Tampilan tiap level (tidak dapat diubah dari aplikasi)
export const LEVEL_DISPLAY = Object.freeze({
  teladan:    { label: "Teladan",      color: "#B7791F", badge: "🥇", description: "Kedisiplinan tinggi, selalu tepat waktu dan merawat barang." },
  terpercaya: { label: "Terpercaya",   color: "#64748B", badge: "🥈", description: "Memiliki catatan peminjaman yang baik dan konsisten." },
  pemula:     { label: "Pemula",       color: "#9A3412", badge: "🥉", description: "Mulai membangun rekam jejak kedisiplinan peminjaman." },
  beginner:   { label: "Belum Pemula", color: "#4A5B56", badge: "🌱", description: "Akun peminjam baru atau poin masih di bawah level Pemula." },
});
