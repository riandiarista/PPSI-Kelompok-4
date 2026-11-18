import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { api } from '../lib/api'

const ACTIVITY_PAGE_SIZE = 20

const TABS = [
  { id: 'loans', label: 'Riwayat peminjaman' },
  { id: 'inventory', label: 'Laporan inventaris' },
  { id: 'activity', label: 'Log aktivitas' },
]

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

function loanSortParams(sortBy) {
  const sortOptions = {
    newest: ['returned_at', 'desc'],
    oldest: ['returned_at', 'asc'],
  }
  return sortOptions[sortBy] || sortOptions.newest
}

function activitySortParams(sortBy) {
  const sortOptions = {
    newest: ['occurred_at', 'desc'],
    oldest: ['occurred_at', 'asc'],
    action: ['action_type', 'asc'],
    actor: ['actor_name', 'asc'],
  }
  return sortOptions[sortBy] || sortOptions.newest
}

function lateSortParams(sortBy) {
  const sortOptions = {
    due_asc: ['due_at', 'asc'],
    due_desc: ['due_at', 'desc'],
    late_desc: ['late_days', 'desc'],
    item_asc: ['item_name', 'asc'],
    borrower_asc: ['borrower_name', 'asc'],
  }
  return sortOptions[sortBy] || sortOptions.due_asc
}

