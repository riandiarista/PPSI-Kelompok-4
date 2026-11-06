import { ROLES } from './auth/authContext'

// Menu sidebar per role. Rute halaman dibuat otomatis dari daftar ini (lihat App.jsx).
// Item pertama tiap role = halaman yang dibuka setelah login.
export const MENUS = {
  [ROLES.PEMINJAM]: [
    { path: '/peminjam/katalog', label: 'Katalog barang', icon: 'grid' },
    { path: '/peminjam/status', label: 'Status & notifikasi', icon: 'check' },
    { path: '/peminjam/poin', label: 'Poin & reward', icon: 'award' },
  ],
  [ROLES.TENDIK]: [
    { path: '/tendik/serah-terima', label: 'Serah terima', icon: 'swap' },
    { path: '/tendik/pengembalian', label: 'Pengembalian', icon: 'clock' },
    { path: '/tendik/inventaris', label: 'Kelola inventaris', icon: 'box' },
    { path: '/tendik/akun', label: 'Kelola akun', icon: 'user' },
    { path: '/tendik/laporan', label: 'Riwayat & laporan', icon: 'chart' },
  ],
  [ROLES.KADEP]: [
    { path: '/kadep/antrean', label: 'Antrean persetujuan', icon: 'check' },
    { path: '/kadep/laporan', label: 'Riwayat & laporan', icon: 'chart' },
    { path: '/kadep/aturan-poin', label: 'Aturan poin & reward', icon: 'award' },
  ],
}

export function homeFor(role) {
  return MENUS[role]?.[0]?.path ?? '/login'
}
