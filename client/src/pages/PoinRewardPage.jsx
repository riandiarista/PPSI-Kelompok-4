import { useEffect, useState, useMemo, useCallback } from 'react'
import Icon from '../components/Icon'
import { api } from '../lib/api'

// Format "2026-11-20T14:30:00Z" -> "20 Nov 2026, 14:30 WIB"
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

export default function PoinRewardPage() {
  // State data utama
  const [pointsData, setPointsData] = useState(null)
  const [history, setHistory] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, total_pages: 1 })
  const [rewardPeriods, setRewardPeriods] = useState([])
  const [myAwards, setMyAwards] = useState([])

  // State antarmuka
  const [activeTab, setActiveTab] = useState('history') // 'history' | 'rewards' | 'my-awards'
  const [filterType, setFilterType] = useState('')
  const [loadingPoints, setLoadingPoints] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingRewards, setLoadingRewards] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // Fetch ringkasan poin & level aktif pengguna
  const loadPointsSummary = useCallback(async () => {
    setLoadingPoints(true)
    try {
      const res = await api('/points/me')
      setPointsData(res.data)
      setError('')
    } catch (err) {
      setError(err.message || 'Gagal memuat informasi poin pengguna')
    } finally {
      setLoadingPoints(false)
    }
  }, [])

  // Fetch riwayat perubahan poin (paginasi)
  const loadHistory = useCallback(async (page = 1, type = '') => {
    setLoadingHistory(true)
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '15' })
      if (type) qs.set('type', type)
      const res = await api(`/points/me/history?${qs.toString()}`)
      setHistory(res.data || [])
      if (res.pagination) setPagination(res.pagination)
    } catch (err) {
      console.error('Gagal memuat riwayat poin:', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  // Fetch daftar program reward & apresiasi
  const loadRewards = useCallback(async () => {
    setLoadingRewards(true)
    try {
      const [periodsRes, myAwardsRes] = await Promise.all([
        api('/points/rewards').catch(() => ({ data: [] })),
        api('/points/rewards/my-awards').catch(() => ({ data: [] })),
      ])
      setRewardPeriods(periodsRes.data || [])
      setMyAwards(myAwardsRes.data || [])
    } catch (err) {
      console.error('Gagal memuat reward:', err)
    } finally {
      setLoadingRewards(false)
    }
  }, [])

  // Inisialisasi data
  useEffect(() => {
    loadPointsSummary()
  }, [loadPointsSummary, refreshKey])

  useEffect(() => {
    loadHistory(pagination.page, filterType)
  }, [loadHistory, pagination.page, filterType, refreshKey])

  useEffect(() => {
    if (activeTab === 'rewards' || activeTab === 'my-awards') {
      loadRewards()
    }
  }, [activeTab, loadRewards, refreshKey])

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1)
  }

  // Ambang batas level kedisiplinan sesuai Dokumen A3 §3.4.5
  const levelTiers = useMemo(() => {
    if (pointsData?.all_levels) return pointsData.all_levels
    return [
      {
        level: 'beginner',
        label: 'Belum Pemula',
        range: '< 30 poin',
        badge: '🌱',
        description: 'Akun peminjam baru atau dengan akumulasi poin di bawah 30.',
      },
      {
        level: 'pemula',
        label: 'Pemula',
        range: '30 – 49 poin',
        badge: '🥉',
        description: 'Mulai membangun rekam jejak kedisiplinan peminjaman.',
      },
      {
        level: 'terpercaya',
        label: 'Terpercaya',
        range: '50 – 69 poin',
        badge: '🥈',
        description: 'Memiliki catatan peminjaman yang baik dan konsisten.',
      },
      {
        level: 'teladan',
        label: 'Teladan',
        range: '≥ 70 poin',
        badge: '🥇',
        description: 'Kedisiplinan tinggi, selalu tepat waktu dan merawat barang.',
      },
    ]
  }, [pointsData])

  // Ringkasan aturan poin yang berlaku (diatur Kadep); cadangan = nilai bawaan
  const ruleSummary = useMemo(() => {
    const get = (key, fallback) => pointsData?.point_rules?.find((r) => r.key === key)?.points ?? fallback
    return [
      { label: 'Tepat waktu & baik', points: get('ON_TIME_GOOD', 10) },
      { label: 'Rusak ringan', points: get('ON_TIME_MINOR_DAMAGE', 2) },
      { label: 'Keterlambatan', points: get('LATE_PER_DAY', -2), perDay: true },
      { label: 'Kerusakan parah/hilang', points: get('ON_TIME_MAJOR_DAMAGE', -5) + get('MAJOR_DAMAGE_PENALTY', -20) },
    ]
  }, [pointsData])

  return (
    <div className="space-y-6">
      {/* Header Halaman */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#14231F]">
            Poin, Level & Riwayat Reward
          </h1>
          <p className="mt-1 text-[13px] text-[#4A5B56]">
            Pantau akumulasi poin kedisiplinan, tingkat reputasi peminjaman, dan apresiasi berkala dari Departemen.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1.5 self-start rounded-[8px] border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#14231F] shadow-xs transition hover:bg-neutral-50"
        >
          <Icon name="refresh" size={14} className={loadingPoints ? 'animate-spin' : ''} />
          Segarkan
        </button>
      </div>

      {error ? (
        <div className="rounded-[12px] bg-red-50 p-4 text-[13px] text-red-600 border border-red-200">
          {error}
        </div>
      ) : null}

      {/* ─── KARTU UTAMA RINGKASAN SALDO & PROGRESS LEVEL ─── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Kartu 1 & 2: Saldo dan Progress Bar Level */}
        <div className="relative overflow-hidden rounded-[16px] border border-neutral-200/80 bg-white p-6 shadow-xs lg:col-span-2">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <span className="text-[12.5px] font-medium uppercase tracking-wider text-[#71827D]">
                Saldo Poin Kedisiplinan Anda
              </span>
              <div className="mt-1.5 flex items-baseline gap-3">
                <span className="text-[36px] font-extrabold tracking-tight text-[#14231F]">
                  {loadingPoints ? '...' : pointsData?.point_balance ?? 0}
                </span>
                <span className="text-[15px] font-semibold text-[#4A5B56]">Poin</span>
              </div>
            </div>

            {/* Badge Level Aktif */}
            <div className="inline-flex items-center gap-2 rounded-[12px] border border-[#1E3F70]/20 bg-[#F4F7FC] px-4 py-2.5">
              <span className="text-[24px]">
                {pointsData?.level_badge || '🌱'}
              </span>
              <div>
                <span className="block text-[11px] font-medium uppercase text-[#71827D]">
                  Level Aktif
                </span>
                <span className="text-[15px] font-bold text-[#1E3F70]">
                  {pointsData?.level_label || 'Belum Pemula'}
                </span>
              </div>
            </div>
          </div>

          {/* Progress Bar Menuju Level Berikutnya */}
          <div className="mt-6 border-t border-neutral-100 pt-5">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="font-medium text-[#14231F]">
                {pointsData?.level_next ? (
                  <>
                    Progres menuju level berikutnya (
                    <span className="font-semibold text-[#1E3F70]">
                      {pointsData?.level_next} Poin
                    </span>
                    )
                  </>
                ) : (
                  <span className="font-semibold text-emerald-700">
                    🎉 Level tertinggi tercapai! Pertahankan kedisiplinan Anda.
                  </span>
                )}
              </span>
              <span className="font-bold text-[#14231F]">
                {pointsData?.level_progress ?? 0}%
              </span>
            </div>

            {/* Bar */}
            <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#1E3F70] to-[#14532D] transition-all duration-500"
                style={{ width: `${pointsData?.level_progress ?? 0}%` }}
              />
            </div>

            {pointsData?.level_next && (
              <p className="mt-2 text-[12px] text-[#71827D]">
                Butuh{' '}
                <strong className="text-[#14231F]">
                  {Math.max(0, (pointsData?.level_next ?? 0) - (pointsData?.point_balance ?? 0))}
                </strong>{' '}
                poin lagi untuk naik ke tingkat selanjutnya.
              </p>
            )}
          </div>
        </div>

        {/* Kartu 3: Ringkasan Aktivitas Poin */}
        <div className="flex flex-col justify-between rounded-[16px] border border-neutral-200/80 bg-white p-6 shadow-xs">
          <h2 className="text-[13.5px] font-semibold text-[#14231F]">
            Statistik Riwayat Poin
          </h2>

          <div className="my-3 space-y-3">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
              <span className="flex items-center gap-2 text-[12.5px] text-[#4A5B56]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Icon name="plus" size={13} />
                </span>
                Total Didapat
              </span>
              <span className="font-bold text-emerald-700">
                +{pointsData?.stats?.total_earned ?? 0} poin
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
              <span className="flex items-center gap-2 text-[12.5px] text-[#4A5B56]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600">
                  <Icon name="x" size={13} />
                </span>
                Total Pengurangan
              </span>
              <span className="font-bold text-red-600">
                -{pointsData?.stats?.total_deducted ?? 0} poin
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
              <span className="flex items-center gap-2 text-[12.5px] text-[#4A5B56]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[#1E3F70]">
                  <Icon name="check" size={13} />
                </span>
                Tepat Waktu
              </span>
              <span className="font-semibold text-[#14231F]">
                {pointsData?.stats?.on_time_count ?? 0} kali
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12.5px] text-[#4A5B56]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  <Icon name="clock" size={13} />
                </span>
                Terlambat
              </span>
              <span className="font-semibold text-[#14231F]">
                {pointsData?.stats?.late_count ?? 0} kali
              </span>
            </div>
          </div>

          <div className="rounded-[10px] bg-neutral-50 p-2.5 text-center text-[11.5px] text-[#71827D]">
            Total transaksi poin dicatat: <strong>{pointsData?.stats?.total_transactions ?? 0}</strong>
          </div>
        </div>
      </div>

      {/* ─── KOTAK INFORMASI LEVEL KEDISIPLINAN (A3 §3.4.5) ─── */}
      <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
        <div className="flex flex-col gap-1 border-b border-neutral-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-[#14231F]">
              Tingkat Kedisiplinan Peminjam
            </h2>
            <p className="text-[12px] text-[#71827D]">
              Berdasarkan ambang batas akumulasi poin kedisiplinan peminjaman barang inventaris.
            </p>
          </div>
          <span className="self-start rounded-full bg-blue-50 px-3 py-1 text-[11.5px] font-semibold text-[#1E3F70]">
            Pedoman Standar Departemen
          </span>
        </div>

        {/* 4 Kolom Tier Level */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {levelTiers.map((tier) => {
            const isActive = pointsData?.discipline_level === tier.level
            return (
              <div
                key={tier.level}
                className={`relative rounded-[12px] border p-4 transition ${
                  isActive
                    ? 'border-[#1E3F70] bg-[#F4F7FC] ring-2 ring-[#1E3F70]/20'
                    : 'border-neutral-200/80 bg-white hover:border-neutral-300'
                }`}
              >
                {isActive && (
                  <span className="absolute right-3 top-3 rounded-full bg-[#1E3F70] px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                    Level Anda
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[20px]">{tier.badge}</span>
                  <div>
                    <h3 className="text-[13.5px] font-bold text-[#14231F]">{tier.label}</h3>
                    <span className="inline-block rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-[#4A5B56]">
                      {tier.range}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-[#4A5B56]">
                  {tier.description}
                </p>
              </div>
            )
          })}
        </div>

        {/* Ringkasan Perhitungan Poin */}
        <div className="mt-4 rounded-[12px] bg-[#FAFBF9] border border-neutral-200/60 p-3.5 text-[12px] text-[#4A5B56] leading-relaxed">
          <strong className="text-[#14231F]">Aturan Perhitungan Poin:</strong>
          {ruleSummary.map((r) => (
            <span
              key={r.label}
              className={`ml-2 inline-flex items-center gap-1 ${r.points >= 0 ? 'text-emerald-800' : 'text-red-700'}`}
            >
              • {r.label}: <strong>{r.points > 0 ? `+${r.points}` : r.points} poin{r.perDay ? ' / hari' : ''}</strong>
            </span>
          ))}
          <span className="ml-2 text-[#71827D]">
            • Saldo minimum: <strong>0 poin</strong> (tidak pernah bernilai negatif).
          </span>
        </div>
      </div>

      {/* ─── PANEL TABS & TABEL RIWAYAT / REWARD ─── */}
      <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
        {/* Navigasi Tab */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/80 pb-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition ${
                activeTab === 'history'
                  ? 'bg-[#1E3F70] text-white'
                  : 'bg-neutral-100 text-[#4A5B56] hover:bg-neutral-200/70'
              }`}
            >
              <Icon name="clock" size={15} />
              <span>Riwayat Mutasi Poin</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  activeTab === 'history' ? 'bg-white/20 text-white' : 'bg-neutral-200 text-[#14231F]'
                }`}
              >
                {pagination.total}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('rewards')}
              className={`flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition ${
                activeTab === 'rewards'
                  ? 'bg-[#1E3F70] text-white'
                  : 'bg-neutral-100 text-[#4A5B56] hover:bg-neutral-200/70'
              }`}
            >
              <Icon name="award" size={15} />
              <span>Program Reward & Apresiasi</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  activeTab === 'rewards' ? 'bg-white/20 text-white' : 'bg-neutral-200 text-[#14231F]'
                }`}
              >
                {rewardPeriods.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('my-awards')}
              className={`flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition ${
                activeTab === 'my-awards'
                  ? 'bg-[#1E3F70] text-white'
                  : 'bg-neutral-100 text-[#4A5B56] hover:bg-neutral-200/70'
              }`}
            >
              <Icon name="check-circle" size={15} />
              <span>Penghargaan Saya</span>
              {myAwards.length > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    activeTab === 'my-awards' ? 'bg-white/20 text-white' : 'bg-neutral-200 text-[#14231F]'
                  }`}
                >
                  {myAwards.length}
                </span>
              )}
            </button>
          </div>

          {/* Filter Tipe Transaksi (Khusus tab history) */}
          {activeTab === 'history' && (
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-[#71827D]">Filter Tipe:</span>
              <select
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value)
                  setPagination((prev) => ({ ...prev, page: 1 }))
                }}
                className="rounded-[10px] border border-neutral-300 bg-white px-3 py-1.5 text-[12.5px] text-[#14231F] focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
              >
                <option value="">Semua Mutasi</option>
                <option value="on_time_return">Tepat Waktu (+)</option>
                <option value="late_penalty">Penalti Terlambat (-)</option>
                <option value="manual_adjustment">Penyesuaian Manual</option>
              </select>
            </div>
          )}
        </div>

        {/* ─── TAB 1: RIWAYAT MUTASI POIN ─── */}
        {activeTab === 'history' && (
          <div>
            {loadingHistory ? (
              <div className="flex flex-col items-center justify-center py-16 text-[#4A5B56]">
                <Icon name="refresh" size={28} className="animate-spin text-[#1E3F70]" />
                <p className="mt-3 text-[13.5px] font-medium">Memuat riwayat poin...</p>
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-[#4A5B56]">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                  <Icon name="clock" size={24} />
                </div>
                <p className="mt-3 text-[14px] font-semibold text-[#14231F]">
                  Belum ada riwayat poin
                </p>
                <p className="mt-1 text-[12.5px] text-[#71827D]">
                  {filterType
                    ? 'Tidak ada mutasi yang cocok dengan filter yang dipilih.'
                    : 'Poin Anda akan tercatat secara otomatis setiap kali melakukan pengembalian barang.'}
                </p>
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50/70 text-[12px] font-semibold text-[#4A5B56]">
                      <th className="px-3.5 py-3">Waktu Pencatatan</th>
                      <th className="px-3.5 py-3">Barang Inventaris</th>
                      <th className="px-3.5 py-3">Jenis Aktivitas</th>
                      <th className="px-3.5 py-3">Keterangan / Alasan</th>
                      <th className="px-3.5 py-3 text-right">Perubahan Poin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {history.map((tx) => {
                      const isPlus = tx.points_delta > 0
                      return (
                        <tr key={tx.point_transaction_id} className="transition-colors hover:bg-neutral-50/60">
                          {/* Waktu */}
                          <td className="px-3.5 py-3.5 align-top whitespace-nowrap text-[#14231F]">
                            {formatDateTime(tx.created_at)}
                          </td>

                          {/* Barang */}
                          <td className="px-3.5 py-3.5 align-top">
                            {tx.item_name ? (
                              <div>
                                <span className="font-semibold text-[#14231F]">{tx.item_name}</span>
                                {tx.category_name && (
                                  <span className="block text-[11.5px] text-[#71827D]">
                                    {tx.category_name}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[#71827D]">-</span>
                            )}
                          </td>

                          {/* Jenis Aktivitas */}
                          <td className="px-3.5 py-3.5 align-top">
                            <span
                              className={`inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[11.5px] font-medium ${
                                tx.transaction_type === 'on_time_return'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : tx.transaction_type === 'late_penalty'
                                  ? 'border-red-200 bg-red-50 text-red-800'
                                  : 'border-blue-200 bg-blue-50 text-blue-800'
                              }`}
                            >
                              <Icon
                                name={isPlus ? 'check' : 'alert-circle'}
                                size={12}
                              />
                              {tx.type_label}
                            </span>
                          </td>

                          {/* Keterangan */}
                          <td className="px-3.5 py-3.5 align-top max-w-[320px]">
                            <p className="text-[#4A5B56] leading-relaxed">
                              {tx.reason || '-'}
                            </p>
                          </td>

                          {/* Delta Poin */}
                          <td className="px-3.5 py-3.5 align-top text-right whitespace-nowrap">
                            <span
                              className={`inline-block font-extrabold text-[14px] ${
                                isPlus ? 'text-emerald-700' : 'text-red-600'
                              }`}
                            >
                              {isPlus ? `+${tx.points_delta}` : tx.points_delta} Poin
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Paginasi */}
                {pagination.total_pages > 1 && (
                  <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
                    <span className="text-[12px] text-[#71827D]">
                      Halaman {pagination.page} dari {pagination.total_pages} ({pagination.total} mutasi)
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!pagination.has_prev}
                        onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                        className="rounded-[8px] border border-neutral-200 bg-white px-3 py-1 text-[12px] font-medium text-[#14231F] hover:bg-neutral-50 disabled:opacity-40"
                      >
                        Sebelumnya
                      </button>
                      <button
                        type="button"
                        disabled={!pagination.has_next}
                        onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                        className="rounded-[8px] border border-neutral-200 bg-white px-3 py-1 text-[12px] font-medium text-[#14231F] hover:bg-neutral-50 disabled:opacity-40"
                      >
                        Selanjutnya
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 2: PROGRAM REWARD & APRESIASI ─── */}
        {activeTab === 'rewards' && (
          <div className="space-y-4 pt-2">
            {/* Banner Penjelasan Aturan Bisnis Reward A3 */}
            <div className="flex items-start gap-3 rounded-[12px] bg-[#EBF3FB] p-4 text-[13px] leading-relaxed text-[#1E3F70]">
              <Icon name="award" size={20} className="mt-0.5 shrink-0" />
              <div>
                <strong className="font-bold">Konsep Reward Departemen:</strong> Program reward merupakan bentuk <strong>apresiasi dan piagam penghargaan berkala</strong> bagi peraih akumulasi poin tertinggi dalam satu semester/periode.
                <div className="mt-1 text-[12px] opacity-90">
                  * <strong>Penting:</strong> Ini <u>bukan</u> sistem tukar poin yang mengurangi saldo Anda. Saldo dan tingkat reputasi peminjaman Anda tetap utuh.
                </div>
              </div>
            </div>

            {loadingRewards ? (
              <div className="flex flex-col items-center justify-center py-16 text-[#4A5B56]">
                <Icon name="refresh" size={28} className="animate-spin text-[#1E3F70]" />
                <p className="mt-3 text-[13.5px] font-medium">Memuat program reward...</p>
              </div>
            ) : rewardPeriods.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-[#4A5B56]">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                  <Icon name="award" size={24} />
                </div>
                <p className="mt-3 text-[14px] font-semibold text-[#14231F]">
                  Belum ada periode reward yang dibuat
                </p>
                <p className="mt-1 text-[12.5px] text-[#71827D]">
                  Ketua Departemen akan menjadwalkan periode penilaian reward bagi peminjam teladan.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {rewardPeriods.map((period) => (
                  <div
                    key={period.period_id}
                    className="rounded-[14px] border border-neutral-200/80 bg-white p-5 shadow-xs"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[15px] font-bold text-[#14231F]">
                            {period.period_name}
                          </h3>
                          {period.is_active ? (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                              Periode Berjalan
                            </span>
                          ) : (
                            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600">
                              Selesai
                            </span>
                          )}
                        </div>
                        <span className="mt-1 text-[12px] text-[#71827D]">
                          Rentang Waktu: {formatTanggal(period.started_at)} – {formatTanggal(period.ended_at)}
                        </span>
                      </div>
                    </div>

                    {/* Daftar Pemenang Penghargaan dalam Periode Ini */}
                    <div className="mt-4">
                      <h4 className="text-[12.5px] font-semibold uppercase tracking-wider text-[#4A5B56]">
                        Penerima Penghargaan
                      </h4>

                      {period.awards && period.awards.length > 0 ? (
                        <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {period.awards.map((aw) => (
                            <div
                              key={aw.award_id}
                              className="rounded-[12px] border border-neutral-200 bg-neutral-50/70 p-3.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-[13.5px] text-[#1E3F70]">
                                  🏆 {aw.reward_name}
                                </span>
                                <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-800 border border-neutral-200">
                                  {aw.winner_points} Poin
                                </span>
                              </div>
                              <p className="mt-1 text-[12px] text-[#71827D]">
                                {aw.reward_description}
                              </p>
                              <div className="mt-3 flex items-center justify-between border-t border-neutral-200/60 pt-2 text-[12px]">
                                <span className="font-medium text-[#14231F]">
                                  Penerima: <strong>{aw.winner_name}</strong>
                                </span>
                                <span className="text-[#71827D]">
                                  {formatTanggal(aw.awarded_at)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-[12.5px] italic text-[#71827D]">
                          Penilaian untuk periode ini sedang berjalan. Terus jaga kedisiplinan peminjaman Anda!
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 3: PENGHARGAAN SAYA ─── */}
        {activeTab === 'my-awards' && (
          <div className="pt-2">
            {loadingRewards ? (
              <div className="flex flex-col items-center justify-center py-16 text-[#4A5B56]">
                <Icon name="refresh" size={28} className="animate-spin text-[#1E3F70]" />
                <p className="mt-3 text-[13.5px] font-medium">Memeriksa penghargaan Anda...</p>
              </div>
            ) : myAwards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-[#4A5B56]">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <Icon name="award" size={28} />
                </div>
                <p className="mt-3 text-[15px] font-bold text-[#14231F]">
                  Belum Ada Piagam Penghargaan
                </p>
                <p className="mt-1 max-w-md text-[12.5px] text-[#71827D]">
                  Anda belum tercatat sebagai penerima penghargaan reward semester ini. Pertahankan pengembalian tepat waktu dan kondisi barang tetap baik untuk meraih posisi teratas!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {myAwards.map((aw) => (
                  <div
                    key={aw.award_id}
                    className="relative overflow-hidden rounded-[16px] border border-amber-300 bg-gradient-to-br from-amber-50/60 to-white p-5 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-[20px]">
                        🏆
                      </span>
                      <span className="rounded-full bg-amber-200/60 px-3 py-1 text-[11px] font-bold text-amber-900">
                        {aw.period_name}
                      </span>
                    </div>

                    <h3 className="mt-3 text-[16px] font-bold text-[#14231F]">
                      {aw.reward_name}
                    </h3>
                    <p className="mt-1 text-[12.5px] text-[#4A5B56]">
                      {aw.reward_description}
                    </p>

                    {aw.note && (
                      <div className="mt-3 rounded-[8px] bg-white/80 p-2.5 text-[11.5px] italic text-[#71827D] border border-amber-200/50">
                        &ldquo;{aw.note}&rdquo;
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between border-t border-amber-200/60 pt-2.5 text-[11.5px] text-[#71827D]">
                      <span>Departemen Bahasa Inggris UNP</span>
                      <span>Diberikan: {formatTanggal(aw.awarded_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}