export default function HistoryReportPage({ isKadep = false }) {
  const [activeTab, setActiveTab] = useState('loans')
  const [groupBy, setGroupBy] = useState('item')
  const periodOptions = useMemo(() => createRecentPeriods(), [])
  const [reportPeriod, setReportPeriod] = useState(currentWibMonth)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [loans, setLoans] = useState([])
  const [lateLoans, setLateLoans] = useState([])
  const [inventory, setInventory] = useState([])
  const [inventoryStats, setInventoryStats] = useState({})
  const [activities, setActivities] = useState([])
  const [activityPagination, setActivityPagination] = useState({ page: 1, total_pages: 1, total: 0 })
  const [activityPage, setActivityPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const tabs = isKadep
    ? [TABS[0], { id: 'late', label: 'Rekap keterlambatan' }, ...TABS.slice(1)]
    : TABS

  useEffect(() => {
    let cancelled = false
    const fetchData = async () => {
      try {
        if (activeTab === 'loans') {
          const [sort_by, sort_order] = loanSortParams(sortBy)
          const query = new URLSearchParams({ sort_by, sort_order })
          const response = await api(`/loans/history?${query.toString()}`)
          if (!cancelled) {
            setLoans(response.data || [])
            setError('')
          }
        } else if (activeTab === 'late') {
          const [sort_by, sort_order] = lateSortParams(sortBy)
          const query = new URLSearchParams({ month: reportPeriod, sort_by, sort_order })
          if (search) query.set('search', search)
          const response = await api(`/loans/late-report?${query.toString()}`)
          if (!cancelled) {
            setLateLoans(response.data?.items || [])
            setError('')
          }
        } else if (activeTab === 'inventory') {
          const query = new URLSearchParams()
          if (search) query.set('search', search)
          const queryString = query.toString()
          const suffix = queryString ? `?${queryString}` : ''
          const response = await api(`/inventory/items${suffix}`)
          if (!cancelled) {
            setInventory(response.data || [])
            setInventoryStats(response.stats || {})
            setError('')
          }
        } else {
          const [sort_by, sort_order] = activitySortParams(sortBy)
          const query = new URLSearchParams({
            page: String(activityPage),
            page_size: String(ACTIVITY_PAGE_SIZE),
            sort_by,
            sort_order,
          })
          if (search) query.set('search', search)
          const response = await api(`/audit-logs?${query.toString()}`)
          if (!cancelled) {
            setActivities(response.data?.items || [])
            setActivityPagination(response.data?.pagination || { page: 1, total_pages: 1, total: 0 })
            setError('')
          }
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError.message || 'Gagal memuat riwayat')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [activeTab, search, sortBy, activityPage, refreshKey, reportPeriod])

  const sortedInventory = useMemo(() => {
    const items = [...inventory]
    if (sortBy === 'newest') {
      return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }
    return items.sort((a, b) =>
      a.availability_status.localeCompare(b.availability_status, 'id')
      || a.item_name.localeCompare(b.item_name, 'id')
    )
  }, [inventory, sortBy])

  const groupedLoans = useMemo(() => {
    const groups = new Map()
    loans.forEach((loan) => {
      const key = groupBy === 'item' ? `item-${loan.item_id}` : `borrower-${loan.borrower_id}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: groupBy === 'item' ? loan.item_name : loan.borrower_name,
          subLabel: groupBy === 'item' ? loan.category_name : loan.borrower_email,
          loans: [],
        })
      }
      groups.get(key).loans.push(loan)
    })
    return [...groups.values()].sort((a, b) => {
      const getGroupDate = (group) => {
        const dates = group.loans.map((loan) => new Date(loan.returned_at).getTime())
        return sortBy === 'oldest' ? Math.min(...dates) : Math.max(...dates)
      }
      const dateDifference = getGroupDate(a) - getGroupDate(b)
      return sortBy === 'oldest' ? dateDifference : -dateDifference
    })
  }, [loans, groupBy, sortBy])

  const applySearch = (event) => {
    event.preventDefault()
    setLoading(true)
    setActivityPage(1)
    setSearch(searchDraft.trim())
  }

  const changeTab = (tab) => {
    if (tab === activeTab) return
    setActiveTab(tab)
    setActivityPage(1)
    if (tab === 'loans' || tab === 'activity') {
      setSearch('')
      setSearchDraft('')
    }
    setSortBy(tab === 'loans' ? 'newest'
      : tab === 'late' ? 'due_asc'
        : tab === 'inventory' ? 'status_asc' : 'newest')
    setLoading(true)
  }

  const changeSort = (value) => {
    setSortBy(value)
    setLoading(true)
    setActivityPage(1)
  }

  const refresh = () => {
    setLoading(true)
    setRefreshKey((current) => current + 1)
  }

  const sortOptions = activeTab === 'loans'
    ? [
      ['newest', 'Terbaru'],
      ['oldest', 'Terlama'],
    ]
    : activeTab === 'late'
      ? [
        ['due_asc', 'Jatuh tempo terdekat'],
        ['due_desc', 'Jatuh tempo terjauh'],
        ['late_desc', 'Terlambat terbanyak'],
        ['item_asc', 'Barang A–Z'],
        ['borrower_asc', 'Peminjam A–Z'],
      ]
      : activeTab === 'inventory'
      ? [
        ['status_asc', 'Status barang'],
        ['newest', 'Barang terbaru ditambahkan'],
      ]
      : [
        ['newest', 'Aktivitas terbaru'],
        ['oldest', 'Aktivitas terlama'],
        ['action', 'Aktivitas A–Z'],
        ['actor', 'Pelaku A–Z'],
      ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#14231F]">Riwayat &amp; laporan</h1>
          <p className="mt-1 text-[13px] text-[#4A5B56]">
            Telusuri siapa meminjam apa, kapan, dan dalam kondisi bagaimana.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 self-start rounded-[8px] border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-dark shadow-xs transition hover:bg-neutral-50 disabled:opacity-60 sm:self-auto"
        >
          <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
          Segarkan
        </button>
      </header>

      <nav className="flex flex-wrap items-center gap-2 border-b border-border-subtle/50 pb-2" aria-label="Jenis riwayat">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => changeTab(tab.id)}
            className={`inline-flex items-center gap-2 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition ${
              activeTab === tab.id
                ? 'bg-navy text-white shadow-2xs'
                : 'text-muted hover:bg-neutral-100 hover:text-dark'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab !== 'loans' && activeTab !== 'activity' && (
      <form onSubmit={applySearch} className="flex flex-col gap-3 rounded-[12px] border border-border-subtle/50 bg-white p-3 shadow-2xs sm:flex-row sm:items-end sm:p-4">
        <label className="flex-1 text-[12px] font-medium text-muted">
          Cari {activeTab === 'loans' || activeTab === 'late' ? 'barang atau peminjam' : activeTab === 'inventory' ? 'barang atau kategori' : 'aktivitas, pelaku, atau detail'}
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            maxLength={100}
            placeholder="Ketik kata kunci..."
            className="mt-1 block h-[40px] w-full rounded-[8px] border border-border-subtle/80 bg-surface px-3 text-[13px] text-dark outline-none focus:border-navy"
          />
        </label>
        <label className="text-[12px] font-medium text-muted sm:w-56">
          Urutkan
          <select
            value={sortBy}
            onChange={(event) => changeSort(event.target.value)}
            className="mt-1 block h-[40px] w-full cursor-pointer rounded-[8px] border border-border-subtle/80 bg-surface px-3 text-[13px] text-dark outline-none focus:border-navy"
          >
            {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="submit" className="inline-flex h-[40px] items-center justify-center gap-1.5 rounded-[8px] bg-navy px-4 text-[13px] font-bold text-white shadow-2xs transition hover:bg-navy/90">
          <Icon name="search" size={14} />
          Cari
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft('')
              setSearch('')
              setLoading(true)
            }}
            className="h-[40px] rounded-[8px] border border-border-subtle/80 bg-surface px-3 text-[13px] font-semibold text-muted transition hover:bg-neutral-100"
          >
            Reset
          </button>
        )}
      </form>
      )}

      {activeTab === 'late' && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[12px] font-medium text-muted">Periode</span>
            {periodOptions.map((period) => (
              <button
                key={period.value}
                type="button"
                onClick={() => {
                  setReportPeriod(period.value)
                  setLoading(true)
                }}
                className={`rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold transition ${
                  reportPeriod === period.value
                    ? 'border-navy bg-navy text-white'
                    : 'border-border-subtle/70 bg-white text-muted hover:bg-neutral-100'
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>
          <p className="text-[12.5px] font-semibold text-dark">
            {lateLoans.length} peminjaman terlambat pada {periodOptions.find((period) => period.value === reportPeriod)?.label || reportPeriod}
          </p>
        </section>
      )}

      {activeTab === 'loans' && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-medium text-muted">Kelompokkan menurut</span>
          {[
            ['item', 'Barang'],
            ['borrower', 'Peminjam'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setGroupBy(value)}
              className={`rounded-[8px] border px-3 py-1.5 font-semibold transition ${
                groupBy === value
                  ? 'border-navy bg-navy text-white'
                  : 'border-border-subtle/70 bg-white text-muted hover:bg-neutral-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="rounded-[10px] border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">{error}</div>}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-[14px] border border-border-subtle/60 bg-white py-14 text-[13px] text-muted shadow-2xs">
          <Icon name="refresh" size={16} className="animate-spin" />
          Memuat data...
        </div>
      ) : !error && activeTab === 'loans' ? (
        <section className="space-y-3">
          {groupedLoans.length === 0 ? (
            <EmptyState text="Belum ada riwayat peminjaman yang cocok." />
          ) : groupedLoans.map((group) => (
            <article key={group.key} className="rounded-[14px] border border-border-subtle/60 bg-white p-4 shadow-2xs">
              <div className="mb-3">
                <h2 className="text-[14px] font-bold text-dark">{group.label}</h2>
                <p className="text-[11.5px] text-muted">{group.subLabel}</p>
              </div>
              <div className="space-y-2">
                {group.loans.map((loan) => (
                  <div key={loan.loan_id} className="flex flex-col gap-2 rounded-[10px] border border-border-subtle/40 bg-surface px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      {groupBy === 'item' ? (
                        <p className="truncate text-[12.5px] font-semibold text-dark">{loan.borrower_name}</p>
                      ) : (
                        <p className="truncate text-[12.5px] font-semibold text-dark">{loan.item_name}</p>
                      )}
                      <p className="mt-0.5 text-[11.5px] text-muted">
                        {formatDate(loan.handover_at)} – {formatDate(loan.due_at)} · kembali {formatDate(loan.returned_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <span className={`rounded-full border px-2 py-1 text-[10.5px] font-semibold ${
                        loan.late_days > 0 ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}>
                        {loan.late_days > 0 ? `Terlambat ${loan.late_days} hari` : 'Tepat waktu'}
                      </span>
                      <span className={`rounded-full border px-2 py-1 text-[10.5px] font-semibold ${CONDITION_STYLES[loan.return_condition] || 'border-neutral-200 bg-neutral-100 text-muted'}`}>
                        {CONDITION_LABELS[loan.return_condition] || 'Kondisi tercatat'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : !error && activeTab === 'inventory' ? (
        <section className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Total barang', inventoryStats.total_items || 0],
              ['Tersedia', inventoryStats.available_items || 0],
              ['Dipinjam', inventoryStats.borrowed_items || 0],
              ['Perbaikan', inventoryStats.maintenance_items || 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[12px] border border-border-subtle/60 bg-white p-3.5 shadow-2xs">
                <p className="text-[12px] font-medium text-muted">{label}</p>
                <p className="mt-1 text-[22px] font-extrabold text-dark">{value}</p>
              </div>
            ))}
          </div>
          {sortedInventory.length === 0 ? (
            <EmptyState text="Tidak ada barang yang cocok dengan pencarian." />
          ) : sortedInventory.map((item) => (
            <article key={item.item_id} className="flex flex-col gap-2 rounded-[12px] border border-border-subtle/60 bg-white px-4 py-3 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[13px] font-semibold text-dark">{item.item_name}</h2>
                <p className="text-[11.5px] text-muted">{item.category_name}</p>
              </div>
              <div className="flex gap-2 text-[10.5px] font-semibold">
                <span className={`rounded-full border px-2 py-1 ${CONDITION_STYLES[item.item_condition] || 'border-neutral-200 bg-neutral-100 text-muted'}`}>
                  {CONDITION_LABELS[item.item_condition] || item.item_condition}
                </span>
                <span className={`rounded-full border px-2 py-1 ${STATUS_STYLES[item.availability_status] || 'border-neutral-200 bg-neutral-100 text-muted'}`}>
                  {STATUS_LABELS[item.availability_status] || item.availability_status}
                </span>
              </div>
            </article>
          ))}
        </section>
      ) : !error && activeTab === 'late' ? (
        <section className="space-y-2">
          {lateLoans.length === 0 ? (
            <EmptyState text="Tidak ada peminjaman terlambat pada periode ini." />
          ) : lateLoans.map((loan) => (
            <article key={loan.loan_id} className="flex flex-col gap-2 rounded-[12px] border border-border-subtle/60 bg-white px-4 py-3 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[13px] font-semibold text-dark">{loan.item_name}</h2>
                <p className="text-[11.5px] text-muted">Peminjam {loan.borrower_name}</p>
                <p className="text-[11px] text-muted">
                  Jatuh tempo {formatDate(loan.due_at)}
                  {loan.is_returned ? ` · dikembalikan ${formatDate(loan.returned_at)}` : ' · belum dikembalikan'}
                </p>
              </div>
              <span className="w-fit rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10.5px] font-semibold text-red-700">
                Terlambat {loan.late_days} hari
              </span>
            </article>
          ))}
        </section>
      ) : !error && activeTab === 'activity' ? (
        <section className="space-y-2">
          <p className="text-[12px] text-muted">{activityPagination.total} aktivitas tercatat</p>
          {activities.length === 0 ? (
            <EmptyState text="Tidak ada aktivitas yang cocok." />
          ) : activities.map((activity) => (
            <article key={activity.audit_id} className="rounded-[12px] border border-border-subtle/60 bg-white px-4 py-3 shadow-2xs">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-[12.5px] font-semibold text-dark">
                    {ACTION_LABELS[activity.action_type] || activity.action_type.replaceAll('_', ' ')}
                  </h2>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    {activity.actor_name || 'Pengguna dihapus'} · {activity.entity_type} #{activity.entity_id}
                  </p>
                </div>
                <time className="shrink-0 text-[11px] text-muted">{formatDateTime(activity.occurred_at)}</time>
              </div>
              {activity.details && (
                <details className="mt-2 text-[11.5px]">
                  <summary className="cursor-pointer text-primary">Detail</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-border-subtle/40 bg-surface p-2 text-[10.5px] text-muted">
                    {JSON.stringify(activity.details, null, 2)}
                  </pre>
                </details>
              )}
            </article>
          ))}
          {activityPagination.total_pages > 1 && (
            <div className="flex items-center justify-between rounded-[10px] border border-border-subtle/50 bg-white px-3 py-2 shadow-2xs">
              <span className="text-[11.5px] text-muted">
                Halaman {activityPagination.page} dari {activityPagination.total_pages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={activityPage <= 1}
                  onClick={() => { setActivityPage((current) => current - 1); setLoading(true) }}
                  className="rounded-[8px] border border-border-subtle/80 bg-surface px-3 py-1.5 text-[12px] font-medium text-muted transition hover:bg-neutral-100 disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  disabled={activityPage >= activityPagination.total_pages}
                  onClick={() => { setActivityPage((current) => current + 1); setLoading(true) }}
                  className="rounded-[8px] border border-border-subtle/80 bg-surface px-3 py-1.5 text-[12px] font-medium text-muted transition hover:bg-neutral-100 disabled:opacity-40"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div className="rounded-[14px] border border-dashed border-border-subtle/60 bg-white px-6 py-14 text-center text-[13px] text-muted shadow-2xs">
      {text}
    </div>
  )
}
