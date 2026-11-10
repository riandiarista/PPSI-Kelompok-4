import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { api } from '../lib/api'

// Label & Badge Helper untuk Kondisi Fisik
const CONDITION_MAP = {
  good: { label: 'Baik', badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  minor_damage: { label: 'Rusak Ringan', badgeClass: 'bg-amber-100 text-amber-800 border-amber-200' },
  major_damage: { label: 'Rusak Berat', badgeClass: 'bg-red-100 text-red-800 border-red-200' },
}

// Label & Badge Helper untuk Status Operasional / Ketersediaan
const AVAILABILITY_MAP = {
  available: { label: 'Tersedia', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  borrowed: { label: 'Sedang Dipinjam', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200' },
  maintenance: { label: 'Perbaikan', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200' },
  unavailable: { label: 'Tidak Tersedia', badgeClass: 'bg-neutral-100 text-neutral-600 border-neutral-200' },
}

export default function KelolaInventarisPage() {
  // State Utama
  const [activeTab, setActiveTab] = useState('items') // 'items' | 'categories'
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [stats, setStats] = useState({
    total_items: 0,
    available_items: 0,
    borrowed_items: 0,
    maintenance_items: 0,
    inactive_items: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' })
  const [refreshKey, setRefreshKey] = useState(0)

  // State Filter & Pencarian Barang
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [conditionFilter, setConditionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')

  // State Modals Barang
  const [showAddItemModal, setShowAddItemModal] = useState(false)
  const [editItemModal, setEditItemModal] = useState({ open: false, item: null })
  const [toggleActiveModal, setToggleActiveModal] = useState({ open: false, item: null, loading: false })

  // State Modals Kategori
  const [showAddCatModal, setShowAddCatModal] = useState(false)
  const [editCatModal, setEditCatModal] = useState({ open: false, category: null })
  const [deleteCatModal, setDeleteCatModal] = useState({ open: false, category: null, loading: false })

  // State Form Input
  const [itemFormData, setItemFormData] = useState({
    item_name: '',
    category_id: '',
    item_condition: 'good',
    availability_status: 'available',
  })
  const [catFormData, setCatFormData] = useState({ category_name: '' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' })
    }, 4500)
  }

  const triggerRefresh = () => {
    setLoading(true)
    setRefreshKey((k) => k + 1)
  }

  // Fetch Kategori
  useEffect(() => {
    api('/inventory/categories')
      .then((res) => {
        if (res.data) setCategories(res.data)
      })
      .catch((err) => {
        console.error('Gagal memuat kategori:', err)
      })
  }, [refreshKey])

  // Fetch Daftar Barang
  useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams()
    if (search.trim()) query.set('search', search.trim())
    if (categoryFilter !== 'all') query.set('category_id', categoryFilter)
    if (conditionFilter !== 'all') query.set('condition', conditionFilter)
    if (statusFilter !== 'all') query.set('availability_status', statusFilter)
    if (activeFilter !== 'all') query.set('is_active', activeFilter)

    api(`/inventory/items?${query.toString()}`)
      .then((res) => {
        if (cancelled) return
        setItems(res.data || [])
        if (res.stats) setStats(res.stats)
        setError('')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Gagal memuat data inventaris barang')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [search, categoryFilter, conditionFilter, statusFilter, activeFilter, refreshKey])

  // ==========================================
  // HANDLERS: BARANG
  // ==========================================

  const handleOpenAddItem = () => {
    setFormError('')
    setItemFormData({
      item_name: '',
      category_id: categories[0]?.category_id ? String(categories[0].category_id) : '',
      item_condition: 'good',
      availability_status: 'available',
    })
    setShowAddItemModal(true)
  }

  const handleCreateItemSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      await api('/inventory/items', {
        method: 'POST',
        body: itemFormData,
      })
      setShowAddItemModal(false)
      showToast(`Barang "${itemFormData.item_name}" berhasil ditambahkan!`)
      triggerRefresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenEditItem = (item) => {
    setFormError('')
    setEditItemModal({ open: true, item })
    setItemFormData({
      item_name: item.item_name,
      category_id: String(item.category_id),
      item_condition: item.item_condition,
      availability_status: item.availability_status,
    })
  }

  const handleUpdateItemSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      await api(`/inventory/items/${editItemModal.item.item_id}`, {
        method: 'PUT',
        body: itemFormData,
      })
      setEditItemModal({ open: false, item: null })
      showToast(`Data barang "${itemFormData.item_name}" berhasil diperbarui!`)
      triggerRefresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleActiveConfirm = async () => {
    if (!toggleActiveModal.item) return
    const { item } = toggleActiveModal

    // Validasi Sisi Frontend (Defense in Depth):
    // "Barang yang sedang berstatus 'Sedang dipinjam' dilarang keras untuk dinonaktifkan"
    if (item.is_active && item.availability_status === 'borrowed') {
      showToast(
        `Barang "${item.item_name}" sedang dipinjam! Selesaikan proses pengembalian terlebih dahulu sebelum menonaktifkan barang.`,
        'error'
      )
      setToggleActiveModal({ open: false, item: null, loading: false })
      return
    }

    setToggleActiveModal((prev) => ({ ...prev, loading: true }))
    try {
      const res = await api(`/inventory/items/${item.item_id}/status`, {
        method: 'PATCH',
        body: { is_active: !item.is_active },
      })
      setToggleActiveModal({ open: false, item: null, loading: false })
      showToast(res.message || 'Status barang berhasil diubah')
      triggerRefresh()
    } catch (err) {
      setToggleActiveModal({ open: false, item: null, loading: false })
      showToast(err.message, 'error')
    }
  }

  // ==========================================
  // HANDLERS: KATEGORI
  // ==========================================

  const handleCreateCategorySubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      await api('/inventory/categories', {
        method: 'POST',
        body: catFormData,
      })
      setShowAddCatModal(false)
      setCatFormData({ category_name: '' })
      showToast(`Kategori "${catFormData.category_name}" berhasil ditambahkan!`)
      triggerRefresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateCategorySubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      await api(`/inventory/categories/${editCatModal.category.category_id}`, {
        method: 'PUT',
        body: catFormData,
      })
      setEditCatModal({ open: false, category: null })
      showToast(`Kategori berhasil diperbarui!`)
      triggerRefresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteCategoryConfirm = async () => {
    if (!deleteCatModal.category) return
    setDeleteCatModal((prev) => ({ ...prev, loading: true }))
    try {
      const res = await api(`/inventory/categories/${deleteCatModal.category.category_id}`, {
        method: 'DELETE',
      })
      setDeleteCatModal({ open: false, category: null, loading: false })
      showToast(res.message || 'Kategori berhasil dihapus')
      triggerRefresh()
    } catch (err) {
      setDeleteCatModal((prev) => ({ ...prev, loading: false }))
      showToast(err.message, 'error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Notification */}
      {toast.show && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-[12px] px-4 py-3 shadow-lg border transition-all ${
            toast.type === 'error'
              ? 'bg-red-50 text-red-900 border-red-200'
              : 'bg-emerald-50 text-emerald-900 border-emerald-200'
          }`}
        >
          <Icon name={toast.type === 'error' ? 'alert-circle' : 'check-circle'} size={20} />
          <span className="text-[14px] font-semibold">{toast.message}</span>
        </div>
      )}

      {/* Header Halaman */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold text-dark tracking-[-0.01em]">
            Kelola Inventaris & Kategori Barang
          </h1>
          <p className="text-[14px] text-muted mt-1">
            Kelola data barang inventaris, pantau kondisi fisik, status ketersediaan, serta klasifikasi kategori.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'items' ? (
            <button
              type="button"
              onClick={handleOpenAddItem}
              className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-navy px-4 py-2.5 text-[14px] font-bold text-white shadow-sm transition hover:bg-navy/90 active:bg-navy/95 cursor-pointer shrink-0"
            >
              <Icon name="plus" size={16} />
              <span>Tambah Barang</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setFormError('')
                setCatFormData({ category_name: '' })
                setShowAddCatModal(true)
              }}
              className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-navy px-4 py-2.5 text-[14px] font-bold text-white shadow-sm transition hover:bg-navy/90 active:bg-navy/95 cursor-pointer shrink-0"
            >
              <Icon name="plus" size={16} />
              <span>Tambah Kategori</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigasi Tab */}
      <div className="flex items-center gap-2 border-b border-border-subtle/50 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('items')}
          className={`inline-flex items-center gap-2 rounded-[8px] px-4 py-2 text-[14px] font-semibold transition cursor-pointer ${
            activeTab === 'items'
              ? 'bg-navy text-white shadow-2xs'
              : 'text-muted hover:text-dark hover:bg-neutral-100'
          }`}
        >
          <Icon name="box" size={16} />
          <span>Data Barang</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${
              activeTab === 'items' ? 'bg-white/20 text-white' : 'bg-surface text-muted'
            }`}
          >
            {stats.total_items}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          className={`inline-flex items-center gap-2 rounded-[8px] px-4 py-2 text-[14px] font-semibold transition cursor-pointer ${
            activeTab === 'categories'
              ? 'bg-navy text-white shadow-2xs'
              : 'text-muted hover:text-dark hover:bg-neutral-100'
          }`}
        >
          <Icon name="tag" size={16} />
          <span>Kategori Barang</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${
              activeTab === 'categories' ? 'bg-white/20 text-white' : 'bg-surface text-muted'
            }`}
          >
            {categories.length}
          </span>
        </button>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: DATA BARANG INVENTARIS                             */}
      {/* ========================================================= */}
      {activeTab === 'items' && (
        <div className="flex flex-col gap-5">
          {/* Kartu Ringkasan Statistik */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-white p-3.5 rounded-[12px] border border-border-subtle/60 shadow-2xs">
              <p className="text-[12px] font-medium text-muted">Total Inventaris</p>
              <p className="text-[22px] font-extrabold text-dark mt-1">{stats.total_items}</p>
            </div>
            <div className="bg-white p-3.5 rounded-[12px] border border-border-subtle/60 shadow-2xs">
              <p className="text-[12px] font-medium text-emerald-700">Siap Dipinjam</p>
              <p className="text-[22px] font-extrabold text-emerald-700 mt-1">{stats.available_items}</p>
            </div>
            <div className="bg-white p-3.5 rounded-[12px] border border-border-subtle/60 shadow-2xs">
              <p className="text-[12px] font-medium text-blue-700">Sedang Dipinjam</p>
              <p className="text-[22px] font-extrabold text-blue-700 mt-1">{stats.borrowed_items}</p>
            </div>
            <div className="bg-white p-3.5 rounded-[12px] border border-border-subtle/60 shadow-2xs">
              <p className="text-[12px] font-medium text-amber-700">Dalam Perbaikan</p>
              <p className="text-[22px] font-extrabold text-amber-700 mt-1">{stats.maintenance_items}</p>
            </div>
            <div className="bg-white p-3.5 rounded-[12px] border border-border-subtle/60 shadow-2xs col-span-2 sm:col-span-1">
              <p className="text-[12px] font-medium text-muted">Dinonaktifkan</p>
              <p className="text-[22px] font-extrabold text-neutral-500 mt-1">{stats.inactive_items}</p>
            </div>
          </div>

          {/* Bar Filter & Pencarian */}
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between bg-white p-3 sm:p-4 rounded-[12px] border border-border-subtle/50 shadow-2xs">
            {/* Pencarian Nama */}
            <div className="relative flex-1 min-w-[220px]">
              <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted">
                <Icon name="search" size={16} />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama barang..."
                className="w-full h-[40px] pl-9 pr-3 rounded-[8px] bg-surface border border-border-subtle/80 text-[13px] text-dark placeholder:text-muted outline-none focus:border-navy"
              />
            </div>

            {/* Filter Dropdown */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Filter Kategori */}
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-[40px] px-3 rounded-[8px] bg-surface border border-border-subtle/80 text-[13px] font-medium text-dark outline-none focus:border-navy cursor-pointer"
              >
                <option value="all">Semua Kategori</option>
                {categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.category_name}
                  </option>
                ))}
              </select>

              {/* Filter Kondisi Fisik */}
              <select
                value={conditionFilter}
                onChange={(e) => setConditionFilter(e.target.value)}
                className="h-[40px] px-3 rounded-[8px] bg-surface border border-border-subtle/80 text-[13px] font-medium text-dark outline-none focus:border-navy cursor-pointer"
              >
                <option value="all">Semua Kondisi Fisik</option>
                <option value="good">Baik</option>
                <option value="minor_damage">Rusak Ringan</option>
                <option value="major_damage">Rusak Berat</option>
              </select>

              {/* Filter Status Operasional */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-[40px] px-3 rounded-[8px] bg-surface border border-border-subtle/80 text-[13px] font-medium text-dark outline-none focus:border-navy cursor-pointer"
              >
                <option value="all">Semua Status Operasional</option>
                <option value="available">Tersedia</option>
                <option value="borrowed">Sedang Dipinjam</option>
                <option value="maintenance">Perbaikan</option>
                <option value="unavailable">Tidak Tersedia</option>
              </select>

              {/* Filter Keaktifan */}
              <select
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value)}
                className="h-[40px] px-3 rounded-[8px] bg-surface border border-border-subtle/80 text-[13px] font-medium text-dark outline-none focus:border-navy cursor-pointer"
              >
                <option value="all">Semua Status</option>
                <option value="true">Hanya Aktif</option>
                <option value="false">Hanya Nonaktif</option>
              </select>

              {(search || categoryFilter !== 'all' || conditionFilter !== 'all' || statusFilter !== 'all' || activeFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setCategoryFilter('all')
                    setConditionFilter('all')
                    setStatusFilter('all')
                    setActiveFilter('all')
                  }}
                  className="h-[40px] px-3 rounded-[8px] text-[13px] font-semibold text-danger hover:bg-red-50 transition cursor-pointer"
                >
                  Reset Filter
                </button>
              )}
            </div>
          </div>

          {/* Tabel Barang */}
          <div className="bg-white rounded-[12px] border border-border-subtle/50 shadow-2xs overflow-hidden">
            {error && (
              <div className="p-4 bg-red-50 text-danger text-[14px] border-b border-red-100 flex items-center gap-2">
                <Icon name="alert-circle" size={18} />
                <span>{error}</span>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20 text-[14px] text-muted">
                Memuat data inventaris barang...
              </div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-surface text-muted flex items-center justify-center mx-auto mb-3">
                  <Icon name="box" size={24} />
                </div>
                <h3 className="font-bold text-dark text-[16px]">Belum ada barang inventaris</h3>
                <p className="text-muted text-[13px] mt-1 max-w-sm mx-auto">
                  {search || categoryFilter !== 'all' || conditionFilter !== 'all'
                    ? 'Tidak ada barang yang cocok dengan kriteria filter pencarian.'
                    : 'Belum ada barang yang didaftarkan. Klik tombol "Tambah Barang" di atas untuk menambahkan barang pertama.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[14px] border-collapse">
                  <thead>
                    <tr className="border-b border-border-subtle/40 bg-surface/50 text-[12px] font-bold text-muted uppercase tracking-wider">
                      <th className="py-3 px-4">Nama Barang</th>
                      <th className="py-3 px-4">Kategori</th>
                      <th className="py-3 px-4">Kondisi Fisik</th>
                      <th className="py-3 px-4">Status Operasional</th>
                      <th className="py-3 px-4">Keaktifan Katalog</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle/30">
                    {items.map((item) => {
                      const conditionMeta = CONDITION_MAP[item.item_condition] || {
                        label: item.item_condition,
                        badgeClass: 'bg-neutral-100 text-neutral-800',
                      }
                      const statusMeta = AVAILABILITY_MAP[item.availability_status] || {
                        label: item.availability_status,
                        badgeClass: 'bg-neutral-100 text-neutral-800',
                      }
                      const isBorrowed = item.availability_status === 'borrowed'

                      return (
                        <tr
                          key={item.item_id}
                          className={`hover:bg-neutral-50/70 transition ${
                            !item.is_active ? 'bg-neutral-50/40 opacity-75' : ''
                          }`}
                        >
                          {/* Nama Barang */}
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-dark text-[14px]">{item.item_name}</div>
                            <div className="text-[12px] text-muted">ID: #{item.item_id}</div>
                          </td>

                          {/* Kategori */}
                          <td className="py-3.5 px-4 font-medium text-dark text-[13px]">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface text-navy font-semibold text-[12px] border border-border-subtle/40">
                              <Icon name="tag" size={12} />
                              {item.category_name}
                            </span>
                          </td>

                          {/* Kondisi Fisik */}
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-bold border ${conditionMeta.badgeClass}`}
                            >
                              {conditionMeta.label}
                            </span>
                          </td>

                          {/* Status Operasional */}
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-bold border ${statusMeta.badgeClass}`}
                            >
                              {statusMeta.label}
                            </span>
                          </td>

                          {/* Keaktifan Katalog */}
                          <td className="py-3.5 px-4">
                            {item.is_active ? (
                              <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold text-[13px]">
                                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                Aktif di Katalog
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-neutral-500 font-semibold text-[13px]">
                                <span className="w-2 h-2 rounded-full bg-neutral-400" />
                                Disembunyikan
                              </span>
                            )}
                          </td>

                          {/* Aksi */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {/* Edit Button */}
                              <button
                                type="button"
                                onClick={() => handleOpenEditItem(item)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-surface hover:bg-neutral-200/70 text-dark text-[13px] font-semibold transition cursor-pointer"
                                title="Edit data barang"
                              >
                                <Icon name="edit" size={14} />
                                <span>Edit</span>
                              </button>

                              {/* Toggle Status Aktif Button */}
                              <button
                                type="button"
                                onClick={() => setToggleActiveModal({ open: true, item, loading: false })}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[13px] font-semibold transition cursor-pointer ${
                                  item.is_active
                                    ? isBorrowed
                                      ? 'bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed'
                                      : 'bg-red-50 text-danger hover:bg-red-100 border border-danger/30'
                                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300'
                                }`}
                                title={
                                  isBorrowed && item.is_active
                                    ? 'Barang sedang dipinjam (dilarang dinonaktifkan)'
                                    : item.is_active
                                    ? 'Nonaktifkan barang dari katalog'
                                    : 'Aktifkan kembali ke katalog'
                                }
                              >
                                {item.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
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
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: KATEGORI BARANG                                    */}
      {/* ========================================================= */}
      {activeTab === 'categories' && (
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-[12px] border border-border-subtle/50 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-border-subtle/40 bg-surface/40 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-dark text-[16px]">Daftar Kategori Barang</h3>
                <p className="text-[13px] text-muted">
                  Kelompokkan inventaris barang ke dalam kategori yang tepat untuk memudahkan pencarian oleh peminjam.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFormError('')
                  setCatFormData({ category_name: '' })
                  setShowAddCatModal(true)
                }}
                className="inline-flex items-center gap-2 rounded-[8px] bg-navy text-white px-3.5 py-2 text-[13px] font-bold hover:bg-navy/90 transition cursor-pointer"
              >
                <Icon name="plus" size={14} />
                <span>Tambah Kategori</span>
              </button>
            </div>

            {categories.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-surface text-muted flex items-center justify-center mx-auto mb-3">
                  <Icon name="tag" size={24} />
                </div>
                <h3 className="font-bold text-dark text-[16px]">Belum ada kategori</h3>
                <p className="text-muted text-[13px] mt-1 max-w-sm mx-auto">
                  Tambahkan kategori barang baru agar inventaris dapat terorganisir dengan rapi.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[14px] border-collapse">
                  <thead>
                    <tr className="border-b border-border-subtle/40 bg-surface/50 text-[12px] font-bold text-muted uppercase tracking-wider">
                      <th className="py-3 px-4">Nama Kategori</th>
                      <th className="py-3 px-4">Jumlah Barang Terkait</th>
                      <th className="py-3 px-4">Barang Aktif</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle/30">
                    {categories.map((cat) => (
                      <tr key={cat.category_id} className="hover:bg-neutral-50/70 transition">
                        <td className="py-3.5 px-4 font-bold text-dark text-[14px]">
                          {cat.category_name}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-muted text-[13px]">
                          {cat.total_items ?? 0} barang
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-bold text-[12px] border border-emerald-200">
                            {cat.active_items ?? 0} aktif
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setFormError('')
                                setEditCatModal({ open: true, category: cat })
                                setCatFormData({ category_name: cat.category_name })
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-surface hover:bg-neutral-200/70 text-dark text-[13px] font-semibold transition cursor-pointer"
                              title="Ubah nama kategori"
                            >
                              <Icon name="edit" size={14} />
                              <span>Edit</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setDeleteCatModal({ open: true, category: cat, loading: false })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-danger hover:bg-red-50 text-[13px] font-semibold transition cursor-pointer"
                              title="Hapus kategori"
                            >
                              <Icon name="trash" size={14} />
                              <span>Hapus</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: TAMBAH BARANG                                      */}
      {/* ========================================================= */}
      {showAddItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 max-w-[500px] w-full shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle/40">
              <h3 className="text-[18px] font-bold text-dark">Tambah Barang Baru</h3>
              <button
                type="button"
                onClick={() => setShowAddItemModal(false)}
                className="text-muted hover:text-dark p-1"
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            {formError && (
              <div className="rounded-[10px] border border-danger/30 bg-red-50 px-3.5 py-2.5 text-[13px] text-danger">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateItemSubmit} className="flex flex-col gap-3.5">
              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">
                  Nama Barang <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Proyektor Epson EB-X400"
                  value={itemFormData.item_name}
                  onChange={(e) => setItemFormData({ ...itemFormData, item_name: e.target.value })}
                  className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[14px] outline-none focus:border-navy"
                />
              </div>

              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">
                  Kategori <span className="text-danger">*</span>
                </label>
                <select
                  required
                  value={itemFormData.category_id}
                  onChange={(e) => setItemFormData({ ...itemFormData, category_id: e.target.value })}
                  className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[14px] outline-none focus:border-navy cursor-pointer"
                >
                  <option value="" disabled>
                    Pilih Kategori
                  </option>
                  {categories.map((c) => (
                    <option key={c.category_id} value={c.category_id}>
                      {c.category_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[13px] font-semibold text-dark block mb-1">
                    Kondisi Fisik
                  </label>
                  <select
                    value={itemFormData.item_condition}
                    onChange={(e) => setItemFormData({ ...itemFormData, item_condition: e.target.value })}
                    className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[13px] outline-none focus:border-navy cursor-pointer"
                  >
                    <option value="good">Baik</option>
                    <option value="minor_damage">Rusak Ringan</option>
                    <option value="major_damage">Rusak Berat</option>
                  </select>
                </div>

                <div>
                  <label className="text-[13px] font-semibold text-dark block mb-1">
                    Status Operasional
                  </label>
                  <select
                    value={itemFormData.availability_status}
                    onChange={(e) =>
                      setItemFormData({ ...itemFormData, availability_status: e.target.value })
                    }
                    className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[13px] outline-none focus:border-navy cursor-pointer"
                  >
                    <option value="available">Tersedia</option>
                    <option value="maintenance">Perbaikan</option>
                    <option value="unavailable">Tidak Tersedia</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 mt-3 pt-3 border-t border-border-subtle/40">
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="px-4 py-2 rounded-[8px] text-[13px] font-semibold text-muted hover:text-dark transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-[8px] bg-navy text-white text-[13px] font-bold hover:bg-navy/90 transition cursor-pointer disabled:opacity-75"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Barang'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: EDIT BARANG                                        */}
      {/* ========================================================= */}
      {editItemModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 max-w-[500px] w-full shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle/40">
              <h3 className="text-[18px] font-bold text-dark">Edit Data Barang</h3>
              <button
                type="button"
                onClick={() => setEditItemModal({ open: false, item: null })}
                className="text-muted hover:text-dark p-1"
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            {formError && (
              <div className="rounded-[10px] border border-danger/30 bg-red-50 px-3.5 py-2.5 text-[13px] text-danger">
                {formError}
              </div>
            )}

            <form onSubmit={handleUpdateItemSubmit} className="flex flex-col gap-3.5">
              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">
                  Nama Barang <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={itemFormData.item_name}
                  onChange={(e) => setItemFormData({ ...itemFormData, item_name: e.target.value })}
                  className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[14px] outline-none focus:border-navy"
                />
              </div>

              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">
                  Kategori <span className="text-danger">*</span>
                </label>
                <select
                  required
                  value={itemFormData.category_id}
                  onChange={(e) => setItemFormData({ ...itemFormData, category_id: e.target.value })}
                  className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[14px] outline-none focus:border-navy cursor-pointer"
                >
                  {categories.map((c) => (
                    <option key={c.category_id} value={c.category_id}>
                      {c.category_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[13px] font-semibold text-dark block mb-1">
                    Kondisi Fisik
                  </label>
                  <select
                    value={itemFormData.item_condition}
                    onChange={(e) => setItemFormData({ ...itemFormData, item_condition: e.target.value })}
                    className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[13px] outline-none focus:border-navy cursor-pointer"
                  >
                    <option value="good">Baik</option>
                    <option value="minor_damage">Rusak Ringan</option>
                    <option value="major_damage">Rusak Berat</option>
                  </select>
                </div>

                <div>
                  <label className="text-[13px] font-semibold text-dark block mb-1">
                    Status Operasional
                  </label>
                  <select
                    value={itemFormData.availability_status}
                    onChange={(e) =>
                      setItemFormData({ ...itemFormData, availability_status: e.target.value })
                    }
                    className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[13px] outline-none focus:border-navy cursor-pointer"
                  >
                    <option value="available">Tersedia</option>
                    <option value="borrowed">Sedang Dipinjam</option>
                    <option value="maintenance">Perbaikan</option>
                    <option value="unavailable">Tidak Tersedia</option>
                  </select>
                </div>
              </div>

              {editItemModal.item?.availability_status === 'borrowed' && (
                <div className="p-3 bg-blue-50/70 rounded-[10px] text-[12px] text-blue-900 border border-blue-200">
                  <p className="font-semibold">Perhatian Status Peminjaman:</p>
                  <p className="mt-0.5">
                    Barang ini sedang dipinjam. Status ketersediaan idealnya diperbarui otomatis melalui alur Pengembalian Barang Tendik.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 mt-3 pt-3 border-t border-border-subtle/40">
                <button
                  type="button"
                  onClick={() => setEditItemModal({ open: false, item: null })}
                  className="px-4 py-2 rounded-[8px] text-[13px] font-semibold text-muted hover:text-dark transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-[8px] bg-navy text-white text-[13px] font-bold hover:bg-navy/90 transition cursor-pointer disabled:opacity-75"
                >
                  {submitting ? 'Menyimpan...' : 'Perbarui Barang'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: KONFIRMASI STATUS NONAKTIF / AKTIF BARANG          */}
      {/* ========================================================= */}
      {toggleActiveModal.open && toggleActiveModal.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 max-w-[440px] w-full shadow-xl flex flex-col gap-4">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto ${
                toggleActiveModal.item.is_active
                  ? toggleActiveModal.item.availability_status === 'borrowed'
                    ? 'bg-red-100 text-danger'
                    : 'bg-amber-100 text-amber-800'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              <Icon
                name={
                  toggleActiveModal.item.is_active
                    ? toggleActiveModal.item.availability_status === 'borrowed'
                      ? 'x-circle'
                      : 'alert-circle'
                    : 'check-circle'
                }
                size={26}
              />
            </div>

            <div className="text-center">
              <h3 className="text-[18px] font-bold text-dark">
                {toggleActiveModal.item.is_active
                  ? toggleActiveModal.item.availability_status === 'borrowed'
                    ? 'Dilarang Menonaktifkan Barang'
                    : 'Nonaktifkan Barang?'
                  : 'Aktifkan Kembali Barang?'}
              </h3>

              {toggleActiveModal.item.is_active ? (
                toggleActiveModal.item.availability_status === 'borrowed' ? (
                  <p className="text-[13px] text-danger mt-2 bg-red-50 p-3 rounded-[8px] border border-red-200 text-left">
                    <strong>Peringatan Aturan Bisnis:</strong> Barang &quot;{toggleActiveModal.item.item_name}&quot; saat ini sedang berstatus <strong>Sedang Dipinjam</strong>. Sesuai aturan sistem, barang yang sedang dipinjam dilarang keras untuk dinonaktifkan sampai proses pengembalian selesai.
                  </p>
                ) : (
                  <p className="text-[13px] text-muted mt-2">
                    Apakah Anda yakin ingin menonaktifkan barang &quot;<strong>{toggleActiveModal.item.item_name}</strong>&quot;? Barang ini tidak akan muncul lagi di katalog peminjaman, tetapi riwayat peminjamannya tetap tersimpan aman.
                  </p>
                )
              ) : (
                <p className="text-[13px] text-muted mt-2">
                  Barang &quot;<strong>{toggleActiveModal.item.item_name}</strong>&quot; akan diaktifkan kembali dan dapat diajukan untuk peminjaman di katalog.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setToggleActiveModal({ open: false, item: null, loading: false })}
                className="px-4 py-2 rounded-[8px] text-[13px] font-semibold text-muted hover:text-dark transition cursor-pointer"
              >
                {toggleActiveModal.item.is_active &&
                toggleActiveModal.item.availability_status === 'borrowed'
                  ? 'Tutup'
                  : 'Batal'}
              </button>

              {!(
                toggleActiveModal.item.is_active &&
                toggleActiveModal.item.availability_status === 'borrowed'
              ) && (
                <button
                  type="button"
                  onClick={handleToggleActiveConfirm}
                  disabled={toggleActiveModal.loading}
                  className={`px-4 py-2 rounded-[8px] text-[13px] font-bold text-white transition cursor-pointer ${
                    toggleActiveModal.item.is_active
                      ? 'bg-danger hover:bg-danger/90'
                      : 'bg-emerald-700 hover:bg-emerald-800'
                  }`}
                >
                  {toggleActiveModal.loading
                    ? 'Memproses...'
                    : toggleActiveModal.item.is_active
                    ? 'Ya, Nonaktifkan'
                    : 'Ya, Aktifkan'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: TAMBAH KATEGORI                                    */}
      {/* ========================================================= */}
      {showAddCatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 max-w-[420px] w-full shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle/40">
              <h3 className="text-[18px] font-bold text-dark">Tambah Kategori Baru</h3>
              <button
                type="button"
                onClick={() => setShowAddCatModal(false)}
                className="text-muted hover:text-dark p-1"
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            {formError && (
              <div className="rounded-[10px] border border-danger/30 bg-red-50 px-3.5 py-2 text-[13px] text-danger">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateCategorySubmit} className="flex flex-col gap-3.5">
              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">
                  Nama Kategori <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Audio & Mikrofon"
                  value={catFormData.category_name}
                  onChange={(e) => setCatFormData({ category_name: e.target.value })}
                  className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[14px] outline-none focus:border-navy"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 mt-2 pt-3 border-t border-border-subtle/40">
                <button
                  type="button"
                  onClick={() => setShowAddCatModal(false)}
                  className="px-4 py-2 rounded-[8px] text-[13px] font-semibold text-muted hover:text-dark transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-[8px] bg-navy text-white text-[13px] font-bold hover:bg-navy/90 transition cursor-pointer disabled:opacity-75"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Kategori'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: EDIT KATEGORI                                      */}
      {/* ========================================================= */}
      {editCatModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 max-w-[420px] w-full shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle/40">
              <h3 className="text-[18px] font-bold text-dark">Edit Nama Kategori</h3>
              <button
                type="button"
                onClick={() => setEditCatModal({ open: false, category: null })}
                className="text-muted hover:text-dark p-1"
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            {formError && (
              <div className="rounded-[10px] border border-danger/30 bg-red-50 px-3.5 py-2 text-[13px] text-danger">
                {formError}
              </div>
            )}

            <form onSubmit={handleUpdateCategorySubmit} className="flex flex-col gap-3.5">
              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">
                  Nama Kategori <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={catFormData.category_name}
                  onChange={(e) => setCatFormData({ category_name: e.target.value })}
                  className="w-full h-[40px] px-3 border border-border-subtle rounded-[8px] text-[14px] outline-none focus:border-navy"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 mt-2 pt-3 border-t border-border-subtle/40">
                <button
                  type="button"
                  onClick={() => setEditCatModal({ open: false, category: null })}
                  className="px-4 py-2 rounded-[8px] text-[13px] font-semibold text-muted hover:text-dark transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-[8px] bg-navy text-white text-[13px] font-bold hover:bg-navy/90 transition cursor-pointer disabled:opacity-75"
                >
                  {submitting ? 'Menyimpan...' : 'Perbarui Kategori'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: HAPUS KATEGORI                                     */}
      {/* ========================================================= */}
      {deleteCatModal.open && deleteCatModal.category && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 max-w-[420px] w-full shadow-xl flex flex-col gap-4">
            <div className="w-12 h-12 rounded-full bg-red-100 text-danger flex items-center justify-center mx-auto">
              <Icon name="trash" size={24} />
            </div>

            <div className="text-center">
              <h3 className="text-[18px] font-bold text-dark">Hapus Kategori?</h3>
              <p className="text-[13px] text-muted mt-2">
                Apakah Anda yakin ingin menghapus kategori &quot;<strong>{deleteCatModal.category.category_name}</strong>&quot;?
              </p>
              {Number(deleteCatModal.category.total_items) > 0 && (
                <p className="text-[12px] text-danger mt-2 bg-red-50 p-2.5 rounded-[8px] border border-red-200">
                  Perhatian: Kategori ini masih memiliki {deleteCatModal.category.total_items} barang terkait. Hapus atau pindahkan barang terlebih dahulu sebelum menghapus kategori.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteCatModal({ open: false, category: null, loading: false })}
                className="px-4 py-2 rounded-[8px] text-[13px] font-semibold text-muted hover:text-dark transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteCategoryConfirm}
                disabled={deleteCatModal.loading}
                className="px-4 py-2 rounded-[8px] bg-danger text-white text-[13px] font-bold hover:bg-danger/90 transition cursor-pointer disabled:opacity-75"
              >
                {deleteCatModal.loading ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

