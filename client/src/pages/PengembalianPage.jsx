import { useEffect, useMemo, useState, useCallback } from 'react'
import Icon from '../components/Icon'
import { api } from '../lib/api'

function formatDateTime(isoStr) {
  if (!isoStr) return '-'
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }).format(new Date(isoStr)) + ' WIB'
  } catch { return isoStr }
}

// Kondisi pengembalian
const RETURN_CONDITIONS = [
  {
    value: 'good',
    label: 'Baik',
    desc:  'Barang kembali tanpa kerusakan. Status setelah dikembalikan: tersedia.',
    color: 'border-emerald-400 bg-emerald-50 text-emerald-800',
    ring:  'ring-2 ring-emerald-400',
    icon:  'check',
  },
  {
    value: 'minor_damage',
    label: 'Kerusakan Ringan',
    desc:  'Terdapat kerusakan kecil. Status setelah dikembalikan: perbaikan.',
    color: 'border-amber-400 bg-amber-50 text-amber-800',
    ring:  'ring-2 ring-amber-400',
    icon:  'alert-circle',
  },
  {
    value: 'major_damage',
    label: 'Kerusakan Besar / Hilang',
    desc:  'Barang rusak parah atau hilang. Status setelah dikembalikan: tidak tersedia.',
    color: 'border-red-400 bg-red-50 text-red-800',
    ring:  'ring-2 ring-red-400',
    icon:  'x-circle',
  },
]

// Label poin delta
function PointDeltaBadge({ delta }) {
  if (delta === 0) return <span className="text-[#71827D]">0 poin (tidak berubah)</span>
  if (delta > 0)
    return <span className="font-semibold text-emerald-700">+{delta} poin</span>
  return <span className="font-semibold text-red-600">{delta} poin</span>
}

