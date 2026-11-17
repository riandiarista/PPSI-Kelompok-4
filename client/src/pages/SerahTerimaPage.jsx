import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { api } from '../lib/api'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatTanggal(dateStr) {
  if (!dateStr) return '-'
  try {
    const raw = String(dateStr).slice(0, 10)
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${raw}T12:00:00Z`))
  } catch { return dateStr }
}

function formatDateTime(isoStr) {
  if (!isoStr) return '-'
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }).format(new Date(isoStr)) + ' WIB'
  } catch { return isoStr }
}

function formatRentang(start, end) {
  if (!start || !end) return '-'
  try {
    const fmt = (d) => new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta',
    }).format(d)
    const s    = new Date(start)
    const last = new Date(new Date(end).getTime() - 1)
    return fmt(s) === fmt(last) ? fmt(s) : `${fmt(s)} – ${fmt(last)}`
  } catch { return `${start} – ${end}` }
}

// ─── Komponen Utama ───────────────────────────────────────────────────────────
export default function SerahTerimaPage() {
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [search, setSearch]         = useState('')

  // Modal konfirmasi serah terima
  const [confirmModal, setConfirmModal] = useState({
    open: false, item: null, loading: false, note: '',
  })

  // Toast
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' })

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 4500)
  }

  const refreshData = () => { setLoading(true); setRefreshKey((k) => k + 1) }

  // Fetch daftar pengajuan disetujui yang belum diserahterimakan
  useEffect(() => {
    let cancelled = false
    api('/handover/pending')
      .then((res) => {
        if (cancelled) return
        setItems(res.data || [])
        setError('')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Gagal memuat daftar pengajuan')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey])

  // Filter pencarian
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) =>
      it.item_name?.toLowerCase().includes(q) ||
      it.borrower_name?.toLowerCase().includes(q) ||
      it.borrower_email?.toLowerCase().includes(q) ||
      it.category_name?.toLowerCase().includes(q)
    )
  }, [items, search])

  // Handler Konfirmasi Serah Terima
  const handleConfirmHandover = async () => {
    const item = confirmModal.item
    if (!item) return
    setConfirmModal((prev) => ({ ...prev, loading: true }))
    try {
      await api(`/handover/${item.request_id}/confirm`, {
        method: 'POST',
        body: { handover_note: confirmModal.note },
      })
      setConfirmModal({ open: false, item: null, loading: false, note: '' })
      showToast(`Serah terima "${item.item_name}" berhasil dicatat!`, 'success')
      refreshData()
    } catch (err) {
      setConfirmModal((prev) => ({ ...prev, loading: false }))
      showToast(err.message || 'Gagal mencatat serah terima', 'error')
    }
  }

  const stats = useMemo(() => ({
    total:     items.length,
    started:   items.filter((i) => i.is_started).length,
    upcoming:  items.filter((i) => i.is_not_started).length,
    expired:   items.filter((i) => i.is_expired).length,
  }), [items])

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast.show && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-[12px] px-4 py-3 text-[13.5px] font-medium shadow-lg transition-all ${
          toast.type === 'success' ? 'bg-[#14532D] text-white'
          : toast.type === 'info'  ? 'bg-[#1E3F70] text-white'
          : 'bg-[#B91C1C] text-white'
        }`}>
          <Icon name={toast.type === 'success' ? 'check' : toast.type === 'info' ? 'alert-circle' : 'x-circle'} size={18} />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#14231F]">
            Serah Terima Peminjaman
          </h1>
          <p className="mt-1 text-[13px] text-[#4A5B56]">
            Konfirmasi penyerahan fisik barang kepada peminjam yang pengajuannya sudah disetujui.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshData}
          className="flex items-center gap-1.5 self-start rounded-[8px] border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#14231F] shadow-xs transition hover:bg-neutral-50"
        >
          <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
          Segarkan
        </button>
      </div>

      {/* Kartu Statistik */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Menunggu', value: stats.total, color: 'text-[#1E3F70]', bg: 'bg-blue-50' },
          { label: 'Periode Aktif', value: stats.started, color: 'text-emerald-700', bg: 'bg-emerald-50' },
          { label: 'Belum Dimulai', value: stats.upcoming, color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'Waktu Lewat', value: stats.expired, color: 'text-red-700', bg: 'bg-red-50' },
        ].map((s) => (
          <div key={s.label} className={`rounded-[14px] border border-neutral-200/80 ${s.bg} p-4 shadow-xs`}>
            <p className="text-[12px] font-medium text-[#4A5B56]">{s.label}</p>
            <p className={`mt-1 text-[26px] font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Panel Utama */}
      <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
        {/* Search + Info Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/80 pb-4">
          <h2 className="text-[14px] font-semibold text-[#14231F]">
            Daftar Pengajuan Disetujui ({filteredItems.length})
          </h2>
          <div className="relative min-w-[220px]">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari barang atau peminjam..."
              className="w-full rounded-[10px] border border-neutral-300 py-1.5 pl-9 pr-3 text-[13px] text-[#14231F] placeholder-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
            />
          </div>
        </div>

        <div className="my-3.5 flex items-start gap-2.5 rounded-[10px] bg-[#EBF3FB] p-3 text-[12.5px] leading-relaxed text-[#1E3F70]">
          <Icon name="alert-circle" size={17} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Proses Serah Terima:</span> Pastikan barang dalam kondisi baik sebelum diserahkan. Setelah dikonfirmasi, status barang otomatis berubah menjadi{' '}
            <strong>"Sedang Dipinjam"</strong> dan sistem mulai menghitung jatuh tempo.
          </div>
        </div>

        {/* Konten */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#4A5B56]">
            <Icon name="refresh" size={28} className="animate-spin text-[#1E3F70]" />
            <p className="mt-3 text-[13.5px] font-medium">Memuat data...</p>
          </div>
        ) : error ? (
          <div className="rounded-[12px] bg-red-50 p-4 text-center text-[13px] text-red-600">{error}</div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-[#4A5B56]">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <Icon name="check" size={24} />
            </div>
            <p className="mt-3 text-[14px] font-semibold text-[#14231F]">
              {search ? 'Tidak ada yang cocok' : 'Semua serah terima sudah selesai'}
            </p>
            <p className="mt-1 text-[12.5px] text-[#71827D]">
              {search ? 'Coba ubah kata kunci pencarian.' : 'Tidak ada pengajuan disetujui yang menunggu serah terima.'}
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/70 text-[12px] font-semibold text-[#4A5B56]">
                  <th className="px-3.5 py-3">Peminjam</th>
                  <th className="px-3.5 py-3">Barang</th>
                  <th className="px-3.5 py-3">Jadwal Pinjam</th>
                  <th className="px-3.5 py-3">Jatuh Tempo</th>
                  <th className="px-3.5 py-3">Status</th>
                  <th className="px-3.5 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filteredItems.map((item) => {
                  const isExpired    = item.is_expired
                  const isStarted    = item.is_started
                  const isNotStarted = item.is_not_started

                  return (
                    <tr key={item.request_id} className="transition-colors hover:bg-neutral-50/60">
                      {/* Peminjam */}
                      <td className="px-3.5 py-3.5 align-top">
                        <div className="font-semibold text-[#14231F]">{item.borrower_name || 'Tanpa Nama'}</div>
                        <div className="text-[12px] text-[#71827D]">{item.borrower_email}</div>
                        <div className="mt-1 inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-[#4A5B56]">
                          {item.borrower_role || 'Peminjam'}
                        </div>
                      </td>

                      {/* Barang */}
                      <td className="px-3.5 py-3.5 align-top">
                        <div className="font-medium text-[#14231F]">{item.item_name}</div>
                        <div className="text-[12px] text-[#71827D]">{item.category_name}</div>
                      </td>

                      {/* Jadwal */}
                      <td className="px-3.5 py-3.5 align-top">
                        <div className="font-medium text-[#14231F]">
                          {formatRentang(item.planned_start_at, item.planned_end_at)}
                        </div>
                        <div className="text-[12px] text-[#71827D]">{item.duration_days} hari</div>
                      </td>

                      {/* Jatuh Tempo */}
                      <td className="px-3.5 py-3.5 align-top">
                        <div className={`font-medium ${isExpired ? 'text-red-600' : 'text-[#14231F]'}`}>
                          {formatTanggal(String(item.planned_end_at).slice(0, 10))}
                        </div>
                        <div className="text-[11px] text-[#71827D]">
                          Disetujui: {formatDateTime(item.approved_at)}
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="px-3.5 py-3.5 align-top">
                        {isExpired && (
                          <span className="inline-flex items-center gap-1 rounded-[6px] border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                            <Icon name="alert-circle" size={12} />
                            Waktu Lewat
                          </span>
                        )}
                        {isStarted && (
                          <span className="inline-flex items-center gap-1 rounded-[6px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            <Icon name="check" size={12} />
                            Periode Aktif
                          </span>
                        )}
                        {isNotStarted && (
                          <span className="inline-flex items-center gap-1 rounded-[6px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            <Icon name="clock" size={12} />
                            Belum Dimulai
                          </span>
                        )}
                      </td>

                      {/* Aksi */}
                      <td className="px-3.5 py-3.5 align-top text-right">
                        <button
                          type="button"
                          disabled={isExpired}
                          onClick={() => setConfirmModal({ open: true, item, loading: false, note: '' })}
                          title={isExpired ? 'Waktu peminjaman sudah lewat, tidak dapat diserahterimakan' : 'Konfirmasi serah terima'}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#1E3F70] px-3 py-1.5 text-[12px] font-medium text-white shadow-xs transition hover:bg-[#162e55] disabled:cursor-not-allowed disabled:bg-neutral-300"
                        >
                          <Icon name="swap" size={14} />
                          Serahkan
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: KONFIRMASI SERAH TERIMA                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {confirmModal.open && confirmModal.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[16px] bg-white p-6 shadow-xl">
            {/* Header Modal */}
            <div className="flex items-center justify-between border-b border-neutral-200/80 pb-3">
              <div className="flex items-center gap-2 text-[#1E3F70]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                  <Icon name="swap" size={18} />
                </span>
                <h3 className="text-[16px] font-bold text-[#14231F]">Konfirmasi Serah Terima</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmModal({ open: false, item: null, loading: false, note: '' })}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* Ringkasan Data */}
            <div className="mt-4 space-y-2.5 rounded-[12px] bg-neutral-50 p-3.5 text-[13px]">
              {[
                ['Peminjam', `${confirmModal.item.borrower_name} (${confirmModal.item.borrower_email})`],
                ['Barang', `${confirmModal.item.item_name} — ${confirmModal.item.category_name}`],
                ['Jadwal', formatRentang(confirmModal.item.planned_start_at, confirmModal.item.planned_end_at)],
                ['Durasi', `${confirmModal.item.duration_days} hari`],
                ['Jatuh Tempo', formatTanggal(String(confirmModal.item.planned_end_at).slice(0, 10))],
                ['Keperluan', confirmModal.item.purpose],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-neutral-200/70 pb-2 last:border-0 last:pb-0">
                  <span className="shrink-0 text-[#71827D]">{label}:</span>
                  <span className="text-right font-medium text-[#14231F]">{value}</span>
                </div>
              ))}
            </div>

            {/* Catatan Opsional */}
            <div className="mt-4">
              <label className="mb-1.5 block text-[13px] font-medium text-[#14231F]">
                Catatan Serah Terima <span className="text-[#71827D] font-normal">(opsional)</span>
              </label>
              <textarea
                rows={2}
                value={confirmModal.note}
                onChange={(e) => setConfirmModal((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="Contoh: Barang diserahkan dalam kondisi baik, disaksikan oleh peminjam."
                className="w-full rounded-[10px] border border-neutral-300 px-3 py-2 text-[13px] text-[#14231F] placeholder-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15 resize-none"
              />
            </div>

            <p className="mt-3 text-[12px] text-[#71827D]">
              * Setelah dikonfirmasi, status barang berubah menjadi <strong>"Sedang Dipinjam"</strong> dan jatuh tempo mulai berlaku.
            </p>

            {/* Aksi Modal */}
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmModal({ open: false, item: null, loading: false, note: '' })}
                disabled={confirmModal.loading}
                className="rounded-[10px] border border-neutral-300 bg-white px-4 py-2 text-[13px] font-medium text-[#4A5B56] hover:bg-neutral-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmHandover}
                disabled={confirmModal.loading}
                className="flex items-center gap-1.5 rounded-[10px] bg-[#1E3F70] px-4 py-2 text-[13px] font-semibold text-white shadow-xs hover:bg-[#162e55] disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                <Icon name={confirmModal.loading ? 'refresh' : 'swap'} size={15} className={confirmModal.loading ? 'animate-spin' : ''} />
                {confirmModal.loading ? 'Menyimpan...' : 'Ya, Konfirmasi Serah Terima'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
