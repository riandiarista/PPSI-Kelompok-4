import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { api } from '../lib/api'

// Harus sama dengan server/src/constants/loanRules.js
const MAX_DURATION_DAYS = 7
const MAX_ADVANCE_DAYS = 30

// "YYYY-MM-DD" hari ini dalam WIB
function todayWib() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// "2026-11-20" -> "20 Nov 2026"
function formatTanggal(dateStr) {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${dateStr}T12:00:00Z`)
  )
}

// Rentang dari server [mulai, selesai) -> "20 – 21 Nov 2026" (tanggal terakhir dipakai = selesai - 1 hari)
function formatRentang(start, end) {
  const fmt = (d) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(d)
  const s = new Date(start)
  const last = new Date(new Date(end).getTime() - 1)
  return fmt(s) === fmt(last) ? fmt(s) : `${fmt(s)} – ${fmt(last)}`
}

// Data bawaan sesuai tampilan desain/mockup
const DEFAULT_ITEMS = [
  {
    item_id: 1,
    item_name: 'Kamera DSLR',
    category_name: 'Kamera',
    item_condition: 'good',
    item_condition_label: 'Kondisi baik',
    availability_status: 'available',
  },
  {
    item_id: 2,
    item_name: 'Proyektor (Infokus) 01',
    category_name: 'Proyektor',
    item_condition: 'good',
    item_condition_label: 'Kondisi baik',
    availability_status: 'available',
  },
  {
    item_id: 3,
    item_name: 'Proyektor (Infokus) 02',
    category_name: 'Proyektor',
    item_condition: 'good',
    item_condition_label: 'Kondisi baik',
    availability_status: 'borrowed',
  },
  {
    item_id: 4,
    item_name: 'Speaker portabel',
    category_name: 'Elektronik',
    item_condition: 'good',
    item_condition_label: 'Kondisi baik',
    availability_status: 'available',
  },
  {
    item_id: 5,
    item_name: 'Buku sumbangan dosen',
    category_name: 'Buku',
    item_condition: 'good',
    item_condition_label: 'Kondisi baik',
    availability_status: 'available',
  },
  {
    item_id: 6,
    item_name: 'Tripod',
    category_name: 'Kamera',
    item_condition: 'good',
    item_condition_label: 'Kondisi baik',
    availability_status: 'return_process',
  },
]

// Pemetaan badge status operasional
const STATUS_CONFIG = {
  available: {
    label: 'Tersedia',
    badgeClass: 'bg-[#EBF7EE] text-[#1E7E34] border-[#D4EDDA]',
    isAvailable: true,
  },
  borrowed: {
    label: 'Sedang dipinjam',
    badgeClass: 'bg-[#FFF6E5] text-[#B76E00] border-[#FFE8B8]',
    isAvailable: false,
  },
  return_process: {
    label: 'Proses pengembalian',
    badgeClass: 'bg-[#EBF2FC] text-[#2C6ECB] border-[#D0E2FB]',
    isAvailable: false,
  },
  maintenance: {
    label: 'Perbaikan',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    isAvailable: false,
  },
  unavailable: {
    label: 'Tidak tersedia',
    badgeClass: 'bg-neutral-100 text-neutral-500 border-neutral-200',
    isAvailable: false,
  },
}

export default function KatalogBarangPage() {
  const [items, setItems] = useState(DEFAULT_ITEMS)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all') // 'all' | 'available' | 'borrowed' | 'return_process'
  const [selectedItemId, setSelectedItemId] = useState(1) // Default Kamera DSLR terpilih

  // Form State
  const [purpose, setPurpose] = useState('')
  const [borrowDate, setBorrowDate] = useState(todayWib)
  const [duration, setDuration] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [successModal, setSuccessModal] = useState({ open: false, data: null })
  // Hasil cek ketersediaan & bentrok jadwal (#24), disimpan bersama kunci query-nya
  const [availability, setAvailability] = useState({ key: null, data: null, error: '' })
  const [availabilityVersion, setAvailabilityVersion] = useState(0)

  // Coba ambil data dari API server jika tersedia, fallback ke DEFAULT_ITEMS
  useEffect(() => {
    let cancelled = false
    api('/inventory/items')
      .then((res) => {
        if (cancelled) return
        if (res?.data && res.data.length > 0) {
          const mapped = res.data.map((item) => ({
            ...item,
            item_condition_label:
              item.item_condition === 'good'
                ? 'Kondisi baik'
                : item.item_condition === 'minor_damage'
                ? 'Rusak ringan'
                : 'Rusak berat',
          }))
          setItems(mapped)
          // Set item pertama yang tersedia sebagai pilihan awal
          const firstAvailable = mapped.find((it) => it.availability_status === 'available')
          if (firstAvailable) {
            setSelectedItemId(firstAvailable.item_id)
          }
        }
      })
      .catch(() => {
        // Jika server backend belum berjalan / belum ada data, gunakan DEFAULT_ITEMS
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Item yang sedang aktif terpilih
  const selectedItem = useMemo(() => {
    return items.find((item) => item.item_id === selectedItemId) || items[0] || null
  }, [items, selectedItemId])

  // Cek ketersediaan ke server setiap kali barang/tanggal/durasi berubah
  const canCheck = Boolean(selectedItem && selectedItem.availability_status === 'available' && borrowDate)
  const availabilityKey = canCheck ? `${selectedItem.item_id}|${borrowDate}|${duration}|${availabilityVersion}` : null

  useEffect(() => {
    if (!availabilityKey) return
    const [itemId, date, days] = availabilityKey.split('|')
    let cancelled = false
    // Jeda singkat supaya tidak memanggil server di setiap ketukan saat memilih tanggal
    const timer = setTimeout(() => {
      api(`/loans/availability?${new URLSearchParams({ item_id: itemId, borrow_date: date, duration_days: days })}`)
        .then((res) => {
          if (!cancelled) setAvailability({ key: availabilityKey, data: res.data, error: '' })
        })
        .catch((err) => {
          if (!cancelled) setAvailability({ key: availabilityKey, data: null, error: err.message })
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [availabilityKey])

  const availabilityReady = availabilityKey !== null && availability.key === availabilityKey
  const checkResult = availabilityReady ? availability.data : null
  const checkError = availabilityReady ? availability.error : ''
  const scheduleBlocked = checkResult?.available === false

  // Hitung jumlah item per kategori status
  const counts = useMemo(() => {
    return {
      all: items.length,
      available: items.filter((it) => it.availability_status === 'available').length,
      borrowed: items.filter((it) => it.availability_status === 'borrowed').length,
      return_process: items.filter((it) => it.availability_status === 'return_process').length,
    }
  }, [items])

  // Filter daftar item berdasarkan pencarian dan status pill
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchSearch =
        search.trim() === '' ||
        item.item_name.toLowerCase().includes(search.toLowerCase()) ||
        item.category_name?.toLowerCase().includes(search.toLowerCase())

      const matchFilter =
        activeFilter === 'all'
          ? true
          : item.availability_status === activeFilter

      return matchSearch && matchFilter
    })
  }, [items, search, activeFilter])

  // Handle pengiriman formulir peminjaman
  const handleSubmitLoan = async (e) => {
    e.preventDefault()
    setFormError('')

    if (!selectedItem) {
      setFormError('Silakan pilih barang yang ingin dipinjam terlebih dahulu.')
      return
    }

    if (selectedItem.availability_status !== 'available') {
      setFormError('Barang yang dipilih sedang tidak tersedia untuk dipinjam.')
      return
    }

    if (!purpose.trim()) {
      setFormError('Keperluan peminjaman wajib diisi.')
      return
    }

    if (!borrowDate) {
      setFormError('Tanggal pinjam wajib diisi.')
      return
    }

    setSubmitting(true)

    try {
      // Server memvalidasi ulang ketersediaan & bentrok jadwal saat menyimpan
      const res = await api('/loans/request', {
        method: 'POST',
        body: {
          item_id: selectedItem.item_id,
          purpose: purpose.trim(),
          borrow_date: borrowDate,
          duration_days: duration,
        },
      })

      setSuccessModal({
        open: true,
        data: {
          itemName: selectedItem.item_name,
          category: selectedItem.category_name,
          purpose: purpose.trim(),
          date: formatTanggal(borrowDate),
          duration: `${duration} hari`,
          message: res.message,
          pendingOverlaps: res.data?.pending_overlaps || 0,
        },
      })
      setPurpose('')
      // Jadwal berubah setelah pengajuan, cek ulang ketersediaannya
      setAvailabilityVersion((v) => v + 1)
    } catch (err) {
      setFormError(err.message || 'Gagal mengajukan peminjaman.')
      setAvailabilityVersion((v) => v + 1)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header Halaman: Judul, Subjudul & Pencarian */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-0.01em] text-[#14231F] sm:text-[30px] sm:leading-[38px]">
            Katalog barang
          </h1>
          <p className="mt-1 text-[13.5px] text-[#4A5B56]">
            Pilih barang yang tersedia, lalu isi form pengajuan di sebelah kanan.
          </p>
        </div>

        {/* Input Cari Nama Barang */}
        <div className="w-full sm:w-[260px] lg:w-[280px]">
          <label htmlFor="search-input" className="mb-1.5 block text-[13px] font-medium text-[#14231F]">
            Cari nama barang
          </label>
          <div className="relative">
            <input
              id="search-input"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Contoh: proyektor"
              className="w-full rounded-[10px] border border-neutral-300 bg-white px-3.5 py-2 text-[13.5px] text-[#14231F] placeholder:text-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                aria-label="Bersihkan pencarian"
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filter Status Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveFilter('all')}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
            activeFilter === 'all'
              ? 'bg-[#1E3F70] text-white shadow-sm'
              : 'border border-neutral-300 bg-white text-[#14231F] hover:bg-neutral-50'
          }`}
        >
          Semua · {counts.all}
        </button>

        <button
          type="button"
          onClick={() => setActiveFilter('available')}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
            activeFilter === 'available'
              ? 'bg-[#1E3F70] text-white shadow-sm'
              : 'border border-neutral-300 bg-white text-[#14231F] hover:bg-neutral-50'
          }`}
        >
          Tersedia · {counts.available}
        </button>

        <button
          type="button"
          onClick={() => setActiveFilter('borrowed')}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
            activeFilter === 'borrowed'
              ? 'bg-[#1E3F70] text-white shadow-sm'
              : 'border border-neutral-300 bg-white text-[#14231F] hover:bg-neutral-50'
          }`}
        >
          Sedang dipinjam · {counts.borrowed}
        </button>

        <button
          type="button"
          onClick={() => setActiveFilter('return_process')}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
            activeFilter === 'return_process'
              ? 'bg-[#1E3F70] text-white shadow-sm'
              : 'border border-neutral-300 bg-white text-[#14231F] hover:bg-neutral-50'
          }`}
        >
          Proses pengembalian · {counts.return_process}
        </button>
      </div>

      {/* Konten Utama: 2 Kolom (Katalog Grid di Kiri + Form Pengajuan di Kanan) */}
      <div className="flex flex-col items-start gap-6 lg:flex-row">
        {/* Kolom Kiri: Grid Kartu Barang */}
        <div className="min-w-0 flex-1 w-full">
          {filteredItems.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
              <Icon name="search" size={32} className="mx-auto text-neutral-400" />
              <p className="mt-3 text-[15px] font-bold text-[#14231F]">Barang tidak ditemukan</p>
              <p className="mt-1 text-[13px] text-[#4A5B56]">
                Tidak ada barang yang cocok dengan kata kunci atau filter yang dipilih.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setActiveFilter('all')
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-[#1E3F70] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#163056]"
              >
                Reset pencarian & filter
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map((item) => {
                const statusInfo = STATUS_CONFIG[item.availability_status] || STATUS_CONFIG.available
                const isSelected = selectedItemId === item.item_id
                const isAvailable = statusInfo.isAvailable

                return (
                  <div
                    key={item.item_id}
                    onClick={() => {
                      if (isAvailable) setSelectedItemId(item.item_id)
                    }}
                    className={`flex flex-col justify-between rounded-[14px] bg-white p-4 transition ${
                      isSelected
                        ? 'border-2 border-[#1E3F70] shadow-sm'
                        : 'border border-neutral-200/90 hover:border-neutral-300'
                    } ${isAvailable ? 'cursor-pointer' : ''}`}
                  >
                    <div>
                      {/* Placeholder Foto Barang */}
                      <div className="mb-3.5 flex h-32 w-full select-none items-center justify-center rounded-[10px] bg-[#E5EAE8]/70 text-[13px] font-medium text-neutral-400">
                        Foto barang
                      </div>

                      {/* Nama Barang */}
                      <h3 className="line-clamp-1 text-[15px] font-bold text-[#14231F]">
                        {item.item_name}
                      </h3>

                      {/* Kategori dan Kondisi */}
                      <p className="mt-0.5 text-[12px] text-[#4A5B56]">
                        {item.category_name} · {item.item_condition_label || 'Kondisi baik'}
                      </p>

                      {/* Badge Status */}
                      <div className="mt-2.5 mb-3.5">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusInfo.badgeClass}`}
                        >
                          {statusInfo.label}
                        </span>
                      </div>
                    </div>

                    {/* Tombol Aksi per Kartu */}
                    <div>
                      {isSelected ? (
                        <button
                          type="button"
                          className="w-full rounded-[8px] bg-[#1E3F70] py-2 text-center text-[13px] font-semibold text-white shadow-sm"
                        >
                          Dipilih
                        </button>
                      ) : isAvailable ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedItemId(item.item_id)
                          }}
                          className="w-full rounded-[8px] bg-[#1E3F70] py-2 text-center text-[13px] font-medium text-white shadow-sm transition hover:bg-[#163056] active:scale-[0.99]"
                        >
                          Pilih untuk diajukan
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="w-full cursor-not-allowed rounded-[8px] bg-[#EEF2F0] py-2 text-center text-[13px] font-medium text-neutral-400 select-none"
                        >
                          Belum tersedia
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Kolom Kanan: Kartu Form Pengajuan Peminjaman */}
        <div className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[360px] xl:w-[390px]">
          <div className="rounded-[16px] border border-neutral-200/90 bg-white p-5 shadow-sm sm:p-6">
            {/* Header Form */}
            <div className="mb-4">
              <span className="block text-[11px] font-bold tracking-wider text-[#14532D] uppercase">
                AJUKAN PEMINJAMAN
              </span>
              <h2 className="mt-0.5 text-[20px] font-bold leading-tight text-[#14231F]">
                {selectedItem ? selectedItem.item_name : 'Pilih barang'}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-[#4A5B56]">
                {selectedItem ? selectedItem.category_name : '-'}
              </p>
            </div>

            {/* Error Notifikasi Form */}
            {formError && (
              <div className="mb-4 rounded-[8px] bg-red-50 p-2.5 text-[12.5px] text-red-700">
                {formError}
              </div>
            )}

            {/* Formulir */}
            <form onSubmit={handleSubmitLoan} className="flex flex-col gap-4">
              {/* Field Keperluan */}
              <div>
                <label htmlFor="loan-purpose" className="mb-1.5 block text-[13px] font-medium text-[#14231F]">
                  Keperluan
                </label>
                <textarea
                  id="loan-purpose"
                  rows={3}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="Jelaskan untuk kegiatan apa barang dipakai"
                  className="w-full resize-none rounded-[10px] border border-neutral-300 p-3 text-[13px] text-[#14231F] placeholder:text-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
                />
              </div>

              {/* Row: Tanggal Pinjam & Durasi */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="loan-date" className="mb-1.5 block text-[13px] font-medium text-[#14231F]">
                    Tanggal pinjam
                  </label>
                  <input
                    id="loan-date"
                    type="date"
                    value={borrowDate}
                    min={todayWib()}
                    max={addDays(todayWib(), MAX_ADVANCE_DAYS)}
                    onChange={(e) => {
                      setBorrowDate(e.target.value)
                      setFormError('')
                    }}
                    className="w-full rounded-[10px] border border-neutral-300 px-3 py-2 text-[13px] text-[#14231F] focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
                  />
                </div>

                <div>
                  <label htmlFor="loan-duration" className="mb-1.5 block text-[13px] font-medium text-[#14231F]">
                    Durasi
                  </label>
                  <select
                    id="loan-duration"
                    value={duration}
                    onChange={(e) => {
                      setDuration(Number(e.target.value))
                      setFormError('')
                    }}
                    className="w-full rounded-[10px] border border-neutral-300 bg-white px-3 py-2 text-[13px] text-[#14231F] focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15"
                  >
                    {Array.from({ length: MAX_DURATION_DAYS }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d} hari
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Hasil cek ketersediaan & bentrok jadwal */}
              <AvailabilityStatus
                enabled={canCheck}
                loading={canCheck && !availabilityReady}
                result={checkResult}
                error={checkError}
              />

              {/* Catatan / Peringatan Pengajuan Akhir Pekan */}
              <div className="rounded-[10px] bg-[#FEF6E6] p-3 text-[12px] leading-relaxed text-[#855302]">
                Pengajuan pada hari Sabtu atau Minggu dicatat dan baru diproses pada hari kerja berikutnya.
              </div>

              {/* Tombol Kirim Pengajuan */}
              <button
                type="submit"
                disabled={submitting || !selectedItem || selectedItem.availability_status !== 'available' || scheduleBlocked}
                className="mt-1 flex w-full items-center justify-center rounded-[10px] bg-[#14532D] py-2.5 text-center text-[14px] font-semibold text-white shadow-sm transition hover:bg-[#0f3f22] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500"
              >
                {submitting ? 'Mengirim...' : 'Kirim pengajuan'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Modal Dialog Konfirmasi Berhasil */}
      {successModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Icon name="check" size={24} />
            </div>

            <h3 className="text-center text-[18px] font-bold text-[#14231F]">
              Pengajuan Peminjaman Terkirim!
            </h3>
            <p className="mt-2 text-center text-[13.5px] text-[#4A5B56]">
              {successModal.data?.message ||
                'Pengajuan berhasil dikirim dan sedang menunggu persetujuan.'}
            </p>
            {successModal.data?.pendingOverlaps > 0 && (
              <p className="mt-2 rounded-[8px] bg-[#FEF6E6] p-2.5 text-center text-[12.5px] text-[#855302]">
                Ada {successModal.data.pendingOverlaps} pengajuan lain di jadwal yang beririsan. Ketua Departemen
                akan memilih salah satu.
              </p>
            )}

            <div className="my-4 rounded-[10px] bg-[#F6F7F5] p-3 text-[12.5px] text-[#14231F]">
              <div className="flex justify-between py-1 border-b border-neutral-200/60">
                <span className="text-[#4A5B56]">Barang:</span>
                <span className="font-semibold">{successModal.data?.itemName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-neutral-200/60">
                <span className="text-[#4A5B56]">Tanggal pinjam:</span>
                <span className="font-semibold">{successModal.data?.date}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#4A5B56]">Durasi:</span>
                <span className="font-semibold">{successModal.data?.duration}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Link
                to="/peminjam/status"
                className="w-full rounded-[10px] bg-[#1E3F70] py-2.5 text-center text-[13.5px] font-medium text-white hover:bg-[#163056]"
              >
                Lihat Status & Notifikasi
              </Link>
              <button
                type="button"
                onClick={() => setSuccessModal({ open: false, data: null })}
                className="w-full rounded-[10px] border border-neutral-300 py-2.5 text-center text-[13.5px] font-medium text-[#14231F] hover:bg-neutral-50"
              >
                Tutup & Ajukan Lainnya
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Kotak status hasil cek ketersediaan & bentrok jadwal di form pengajuan
function AvailabilityStatus({ enabled, loading, result, error }) {
  if (!enabled) return null

  const box = 'rounded-[10px] p-3 text-[12.5px] leading-relaxed'

  if (loading) {
    return <div className={`${box} bg-[#F6F7F5] text-[#4A5B56]`}>Mengecek ketersediaan jadwal…</div>
  }

  if (error) {
    return <div className={`${box} bg-red-50 text-red-700`}>{error}</div>
  }

  if (!result) return null

  if (!result.available) {
    return (
      <div className={`${box} bg-red-50 text-red-700`} role="alert">
        <p className="font-semibold">{result.reason}</p>
        {result.conflicts?.length > 0 && (
          <ul className="mt-1 list-disc pl-4">
            {result.conflicts.map((c) => (
              <li key={`${c.start}-${c.end}`}>
                {formatRentang(c.start, c.end)}
                {c.status === 'pending' ? ' (pengajuan Anda)' : ' (sudah disetujui)'}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1">Silakan pilih tanggal atau durasi lain.</p>
      </div>
    )
  }

  if (result.pending_overlaps > 0) {
    return (
      <div className={`${box} bg-[#FEF6E6] text-[#855302]`}>
        Jadwal masih bisa diajukan, tetapi ada {result.pending_overlaps} pengajuan lain yang menunggu persetujuan di
        tanggal yang beririsan. Ketua Departemen akan memilih salah satu.
      </div>
    )
  }

  return (
    <div className={`${box} bg-[#EBF7EE] text-[#1E7E34]`}>
      Barang tersedia untuk {formatRentang(result.period.start, result.period.end)}.
    </div>
  )
}