// Label level gamifikasi
function LevelBadge({ level }) {
  const map = {
    gold:     'bg-yellow-100 text-yellow-800 border-yellow-300',
    silver:   'bg-slate-100 text-slate-700 border-slate-300',
    bronze:   'bg-orange-100 text-orange-800 border-orange-300',
    beginner: 'bg-neutral-100 text-neutral-700 border-neutral-300',
  }
  return (
    <span className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[11.5px] font-semibold capitalize ${map[level] || map.beginner}`}>
      {level === 'gold' ? '🥇' : level === 'silver' ? '🥈' : level === 'bronze' ? '🥉' : '🌱'} {level}
    </span>
  )
}

// ─── Komponen Utama ───────────────────────────────────────────────────────────
export default function PengembalianPage() {
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [search, setSearch]         = useState('')

  // Toast
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' })

  // Modal pengembalian
  const [returnModal, setReturnModal] = useState({
    open: false, item: null, loading: false,
    condition: '',  // 'good' | 'minor_damage' | 'major_damage'
    notes: '',
    returnedAt: '', // ISO string (opsional, default: now)
    preview: null,  // data pratinjau poin
    previewLoading: false,
    confirmStep: false, // true = tampilkan ringkasan sebelum submit
  })

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 5000)
  }

  const refreshData = () => { setLoading(true); setRefreshKey((k) => k + 1) }

  // Fetch daftar barang yang sedang dipinjam
  useEffect(() => {
    let cancelled = false
    api('/handover/active')
      .then((res) => {
        if (cancelled) return
        setItems(res.data || [])
        setError('')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Gagal memuat data pengembalian')
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

  // Fetch preview poin ketika kondisi atau waktu berubah
  const fetchPreview = useCallback(async (item, condition, returnedAt) => {
    if (!item || !condition) return
    setReturnModal((prev) => ({ ...prev, previewLoading: true, preview: null }))
    try {
      const qs = new URLSearchParams({ return_condition: condition })
      if (returnedAt) qs.set('returned_at', returnedAt)
      const res = await api(`/handover/returns/${item.loan_id}/preview?${qs.toString()}`)
      setReturnModal((prev) => ({ ...prev, preview: res.data, previewLoading: false }))
    } catch {
      setReturnModal((prev) => ({ ...prev, previewLoading: false }))
    }
  }, [])

  // Handler saat kondisi atau waktu berubah → fetch preview
  const handleConditionChange = (condition) => {
    setReturnModal((prev) => {
      const updated = { ...prev, condition, preview: null, previewLoading: false }
      if (prev.item) {
        fetchPreview(prev.item, condition, prev.returnedAt || null)
      }
      return updated
    })
  }

  const handleReturnedAtChange = (val) => {
    setReturnModal((prev) => {
      const updated = { ...prev, returnedAt: val, preview: null }
      if (prev.item && prev.condition) {
        fetchPreview(prev.item, prev.condition, val || null)
      }
      return updated
    })
  }

  // Submit konfirmasi pengembalian
  const handleConfirmReturn = async () => {
    const { item, condition, notes, returnedAt } = returnModal
    if (!item || !condition) return
    setReturnModal((prev) => ({ ...prev, loading: true }))
    try {
      const body = { return_condition: condition, notes }
      if (returnedAt) body.returned_at = returnedAt
      const res = await api(`/handover/returns/${item.loan_id}/confirm`, {
        method: 'POST', body,
      })
      setReturnModal({ open: false, item: null, loading: false, condition: '', notes: '', returnedAt: '', preview: null, previewLoading: false, confirmStep: false })

      const gam = res.data?.gamification
      let pointMsg = ''
      if (gam) {
        pointMsg = gam.point_delta > 0
          ? ` Poin: +${gam.point_delta} → ${gam.new_balance}`
          : gam.point_delta < 0
          ? ` Poin: ${gam.point_delta} → ${gam.new_balance}`
          : ''
        if (gam.level_changed) pointMsg += ` (level: ${gam.new_level})`
      }
      showToast(`Pengembalian "${item.item_name}" berhasil dikonfirmasi.${pointMsg}`, 'success')
      refreshData()
    } catch (err) {
      setReturnModal((prev) => ({ ...prev, loading: false }))
      showToast(err.message || 'Gagal mengkonfirmasi pengembalian', 'error')
    }
  }

  const stats = useMemo(() => ({
    total:   items.length,
    overdue: items.filter((i) => i.is_overdue).length,
    onTime:  items.filter((i) => !i.is_overdue).length,
  }), [items])

  return (
    <div className="space-y-6 font-sans">
      {/* Toast */}
      {toast.show && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-[12px] px-4 py-3 text-[13.5px] font-medium shadow-lg transition-all ${
          toast.type === 'success' ? 'bg-[#14532D] text-white'
          : toast.type === 'info'  ? 'bg-[#1E3F70] text-white'
          : 'bg-[#B91C1C] text-white'
        }`}>
          <Icon name={toast.type === 'success' ? 'check' : 'alert-circle'} size={18} />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#14231F]">
            Konfirmasi Pengembalian Barang
          </h1>
          <p className="mt-1 text-[13px] text-[#4A5B56]">
            Proses pengembalian fisik barang, periksa kondisi, dan catat perubahan poin peminjam.
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
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Dipinjam', value: stats.total, color: 'text-[#1E3F70]', bg: 'bg-blue-50' },
          { label: 'Terlambat', value: stats.overdue, color: 'text-red-700', bg: 'bg-red-50' },
          { label: 'Belum Terlambat', value: stats.onTime, color: 'text-emerald-700', bg: 'bg-emerald-50' },
        ].map((s) => (
          <div key={s.label} className={`rounded-[14px] border border-neutral-200/80 ${s.bg} p-4 shadow-xs`}>
            <p className="text-[12px] font-medium text-[#4A5B56]">{s.label}</p>
            <p className={`mt-1 text-[26px] font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Panel Utama */}
      <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/80 pb-4">
          <h2 className="text-[14px] font-semibold text-[#14231F]">
            Barang Sedang Dipinjam ({filteredItems.length})
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
              <Icon name="box" size={24} />
            </div>
            <p className="mt-3 text-[14px] font-semibold text-[#14231F]">
              {search ? 'Tidak ada yang cocok' : 'Tidak ada barang yang sedang dipinjam'}
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/70 text-[12px] font-semibold text-[#4A5B56]">
                  <th className="px-3.5 py-3">Peminjam</th>
                  <th className="px-3.5 py-3">Barang</th>
                  <th className="px-3.5 py-3">Diserahkan</th>
                  <th className="px-3.5 py-3">Jatuh Tempo</th>
                  <th className="px-3.5 py-3">Poin Saat Ini</th>
                  <th className="px-3.5 py-3">Status</th>
                  <th className="px-3.5 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filteredItems.map((item) => (
                  <tr key={item.loan_id} className="transition-colors hover:bg-neutral-50/60">
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

                    {/* Diserahkan */}
                    <td className="px-3.5 py-3.5 align-top">
                      <div className="text-[#14231F]">{formatDateTime(item.handover_at)}</div>
                      <div className="text-[11px] text-[#71827D]">oleh {item.handover_by_name}</div>
                    </td>

                    {/* Jatuh Tempo */}
                    <td className="px-3.5 py-3.5 align-top">
                      <div className={`font-medium ${item.is_overdue ? 'text-red-600' : 'text-[#14231F]'}`}>
                        {formatDateTime(item.due_at)}
                      </div>
                      {item.is_overdue && (
                        <div className="text-[11px] font-semibold text-red-600">
                          Terlambat {item.late_days_estimate} hari
                        </div>
                      )}
                    </td>

                    {/* Poin */}
                    <td className="px-3.5 py-3.5 align-top">
                      <div className="font-semibold text-[#14231F]">{item.current_points} poin</div>
                      <LevelBadge level={item.discipline_level} />
                    </td>

                    {/* Status */}
                    <td className="px-3.5 py-3.5 align-top">
                      {item.is_overdue ? (
                        <span className="inline-flex items-center gap-1 rounded-[6px] border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                          <Icon name="alert-circle" size={12} />
                          Terlambat
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-[6px] border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          <Icon name="clock" size={12} />
                          Dipinjam
                        </span>
                      )}
                    </td>

                    {/* Aksi */}
                    <td className="px-3.5 py-3.5 align-top text-right">
                      <button
                        type="button"
                        onClick={() => setReturnModal({
                          open: true, item, loading: false,
                          condition: '', notes: '', returnedAt: '',
                          preview: null, previewLoading: false, confirmStep: false,
                        })}
                        className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#1E3F70] px-3 py-1.5 text-[12px] font-medium text-white shadow-xs transition hover:bg-[#162e55]"
                      >
                        <Icon name="check" size={14} />
                        Proses
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: FORM PENGEMBALIAN + PRATINJAU POIN                              */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {returnModal.open && returnModal.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[16px] bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-200/80 px-6 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-[#1E3F70]">
                  <Icon name="check" size={18} />
                </span>
                <h3 className="text-[16px] font-bold text-[#14231F]">Konfirmasi Pengembalian</h3>
              </div>
              <button
                type="button"
                onClick={() => setReturnModal({ open: false, item: null, loading: false, condition: '', notes: '', returnedAt: '', preview: null, previewLoading: false, confirmStep: false })}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="max-h-[80vh] overflow-y-auto px-6 pb-6 pt-4 space-y-5">
              {/* Info Barang */}
              <div className="rounded-[12px] bg-neutral-50 p-3.5 text-[13px] space-y-2">
                {[
                  ['Peminjam', `${returnModal.item.borrower_name} (${returnModal.item.borrower_email})`],
                  ['Barang', `${returnModal.item.item_name} — ${returnModal.item.category_name}`],
                  ['Diserahkan', formatDateTime(returnModal.item.handover_at)],
                  ['Jatuh Tempo', formatDateTime(returnModal.item.due_at)],
                  ['Poin Saat Ini', `${returnModal.item.current_points} poin (${returnModal.item.discipline_level})`],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-neutral-200/70 pb-1.5 last:border-0 last:pb-0">
                    <span className="shrink-0 text-[#71827D]">{label}:</span>
                    <span className={`text-right font-medium ${label === 'Jatuh Tempo' && returnModal.item.is_overdue ? 'text-red-600' : 'text-[#14231F]'}`}>{val}</span>
                  </div>
                ))}
                {returnModal.item.is_overdue && (
                  <div className="rounded-[8px] border border-red-200 bg-red-50 p-2.5 text-[12px] text-red-700">
                    <Icon name="alert-circle" size={14} className="inline mr-1" />
                    <strong>Terlambat {returnModal.item.late_days_estimate} hari</strong> — penalti poin akan dihitung otomatis.
                  </div>
                )}
              </div>

              {/* Waktu Pengembalian */}
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-[#14231F]">
                  Waktu Pengembalian <span className="text-[#71827D] font-normal">(opsional, default: sekarang)</span>
                </label>
                <input
                  type="datetime-local"
                  value={returnModal.returnedAt ? returnModal.returnedAt.slice(0, 16) : ''}
                  onChange={(e) => handleReturnedAtChange(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  className="w-full rounded-[10px] border border-neutral-300 px-3 py-2 text-[13px] text-[#14231F] focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
                />
              </div>

              {/* Pilih Kondisi */}
              <div>
                <label className="mb-2 block text-[13px] font-medium text-[#14231F]">
                  Kondisi Barang Saat Dikembalikan <span className="text-red-500">*</span>
                </label>
                <div className="space-y-2.5">
                  {RETURN_CONDITIONS.map((cond) => (
                    <button
                      key={cond.value}
                      type="button"
                      onClick={() => handleConditionChange(cond.value)}
                      className={`w-full rounded-[10px] border-2 p-3 text-left transition ${
                        returnModal.condition === cond.value
                          ? `${cond.color} ${cond.ring}`
                          : 'border-neutral-200 bg-white hover:border-neutral-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon name={cond.icon} size={16} />
                        <span className="font-semibold text-[13px]">{cond.label}</span>
                      </div>
                      <p className="mt-1 text-[12px] opacity-80">{cond.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Catatan */}
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-[#14231F]">
                  Catatan Kondisi <span className="text-[#71827D] font-normal">(opsional)</span>
                </label>
                <textarea
                  rows={2}
                  value={returnModal.notes}
                  onChange={(e) => setReturnModal((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Contoh: Terdapat goresan di sudut kanan bawah."
                  className="w-full rounded-[10px] border border-neutral-300 px-3 py-2 text-[13px] text-[#14231F] placeholder-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15 resize-none"
                />
              </div>

              {/* Pratinjau Poin */}
              {(returnModal.previewLoading || returnModal.preview) && (
                <div className={`rounded-[12px] border p-4 text-[13px] ${
                  returnModal.preview?.point_delta > 0
                    ? 'border-emerald-200 bg-emerald-50'
                    : returnModal.preview?.point_delta < 0
                    ? 'border-red-200 bg-red-50'
                    : 'border-neutral-200 bg-neutral-50'
                }`}>
                  {returnModal.previewLoading ? (
                    <div className="flex items-center gap-2 text-[#4A5B56]">
                      <Icon name="refresh" size={15} className="animate-spin" />
                      <span>Menghitung perubahan poin...</span>
                    </div>
                  ) : returnModal.preview ? (
                    <>
                      <div className="mb-3 font-semibold text-[#14231F] flex items-center gap-2">
                        <Icon name="award" size={16} />
                        Pratinjau Perubahan Poin Peminjam
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-[#71827D]">Saldo sebelum:</span>
                          <span className="font-medium">{returnModal.preview.current_points} poin</span>
                        </div>
                        {returnModal.preview.breakdown.late_days > 0 && (
                          <div className="flex justify-between">
                            <span className="text-[#71827D]">Penalti terlambat ({returnModal.preview.late_days} hari × 2):</span>
                            <span className="font-medium text-red-600">{returnModal.preview.breakdown.late_points} poin</span>
                          </div>
                        )}
                        {returnModal.preview.breakdown.condition_points !== 0 && (
                          <div className="flex justify-between">
                            <span className="text-[#71827D]">Poin kondisi:</span>
                            <span className={`font-medium ${returnModal.preview.breakdown.condition_points > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                              {returnModal.preview.breakdown.condition_points > 0 ? '+' : ''}{returnModal.preview.breakdown.condition_points} poin
                            </span>
                          </div>
                        )}
                        {returnModal.preview.breakdown.major_damage_penalty !== 0 && (
                          <div className="flex justify-between">
                            <span className="text-[#71827D]">Penalti kerusakan besar:</span>
                            <span className="font-medium text-red-600">{returnModal.preview.breakdown.major_damage_penalty} poin</span>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-neutral-200/80 pt-2 mt-1">
                          <span className="font-semibold text-[#14231F]">Perubahan total:</span>
                          <PointDeltaBadge delta={returnModal.preview.point_delta} />
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold text-[#14231F]">Saldo baru:</span>
                          <span className="font-bold text-[16px] text-[#14231F]">{returnModal.preview.new_balance} poin</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[#71827D]">Level:</span>
                          <div className="flex items-center gap-2">
                            <LevelBadge level={returnModal.preview.discipline_level} />
                            {returnModal.preview.new_level !== returnModal.preview.discipline_level && (
                              <>
                                <Icon name="refresh" size={12} className="text-neutral-400" />
                                <LevelBadge level={returnModal.preview.new_level} />
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>

            {/* Footer Modal */}
            <div className="border-t border-neutral-200/80 px-6 py-4 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setReturnModal({ open: false, item: null, loading: false, condition: '', notes: '', returnedAt: '', preview: null, previewLoading: false, confirmStep: false })}
                disabled={returnModal.loading}
                className="rounded-[10px] border border-neutral-300 bg-white px-4 py-2 text-[13px] font-medium text-[#4A5B56] hover:bg-neutral-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmReturn}
                disabled={returnModal.loading || !returnModal.condition}
                className="flex items-center gap-1.5 rounded-[10px] bg-[#1E3F70] px-4 py-2 text-[13px] font-semibold text-white shadow-xs hover:bg-[#162e55] disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                <Icon name={returnModal.loading ? 'refresh' : 'check'} size={15} className={returnModal.loading ? 'animate-spin' : ''} />
                {returnModal.loading ? 'Menyimpan...' : 'Konfirmasi Pengembalian'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
