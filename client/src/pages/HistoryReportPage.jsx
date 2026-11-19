import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { api } from '../lib/api'

const ACTIVITY_PAGE_SIZE = 20

const TABS = [
  { id: 'loans', label: 'Riwayat peminjaman' },
  { id: 'inventory', label: 'Laporan inventaris' },
  { id: 'activity', label: 'Log aktivitas' },
]

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'
]

function formatLoanRange(handoverAt, dueAt, returnedAt) {
  if (!handoverAt) return '-'
  try {
    const dStart = new Date(handoverAt)
    const dDue = dueAt ? new Date(dueAt) : dStart
    const dRet = returnedAt ? new Date(returnedAt) : null

    const startDay = dStart.getUTCDate()
    const startMonth = MONTH_NAMES[dStart.getUTCMonth()]
    const dueDay = dDue.getUTCDate()
    const dueMonth = MONTH_NAMES[dDue.getUTCMonth()]

    let range = ''
    if (startMonth === dueMonth) {
      range = `${startDay} – ${dueDay} ${startMonth}`
    } else {
      range = `${startDay} ${startMonth} – ${dueDay} ${dueMonth}`
    }

    if (dRet) {
      const retDay = dRet.getUTCDate()
      const retMonth = MONTH_NAMES[dRet.getUTCMonth()]
      return `${range} · kembali ${retDay} ${retMonth}`
    }
    return range
  } catch {
    return '-'
  }
}

function currentWibMonth() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
}

function createRecentPeriods() {
  const [year, month] = currentWibMonth().split('-').map(Number)
  return [0, 1, 2].map((offset) => {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1))
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    return {
      value,
      label: new Intl.DateTimeFormat('id-ID', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date),
    }
  })
}

const CONDITION_LABELS = {
  good: 'Kondisi baik',
  minor_damage: 'Kerusakan ringan',
  major_damage: 'Kerusakan besar / hilang',
}

const CONDITION_STYLES = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  minor_damage: 'border-amber-200 bg-amber-50 text-amber-700',
  major_damage: 'border-red-200 bg-red-50 text-red-700',
}

const STATUS_LABELS = {
  available: 'Tersedia',
  borrowed: 'Dipinjam',
  maintenance: 'Perbaikan',
  unavailable: 'Tidak tersedia',
}

const STATUS_STYLES = {
  available: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  borrowed: 'border-blue-200 bg-blue-50 text-blue-700',
  maintenance: 'border-amber-200 bg-amber-50 text-amber-700',
  unavailable: 'border-neutral-200 bg-neutral-100 text-neutral-600',
}

const ACTION_LABELS = {
  create_user: 'Membuat akun',
  approve_user_registration: 'Menyetujui pendaftaran akun',
  reject_user_registration: 'Menolak pendaftaran akun',
  toggle_user_active: 'Mengubah status akun',
  create_category: 'Membuat kategori',
  update_category: 'Mengubah kategori',
  delete_category: 'Menghapus kategori',
  create_item: 'Menambahkan barang',
  update_item: 'Mengubah barang',
  toggle_item_active: 'Mengubah status barang',
  create_loan_request: 'Mengajukan peminjaman',
  approve_loan_request: 'Menyetujui peminjaman',
  reject_loan_request: 'Menolak peminjaman',
  handover_loan: 'Serah terima barang',
  confirm_return: 'Konfirmasi pengembalian',
  google_registration: 'Pendaftaran akun Google',
}

function formatDateTime(value) {
  if (!value) return '-'
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    }).format(new Date(value)) + ' WIB'
  } catch {
    return value
  }
}

function formatDate(value) {
  if (!value) return '-'
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }).format(new Date(value))
  } catch {
    return value
  }
}

