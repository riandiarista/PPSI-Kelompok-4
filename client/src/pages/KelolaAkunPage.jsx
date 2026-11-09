import { useEffect, useState } from 'react'
import { ROLE_LABEL, ROLES, useAuth } from '../auth/authContext'
import Icon from '../components/Icon'
import { api } from '../lib/api'

export default function KelolaAkunPage() {
  const { user: currentUser } = useAuth()

  // State data utama
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' })

  // State filter & search
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'pending' | 'approved' | 'rejected'
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [refreshKey, setRefreshKey] = useState(0)

  // Trigger refresh data
  const refreshUsers = () => {
    setLoading(true)
    setRefreshKey((k) => k + 1)
  }

  // State Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [detailUser, setDetailUser] = useState(null)
  const [acceptModal, setAcceptModal] = useState({ open: false, user: null, loading: false })
  const [declineModal, setDeclineModal] = useState({ open: false, user: null, reason: '', loading: false })

  // State Form Tambah Akun
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    role: ROLES.PEMINJAM,
    must_change_password: true,
  })
  const [generatedPassword, setGeneratedPassword] = useState('')
  const [copiedPassword, setCopiedPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  // Tampilkan toast notifikasi sesaat
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' })
    }, 4500)
  }

  // Fetch daftar role dari database
  useEffect(() => {
    api('/admin/roles')
      .then((res) => {
        if (res.data) setRoles(res.data)
      })
      .catch((err) => {
        console.error('Gagal mengambil daftar role:', err)
      })
  }, [])

  // Fetch daftar pengguna dengan parameter filter
  useEffect(() => {
    let cancelled = false
    const queryParams = new URLSearchParams()
    if (search) queryParams.set('search', search)
    if (roleFilter !== 'all') queryParams.set('role', roleFilter)
    if (providerFilter !== 'all') queryParams.set('provider', providerFilter)
    if (activeTab !== 'all') queryParams.set('status', activeTab)

    api(`/admin/users?${queryParams.toString()}`)
      .then((res) => {
        if (cancelled) return
        setUsers(res.data || [])
        setError('')
        if (res.stats) setStats(res.stats)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Gagal memuat data pengguna')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [search, roleFilter, providerFilter, activeTab, refreshKey])

  // Handle submit search
  const handleSearchSubmit = (e) => {
    e.preventDefault()
    refreshUsers()
  }

  // Fungsi generate password acak aman
  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*'
    let pwd = 'En#'
    for (let i = 0; i < 9; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setGeneratedPassword(pwd)
    setFormData((prev) => ({ ...prev, password: pwd, must_change_password: true }))
    setCopiedPassword(false)
  }

  const handleCopyPassword = () => {
    if (generatedPassword) {
      navigator.clipboard.writeText(generatedPassword)
      setCopiedPassword(true)
      setTimeout(() => setCopiedPassword(false), 2000)
    }
  }

  // Submit Tambah Akun
  const handleAddUser = async (e) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)

    try {
      await api('/admin/users', {
        method: 'POST',
        body: formData,
      })
      showToast(`Akun untuk "${formData.full_name}" berhasil dibuat.`, 'success')
      setShowAddModal(false)
      setFormData({
        full_name: '',
        email: '',
        password: '',
        role: ROLES.PEMINJAM,
        must_change_password: true,
      })
      setGeneratedPassword('')
      refreshUsers()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Aksi Menyetujui Akun (Accept)
  const handleConfirmAccept = async () => {
    if (!acceptModal.user) return
    setAcceptModal((prev) => ({ ...prev, loading: true }))

    try {
      await api(`/admin/users/${acceptModal.user.user_id}/accept`, {
        method: 'POST',
      })
      showToast(`Pendaftaran ${acceptModal.user.full_name} berhasil disetujui.`, 'success')
      setAcceptModal({ open: false, user: null, loading: false })
      refreshUsers()
    } catch (err) {
      showToast(err.message || 'Gagal menyetujui akun', 'danger')
      setAcceptModal((prev) => ({ ...prev, loading: false }))
    }
  }

  // Aksi Menolak Akun (Decline)
  const handleConfirmDecline = async () => {
    if (!declineModal.user) return
    setDeclineModal((prev) => ({ ...prev, loading: true }))

    try {
      await api(`/admin/users/${declineModal.user.user_id}/decline`, {
        method: 'POST',
        body: { reason: declineModal.reason },
      })
      showToast(`Pendaftaran ${declineModal.user.full_name} telah ditolak.`, 'danger')
      setDeclineModal({ open: false, user: null, reason: '', loading: false })
      refreshUsers()
    } catch (err) {
      showToast(err.message || 'Gagal menolak akun', 'danger')
      setDeclineModal((prev) => ({ ...prev, loading: false }))
    }
  }

  // Aksi Toggle Aktif / Nonaktif
  const handleToggleActive = async (targetUser) => {
    if (targetUser.user_id === currentUser.user_id) {
      showToast('Anda tidak dapat menonaktifkan akun sendiri', 'danger')
      return
    }

    const newActiveState = !targetUser.is_active
    try {
      await api(`/admin/users/${targetUser.user_id}/status`, {
        method: 'PATCH',
        body: { is_active: newActiveState },
      })
      showToast(
        `Akun ${targetUser.full_name} berhasil ${newActiveState ? 'diaktifkan' : 'dinonaktifkan'}.`,
        newActiveState ? 'success' : 'danger'
      )
      refreshUsers()
    } catch (err) {
      showToast(err.message || 'Gagal mengubah status akun', 'danger')
    }
  }

  // Format tanggal ramah pengguna (WIB)
  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d)
  }

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] pb-12">
      {/* Toast Notification */}
      {toast.show && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-[12px] px-4 py-3 shadow-lg border transition-all ${
            toast.type === 'success'
              ? 'bg-[#EBFDF5] border-[#A7F3D0] text-[#065F46]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <Icon name={toast.type === 'success' ? 'check-circle' : 'alert-circle'} size={20} />
          <span className="text-[14px] font-medium">{toast.message}</span>
        </div>
      )}

      {/* Header Halaman */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold leading-[32px] tracking-[-0.01em] text-dark sm:text-[30px] sm:leading-[38px]">
            Kelola Akun
          </h1>
          <p className="mt-1 text-[14px] leading-[20px] text-muted">
            Pusat pengelolaan akun pengguna, penentuan role, dan persetujuan pendaftaran mandiri Google.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowAddModal(true)
            setFormError('')
          }}
          className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-navy px-4 py-2.5 text-[14px] font-bold text-white shadow-sm transition hover:bg-navy/90 active:bg-navy/95 cursor-pointer shrink-0"
        >
          <Icon name="plus" size={18} />
          <span>Tambah Akun</span>
        </button>
      </div>

      {/* Tab Navigasi Status */}
      <div className="flex flex-wrap gap-2 border-b border-border-subtle/40 pb-2">
        {[
          { key: 'all', label: 'Semua Akun', count: stats.total },
          { key: 'pending', label: 'Menunggu Persetujuan', count: stats.pending, highlight: stats.pending > 0 },
          { key: 'approved', label: 'Disetujui', count: stats.approved },
          { key: 'rejected', label: 'Ditolak', count: stats.rejected },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center gap-2 rounded-[8px] px-3.5 py-2 text-[14px] font-semibold transition cursor-pointer ${
              activeTab === tab.key
                ? 'bg-navy text-white shadow-xs'
                : 'text-muted hover:bg-white hover:text-dark'
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${
                activeTab === tab.key
                  ? 'bg-white/20 text-white'
                  : tab.highlight
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-neutral-200 text-neutral-700'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar Pencarian & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-white p-3 sm:p-4 rounded-[12px] border border-border-subtle/50 shadow-2xs">
        <form onSubmit={handleSearchSubmit} className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama lengkap atau email..."
            className="w-full h-[40px] pl-10 pr-4 bg-surface border border-border-subtle/60 rounded-[8px] text-[14px] text-dark placeholder:text-muted/70 outline-none focus:border-navy focus:bg-white transition"
          />
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
            <Icon name="search" size={16} />
          </span>
        </form>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Filter Role */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-[40px] px-3 bg-surface border border-border-subtle/60 rounded-[8px] text-[13px] font-medium text-dark outline-none focus:border-navy cursor-pointer"
          >
            <option value="all">Semua Role</option>
            <option value={ROLES.PEMINJAM}>Peminjam</option>
            <option value={ROLES.TENDIK}>Tendik</option>
            <option value={ROLES.KADEP}>Kadep</option>
          </select>

          {/* Filter Provider */}
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="h-[40px] px-3 bg-surface border border-border-subtle/60 rounded-[8px] text-[13px] font-medium text-dark outline-none focus:border-navy cursor-pointer"
          >
            <option value="all">Semua Sumber</option>
            <option value="local">Lokal (Admin)</option>
            <option value="google">Google</option>
          </select>

          {(search || roleFilter !== 'all' || providerFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setRoleFilter('all')
                setProviderFilter('all')
              }}
              className="h-[40px] px-3 text-[13px] text-muted hover:text-dark font-medium transition cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>
      </div>

      {/* Tabel Data Akun Pengguna */}
      <div className="overflow-hidden rounded-[14px] border border-border-subtle/60 bg-white shadow-xs">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-[14px] text-muted">
            <Icon name="refresh" className="animate-spin mr-2" size={20} />
            Memuat daftar pengguna...
          </div>
        ) : error ? (
          <div className="py-12 text-center text-[14px] text-danger">
            <p>{error}</p>
            <button
              type="button"
              onClick={refreshUsers}
              className="mt-2 text-primary font-semibold underline cursor-pointer"
            >
              Coba lagi
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-surface text-muted flex items-center justify-center mx-auto mb-3">
              <Icon name="user" size={24} />
            </div>
            <p className="text-[16px] font-bold text-dark">Tidak ada data pengguna ditemukan</p>
            <p className="text-[14px] text-muted mt-1">
              {search || roleFilter !== 'all' || providerFilter !== 'all'
                ? 'Coba sesuaikan kata kunci pencarian atau filter yang dipilih.'
                : activeTab === 'pending'
                ? 'Tidak ada permohonan pendaftaran Google yang menunggu persetujuan.'
                : 'Belum ada akun terdaftar.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-[#FAFBF9] border-b border-border-subtle/50 text-[12px] font-bold uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-5 py-3.5">Pengguna</th>
                  <th scope="col" className="px-5 py-3.5">Role</th>
                  <th scope="col" className="px-5 py-3.5">Sumber</th>
                  <th scope="col" className="px-5 py-3.5">Status Persetujuan</th>
                  <th scope="col" className="px-5 py-3.5">Status Keaktifan</th>
                  <th scope="col" className="px-5 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle/30 text-dark">
                {users.map((u) => {
                  const isPending = u.registration_status === 'pending'
                  const isApproved = u.registration_status === 'approved'
                  const isRejected = u.registration_status === 'rejected'

                  return (
                    <tr
                      key={u.user_id}
                      className={`hover:bg-surface/60 transition ${
                        isPending ? 'bg-amber-50/30' : ''
                      }`}
                    >
                      {/* Kolom Pengguna */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          {u.avatar_url ? (
                            <img
                              src={u.avatar_url}
                              alt={u.full_name}
                              className="w-10 h-10 rounded-full object-cover border border-border-subtle/50 shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-navy/10 text-navy font-bold flex items-center justify-center shrink-0 text-[14px]">
                              {u.full_name
                                .split(' ')
                                .slice(0, 2)
                                .map((n) => n[0])
                                .join('')
                                .toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-dark truncate flex items-center gap-2">
                              <span>{u.full_name}</span>
                              {u.user_id === currentUser.user_id && (
                                <span className="rounded bg-navy/10 px-1.5 py-0.5 text-[11px] font-bold text-navy">
                                  Anda
                                </span>
                              )}
                            </div>
                            <div className="text-[13px] text-muted truncate">{u.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Kolom Role */}
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-md text-[12px] font-bold ${
                            u.role === ROLES.TENDIK
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : u.role === ROLES.KADEP
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {ROLE_LABEL[u.role] || u.role}
                        </span>
                      </td>

                      {/* Kolom Sumber Auth */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-[13px]">
                          {u.auth_provider === 'google' ? (
                            <>
                              <GoogleSmallIcon />
                              <span className="font-medium">Google</span>
                            </>
                          ) : (
                            <span className="font-medium text-muted">Lokal</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted mt-0.5">
                          {formatDate(u.created_at)}
                        </div>
                      </td>

                      {/* Kolom Status Persetujuan */}
                      <td className="px-5 py-4">
                        {isPending && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 px-3 py-1 text-[12px] font-bold">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            Menunggu Persetujuan
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-[12px] font-bold">
                            <Icon name="check" size={13} />
                            Disetujui
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-800 px-3 py-1 text-[12px] font-bold">
                            <Icon name="x" size={13} />
                            Ditolak
                          </span>
                        )}
                      </td>

                      {/* Kolom Status Keaktifan */}
                      <td className="px-5 py-4">
                        {isPending ? (
                          <span className="text-[13px] text-muted italic">-</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u)}
                            disabled={u.user_id === currentUser.user_id}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold transition ${
                              u.is_active
                                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                            } ${u.user_id === currentUser.user_id ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
                            title={
                              u.user_id === currentUser.user_id
                                ? 'Tidak dapat mengubah akun Anda sendiri'
                                : 'Klik untuk mengubah status aktif'
                            }
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                u.is_active ? 'bg-emerald-500' : 'bg-neutral-400'
                              }`}
                            />
                            {u.is_active ? 'Aktif' : 'Nonaktif'}
                          </button>
                        )}
                      </td>

                      {/* Kolom Aksi */}
                      <td className="px-5 py-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          {isPending ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setAcceptModal({ open: true, user: u, loading: false })}
                                className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#14532D] hover:bg-[#166534] text-white px-3 py-1.5 text-[13px] font-bold transition shadow-2xs cursor-pointer"
                              >
                                <Icon name="check" size={14} />
                                <span>Setujui</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeclineModal({ open: true, user: u, reason: '', loading: false })
                                }
                                className="inline-flex items-center gap-1.5 rounded-[8px] border border-danger/40 hover:bg-red-50 text-danger px-3 py-1.5 text-[13px] font-bold transition cursor-pointer"
                              >
                                <Icon name="x" size={14} />
                                <span>Tolak</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDetailUser(u)}
                              className="rounded-[8px] border border-border-subtle/60 px-3 py-1.5 text-[13px] font-semibold text-dark hover:bg-surface transition cursor-pointer"
                            >
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

      {/* MODAL 1: Tambah Akun Pengguna oleh Tendik */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] max-w-[500px] w-full p-6 shadow-xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle/40">
              <div>
                <h3 className="text-[18px] font-bold text-dark">Tambah Akun Pengguna Baru</h3>
                <p className="text-[13px] text-muted">Akun langsung aktif dan dapat digunakan login.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-muted hover:text-dark p-1 rounded-md cursor-pointer"
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            {formError && (
              <div className="rounded-[10px] border border-danger/30 bg-red-50 p-3 text-[13px] text-danger">
                {formError}
              </div>
            )}

            <form onSubmit={handleAddUser} className="flex flex-col gap-4">
              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">
                  Nama Lengkap <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Contoh: Rian Pratama"
                  className="w-full h-[42px] px-3.5 border border-border-subtle/80 rounded-[10px] text-[14px] text-dark outline-none focus:border-navy focus:ring-1 focus:ring-navy transition"
                />
              </div>

              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">
                  Alamat Email <span className="text-danger">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="nama@email.com"
                  className="w-full h-[42px] px-3.5 border border-border-subtle/80 rounded-[10px] text-[14px] text-dark outline-none focus:border-navy focus:ring-1 focus:ring-navy transition"
                />
              </div>

              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">
                  Role Pengguna <span className="text-danger">*</span>
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full h-[42px] px-3.5 border border-border-subtle/80 rounded-[10px] text-[14px] text-dark outline-none focus:border-navy focus:ring-1 focus:ring-navy transition cursor-pointer bg-white"
                >
                  {roles.length > 0 ? (
                    roles.map((r) => (
                      <option key={r.role_id} value={r.role_name}>
                        {ROLE_LABEL[r.role_name] || r.role_name}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value={ROLES.PEMINJAM}>Peminjam</option>
                      <option value={ROLES.TENDIK}>Tenaga Kependidikan (Tendik)</option>
                      <option value={ROLES.KADEP}>Ketua Departemen (Kadep)</option>
                    </>
                  )}
                </select>
                <p className="text-[12px] text-muted mt-1">
                  Role menentukan hak akses menu dan otoritas aksi dalam sistem.
                </p>
              </div>

              <div className="border-t border-border-subtle/40 pt-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[13px] font-semibold text-dark">
                    Kata Sandi Awal <span className="text-danger">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={generateRandomPassword}
                    className="inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline cursor-pointer"
                  >
                    <Icon name="refresh" size={13} />
                    <span>Buat Password Acak</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Minimal 6 karakter"
                    className="w-full h-[42px] pl-3.5 pr-20 border border-border-subtle/80 rounded-[10px] text-[14px] text-dark font-mono outline-none focus:border-navy focus:ring-1 focus:ring-navy transition"
                  />
                  {formData.password && (
                    <button
                      type="button"
                      onClick={handleCopyPassword}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-[11px] font-bold text-dark transition cursor-pointer"
                    >
                      {copiedPassword ? 'Tersalin!' : 'Salin'}
                    </button>
                  )}
                </div>

                {generatedPassword && (
                  <div className="mt-2 p-2.5 bg-amber-50 rounded-[8px] border border-amber-200 text-[12px] text-amber-900">
                    <strong>Password Acak Dibuat:</strong> Simpan atau salin password ini untuk diberikan kepada pengguna satu kali.
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3">
                  <input
                    type="checkbox"
                    id="must_change_password"
                    checked={formData.must_change_password}
                    onChange={(e) => setFormData({ ...formData, must_change_password: e.target.checked })}
                    className="w-4 h-4 rounded text-navy focus:ring-navy border-border-subtle cursor-pointer"
                  />
                  <label htmlFor="must_change_password" className="text-[13px] text-dark font-medium cursor-pointer">
                    Wajibkan ganti kata sandi saat login pertama kali
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-border-subtle/40">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-[14px] font-semibold text-muted hover:text-dark cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-navy hover:bg-navy/90 text-white font-bold text-[14px] rounded-[10px] transition shadow-xs cursor-pointer disabled:opacity-75"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Konfirmasi Persetujuan (Accept) */}
      {acceptModal.open && acceptModal.user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] max-w-[460px] w-full p-6 shadow-xl flex flex-col gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Icon name="check" size={24} />
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-[18px] font-bold text-dark">Setujui Pendaftaran Akun?</h3>
              <p className="text-[14px] text-muted">
                Pengguna berikut akan diberikan izin akses ke sistem sebagai <strong>Peminjam</strong> dan dapat langsung login menggunakan akun Google-nya:
              </p>
            </div>

            <div className="p-3.5 bg-surface rounded-[10px] border border-border-subtle/50 text-[13px] space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted">Nama:</span>
                <span className="font-bold text-dark">{acceptModal.user.full_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Email Google:</span>
                <span className="font-semibold text-dark">{acceptModal.user.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Role Diberikan:</span>
                <span className="font-bold text-emerald-700">Peminjam</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setAcceptModal({ open: false, user: null, loading: false })}
                disabled={acceptModal.loading}
                className="px-4 py-2 text-[14px] font-semibold text-muted hover:text-dark cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmAccept}
                disabled={acceptModal.loading}
                className="px-5 py-2.5 bg-[#14532D] hover:bg-[#166534] text-white font-bold text-[14px] rounded-[10px] transition shadow-xs cursor-pointer disabled:opacity-75"
              >
                {acceptModal.loading ? 'Memproses...' : 'Ya, Setujui Akun'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Konfirmasi Penolakan (Decline) */}
      {declineModal.open && declineModal.user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] max-w-[460px] w-full p-6 shadow-xl flex flex-col gap-4">
            <div className="w-12 h-12 rounded-full bg-red-100 text-danger flex items-center justify-center">
              <Icon name="x" size={24} />
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-[18px] font-bold text-dark">Tolak Pendaftaran Akun?</h3>
              <p className="text-[14px] text-muted">
                Pendaftaran untuk <strong>{declineModal.user.full_name}</strong> ({declineModal.user.email}) akan ditolak dan pengguna tidak dapat mengakses sistem.
              </p>
            </div>

            <div>
              <label className="text-[13px] font-semibold text-dark block mb-1">
                Alasan Penolakan <span className="text-muted text-[12px] font-normal">(Opsional)</span>
              </label>
              <textarea
                rows={3}
                value={declineModal.reason}
                onChange={(e) => setDeclineModal({ ...declineModal, reason: e.target.value })}
                placeholder="Contoh: Bukan mahasiswa aktif / data identitas tidak valid..."
                className="w-full p-3 border border-border-subtle/80 rounded-[10px] text-[13px] text-dark outline-none focus:border-navy transition resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeclineModal({ open: false, user: null, reason: '', loading: false })}
                disabled={declineModal.loading}
                className="px-4 py-2 text-[14px] font-semibold text-muted hover:text-dark cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDecline}
                disabled={declineModal.loading}
                className="px-5 py-2.5 bg-danger hover:bg-danger/90 text-white font-bold text-[14px] rounded-[10px] transition shadow-xs cursor-pointer disabled:opacity-75"
              >
                {declineModal.loading ? 'Memproses...' : 'Tolak Pendaftaran'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Detail Informasi Akun */}
      {detailUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] max-w-[520px] w-full p-6 shadow-xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle/40">
              <div className="flex items-center gap-3">
                {detailUser.avatar_url ? (
                  <img
                    src={detailUser.avatar_url}
                    alt={detailUser.full_name}
                    className="w-12 h-12 rounded-full object-cover border border-border-subtle/50"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-navy/10 text-navy font-bold flex items-center justify-center text-[16px]">
                    {detailUser.full_name
                      .split(' ')
                      .slice(0, 2)
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()}
                  </div>
                )}
                <div>
                  <h3 className="text-[18px] font-bold text-dark">{detailUser.full_name}</h3>
                  <p className="text-[13px] text-muted">{detailUser.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailUser(null)}
                className="text-muted hover:text-dark p-1 rounded-md cursor-pointer"
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div className="p-3 bg-surface rounded-[10px]">
                <span className="text-muted block text-[11px] font-semibold uppercase">Role</span>
                <span className="font-bold text-dark">{ROLE_LABEL[detailUser.role] || detailUser.role}</span>
              </div>
              <div className="p-3 bg-surface rounded-[10px]">
                <span className="text-muted block text-[11px] font-semibold uppercase">Sumber Akun</span>
                <span className="font-bold text-dark capitalize">{detailUser.auth_provider}</span>
              </div>
              <div className="p-3 bg-surface rounded-[10px]">
                <span className="text-muted block text-[11px] font-semibold uppercase">Status Persetujuan</span>
                <span className="font-bold text-dark capitalize">{detailUser.registration_status}</span>
              </div>
              <div className="p-3 bg-surface rounded-[10px]">
                <span className="text-muted block text-[11px] font-semibold uppercase">Status Keaktifan</span>
                <span className="font-bold text-dark">{detailUser.is_active ? 'Aktif' : 'Nonaktif'}</span>
              </div>
            </div>

            <div className="space-y-2 text-[13px] p-3.5 bg-surface/70 rounded-[10px] border border-border-subtle/40">
              <div className="flex justify-between">
                <span className="text-muted">Tanggal Pendaftaran:</span>
                <span className="font-medium text-dark">{formatDate(detailUser.created_at)}</span>
              </div>
              {detailUser.approved_at && (
                <div className="flex justify-between">
                  <span className="text-muted">Disetujui Pada:</span>
                  <span className="font-medium text-dark">{formatDate(detailUser.approved_at)}</span>
                </div>
              )}
              {detailUser.approved_by_name && (
                <div className="flex justify-between">
                  <span className="text-muted">Disetujui Oleh:</span>
                  <span className="font-medium text-dark">{detailUser.approved_by_name}</span>
                </div>
              )}
              {detailUser.rejected_at && (
                <div className="flex justify-between">
                  <span className="text-muted">Ditolak Pada:</span>
                  <span className="font-medium text-danger">{formatDate(detailUser.rejected_at)}</span>
                </div>
              )}
              {detailUser.rejected_by_name && (
                <div className="flex justify-between">
                  <span className="text-muted">Ditolak Oleh:</span>
                  <span className="font-medium text-dark">{detailUser.rejected_by_name}</span>
                </div>
              )}
              {detailUser.rejection_reason && (
                <div className="pt-2 border-t border-border-subtle/30">
                  <span className="text-muted block mb-1">Alasan Penolakan:</span>
                  <p className="text-danger font-medium">{detailUser.rejection_reason}</p>
                </div>
              )}
              {detailUser.google_id && (
                <div className="pt-2 border-t border-border-subtle/30 flex justify-between text-[11px]">
                  <span className="text-muted">Google User ID:</span>
                  <span className="font-mono text-dark">{detailUser.google_id}</span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setDetailUser(null)}
              className="w-full h-[40px] bg-navy text-white rounded-[10px] text-[14px] font-semibold hover:bg-navy/90 transition cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function GoogleSmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.27 21.43 7.35 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.27 2.57 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  )
}
