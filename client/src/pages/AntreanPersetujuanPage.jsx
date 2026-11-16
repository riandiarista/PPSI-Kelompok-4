import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { api } from '../lib/api'

// Format "YYYY-MM-DD" hari ini dalam WIB
function todayWib() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
}

// Format tanggal "2026-11-20" -> "20 Nov 2026"
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

// Format waktu lengkap
function formatDateTime(isoStr) {
  if (!isoStr) return '-'
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    }).format(new Date(isoStr)) + ' WIB'
  } catch {
    return isoStr
  }
}

export default function AntreanPersetujuanPage() {
  // State data utama
  const [items, setItems] = useState([])
  const [counts, setCounts] = useState({ ready: 0, scheduled: 0, history: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // State navigasi tab ('queue' | 'scheduled' | 'history')
  const [activeTab, setActiveTab] = useState('queue')
  const [search, setSearch] = useState('')
  const [filterOverlap, setFilterOverlap] = useState('all') // 'all' | 'has_overlap'

  // Toast notifikasi
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' })

  // State Modals
  const [detailItem, setDetailItem] = useState(null)
  const [approveModal, setApproveModal] = useState({ open: false, item: null, loading: false })
  const [rejectModal, setRejectModal] = useState({
    open: false,
    item: null,
    reason: '',
    loading: false,
    validationError: '',
  })
  const [conflictModal, setConflictModal] = useState({ open: false, conflicts: [], message: '' })

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' })
    }, 4500)
  }

  const changeTab = (tab) => {
    if (tab === activeTab) return
    setActiveTab(tab)
    setLoading(true)
  }

  const refreshData = () => {
    setLoading(true)
    setRefreshKey((k) => k + 1)
  }

  // Fetch antrean dari server
  useEffect(() => {
    let cancelled = false

    api(`/loans/queue?tab=${activeTab}`)
      .then((res) => {
        if (cancelled) return
        setItems(res.data || [])
        if (res.counts) {
          setCounts(res.counts)
        }
        setError('')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Gagal memuat antrean persetujuan')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeTab, refreshKey])

  // Filter pencarian dan overlap
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = search.trim().toLowerCase()
      const matchSearch =
        !q ||
        item.item_name?.toLowerCase().includes(q) ||
        item.borrower_name?.toLowerCase().includes(q) ||
        item.borrower_email?.toLowerCase().includes(q) ||
        item.category_name?.toLowerCase().includes(q) ||
        item.purpose?.toLowerCase().includes(q)

      if (!matchSearch) return false

      if (filterOverlap === 'has_overlap') {
        return (item.pending_overlaps > 0 || item.approved_overlaps > 0)
      }
      return true
    })
  }, [items, search, filterOverlap])

  // Handler Persetujuan (Approve)
  const handleApprove = async () => {
    const item = approveModal.item
    if (!item) return

    setApproveModal((prev) => ({ ...prev, loading: true }))
    try {
      await api(`/loans/${item.request_id}/approve`, {
        method: 'POST',
      })
      setApproveModal({ open: false, item: null, loading: false })
      showToast(`Pengajuan untuk "${item.item_name}" berhasil disetujui!`, 'success')
      refreshData()
    } catch (err) {
      setApproveModal((prev) => ({ ...prev, loading: false }))
      if (err.status === 409) {
        // Bentrok jadwal (misal 23P01) atau pengajuan expired / sudah diputuskan
        if (err.conflicts && err.conflicts.length > 0) {
          setConflictModal({
            open: true,
            conflicts: err.conflicts,
            message: err.message || 'Jadwal bentrok dengan pengajuan lain yang sudah disetujui.',
          })
          setApproveModal({ open: false, item: null, loading: false })
        } else {
          showToast(err.message || 'Pengajuan gagal disetujui.', 'error')
        }
      } else {
        showToast(err.message || 'Terjadi kesalahan pada server', 'error')
      }
    }
  }

  // Handler Penolakan (Reject)
  const handleReject = async () => {
    const item = rejectModal.item
    if (!item) return

    const trimmedReason = String(rejectModal.reason || '').trim()
    if (!trimmedReason) {
      setRejectModal((prev) => ({
        ...prev,
        validationError: 'Alasan penolakan wajib diisi dan tidak boleh hanya spasi.',
      }))
      return
    }
    if (trimmedReason.length > 500) {
      setRejectModal((prev) => ({
        ...prev,
        validationError: 'Alasan penolakan maksimal 500 karakter.',
      }))
      return
    }

    setRejectModal((prev) => ({ ...prev, loading: true, validationError: '' }))
    try {
      await api(`/loans/${item.request_id}/reject`, {
        method: 'POST',
        body: { reason: trimmedReason },
      })
      setRejectModal({ open: false, item: null, reason: '', loading: false, validationError: '' })
      showToast(`Pengajuan untuk "${item.item_name}" berhasil ditolak.`, 'info')
      refreshData()
    } catch (err) {
      setRejectModal((prev) => ({ ...prev, loading: false }))
      showToast(err.message || 'Gagal menolak pengajuan', 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast.show && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-[12px] px-4 py-3 text-[13.5px] font-medium shadow-lg transition-all ${
            toast.type === 'success'
              ? 'bg-[#14532D] text-white'
              : toast.type === 'info'
              ? 'bg-[#1E3F70] text-white'
              : 'bg-[#B91C1C] text-white'
          }`}
        >
          <Icon
            name={toast.type === 'success' ? 'check' : toast.type === 'info' ? 'alert-circle' : 'x-circle'}
            size={18}
          />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Halaman */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#14231F]">
            Antrean Persetujuan Peminjaman
          </h1>
          <p className="mt-1 text-[13px] text-[#4A5B56]">
            Keputusan persetujuan dan penolakan peminjaman barang inventaris oleh Ketua Departemen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4A5B56] border border-neutral-200 shadow-xs">
            <Icon name="calendar" size={14} className="text-[#1E3F70]" />
            Hari ini: {formatTanggal(todayWib())} (WIB)
          </span>
          <button
            type="button"
            onClick={refreshData}
            title="Muat ulang data"
            className="flex items-center gap-1.5 rounded-[8px] border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#14231F] shadow-xs transition hover:bg-neutral-50"
          >
            <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
            Segarkan
          </button>
        </div>
      </div>

      {/* Ringkasan Statistik Kartu */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div
          onClick={() => changeTab('queue')}
          className={`cursor-pointer rounded-[14px] border p-4 transition shadow-xs ${
            activeTab === 'queue'
              ? 'border-[#1E3F70] bg-[#F4F7FC]'
              : 'border-neutral-200/80 bg-white hover:border-neutral-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-[#4A5B56]">Perlu Ditinjau Hari Ini</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Icon name="clock" size={15} />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[24px] font-bold text-[#14231F]">{counts.ready}</span>
            <span className="text-[12px] text-[#4A5B56]">pengajuan</span>
          </div>
          <p className="mt-1 text-[11.5px] text-[#71827D]">
            Review queue date ≤ hari ini (WIB)
          </p>
        </div>

        <div
          onClick={() => changeTab('scheduled')}
          className={`cursor-pointer rounded-[14px] border p-4 transition shadow-xs ${
            activeTab === 'scheduled'
              ? 'border-[#1E3F70] bg-[#F4F7FC]'
              : 'border-neutral-200/80 bg-white hover:border-neutral-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-[#4A5B56]">Terjadwal (Masa Depan)</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-[#1E3F70]">
              <Icon name="calendar" size={15} />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[24px] font-bold text-[#14231F]">{counts.scheduled}</span>
            <span className="text-[12px] text-[#4A5B56]">pengajuan</span>
          </div>
          <p className="mt-1 text-[11.5px] text-[#71827D]">
            Diajukan akhir pekan / jadwal review mendatang
          </p>
        </div>

        <div
          onClick={() => changeTab('history')}
          className={`cursor-pointer rounded-[14px] border p-4 transition shadow-xs ${
            activeTab === 'history'
              ? 'border-[#1E3F70] bg-[#F4F7FC]'
              : 'border-neutral-200/80 bg-white hover:border-neutral-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-[#4A5B56]">Riwayat Keputusan</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="check" size={15} />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[24px] font-bold text-[#14231F]">{counts.history}</span>
            <span className="text-[12px] text-[#4A5B56]">diputuskan</span>
          </div>
          <p className="mt-1 text-[11.5px] text-[#71827D]">
            Pengajuan yang sudah disetujui atau ditolak
          </p>
        </div>
      </div>

      {/* Konten Utama */}
      <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
        {/* Navigasi Tab */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/80 pb-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => changeTab('queue')}
              className={`flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition ${
                activeTab === 'queue'
                  ? 'bg-[#1E3F70] text-white'
                  : 'bg-neutral-100 text-[#4A5B56] hover:bg-neutral-200/70'
              }`}
            >
              <span>Perlu Ditinjau</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  activeTab === 'queue' ? 'bg-white/20 text-white' : 'bg-neutral-200 text-[#14231F]'
                }`}
              >
                {counts.ready}
              </span>
            </button>

            <button
              type="button"
              onClick={() => changeTab('scheduled')}
              className={`flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition ${
                activeTab === 'scheduled'
                  ? 'bg-[#1E3F70] text-white'
                  : 'bg-neutral-100 text-[#4A5B56] hover:bg-neutral-200/70'
              }`}
            >
              <span>Terjadwal</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  activeTab === 'scheduled'
                    ? 'bg-white/20 text-white'
                    : 'bg-neutral-200 text-[#14231F]'
                }`}
              >
                {counts.scheduled}
              </span>
            </button>

            <button
              type="button"
              onClick={() => changeTab('history')}
              className={`flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition ${
                activeTab === 'history'
                  ? 'bg-[#1E3F70] text-white'
                  : 'bg-neutral-100 text-[#4A5B56] hover:bg-neutral-200/70'
              }`}
            >
              <span>Riwayat Keputusan</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  activeTab === 'history' ? 'bg-white/20 text-white' : 'bg-neutral-200 text-[#14231F]'
                }`}
              >
                {counts.history}
              </span>
            </button>
          </div>

          {/* Filter & Pencarian */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[220px]">
              <Icon
                name="search"
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari barang atau peminjam..."
                className="w-full rounded-[10px] border border-neutral-300 py-1.5 pl-9 pr-3 text-[13px] text-[#14231F] placeholder-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
              />
            </div>

            {activeTab !== 'history' && (
              <select
                value={filterOverlap}
                onChange={(e) => setFilterOverlap(e.target.value)}
                className="rounded-[10px] border border-neutral-300 bg-white px-3 py-1.5 text-[13px] text-[#14231F] focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
              >
                <option value="all">Semua Status Irisan</option>
                <option value="has_overlap">Hanya yang Beririsan/Bentrok</option>
              </select>
            )}
          </div>
        </div>

        {/* Banner Penjelasan Sesuai Tab */}
        {activeTab === 'queue' && (
          <div className="my-3.5 flex items-start gap-2.5 rounded-[10px] bg-[#EBF3FB] p-3 text-[12.5px] leading-relaxed text-[#1E3F70]">
            <Icon name="alert-circle" size={17} className="mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">Antrean Aktif:</span> Menampilkan pengajuan pending yang siap ditinjau hari ini (diurutkan dari yang terlama diajukan). Pengajuan yang beririsan tidak otomatis ditolak; silakan putuskan satu per satu.
            </div>
          </div>
        )}

        {activeTab === 'scheduled' && (
          <div className="my-3.5 flex items-start gap-2.5 rounded-[10px] bg-[#FEF6E6] p-3 text-[12.5px] leading-relaxed text-[#855302]">
            <Icon name="clock" size={17} className="mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">Pengajuan Terjadwal:</span> Pengajuan yang masuk pada akhir pekan (Sabtu/Minggu) dijadwalkan diproses pada hari kerja berikutnya (Senin) dan akan otomatis berpindah ke antrean utama pada tanggal review tersebut.
            </div>
          </div>
        )}

        {/* Tabel / Daftar Antrean */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#4A5B56]">
            <Icon name="refresh" size={28} className="animate-spin text-[#1E3F70]" />
            <p className="mt-3 text-[13.5px] font-medium">Memuat data pengajuan...</p>
          </div>
        ) : error ? (
          <div className="rounded-[12px] bg-red-50 p-4 text-center text-[13px] text-red-600">
            {error}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-[#4A5B56]">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <Icon name="box" size={24} />
            </div>
            <p className="mt-3 text-[14px] font-semibold text-[#14231F]">Tidak ada pengajuan</p>
            <p className="mt-1 text-[12.5px] text-[#71827D]">
              {search || filterOverlap !== 'all'
                ? 'Tidak ada pengajuan yang sesuai dengan kriteria filter Anda.'
                : activeTab === 'queue'
                ? 'Semua pengajuan pending untuk hari ini telah selesai ditinjau.'
                : activeTab === 'scheduled'
                ? 'Tidak ada pengajuan terjadwal untuk hari mendatang.'
                : 'Belum ada riwayat keputusan peminjaman.'}
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/70 text-[12px] font-semibold text-[#4A5B56]">
                  <th className="py-3 px-3.5">Peminjam</th>
                  <th className="py-3 px-3.5">Barang & Kategori</th>
                  <th className="py-3 px-3.5">Jadwal Pinjam</th>
                  <th className="py-3 px-3.5">Keperluan</th>
                  <th className="py-3 px-3.5">Status & Penanda</th>
                  <th className="py-3 px-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filteredItems.map((item) => {
                  const hasPendingOverlaps = item.pending_overlaps > 0
                  const hasApprovedOverlaps = item.approved_overlaps > 0
                  const isExpired = item.is_expired
                  const isPending = item.request_status === 'pending'

                  return (
                    <tr
                      key={item.request_id}
                      className="transition-colors hover:bg-neutral-50/60"
                    >
                      {/* Kolom Peminjam */}
                      <td className="py-3.5 px-3.5 align-top">
                        <div className="font-semibold text-[#14231F]">
                          {item.borrower_name || 'Tanpa Nama'}
                        </div>
                        <div className="text-[12px] text-[#71827D]">
                          {item.borrower_email}
                        </div>
                        <div className="mt-1 inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-[#4A5B56]">
                          {item.borrower_role || 'Peminjam'}
                        </div>
                      </td>

                      {/* Kolom Barang */}
                      <td className="py-3.5 px-3.5 align-top">
                        <div className="font-medium text-[#14231F]">{item.item_name}</div>
                        <div className="text-[12px] text-[#71827D]">{item.category_name}</div>
                      </td>

                      {/* Kolom Jadwal Pinjam */}
                      <td className="py-3.5 px-3.5 align-top">
                        <div className="font-medium text-[#14231F]">
                          {formatRentang(item.planned_start_at, item.planned_end_at)}
                        </div>
                        <div className="text-[12px] text-[#71827D]">
                          Durasi: {item.duration_days} hari
                        </div>
                        <div className="mt-1 text-[11px] text-[#71827D]">
                          Diajukan: {formatDateTime(item.submitted_at)}
                        </div>
                        {item.review_queue_date && (
                          <div className="text-[11px] text-[#1E3F70]">
                            Jadwal Review: {formatTanggal(item.review_queue_date)}
                          </div>
                        )}
                      </td>

                      {/* Kolom Keperluan */}
                      <td className="py-3.5 px-3.5 align-top max-w-[220px]">
                        <p className="line-clamp-2 text-[#4A5B56]" title={item.purpose}>
                          {item.purpose}
                        </p>
                      </td>

                      {/* Kolom Status & Penanda Overlap */}
                      <td className="py-3.5 px-3.5 align-top">
                        <div className="flex flex-col gap-1.5 items-start">
                          {/* Badge Status Permohonan */}
                          {item.request_status === 'approved' && (
                            <span className="inline-flex items-center gap-1 rounded-[6px] border border-[#D4EDDA] bg-[#EBF7EE] px-2 py-0.5 text-[11.5px] font-semibold text-[#1E7E34]">
                              <Icon name="check" size={13} />
                              Disetujui
                            </span>
                          )}
                          {item.request_status === 'rejected' && (
                            <span className="inline-flex items-center gap-1 rounded-[6px] border border-[#FECACA] bg-[#FEE2E2] px-2 py-0.5 text-[11.5px] font-semibold text-[#DC2626]">
                              <Icon name="x" size={13} />
                              Ditolak
                            </span>
                          )}
                          {isPending && (
                            <span className="inline-flex items-center gap-1 rounded-[6px] border border-[#FFE8B8] bg-[#FFF6E5] px-2 py-0.5 text-[11.5px] font-semibold text-[#B76E00]">
                              <Icon name="clock" size={13} />
                              Menunggu Keputusan
                            </span>
                          )}

                          {/* Peringatan Expired */}
                          {isExpired && isPending && (
                            <span
                              className="inline-flex items-center gap-1 rounded-[6px] border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
                              title="Batas waktu peminjaman sudah lewat. Aturan melarang persetujuan."
                            >
                              <Icon name="alert-circle" size={12} />
                              Waktu Lewat (Tolak)
                            </span>
                          )}

                          {/* Peringatan Bentrok dengan Approved */}
                          {hasApprovedOverlaps && isPending && (
                            <span
                              className="inline-flex items-center gap-1 rounded-[6px] border border-red-300 bg-red-100/70 px-2 py-0.5 text-[11px] font-medium text-red-800"
                              title="Jadwal bentrok dengan pengajuan yang sudah disetujui sebelumnya."
                            >
                              <Icon name="alert-circle" size={12} />
                              Bentrok Jadwal Disetujui
                            </span>
                          )}

                          {/* Penanda Beririsan dengan Pending Lain */}
                          {hasPendingOverlaps && isPending && (
                            <span
                              className="inline-flex items-center gap-1 rounded-[6px] border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                              title="Ada pengajuan pending lain untuk barang yang sama di waktu beririsan."
                            >
                              <Icon name="clock" size={12} />
                              Beririsan dgn {item.pending_overlaps} pending lain
                            </span>
                          )}

                          {/* Detail Penolakan di Tab Riwayat */}
                          {item.request_status === 'rejected' && item.rejection_reason && (
                            <div className="mt-1 text-[11.5px] text-[#71827D] italic">
                              Alasan: &ldquo;{item.rejection_reason}&rdquo;
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Kolom Aksi */}
                      <td className="py-3.5 px-3.5 align-top text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isPending ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setApproveModal({ open: true, item, loading: false })}
                                title="Setujui pengajuan"
                                className="inline-flex items-center gap-1 rounded-[8px] bg-[#14532D] px-2.5 py-1.5 text-[12px] font-medium text-white shadow-xs transition hover:bg-[#0f3f22]"
                              >
                                <Icon name="check" size={14} />
                                Setujui
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setRejectModal({
                                    open: true,
                                    item,
                                    reason: '',
                                    loading: false,
                                    validationError: '',
                                  })
                                }
                                title="Tolak pengajuan"
                                className="inline-flex items-center gap-1 rounded-[8px] border border-red-300 bg-white px-2.5 py-1.5 text-[12px] font-medium text-red-700 shadow-xs transition hover:bg-red-50"
                              >
                                <Icon name="x" size={14} />
                                Tolak
                              </button>

                              <button
                                type="button"
                                onClick={() => setDetailItem(item)}
                                title="Lihat detail pengajuan"
                                className="inline-flex items-center rounded-[8px] border border-neutral-200 bg-white p-1.5 text-neutral-600 shadow-xs hover:bg-neutral-50"
                              >
                                <Icon name="search" size={14} />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDetailItem(item)}
                              className="inline-flex items-center gap-1 rounded-[8px] border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#4A5B56] shadow-xs hover:bg-neutral-50"
                            >
                              <Icon name="search" size={14} />
                              Detail
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: KONFIRMASI PERSETUJUAN                          */}
      {/* ======================================================== */}
      {approveModal.open && approveModal.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-[16px] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-neutral-200/80 pb-3">
              <div className="flex items-center gap-2 text-[#14532D]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                  <Icon name="check" size={18} />
                </span>
                <h3 className="text-[16px] font-bold text-[#14231F]">
                  Konfirmasi Persetujuan Peminjaman
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setApproveModal({ open: false, item: null, loading: false })}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* Peringatan Expired jika batas waktu lewat */}
            {approveModal.item.is_expired && (
              <div className="mt-4 rounded-[10px] border border-red-300 bg-red-50 p-3 text-[12.5px] leading-relaxed text-red-800">
                <div className="font-semibold flex items-center gap-1">
                  <Icon name="alert-circle" size={15} />
                  Perhatian: Batas waktu peminjaman sudah lewat!
                </div>
                Pengajuan yang batas waktu akhirnya sudah lewat tidak boleh disetujui menurut aturan sistem. Pengajuan ini disarankan untuk ditolak.
              </div>
            )}

            {/* Peringatan Bentrok Jadwal Beririsan */}
            {approveModal.item.pending_overlaps > 0 && !approveModal.item.is_expired && (
              <div className="mt-4 rounded-[10px] border border-amber-300 bg-amber-50 p-3 text-[12.5px] leading-relaxed text-amber-800">
                <div className="font-semibold flex items-center gap-1">
                  <Icon name="clock" size={15} />
                  Pengajuan Beririsan:
                </div>
                Terdapat <strong>{approveModal.item.pending_overlaps} pengajuan lain</strong> yang beririsan untuk barang ini. Setelah pengajuan ini disetujui, pengajuan lain yang beririsan tidak akan dapat disetujui lagi.
              </div>
            )}

            {/* Ringkasan Data Pengajuan */}
            <div className="mt-4 space-y-2.5 rounded-[12px] bg-neutral-50 p-3.5 text-[13px]">
              <div className="flex justify-between border-b border-neutral-200/70 pb-2">
                <span className="text-[#71827D]">Peminjam:</span>
                <span className="font-semibold text-[#14231F]">
                  {approveModal.item.borrower_name} ({approveModal.item.borrower_email})
                </span>
              </div>
              <div className="flex justify-between border-b border-neutral-200/70 pb-2">
                <span className="text-[#71827D]">Barang:</span>
                <span className="font-semibold text-[#14231F]">
                  {approveModal.item.item_name} ({approveModal.item.category_name})
                </span>
              </div>
              <div className="flex justify-between border-b border-neutral-200/70 pb-2">
                <span className="text-[#71827D]">Jadwal:</span>
                <span className="font-semibold text-[#14231F]">
                  {formatRentang(approveModal.item.planned_start_at, approveModal.item.planned_end_at)} (
                  {approveModal.item.duration_days} hari)
                </span>
              </div>
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-[#71827D]">Keperluan:</span>
                <span className="text-[#14231F] italic">&ldquo;{approveModal.item.purpose}&rdquo;</span>
              </div>
            </div>

            <p className="mt-4 text-[12px] text-[#71827D]">
              * Catatan: Persetujuan ini menetapkan jadwal peminjaman. Status fisik barang tetap &lsquo;tersedia&rsquo; hingga serah terima dilakukan oleh Tendik.
            </p>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setApproveModal({ open: false, item: null, loading: false })}
                disabled={approveModal.loading}
                className="rounded-[10px] border border-neutral-300 bg-white px-4 py-2 text-[13px] font-medium text-[#4A5B56] hover:bg-neutral-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={approveModal.loading || approveModal.item.is_expired}
                className="flex items-center gap-1.5 rounded-[10px] bg-[#14532D] px-4 py-2 text-[13px] font-semibold text-white shadow-xs hover:bg-[#0f3f22] disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {approveModal.loading ? 'Menyetujui...' : 'Ya, Setujui Pengajuan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: PENOLAKAN DENGAN ALASAN WAJIB                   */}
      {/* ======================================================== */}
      {rejectModal.open && rejectModal.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-[16px] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-neutral-200/80 pb-3">
              <div className="flex items-center gap-2 text-[#DC2626]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                  <Icon name="x" size={18} />
                </span>
                <h3 className="text-[16px] font-bold text-[#14231F]">
                  Tolak Pengajuan Peminjaman
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRejectModal({ open: false, item: null, reason: '', loading: false, validationError: '' })}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="mt-4 rounded-[10px] bg-neutral-50 p-3 text-[13px] text-[#4A5B56]">
              Menolak pengajuan barang <strong>{rejectModal.item.item_name}</strong> oleh{' '}
              <strong>{rejectModal.item.borrower_name}</strong> untuk tanggal{' '}
              <strong>{formatRentang(rejectModal.item.planned_start_at, rejectModal.item.planned_end_at)}</strong>.
            </div>

            {/* Form Input Alasan Penolakan */}
            <div className="mt-4">
              <label
                htmlFor="rejection-reason"
                className="mb-1.5 flex items-center justify-between text-[13px] font-semibold text-[#14231F]"
              >
                <span>
                  Alasan Penolakan <span className="text-red-500">*</span>
                </span>
                <span
                  className={`text-[11.5px] ${
                    rejectModal.reason.length > 500 ? 'text-red-500 font-bold' : 'text-[#71827D]'
                  }`}
                >
                  {rejectModal.reason.length} / 500 karakter
                </span>
              </label>
              <textarea
                id="rejection-reason"
                rows={4}
                value={rejectModal.reason}
                maxLength={500}
                placeholder="Tuliskan alasan penolakan secara jelas dan objektif (wajib diisi, maks. 500 karakter)..."
                onChange={(e) =>
                  setRejectModal((prev) => ({
                    ...prev,
                    reason: e.target.value,
                    validationError: '',
                  }))
                }
                className={`w-full rounded-[10px] border px-3 py-2 text-[13px] text-[#14231F] focus:outline-none focus:ring-2 ${
                  rejectModal.validationError
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                    : 'border-neutral-300 focus:border-[#1E3F70] focus:ring-[#1E3F70]/15'
                }`}
              />
              {rejectModal.validationError && (
                <p className="mt-1 text-[12px] text-red-600">{rejectModal.validationError}</p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setRejectModal({ open: false, item: null, reason: '', loading: false, validationError: '' })}
                disabled={rejectModal.loading}
                className="rounded-[10px] border border-neutral-300 bg-white px-4 py-2 text-[13px] font-medium text-[#4A5B56] hover:bg-neutral-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={rejectModal.loading}
                className="flex items-center gap-1.5 rounded-[10px] bg-[#DC2626] px-4 py-2 text-[13px] font-semibold text-white shadow-xs hover:bg-[#b91c1c] disabled:opacity-50"
              >
                {rejectModal.loading ? 'Menolak...' : 'Kirim Penolakan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: PERINGATAN BENTROK JADWAL (CONFLICT ALERT 409)  */}
      {/* ======================================================== */}
      {conflictModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <Icon name="alert-circle" size={26} />
            </div>

            <h3 className="mt-3 text-center text-[17px] font-bold text-[#14231F]">
              Jadwal Peminjaman Bentrok
            </h3>
            <p className="mt-1.5 text-center text-[13px] text-[#4A5B56]">
              {conflictModal.message}
            </p>

            {conflictModal.conflicts.length > 0 && (
              <div className="mt-4 rounded-[12px] bg-neutral-50 p-3.5 border border-neutral-200">
                <div className="text-[12px] font-semibold text-[#14231F] mb-2">
                  Jadwal peminjaman yang sudah disetujui:
                </div>
                <div className="space-y-2">
                  {conflictModal.conflicts.map((c, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-[8px] bg-white p-2 text-[12px] border border-neutral-200/80"
                    >
                      <span className="font-medium text-[#14231F]">
                        {formatRentang(c.start, c.end)}
                      </span>
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-[#1E7E34]">
                        Disetujui
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-[#71827D]">
                  * Identitas peminjam lain dirahasiakan untuk menjaga privasi.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setConflictModal({ open: false, conflicts: [], message: '' })}
              className="mt-5 w-full rounded-[10px] bg-[#1E3F70] py-2 text-[13.5px] font-semibold text-white shadow-xs hover:bg-[#163056]"
            >
              Mengerti & Tutup
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 4: DETAIL PENGAJUAN LENGKAP                        */}
      {/* ======================================================== */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-[16px] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-neutral-200/80 pb-3">
              <h3 className="text-[16px] font-bold text-[#14231F]">
                Detail Pengajuan Peminjaman #{detailItem.request_id}
              </h3>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-[13px]">
              <div className="grid grid-cols-2 gap-2 border-b border-neutral-100 pb-2">
                <span className="text-[#71827D]">Nama Peminjam:</span>
                <span className="font-semibold text-[#14231F]">{detailItem.borrower_name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-b border-neutral-100 pb-2">
                <span className="text-[#71827D]">Email Peminjam:</span>
                <span className="text-[#14231F]">{detailItem.borrower_email}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-b border-neutral-100 pb-2">
                <span className="text-[#71827D]">Barang:</span>
                <span className="font-semibold text-[#14231F]">{detailItem.item_name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-b border-neutral-100 pb-2">
                <span className="text-[#71827D]">Kategori:</span>
                <span className="text-[#14231F]">{detailItem.category_name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-b border-neutral-100 pb-2">
                <span className="text-[#71827D]">Rentang Pinjam:</span>
                <span className="font-medium text-[#14231F]">
                  {formatRentang(detailItem.planned_start_at, detailItem.planned_end_at)} (
                  {detailItem.duration_days} hari)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-b border-neutral-100 pb-2">
                <span className="text-[#71827D]">Waktu Pengajuan:</span>
                <span className="text-[#14231F]">{formatDateTime(detailItem.submitted_at)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-b border-neutral-100 pb-2">
                <span className="text-[#71827D]">Jadwal Masuk Antrean:</span>
                <span className="text-[#14231F]">{formatTanggal(detailItem.review_queue_date)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-b border-neutral-100 pb-2">
                <span className="text-[#71827D]">Status Pengajuan:</span>
                <span className="font-semibold capitalize text-[#14231F]">{detailItem.request_status}</span>
              </div>

              {detailItem.rejection_reason && (
                <div className="rounded-[8px] bg-red-50 p-3 text-red-800">
                  <div className="font-semibold text-[12px] mb-1">Alasan Penolakan:</div>
                  <p className="italic">{detailItem.rejection_reason}</p>
                  {detailItem.approver_name && (
                    <div className="mt-1 text-[11px] text-red-600">
                      Ditolak oleh: {detailItem.approver_name} pada {formatDateTime(detailItem.decided_at)}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1 rounded-[10px] bg-neutral-50 p-3">
                <span className="text-[12px] font-semibold text-[#71827D]">Keperluan Peminjaman:</span>
                <p className="text-[#14231F] leading-relaxed">{detailItem.purpose}</p>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="rounded-[10px] bg-neutral-100 px-4 py-2 text-[13px] font-medium text-[#14231F] hover:bg-neutral-200"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
