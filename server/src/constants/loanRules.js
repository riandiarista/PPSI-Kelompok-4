// Aturan pengajuan peminjaman. Ubah angka di sini kalau kebijakan departemen berbeda.
export const LOAN_RULES = Object.freeze({
  // Lama peminjaman maksimal dalam satu pengajuan (hari)
  MAX_DURATION_DAYS: 7,
  // Seberapa jauh ke depan barang boleh dipesan (hari dari hari ini)
  MAX_ADVANCE_DAYS: 30,
  // Panjang maksimal isian keperluan
  MAX_PURPOSE_LENGTH: 500,
});

// Semua tanggal peminjaman dihitung dalam WIB (UTC+7, tanpa daylight saving)
export const WIB_OFFSET = "+07:00";