export default function HistoryReportPage({ isKadep = false }) {
  const [activeTab, setActiveTab] = useState('loans')
  const [groupBy, setGroupBy] = useState('item') // 'item' | 'borrower'
  const periodOptions = useMemo(() => createRecentPeriods(), [])
  const [reportPeriod, setReportPeriod] = useState(currentWibMonth)

  // Search & Filter
  const [search, setSearch] = useState('')
  const [loanPunctualityFilter, setLoanPunctualityFilter] = useState('all') // 'all' | 'on_time' | 'late'
  const [loanConditionFilter, setLoanConditionFilter] = useState('all') // 'all' | 'good' | 'damaged'
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState('all')

  // Data states
  const [loans, setLoans] = useState([])
  const [lateLoans, setLateLoans] = useState([])
  const [inventory, setInventory] = useState([])
  const [inventoryStats, setInventoryStats] = useState({
    total_items: 0,
    available_items: 0,
    borrowed_items: 0,
    maintenance_items: 0,
  })
  const [activities, setActivities] = useState([])
  const [activityPagination, setActivityPagination] = useState({ page: 1, total_pages: 1, total: 0 })
  const [activityPage, setActivityPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const tabs = isKadep
    ? [TABS[0], { id: 'late', label: 'Rekap keterlambatan' }, ...TABS.slice(1)]
    : TABS

  // Fetch data sesuai tab yang aktif
  useEffect(() => {
    let cancelled = false
    const fetchData = async () => {
      try {
        setError('')
        if (activeTab === 'loans') {
          const query = new URLSearchParams({ sort_by: 'returned_at', sort_order: 'desc' })
          if (search.trim()) query.set('search', search.trim())
          const response = await api(`/loans/history?${query.toString()}`)
          if (!cancelled) {
            setLoans(response.data || [])
          }
        } else if (activeTab === 'late') {
          const query = new URLSearchParams({ month: reportPeriod, sort_by: 'due_at', sort_order: 'asc' })
          if (search.trim()) query.set('search', search.trim())
          const response = await api(`/loans/late-report?${query.toString()}`)
          if (!cancelled) {
            setLateLoans(response.data?.items || [])
          }
        } else if (activeTab === 'inventory') {
          const query = new URLSearchParams()
          if (search.trim()) query.set('search', search.trim())
          const queryString = query.toString()
          const suffix = queryString ? `?${queryString}` : ''
          const response = await api(`/inventory/items${suffix}`)
          if (!cancelled) {
            setInventory(response.data || [])
            setInventoryStats(response.stats || {
              total_items: 0,
              available_items: 0,
              borrowed_items: 0,
              maintenance_items: 0,
            })
          }
        } else if (activeTab === 'activity') {
          const query = new URLSearchParams({
            page: String(activityPage),
            page_size: String(ACTIVITY_PAGE_SIZE),
            sort_by: 'occurred_at',
            sort_order: 'desc',
          })
          if (search.trim()) query.set('search', search.trim())
          const response = await api(`/audit-logs?${query.toString()}`)
          if (!cancelled) {
            setActivities(response.data?.items || [])
            setActivityPagination(response.data?.pagination || { page: 1, total_pages: 1, total: 0 })
          }
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError.message || 'Gagal memuat data dari server')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [activeTab, search, activityPage, refreshKey, reportPeriod])

  // Filter Riwayat Peminjaman di sisi client
  const filteredLoans = useMemo(() => {
    return loans.filter((loan) => {
      // Filter ketepatan waktu
      if (loanPunctualityFilter === 'on_time' && loan.late_days > 0) return false
      if (loanPunctualityFilter === 'late' && loan.late_days === 0) return false

      // Filter kondisi barang
      if (loanConditionFilter === 'good' && loan.return_condition !== 'good') return false
      if (loanConditionFilter === 'damaged' && loan.return_condition === 'good') return false

      return true
    })
  }, [loans, loanPunctualityFilter, loanConditionFilter])

  // Pengelompokan riwayat berdasarkan Barang atau Peminjam
  const displayLoans = useMemo(() => {
    const list = [...filteredLoans]
    if (groupBy === 'item') {
      return list.sort((a, b) => a.item_name.localeCompare(b.item_name, 'id') || new Date(b.returned_at) - new Date(a.returned_at))
    }
    return list.sort((a, b) => a.borrower_name.localeCompare(b.borrower_name, 'id') || new Date(b.returned_at) - new Date(a.returned_at))
  }, [filteredLoans, groupBy])

  // Filter Laporan Inventaris
  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      if (inventoryStatusFilter === 'all') return true
      return item.availability_status === inventoryStatusFilter
    })
  }, [inventory, inventoryStatusFilter])

  const changeTab = (tabId) => {
    if (tabId === activeTab) return
    setActiveTab(tabId)
    setSearch('')
    setActivityPage(1)
    setLoading(true)
  }

  const triggerRefresh = () => {
    setLoading(true)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header Halaman Sesuai Desain UI */}
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.01em] text-[#14231F] sm:text-[30px] sm:leading-[38px]">
          Riwayat &amp; laporan
        </h1>
        <p className="mt-1 text-[13.5px] text-[#4A5B56]">
          Telusuri siapa meminjam apa, kapan, dan dalam kondisi bagaimana.
        </p>
      </div>

      {/* Navigasi Tiga Tab Berbentuk Pills */}
      <div className="flex flex-wrap items-center gap-2.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => changeTab(tab.id)}
              className={`rounded-full px-5 py-2 text-[13.5px] font-medium transition ${
                isActive
                  ? 'bg-[#1E3F70] text-white shadow-sm'
                  : 'border border-neutral-300 bg-white text-[#14231F] hover:bg-neutral-50'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Kontrol & Filter Tab: Riwayat Peminjaman */}
      {activeTab === 'loans' && (
        <div className="flex flex-col gap-4">
          {/* Baris Kelompokkan Menurut & Pencarian */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Kelompokkan menurut: Barang | Peminjam */}
            <div className="flex items-center gap-2 text-[13px]">
              <span className="font-medium text-[#14231F]">Kelompokkan menurut</span>
              <button
                type="button"
                onClick={() => setGroupBy('item')}
                className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
                  groupBy === 'item'
                    ? 'bg-[#1E3F70] text-white shadow-sm'
                    : 'border border-neutral-300 bg-white text-[#14231F] hover:bg-neutral-50'
                }`}
              >
                Barang
              </button>
              <button
                type="button"
                onClick={() => setGroupBy('borrower')}
                className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
                  groupBy === 'borrower'
                    ? 'bg-[#1E3F70] text-white shadow-sm'
                    : 'border border-neutral-300 bg-white text-[#14231F] hover:bg-neutral-50'
                }`}
              >
                Peminjam
              </button>
            </div>

            {/* Input Pencarian */}
            <div className="relative w-full sm:w-[280px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari barang atau peminjam..."
                className="w-full rounded-[10px] border border-neutral-300 bg-white px-3.5 py-1.5 text-[13px] text-[#14231F] placeholder:text-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Filter Cepat: Ketepatan & Kondisi */}
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-[#4A5B56]">Filter status:</span>
            <button
              type="button"
              onClick={() => setLoanPunctualityFilter('all')}
              className={`rounded-md px-2.5 py-1 transition ${
                loanPunctualityFilter === 'all'
                  ? 'bg-neutral-200 font-semibold text-[#14231F]'
                  : 'bg-white text-[#4A5B56] hover:bg-neutral-100 border border-neutral-200'
              }`}
            >
              Semua
            </button>
            <button
              type="button"
              onClick={() => setLoanPunctualityFilter('on_time')}
              className={`rounded-md px-2.5 py-1 transition ${
                loanPunctualityFilter === 'on_time'
                  ? 'bg-emerald-100 font-semibold text-emerald-800 border border-emerald-300'
                  : 'bg-white text-[#4A5B56] hover:bg-neutral-100 border border-neutral-200'
              }`}
            >
              Tepat waktu
            </button>
            <button
              type="button"
              onClick={() => setLoanPunctualityFilter('late')}
              className={`rounded-md px-2.5 py-1 transition ${
                loanPunctualityFilter === 'late'
                  ? 'bg-red-100 font-semibold text-red-800 border border-red-300'
                  : 'bg-white text-[#4A5B56] hover:bg-neutral-100 border border-neutral-200'
              }`}
            >
              Terlambat
            </button>

            <span className="ml-2 text-[#4A5B56]">Kondisi:</span>
            <button
              type="button"
              onClick={() => setLoanConditionFilter('all')}
              className={`rounded-md px-2.5 py-1 transition ${
                loanConditionFilter === 'all'
                  ? 'bg-neutral-200 font-semibold text-[#14231F]'
                  : 'bg-white text-[#4A5B56] hover:bg-neutral-100 border border-neutral-200'
              }`}
            >
              Semua
            </button>
            <button
              type="button"
              onClick={() => setLoanConditionFilter('good')}
              className={`rounded-md px-2.5 py-1 transition ${
                loanConditionFilter === 'good'
                  ? 'bg-neutral-200 font-semibold text-[#14231F]'
                  : 'bg-white text-[#4A5B56] hover:bg-neutral-100 border border-neutral-200'
              }`}
            >
              Kondisi baik
            </button>
            <button
              type="button"
              onClick={() => setLoanConditionFilter('damaged')}
              className={`rounded-md px-2.5 py-1 transition ${
                loanConditionFilter === 'damaged'
                  ? 'bg-amber-100 font-semibold text-amber-800 border border-amber-300'
                  : 'bg-white text-[#4A5B56] hover:bg-neutral-100 border border-neutral-200'
              }`}
            >
              Kondisi rusak
            </button>
          </div>
        </div>
      )}

      {/* Notifikasi Error */}
      {error && (
        <div className="rounded-[10px] border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {/* Indikator Memuat Data */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-[14px] border border-neutral-200 bg-white py-16 text-[13.5px] text-[#4A5B56] shadow-sm">
          <Icon name="refresh" size={16} className="animate-spin text-[#1E3F70]" />
          Memuat data dari database...
        </div>
      ) : !error && activeTab === 'loans' ? (
        /* ========================================================================= */
        /* TAB 1: DAFTAR KARTU RIWAYAT PEMINJAMAN (SESUAI GAMBAR UI)                 */
        /* ========================================================================= */
        <section className="space-y-3">
          {displayLoans.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-neutral-300 bg-white px-6 py-16 text-center text-[13.5px] text-[#4A5B56]">
              Belum ada riwayat peminjaman yang cocok dengan pencarian atau filter.
            </div>
          ) : (
            displayLoans.map((loan) => {
              const isLate = loan.late_days > 0
              const isDamaged = loan.return_condition !== 'good'

              return (
                <article
                  key={loan.loan_id}
                  className="flex flex-col justify-between gap-3 rounded-[14px] border border-neutral-200/90 bg-white p-4 shadow-2xs transition hover:border-neutral-300 sm:flex-row sm:items-center sm:px-6 sm:py-5"
                >
                  {/* Bagian Kiri: Nama Barang / Peminjam, Subjudul, dan Rentang Waktu */}
                  <div>
                    {/* Judul Utama Kartu */}
                    <h2 className="text-[15px] font-bold text-[#14231F]">
                      {groupBy === 'item' ? loan.item_name : loan.borrower_name}
                    </h2>

                    {/* Subjudul: Peminjam atau Nama Barang */}
                    <p className="mt-0.5 text-[13px] font-semibold text-[#14231F]">
                      {groupBy === 'item' ? loan.borrower_name : loan.item_name}
                    </p>

                    {/* Rentang Tanggal Pinjam dan Tanggal Kembali (Contoh: 1 – 8 Okt · kembali 8 Okt) */}
                    <p className="mt-0.5 text-[12px] text-[#4A5B56]">
                      {formatLoanRange(loan.handover_at, loan.due_at, loan.returned_at)}
                    </p>
                  </div>

                  {/* Bagian Kanan: Badge Status Keterlambatan dan Kondisi Barang */}
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Badge Ketepatan Waktu */}
                    {isLate ? (
                      <span className="rounded-full border border-[#F8B4B4] bg-[#FDE8E8] px-3 py-1 text-[11px] font-semibold text-[#C81E1E]">
                        Terlambat {loan.late_days} hari
                      </span>
                    ) : (
                      <span className="rounded-full border border-[#D4EDDA] bg-[#EBF7EE] px-3 py-1 text-[11px] font-semibold text-[#1E7E34]">
                        Tepat waktu
                      </span>
                    )}

                    {/* Badge Kondisi Pengembalian */}
                    {isDamaged ? (
                      <span className="rounded-full border border-[#FDE68A] bg-[#FEF3C7] px-3 py-1 text-[11px] font-semibold text-[#92400E]">
                        Kondisi rusak
                      </span>
                    ) : (
                      <span className="rounded-full border border-[#E5E7EB] bg-[#F3F4F6] px-3 py-1 text-[11px] font-semibold text-[#374151]">
                        Kondisi baik
                      </span>
                    )}
                  </div>
                </article>
              )
            })
          )}
        </section>
      ) : !error && activeTab === 'inventory' ? (
        /* ========================================================================= */
        /* TAB 2: LAPORAN INVENTARIS DARI DATA AKTUAL DATABASE                       */
        /* ========================================================================= */
        <section className="space-y-4">
          {/* Ringkasan Kartu Statistik Sesuai Database */}
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            <div className="rounded-[14px] border border-neutral-200/90 bg-white p-4 shadow-2xs">
              <p className="text-[12.5px] font-medium text-[#4A5B56]">Total barang</p>
              <p className="mt-1 text-[24px] font-extrabold text-[#14231F]">{inventoryStats.total_items || 0}</p>
            </div>
            <div className="rounded-[14px] border border-neutral-200/90 bg-white p-4 shadow-2xs">
              <p className="text-[12.5px] font-medium text-[#4A5B56]">Tersedia</p>
              <p className="mt-1 text-[24px] font-extrabold text-[#1E7E34]">{inventoryStats.available_items || 0}</p>
            </div>
            <div className="rounded-[14px] border border-neutral-200/90 bg-white p-4 shadow-2xs">
              <p className="text-[12.5px] font-medium text-[#4A5B56]">Dipinjam</p>
              <p className="mt-1 text-[24px] font-extrabold text-[#1E3F70]">{inventoryStats.borrowed_items || 0}</p>
            </div>
            <div className="rounded-[14px] border border-neutral-200/90 bg-white p-4 shadow-2xs">
              <p className="text-[12.5px] font-medium text-[#4A5B56]">Perbaikan</p>
              <p className="mt-1 text-[24px] font-extrabold text-[#B76E00]">{inventoryStats.maintenance_items || 0}</p>
            </div>
          </div>

          {/* Filter Status Inventaris & Pencarian */}
          <div className="flex flex-col gap-3 rounded-[12px] border border-neutral-200/80 bg-white p-3.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="mr-1 text-[#4A5B56]">Status:</span>
              {[
                ['all', 'Semua'],
                ['available', 'Tersedia'],
                ['borrowed', 'Dipinjam'],
                ['maintenance', 'Perbaikan'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setInventoryStatusFilter(key)}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                    inventoryStatusFilter === key
                      ? 'bg-[#1E3F70] text-white shadow-2xs'
                      : 'border border-neutral-200 bg-white text-[#14231F] hover:bg-neutral-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-[240px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari barang atau kategori..."
                className="w-full rounded-[8px] border border-neutral-300 bg-white px-3 py-1.5 text-[12.5px] text-[#14231F] placeholder:text-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-1 focus:ring-[#1E3F70]"
              />
            </div>
          </div>

          {/* Daftar Barang Inventaris */}
          {filteredInventory.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-neutral-300 bg-white px-6 py-14 text-center text-[13.5px] text-[#4A5B56]">
              Tidak ada barang yang cocok dengan kriteria filter.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredInventory.map((item) => (
                <article
                  key={item.item_id}
                  className="flex flex-col justify-between gap-2.5 rounded-[12px] border border-neutral-200/90 bg-white px-4 py-3.5 shadow-2xs sm:flex-row sm:items-center"
                >
                  <div>
                    <h3 className="text-[14px] font-bold text-[#14231F]">{item.item_name}</h3>
                    <p className="mt-0.5 text-[12px] text-[#4A5B56]">Kategori: {item.category_name}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                        CONDITION_STYLES[item.item_condition] || 'border-neutral-200 bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {CONDITION_LABELS[item.item_condition] || item.item_condition}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                        STATUS_STYLES[item.availability_status] || 'border-neutral-200 bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {STATUS_LABELS[item.availability_status] || item.availability_status}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : !error && activeTab === 'activity' ? (
        /* ========================================================================= */
        /* TAB 3: LOG AKTIVITAS TERHUBUNG DENGAN BACKEND /api/audit-logs             */
        /* ========================================================================= */
        <section className="space-y-3">
          <div className="flex flex-col gap-3 rounded-[12px] border border-neutral-200/80 bg-white p-3.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[12.5px] font-medium text-[#4A5B56]">
              {activityPagination.total} aktivitas tercatat di sistem
            </span>
            <div className="relative w-full sm:w-[260px]">
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setActivityPage(1)
                }}
                placeholder="Cari aktivitas atau pelaku..."
                className="w-full rounded-[8px] border border-neutral-300 bg-white px-3 py-1.5 text-[12.5px] text-[#14231F] placeholder:text-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-1 focus:ring-[#1E3F70]"
              />
            </div>
          </div>

          {activities.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-neutral-300 bg-white px-6 py-14 text-center text-[13.5px] text-[#4A5B56]">
              Tidak ada log aktivitas yang cocok.
            </div>
          ) : (
            activities.map((activity) => (
              <article
                key={activity.audit_id}
                className="rounded-[12px] border border-neutral-200/90 bg-white px-4 py-3.5 shadow-2xs"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-[13px] font-bold text-[#14231F]">
                      {ACTION_LABELS[activity.action_type] || activity.action_type.replaceAll('_', ' ')}
                    </h3>
                    <p className="mt-0.5 text-[12px] text-[#4A5B56]">
                      Oleh: <strong className="text-[#14231F]">{activity.actor_name || 'Sistem'}</strong> ({activity.actor_role || '-'}) · Entitas: {activity.entity_type} #{activity.entity_id}
                    </p>
                  </div>
                  <time className="shrink-0 text-[11.5px] text-[#4A5B56]">
                    {formatDateTime(activity.occurred_at)}
                  </time>
                </div>
                {activity.details && Object.keys(activity.details).length > 0 && (
                  <details className="mt-2 text-[12px]">
                    <summary className="cursor-pointer text-[#1E3F70] hover:underline">
                      Lihat rincian log
                    </summary>
                    <pre className="mt-1.5 max-h-40 overflow-auto rounded-[8px] border border-neutral-200 bg-[#F6F7F5] p-2.5 text-[11px] text-[#14231F]">
                      {JSON.stringify(activity.details, null, 2)}
                    </pre>
                  </details>
                )}
              </article>
            ))
          )}

          {/* Pagination Log Aktivitas */}
          {activityPagination.total_pages > 1 && (
            <div className="flex items-center justify-between rounded-[10px] border border-neutral-200 bg-white px-4 py-2.5 shadow-2xs">
              <span className="text-[12px] text-[#4A5B56]">
                Halaman {activityPagination.page} dari {activityPagination.total_pages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={activityPage <= 1}
                  onClick={() => {
                    setActivityPage((c) => c - 1)
                    setLoading(true)
                  }}
                  className="rounded-[8px] border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium text-[#14231F] transition hover:bg-neutral-50 disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  disabled={activityPage >= activityPagination.total_pages}
                  onClick={() => {
                    setActivityPage((c) => c + 1)
                    setLoading(true)
                  }}
                  className="rounded-[8px] border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium text-[#14231F] transition hover:bg-neutral-50 disabled:opacity-40"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          )}
        </section>
      ) : !error && activeTab === 'late' && isKadep ? (
        /* Khusus Kadep: Rekap Keterlambatan */
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[12px] font-medium text-[#4A5B56]">Periode:</span>
            {periodOptions.map((period) => (
              <button
                key={period.value}
                type="button"
                onClick={() => {
                  setReportPeriod(period.value)
                  setLoading(true)
                }}
                className={`rounded-full px-3.5 py-1 text-[12px] font-medium transition ${
                  reportPeriod === period.value
                    ? 'bg-[#1E3F70] text-white'
                    : 'border border-neutral-300 bg-white text-[#14231F] hover:bg-neutral-50'
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>

          {lateLoans.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-neutral-300 bg-white px-6 py-14 text-center text-[13.5px] text-[#4A5B56]">
              Tidak ada peminjaman terlambat pada periode ini.
            </div>
          ) : (
            lateLoans.map((loan) => (
              <article
                key={loan.loan_id}
                className="flex flex-col justify-between gap-2.5 rounded-[12px] border border-neutral-200/90 bg-white px-4 py-3.5 shadow-2xs sm:flex-row sm:items-center"
              >
                <div>
                  <h3 className="text-[14px] font-bold text-[#14231F]">{loan.item_name}</h3>
                  <p className="text-[12px] text-[#4A5B56]">Peminjam: {loan.borrower_name}</p>
                  <p className="text-[11.5px] text-[#4A5B56]">
                    Jatuh tempo: {formatDate(loan.due_at)}
                    {loan.is_returned ? ` · Dikembalikan: ${formatDate(loan.returned_at)}` : ' · Belum dikembalikan'}
                  </p>
                </div>
                <span className="w-fit rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-700">
                  Terlambat {loan.late_days} hari
                </span>
              </article>
            ))
          )}
        </section>
      ) : null}
    </div>
  )
}
