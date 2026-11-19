import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { api } from '../lib/api'

// Format "YYYY-MM-DD" ke "20 Nov 2026"
function formatTanggal(dateStr) {
  if (!dateStr) return '-'
  try {
    const raw = String(dateStr).slice(0, 10)
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${raw}T12:00:00Z`))
  } catch {
    return dateStr
  }
}

// Format rentang [mulai, selesai) -> "20 – 21 Nov 2026"
function formatRentang(start, end) {
  if (!start || !end) return '-'
  try {
    const fmt = (d) =>
      new Intl.DateTimeFormat('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      }).format(d)

    const s = new Date(start)
    const last = new Date(new Date(end).getTime() - 1)
    return fmt(s) === fmt(last) ? fmt(s) : `${fmt(s)} – ${fmt(last)}`
  } catch {
    return `${start} – ${end}`
  }
}

// Format waktu lengkap WIB
function formatDateTime(isoStr) {
  if (!isoStr) return '-'
  try {
    return (
      new Intl.DateTimeFormat('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta',
      }).format(new Date(isoStr)) + ' WIB'
    )
  } catch {
    return isoStr
  }
}

// Format waktu relatif (e.g. "5 menit lalu", "2 jam lalu", "Kemarin")
function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diffSec = Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / 1000)
  if (diffSec < 60) return 'Baru saja'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} menit yang lalu`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} jam yang lalu`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay === 1) return 'Kemarin'
  if (diffDay < 7) return `${diffDay} hari yang lalu`
  return formatTanggal(dateStr)
}

const STATUS_BADGE = {
  pending: {
    label: 'Menunggu Persetujuan',
    badgeClass: 'bg-[#FFF8E6] text-[#B76E00] border-[#FFE8B8]',
    dotClass: 'bg-[#B76E00]',
  },
  approved: {
    label: 'Disetujui (Siap Ambil di Lab)',
    badgeClass: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]',
    dotClass: 'bg-[#1D4ED8]',
  },
  borrowed: {
    label: 'Sedang Dipinjam',
    badgeClass: 'bg-[#EBF7EE] text-[#1E7E34] border-[#D4EDDA]',
    dotClass: 'bg-[#1E7E34]',
  },
  overdue: {
    label: 'Terlambat Dikembalikan',
    badgeClass: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
    dotClass: 'bg-[#DC2626]',
  },
  returned: {
    label: 'Selesai Dikembalikan',
    badgeClass: 'bg-[#F3F4F6] text-[#374151] border-[#E5E7EB]',
    dotClass: 'bg-[#6B7280]',
  },
  rejected: {
    label: 'Ditolak Kadep',
    badgeClass: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
    dotClass: 'bg-[#DC2626]',
  },
  cancelled: {
    label: 'Dibatalkan',
    badgeClass: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]',
    dotClass: 'bg-[#9CA3AF]',
  },
}

export default function StatusNotifikasiPage() {
  // Tab level atas: 'loans' (Status Peminjaman) atau 'notifications' (Notifikasi)
  const [mainTab, setMainTab] = useState('loans')

  // Sub-filter tab peminjaman
  const [subTab, setSubTab] = useState('all') // all | pending | approved | borrowed | returned | rejected
  const [search, setSearch] = useState('')

  // State data peminjaman
  const [loans, setLoans] = useState([])
  const [counts, setCounts] = useState({
    all: 0,
    pending: 0,
    approved: 0,
    borrowed: 0,
    returned: 0,
    rejected: 0,
  })
  const [loadingLoans, setLoadingLoans] = useState(true)

  // State data notifikasi
  const [notifications, setNotifications] = useState([])
  const [loadingNotifs, setLoadingNotifs] = useState(true)

  // State dialog & aksi
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' })
  const [selectedLoan, setSelectedLoan] = useState(null)
  const [cancelModal, setCancelModal] = useState({ open: false, item: null, loading: false })

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' })
    }, 4500)
  }

  // Ambil data peminjaman milik peminjam
  const fetchLoans = async () => {
    setLoadingLoans(true)
    try {
      const res = await api(`/loans/my-requests?tab=${subTab}&search=${encodeURIComponent(search)}`)
      if (res?.success) {
        setLoans(res.data || [])
        if (res.counts) setCounts(res.counts)
      }
    } catch (err) {
      showToast(err.message || 'Gagal memuat daftar peminjaman', 'error')
    } finally {
      setLoadingLoans(false)
    }
  }

  // Ambil data notifikasi milik peminjam
  const fetchNotifications = async () => {
    setLoadingNotifs(true)
    try {
      const res = await api('/loans/my-notifications')
      if (res?.success) {
        setNotifications(res.data || [])
      }
    } catch (err) {
      showToast(err.message || 'Gagal memuat notifikasi', 'error')
    } finally {
      setLoadingNotifs(false)
    }
  }

  useEffect(() => {
    fetchLoans()
  }, [subTab, search])

  useEffect(() => {
    if (mainTab === 'notifications') {
      fetchNotifications()
    }
  }, [mainTab])

  // Batalkan pengajuan peminjaman yang masih pending
  const handleCancelRequest = async () => {
    if (!cancelModal.item) return
    setCancelModal((prev) => ({ ...prev, loading: true }))
    try {
      await api(`/loans/my-requests/${cancelModal.item.request_id}/cancel`, { method: 'POST' })
      showToast('Pengajuan peminjaman berhasil dibatalkan', 'success')
      setCancelModal({ open: false, item: null, loading: false })
      fetchLoans()
      fetchNotifications()
    } catch (err) {
      showToast(err.message || 'Gagal membatalkan pengajuan', 'error')
      setCancelModal((prev) => ({ ...prev, loading: false }))
    }
  }

  // Hitung jumlah notifikasi belum dibaca / total
  const notifCount = notifications.length

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Notifikasi */}
      {toast.show && (
        <div
          className={`fixed right-6 top-6 z-50 flex items-center gap-3 rounded-[12px] px-4 py-3 text-[13.5px] font-medium shadow-lg transition-all ${
            toast.type === 'error'
              ? 'bg-red-600 text-white shadow-red-500/20'
              : 'bg-emerald-700 text-white shadow-emerald-700/20'
          }`}
        >
          <Icon name={toast.type === 'error' ? 'alert-circle' : 'check'} size={18} />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Halaman */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[26px] font-extrabold leading-[32px] tracking-[-0.01em] text-dark sm:text-[30px] sm:leading-[38px]">
            Status & Notifikasi
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Pantau status persetujuan barang yang diajukan, serah terima, dan riwayat pemberitahuan Anda.
          </p>
        </div>

        <button
          onClick={() => {
            fetchLoans()
            if (mainTab === 'notifications') fetchNotifications()
            showToast('Data berhasil diperbarui', 'success')
          }}
          className="inline-flex items-center gap-2 self-start rounded-[10px] border border-border-subtle bg-white px-3.5 py-2 text-[13px] font-semibold text-dark shadow-sm hover:bg-neutral-50 active:scale-[0.98] sm:self-auto"
        >
          <Icon name="refresh" size={15} />
          Segarkan
        </button>
      </div>

      {/* Navigasi Tab Utama */}
      <div className="flex border-b border-border-subtle">
        <button
          onClick={() => setMainTab('loans')}
          className={`flex items-center gap-2.5 border-b-2 px-5 py-3 text-[14px] font-semibold transition-colors ${
            mainTab === 'loans'
              ? 'border-[#1E3F70] text-[#1E3F70]'
              : 'border-transparent text-muted hover:text-dark'
          }`}
        >
          <Icon name="box" size={17} />
          <span>Status Peminjaman</span>
          {counts.all > 0 && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${
                mainTab === 'loans' ? 'bg-[#1E3F70]/10 text-[#1E3F70]' : 'bg-neutral-100 text-muted'
              }`}
            >
              {counts.all}
            </span>
          )}
        </button>

        <button
          onClick={() => setMainTab('notifications')}
          className={`flex items-center gap-2.5 border-b-2 px-5 py-3 text-[14px] font-semibold transition-colors ${
            mainTab === 'notifications'
              ? 'border-[#1E3F70] text-[#1E3F70]'
              : 'border-transparent text-muted hover:text-dark'
          }`}
        >
          <Icon name="bell" size={17} />
          <span>Notifikasi & Pengingat</span>
          {notifCount > 0 && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${
                mainTab === 'notifications' ? 'bg-[#1E3F70]/10 text-[#1E3F70]' : 'bg-neutral-100 text-muted'
              }`}
            >
              {notifCount}
            </span>
          )}
        </button>
      </div>

      {/* KONTEN TAB 1: STATUS PEMINJAMAN */}
      {mainTab === 'loans' && (
        <div className="flex flex-col gap-5">
          {/* Filter Sub-tab & Search Bar */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Pill Filters */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { key: 'all', label: 'Semua', count: counts.all },
                { key: 'pending', label: 'Menunggu', count: counts.pending },
                { key: 'approved', label: 'Disetujui', count: counts.approved },
                { key: 'borrowed', label: 'Sedang Dipinjam', count: counts.borrowed },
                { key: 'returned', label: 'Selesai', count: counts.returned },
                { key: 'rejected', label: 'Ditolak', count: counts.rejected },
              ].map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => setSubTab(pill.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${
                    subTab === pill.key
                      ? 'bg-[#1E3F70] text-white shadow-sm'
                      : 'bg-white text-muted border border-border-subtle hover:bg-neutral-50 hover:text-dark'
                  }`}
                >
                  <span>{pill.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[11px] font-bold ${
                      subTab === pill.key ? 'bg-white/20 text-white' : 'bg-neutral-100 text-muted'
                    }`}
                  >
                    {pill.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Pencarian */}
            <div className="relative w-full sm:w-72">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
                <Icon name="search" size={16} />
              </span>
              <input
                type="text"
                placeholder="Cari nama barang..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-[10px] border border-border-subtle bg-white py-1.5 pl-9 pr-3 text-[13px] text-dark placeholder:text-muted focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
              />
            </div>
          </div>

          {/* List Card Peminjaman */}
          {loadingLoans ? (
            <div className="flex min-h-[220px] items-center justify-center rounded-[14px] border border-border-subtle bg-white text-[14px] text-muted">
              <Icon name="refresh" size={18} className="mr-2 animate-spin text-[#1E3F70]" />
              Memuat data peminjaman...
            </div>
          ) : loans.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border-subtle bg-white px-6 py-16 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                <Icon name="box" size={26} />
              </div>
              <p className="text-[15px] font-bold text-dark">Belum ada pengajuan peminjaman</p>
              <p className="mt-1 max-w-sm text-[13px] text-muted">
                {subTab !== 'all' || search
                  ? 'Tidak ada pengajuan yang sesuai dengan filter atau kata kunci saat ini.'
                  : 'Anda belum pernah mengajukan peminjaman. Buka menu Katalog Barang untuk mulai meminjam.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {loans.map((loan) => {
                const badge = STATUS_BADGE[loan.current_status] || STATUS_BADGE.pending
                return (
                  <div
                    key={loan.request_id}
                    className="flex flex-col justify-between gap-4 rounded-[14px] border border-border-subtle bg-white p-5 shadow-sm transition hover:border-neutral-300 sm:flex-row sm:items-center"
                  >
                    <div className="flex flex-1 flex-col gap-2">
                      {/* Baris Nama & Status */}
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="text-[16px] font-bold text-dark">{loan.item_name}</h3>
                        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11.5px] font-medium text-neutral-600">
                          {loan.category_name}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${badge.badgeClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`} />
                          {badge.label}
                        </span>
                      </div>

                      {/* Detail Waktu & Keperluan */}
                      <div className="grid grid-cols-1 gap-1 text-[13px] text-muted sm:grid-cols-2 sm:gap-x-4">
                        <div className="flex items-center gap-1.5">
                          <Icon name="calendar" size={14} className="text-neutral-400" />
                          <span>
                            Jadwal:{' '}
                            <strong className="font-semibold text-dark">
                              {formatRentang(loan.planned_start_at, loan.planned_end_at)}
                            </strong>
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Icon name="clock" size={14} className="text-neutral-400" />
                          <span>
                            Diajukan pada: {formatDateTime(loan.submitted_at)}
                          </span>
                        </div>
                      </div>

                      {loan.purpose && (
                        <p className="mt-1 line-clamp-2 text-[13px] text-neutral-600">
                          <span className="font-medium text-dark">Keperluan:</span> {loan.purpose}
                        </p>
                      )}

                      {/* Kotak Catatan Kontekstual */}
                      {loan.current_status === 'approved' && (
                        <div className="mt-2 flex items-start gap-2.5 rounded-[10px] bg-[#EFF6FF] p-3 text-[12.5px] text-[#1E40AF]">
                          <Icon name="check-circle" size={17} className="mt-0.5 shrink-0 text-[#2563EB]" />
                          <div>
                            <p className="font-semibold">Siap diambil di Laboratorium!</p>
                            <p className="mt-0.5 leading-relaxed text-[#1E3A8A]">
                              Pengajuan telah disetujui oleh Ketua Departemen. Silakan temui Tendik untuk serah terima barang fisik.
                            </p>
                          </div>
                        </div>
                      )}

                      {loan.current_status === 'borrowed' && loan.due_at && (
                        <div className="mt-2 flex items-start gap-2.5 rounded-[10px] bg-[#EBF7EE] p-3 text-[12.5px] text-[#166534]">
                          <Icon name="clock" size={17} className="mt-0.5 shrink-0 text-[#16A34A]" />
                          <div>
                            <p className="font-semibold">Barang sedang dalam masa pinjam</p>
                            <p className="mt-0.5 leading-relaxed">
                              Batas pengembalian (jatuh tempo):{' '}
                              <strong>{formatDateTime(loan.due_at)}</strong>. Harap kembalikan tepat waktu untuk menjaga poin Anda.
                            </p>
                          </div>
                        </div>
                      )}

                      {loan.current_status === 'rejected' && loan.rejection_reason && (
                        <div className="mt-2 flex items-start gap-2.5 rounded-[10px] bg-red-50 p-3 text-[12.5px] text-red-800">
                          <Icon name="alert-circle" size={17} className="mt-0.5 shrink-0 text-red-600" />
                          <div>
                            <p className="font-semibold">Alasan Penolakan dari Ketua Departemen:</p>
                            <p className="mt-0.5 leading-relaxed text-red-700">{loan.rejection_reason}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Tombol Aksi */}
                    <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                      <button
                        onClick={() => setSelectedLoan(loan)}
                        className="inline-flex items-center gap-1.5 rounded-[10px] border border-border-subtle bg-white px-3.5 py-2 text-[12.5px] font-semibold text-dark shadow-sm hover:bg-neutral-50 active:scale-[0.98]"
                      >
                        Detail Alur
                      </button>

                      {loan.current_status === 'pending' && (
                        <button
                          onClick={() => setCancelModal({ open: true, item: loan, loading: false })}
                          className="inline-flex items-center gap-1 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700 hover:bg-red-100"
                        >
                          <Icon name="trash" size={14} />
                          Batalkan
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* KONTEN TAB 2: NOTIFIKASI & PENGINGAT */}
      {mainTab === 'notifications' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-[12px] bg-[#F6F7F5] p-4 text-[13px] text-muted">
            Semua riwayat pembaruan status pengajuan, instruksi serah terima, serta email pengingat jatuh tempo H-1 dicatat di sini.
          </div>

          {loadingNotifs ? (
            <div className="flex min-h-[200px] items-center justify-center rounded-[14px] border border-border-subtle bg-white text-[14px] text-muted">
              <Icon name="refresh" size={18} className="mr-2 animate-spin text-[#1E3F70]" />
              Memuat notifikasi...
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border-subtle bg-white px-6 py-16 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                <Icon name="bell" size={26} />
              </div>
              <p className="text-[15px] font-bold text-dark">Belum ada notifikasi</p>
              <p className="mt-1 max-w-sm text-[13px] text-muted">
                Pemberitahuan terkait persetujuan, serah terima, dan pengingat jatuh tempo akan tampil otomatis di sini.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {notifications.map((n) => {
                const isSuccess = n.severity === 'success'
                const isError = n.severity === 'error'
                const isWarning = n.severity === 'warning'

                const bgClass = isError
                  ? 'border-red-200 bg-red-50/40'
                  : isWarning
                  ? 'border-amber-200 bg-amber-50/40'
                  : isSuccess
                  ? 'border-emerald-200 bg-emerald-50/30'
                  : 'border-border-subtle bg-white'

                const iconName = isError
                  ? 'x-circle'
                  : isWarning
                  ? 'clock'
                  : isSuccess
                  ? 'check-circle'
                  : 'bell'

                const iconColor = isError
                  ? 'text-red-600'
                  : isWarning
                  ? 'text-amber-600'
                  : isSuccess
                  ? 'text-emerald-600'
                  : 'text-[#1E3F70]'

                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-4 rounded-[14px] border p-4.5 shadow-sm transition hover:shadow-md ${bgClass}`}
                  >
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ${iconColor}`}>
                      <Icon name={iconName} size={19} />
                    </div>

                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-[14.5px] font-bold text-dark">{n.title}</h4>
                        <span className="text-[11.5px] font-medium text-muted">
                          {timeAgo(n.date)}
                        </span>
                      </div>
                      <p className="text-[13px] leading-relaxed text-neutral-700">{n.message}</p>
                      <p className="mt-1 text-[11.5px] text-neutral-400">{formatDateTime(n.date)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL DETAIL ALUR PEMINJAMAN */}
      {selectedLoan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[16px] bg-white shadow-xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
              <div>
                <h3 className="text-[16px] font-bold text-dark">Rincian Alur Peminjaman</h3>
                <p className="text-[12.5px] text-muted">ID Pengajuan #{selectedLoan.request_id}</p>
              </div>
              <button
                onClick={() => setSelectedLoan(null)}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-dark"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Info Barang */}
              <div className="mb-5 rounded-[12px] bg-[#F6F7F5] p-4 text-[13px]">
                <div className="flex justify-between py-1 border-b border-neutral-200/60">
                  <span className="text-muted">Barang:</span>
                  <span className="font-bold text-dark">{selectedLoan.item_name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-neutral-200/60">
                  <span className="text-muted">Kategori:</span>
                  <span className="font-semibold text-dark">{selectedLoan.category_name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-neutral-200/60">
                  <span className="text-muted">Jadwal Rencana:</span>
                  <span className="font-semibold text-dark">
                    {formatRentang(selectedLoan.planned_start_at, selectedLoan.planned_end_at)}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted">Keperluan:</span>
                  <span className="font-medium text-dark">{selectedLoan.purpose || '-'}</span>
                </div>
              </div>

              {/* Timeline Alur */}
              <h4 className="mb-3 text-[13.5px] font-bold text-dark">Tahapan Proses:</h4>
              <div className="relative flex flex-col gap-4 border-l-2 border-neutral-200 pl-4 ml-2">
                {/* Step 1: Diajukan */}
                <div className="relative">
                  <span className="absolute -left-[23px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-600" />
                  <p className="text-[13px] font-bold text-dark">1. Pengajuan Diajukan</p>
                  <p className="text-[12px] text-muted">{formatDateTime(selectedLoan.submitted_at)}</p>
                </div>

                {/* Step 2: Keputusan Kadep */}
                <div className="relative">
                  <span
                    className={`absolute -left-[23px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${
                      selectedLoan.decision === 'approved'
                        ? 'bg-emerald-600'
                        : selectedLoan.decision === 'rejected'
                        ? 'bg-red-600'
                        : 'bg-neutral-300'
                    }`}
                  />
                  <p className="text-[13px] font-bold text-dark">2. Persetujuan Ketua Departemen</p>
                  {selectedLoan.decision === 'approved' ? (
                    <div>
                      <p className="text-[12px] font-medium text-emerald-700">
                        Disetujui oleh {selectedLoan.approver_name || 'Ketua Departemen'}
                      </p>
                      <p className="text-[11.5px] text-muted">{formatDateTime(selectedLoan.decided_at)}</p>
                    </div>
                  ) : selectedLoan.decision === 'rejected' ? (
                    <div>
                      <p className="text-[12px] font-medium text-red-600">
                        Ditolak: {selectedLoan.rejection_reason}
                      </p>
                      <p className="text-[11.5px] text-muted">{formatDateTime(selectedLoan.decided_at)}</p>
                    </div>
                  ) : (
                    <p className="text-[12px] text-amber-700">Sedang menunggu evaluasi Kadep</p>
                  )}
                </div>

                {/* Step 3: Serah Terima Tendik */}
                <div className="relative">
                  <span
                    className={`absolute -left-[23px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${
                      selectedLoan.loan_id ? 'bg-emerald-600' : 'bg-neutral-300'
                    }`}
                  />
                  <p className="text-[13px] font-bold text-dark">3. Serah Terima Barang Fisik</p>
                  {selectedLoan.loan_id ? (
                    <div>
                      <p className="text-[12px] font-medium text-emerald-700">
                        Diserahkan oleh {selectedLoan.handover_by_name || 'Tendik Lab'}
                      </p>
                      <p className="text-[11.5px] text-muted">{formatDateTime(selectedLoan.handover_at)}</p>
                      <p className="mt-1 text-[12px] text-dark">
                        Batas jatuh tempo: <strong>{formatDateTime(selectedLoan.due_at)}</strong>
                      </p>
                    </div>
                  ) : selectedLoan.decision === 'approved' ? (
                    <p className="text-[12px] text-blue-700">
                      Menunggu serah terima barang di laboratorium oleh Tendik
                    </p>
                  ) : (
                    <p className="text-[12px] text-neutral-400">Belum diserahterimakan</p>
                  )}
                </div>

                {/* Step 4: Pengembalian */}
                <div className="relative">
                  <span
                    className={`absolute -left-[23px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${
                      selectedLoan.transaction_status === 'returned' ? 'bg-emerald-600' : 'bg-neutral-300'
                    }`}
                  />
                  <p className="text-[13px] font-bold text-dark">4. Pengembalian & Pemeriksaan</p>
                  {selectedLoan.transaction_status === 'returned' ? (
                    <div>
                      <p className="text-[12px] font-medium text-emerald-700">
                        Diterima oleh {selectedLoan.return_confirmed_by_name || 'Tendik Lab'}
                      </p>
                      <p className="text-[11.5px] text-muted">{formatDateTime(selectedLoan.returned_at)}</p>
                      <p className="mt-0.5 text-[12px] text-dark">
                        Kondisi: <strong>{selectedLoan.return_condition}</strong>
                        {selectedLoan.late_days > 0 && ` (Terlambat ${selectedLoan.late_days} hari)`}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[12px] text-neutral-400">Belum dikembalikan</p>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-border-subtle bg-neutral-50 px-6 py-3 text-right">
              <button
                onClick={() => setSelectedLoan(null)}
                className="rounded-[10px] bg-white border border-border-subtle px-4 py-2 text-[13px] font-semibold text-dark hover:bg-neutral-100"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI PEMBATALAN */}
      {cancelModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-xl">
            <h3 className="text-[17px] font-bold text-dark">Batalkan Pengajuan?</h3>
            <p className="mt-2 text-[13.5px] text-muted">
              Apakah Anda yakin ingin membatalkan pengajuan peminjaman untuk barang{' '}
              <strong className="text-dark">"{cancelModal.item?.item_name}"</strong>?
            </p>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setCancelModal({ open: false, item: null, loading: false })}
                disabled={cancelModal.loading}
                className="rounded-[10px] border border-border-subtle px-4 py-2 text-[13px] font-semibold text-dark hover:bg-neutral-50"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={handleCancelRequest}
                disabled={cancelModal.loading}
                className="rounded-[10px] bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelModal.loading ? 'Membatalkan...' : 'Ya, Batalkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
