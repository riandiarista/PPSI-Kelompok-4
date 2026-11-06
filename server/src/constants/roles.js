// Nama role harus sama persis dengan isi tabel roles (lihat migrations/006_seed_roles.sql).
export const ROLES = Object.freeze({
  PEMINJAM: "Peminjam",
  TENDIK: "Tendik",
  KADEP: "Kadep",
});

const { PEMINJAM, TENDIK, KADEP } = ROLES;
const SEMUA = [PEMINJAM, TENDIK, KADEP];

// Matriks hak akses: siapa boleh melakukan apa.
// Ubah di sini saja kalau aturan kelompok berubah; route cukup memanggil
// authorize(...ACCESS.namaAksi).
export const ACCESS = Object.freeze({
  // Barang & kategori
  lihatBarang: SEMUA,
  kelolaBarang: [TENDIK],
  kelolaKategori: [TENDIK],

  // Peminjaman
  ajukanPeminjaman: [PEMINJAM],
  lihatSemuaPengajuan: [TENDIK, KADEP],
  approvalPeminjaman: [KADEP],
  serahTerimaBarang: [TENDIK],
  cekPengembalian: [TENDIK],

  // Akun pengguna (#20)
  kelolaAkun: [KADEP],

  // Laporan & audit
  lihatLaporan: [TENDIK, KADEP],
  lihatAuditLog: [KADEP],
});
