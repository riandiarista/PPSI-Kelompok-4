import { useCallback, useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { api } from '../lib/api'

// Format tanggal "2026-11-20" -> "20 Nov 2026"
function formatTanggal(dateStr) {
  if (!dateStr) return '-'
  try {
    const raw = String(dateStr).slice(0, 10)
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${raw}T12:00:00Z`))
  } catch {
    return dateStr
  }
}

function formatPoin(n) {
  return n > 0 ? `+${n}` : String(n)
}

const LEVEL_LABELS = {
  teladan: 'Teladan',
  terpercaya: 'Terpercaya',
  pemula: 'Pemula',
  beginner: 'Belum Pemula',
}

const TABS = [
  { key: 'aturan', label: 'Aturan poin & level', icon: 'shield' },
  { key: 'periode', label: 'Periode & pemenang', icon: 'calendar' },
  { key: 'reward', label: 'Jenis reward', icon: 'award' },
]

const inputCls =
  'w-full rounded-[10px] border border-neutral-300 px-3 py-2 text-[13px] text-[#14231F] placeholder-neutral-400 focus:border-[#1E3F70] focus:outline-none focus:ring-2 focus:ring-[#1E3F70]/15'
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-[8px] bg-[#1E3F70] px-3 py-1.5 text-[12.5px] font-medium text-white shadow-xs transition hover:bg-[#162e55] disabled:opacity-60'
const btnSecondary =
  'inline-flex items-center gap-1.5 rounded-[8px] border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#14231F] shadow-xs transition hover:bg-neutral-50 disabled:opacity-60'

export default function AturanPoinRewardPage() {
  const [tab, setTab] = useState('aturan')
  const [rules, setRules] = useState(null)
  const [rewards, setRewards] = useState([])
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const [refreshKey, setRefreshKey] = useState(0)

  // Muat ulang semua data (dipanggil setelah simpan / tombol Segarkan)
  const loadAll = useCallback(() => {
    setLoading(true)
    setError('')
    setRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([api('/points/admin/rules'), api('/points/admin/rewards'), api('/points/rewards')])
      .then(([r1, r2, r3]) => {
        if (cancelled) return
        setRules(r1.data)
        setRewards(r2.data)
        setPeriods(r3.data)
      })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey])

  return (
    <div className="space-y-6 font-sans">
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-[12px] px-4 py-3 text-[13.5px] font-medium text-white shadow-lg ${
            toast.type === 'success' ? 'bg-[#14532D]' : 'bg-[#B91C1C]'
          }`}
        >
          <Icon name={toast.type === 'success' ? 'check' : 'alert-circle'} size={18} />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#14231F]">Aturan Poin &amp; Reward</h1>
          <p className="mt-1 text-[13px] text-[#4A5B56]">
            Lihat aturan perhitungan poin, kelola periode apresiasi, dan tetapkan peminjam penerima reward.
          </p>
        </div>
        <button type="button" onClick={loadAll} className={`${btnSecondary} self-start`}>
          <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
          Segarkan
        </button>
      </div>

      {/* Tab */}
      <div className="flex flex-wrap gap-2 border-b border-neutral-200/80">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition ${
              tab === t.key
                ? 'border-[#1E3F70] text-[#1E3F70]'
                : 'border-transparent text-[#4A5B56] hover:text-[#14231F]'
            }`}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {loading && !rules ? (
        <div className="flex flex-col items-center justify-center py-16 text-[#4A5B56]">
          <Icon name="refresh" size={28} className="animate-spin text-[#1E3F70]" />
          <p className="mt-3 text-[13.5px] font-medium">Memuat data...</p>
        </div>
      ) : error ? (
        <div className="rounded-[12px] bg-red-50 p-4 text-center text-[13px] text-red-600">{error}</div>
      ) : tab === 'aturan' ? (
        <AturanTab rules={rules} onChanged={loadAll} showToast={showToast} />
      ) : tab === 'periode' ? (
        <PeriodeTab periods={periods} rewards={rewards} onChanged={loadAll} showToast={showToast} />
      ) : (
        <RewardTab rewards={rewards} onChanged={loadAll} showToast={showToast} />
      )}
    </div>
  )
}

// ─── Tab: Aturan poin & level ───────────────────────────────────────────────

// Draft form dari data server: semua nilai disimpan sebagai string agar input bebas diketik
function toDraft(rules) {
  return {
    point_rules: Object.fromEntries(rules.point_rules.map((r) => [r.key, String(r.points)])),
    levels: Object.fromEntries(rules.levels.filter((l) => l.key !== 'beginner').map((l) => [l.key, String(l.min)])),
  }
}

function toInt(v) {
  return /^-?\d+$/.test(String(v).trim()) ? Number(v) : NaN
}

// Validasi sisi klien (server tetap memvalidasi ulang)
function validateDraft(draft, rules) {
  const errors = {}
  for (const r of rules.point_rules) {
    const n = toInt(draft.point_rules[r.key])
    if (Number.isNaN(n)) errors[r.key] = 'Harus bilangan bulat'
    else if (n < r.min || n > r.max) errors[r.key] = `Antara ${r.min} dan ${r.max}`
  }
  const p = toInt(draft.levels.pemula)
  const tp = toInt(draft.levels.terpercaya)
  const tl = toInt(draft.levels.teladan)
  for (const [k, n] of [['pemula', p], ['terpercaya', tp], ['teladan', tl]]) {
    if (Number.isNaN(n) || n < 1) errors[k] = 'Bilangan bulat ≥ 1'
  }
  if (!errors.pemula && !errors.terpercaya && !errors.teladan && !(p < tp && tp < tl)) {
    errors.levels = 'Batas harus berurutan: Pemula < Terpercaya < Teladan'
  }
  return errors
}

function AturanTab({ rules, onChanged, showToast }) {
  const [draft, setDraft] = useState(null) // null = mode lihat
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!rules) return null
  const editing = draft !== null
  const errors = editing ? validateDraft(draft, rules) : {}
  const hasErrors = Object.keys(errors).length > 0

  // Nilai yang ditampilkan: draft saat mengedit, data server saat melihat
  const pointOf = (key) => (editing ? toInt(draft.point_rules[key]) : rules.point_rules.find((r) => r.key === key)?.points)
  const levelMins = rules.levels.map((l) =>
    l.key === 'beginner' ? 0 : editing ? toInt(draft.levels[l.key]) : l.min
  )

  // Daftar perubahan untuk dialog konfirmasi
  const changes = editing
    ? [
        ...rules.point_rules
          .filter((r) => toInt(draft.point_rules[r.key]) !== r.points)
          .map((r) => ({ label: r.label, from: `${formatPoin(r.points)} poin`, to: `${formatPoin(toInt(draft.point_rules[r.key]))} poin` })),
        ...rules.levels
          .filter((l) => l.key !== 'beginner' && toInt(draft.levels[l.key]) !== l.min)
          .map((l) => ({ label: `Batas level ${l.label}`, from: `${l.min} poin`, to: `${toInt(draft.levels[l.key])} poin` })),
      ]
    : []
  const levelChanged = changes.some((c) => c.label.startsWith('Batas level'))

  async function save() {
    setSaving(true)
    try {
      const body = {
        point_rules: Object.fromEntries(Object.entries(draft.point_rules).map(([k, v]) => [k, toInt(v)])),
        levels: Object.fromEntries(Object.entries(draft.levels).map(([k, v]) => [k, toInt(v)])),
      }
      const res = await api('/points/admin/rules', { method: 'PUT', body })
      const n = res.data.users_level_changed
      showToast(n > 0 ? `Aturan disimpan. Level ${n} peminjam ikut berubah.` : 'Aturan poin disimpan')
      setConfirming(false)
      setDraft(null)
      onChanged()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const late = pointOf('LATE_PER_DAY')

  return (
    <div className="space-y-6">
      {/* Bilah aksi */}
      <div className="flex flex-col gap-3 rounded-[14px] border border-neutral-200/80 bg-white px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12.5px] text-[#4A5B56]">
          {editing
            ? 'Ubah nilai lalu simpan. Perubahan berlaku untuk pengembalian berikutnya; poin yang sudah tercatat tidak dihitung ulang.'
            : rules.updated_at
              ? `Terakhir diubah ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(rules.updated_at))} WIB`
              : 'Aturan ini dipakai otomatis saat Tendik mengonfirmasi pengembalian.'}
        </p>
        <div className="flex shrink-0 gap-2">
          {editing ? (
            <>
              <button type="button" className={btnSecondary} onClick={() => setDraft(null)}>Batal</button>
              <button
                type="button"
                className={btnPrimary}
                disabled={hasErrors || changes.length === 0}
                onClick={() => setConfirming(true)}
              >
                <Icon name="check" size={14} />
                Simpan perubahan
              </button>
            </>
          ) : (
            <button type="button" className={btnPrimary} onClick={() => setDraft(toDraft(rules))}>
              <Icon name="edit" size={14} />
              Ubah aturan
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Poin pengembalian */}
        <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
          <h2 className="text-[14px] font-semibold text-[#14231F]">Perhitungan poin pengembalian</h2>
          <p className="mt-1 text-[12.5px] text-[#4A5B56]">
            Poin dihitung otomatis saat Tendik mengonfirmasi pengembalian barang.
          </p>
          <ul className="mt-4 divide-y divide-neutral-100">
            {rules.point_rules.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
                <span className="text-[#14231F]">{r.label}</span>
                {editing ? (
                  <div className="flex shrink-0 flex-col items-end">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="1"
                        min={r.min}
                        max={r.max}
                        aria-label={r.label}
                        value={draft.point_rules[r.key]}
                        onChange={(e) => setDraft({ ...draft, point_rules: { ...draft.point_rules, [r.key]: e.target.value } })}
                        className={`w-20 rounded-[8px] border px-2 py-1 text-right text-[13px] focus:outline-none focus:ring-2 ${
                          errors[r.key] ? 'border-red-400 focus:ring-red-200' : 'border-neutral-300 focus:border-[#1E3F70] focus:ring-[#1E3F70]/15'
                        }`}
                      />
                      <span className="text-[12px] text-[#4A5B56]">poin{r.per_day ? ' / hari' : ''}</span>
                    </div>
                    {errors[r.key] && <span className="mt-0.5 text-[11px] text-red-600">{errors[r.key]}</span>}
                  </div>
                ) : (
                  <span className={`shrink-0 font-semibold ${r.points >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {formatPoin(r.points)} poin{r.per_day ? ' / hari' : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-[10px] bg-neutral-50 p-3 text-[12px] text-[#4A5B56]">
            Contoh: barang kembali terlambat 2 hari dalam kondisi baik →{' '}
            <strong>{Number.isNaN(late) ? '-' : formatPoin(2 * late)} poin</strong>. Saldo poin tidak pernah kurang dari 0.
          </div>
        </div>

        {/* Level */}
        <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
          <h2 className="text-[14px] font-semibold text-[#14231F]">Level kedisiplinan</h2>
          <p className="mt-1 text-[12.5px] text-[#4A5B56]">
            Level ditentukan dari saldo poin peminjam{editing ? '. Isi batas bawah tiap level.' : '.'}
          </p>
          <ul className="mt-4 space-y-2.5">
            {rules.levels.map((lvl, idx) => {
              const min = levelMins[idx]
              const upper = idx > 0 ? levelMins[idx - 1] - 1 : null
              const rangeText = Number.isNaN(min) || Number.isNaN(upper)
                ? '-'
                : upper === null ? `≥ ${min} poin` : `${min} – ${upper} poin`
              return (
                <li
                  key={lvl.key}
                  className="flex items-center justify-between gap-4 rounded-[12px] border border-neutral-200/80 px-3.5 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[20px]" aria-hidden>{lvl.badge}</span>
                    <span className="text-[13.5px] font-semibold" style={{ color: lvl.color }}>{lvl.label}</span>
                  </div>
                  {editing && lvl.key !== 'beginner' ? (
                    <div className="flex shrink-0 flex-col items-end">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] text-[#4A5B56]">mulai</span>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          aria-label={`Batas level ${lvl.label}`}
                          value={draft.levels[lvl.key]}
                          onChange={(e) => setDraft({ ...draft, levels: { ...draft.levels, [lvl.key]: e.target.value } })}
                          className={`w-20 rounded-[8px] border px-2 py-1 text-right text-[13px] focus:outline-none focus:ring-2 ${
                            errors[lvl.key] || errors.levels ? 'border-red-400 focus:ring-red-200' : 'border-neutral-300 focus:border-[#1E3F70] focus:ring-[#1E3F70]/15'
                          }`}
                        />
                        <span className="text-[12px] text-[#4A5B56]">poin</span>
                      </div>
                      <span className={`mt-0.5 text-[11px] ${errors[lvl.key] ? 'text-red-600' : 'text-[#71827D]'}`}>
                        {errors[lvl.key] || rangeText}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[12.5px] font-medium text-[#4A5B56]">{rangeText}</span>
                  )}
                </li>
              )
            })}
          </ul>
          {errors.levels && <p className="mt-2 text-[12px] text-red-600">{errors.levels}</p>}
        </div>
      </div>

      <div className="rounded-[12px] border border-blue-200 bg-blue-50 p-3.5 text-[12.5px] text-blue-800">
        <Icon name="alert-circle" size={14} className="mr-1 inline" />
        Reward bersifat apresiasi — memberikan reward <strong>tidak mengurangi</strong> saldo poin peminjam.
      </div>

      {confirming && (
        <Modal title="Simpan perubahan aturan?" onClose={() => setConfirming(false)}>
          <div className="space-y-4">
            <ul className="divide-y divide-neutral-100 rounded-[10px] border border-neutral-200/80 text-[13px]">
              {changes.map((c) => (
                <li key={c.label} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-[#14231F]">{c.label}</span>
                  <span className="shrink-0 text-[12.5px]">
                    <span className="text-[#71827D] line-through">{c.from}</span>
                    <span className="mx-1.5 text-[#71827D]">→</span>
                    <strong className="text-[#14231F]">{c.to}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] text-[#4A5B56]">
              Berlaku untuk pengembalian berikutnya. Poin yang sudah tercatat tidak dihitung ulang.
              {levelChanged && ' Level semua peminjam akan langsung disesuaikan dengan batas baru.'}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => setConfirming(false)}>Batal</button>
              <button type="button" className={btnPrimary} disabled={saving} onClick={save}>
                {saving ? 'Menyimpan...' : 'Ya, simpan'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Tab: Jenis reward ──────────────────────────────────────────────────────

function RewardTab({ rewards, onChanged, showToast }) {
  const [form, setForm] = useState(null) // { reward_id?, reward_name, description }
  const [saving, setSaving] = useState(false)

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = { reward_name: form.reward_name, description: form.description }
      if (form.reward_id) {
        await api(`/points/admin/rewards/${form.reward_id}`, { method: 'PUT', body })
        showToast('Reward diperbarui')
      } else {
        await api('/points/admin/rewards', { method: 'POST', body })
        showToast('Reward ditambahkan')
      }
      setForm(null)
      onChanged()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove(r) {
    if (!window.confirm(`Hapus reward "${r.reward_name}"?`)) return
    try {
      await api(`/points/admin/rewards/${r.reward_id}`, { method: 'DELETE' })
      showToast('Reward dihapus')
      onChanged()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  return (
    <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/80 pb-4">
        <h2 className="text-[14px] font-semibold text-[#14231F]">Jenis reward ({rewards.length})</h2>
        <button type="button" className={btnPrimary} onClick={() => setForm({ reward_name: '', description: '' })}>
          <Icon name="plus" size={14} />
          Tambah reward
        </button>
      </div>

      {rewards.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-[#4A5B56]">Belum ada jenis reward.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rewards.map((r) => (
            <li key={r.reward_id} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[13.5px] font-semibold text-[#14231F]">{r.reward_name}</p>
                {r.description && <p className="mt-0.5 text-[12.5px] text-[#4A5B56]">{r.description}</p>}
                <p className="mt-1 text-[11.5px] text-[#71827D]">Sudah diberikan {r.award_count} kali</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => setForm({ reward_id: r.reward_id, reward_name: r.reward_name, description: r.description || '' })}
                >
                  <Icon name="edit" size={14} />
                  Ubah
                </button>
                <button
                  type="button"
                  className={`${btnSecondary} text-red-600`}
                  disabled={r.award_count > 0}
                  title={r.award_count > 0 ? 'Reward yang sudah diberikan tidak dapat dihapus' : undefined}
                  onClick={() => remove(r)}
                >
                  <Icon name="trash" size={14} />
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <Modal title={form.reward_id ? 'Ubah reward' : 'Tambah reward'} onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-4">
            <Field label="Nama reward">
              <input
                className={inputCls}
                value={form.reward_name}
                maxLength={150}
                required
                onChange={(e) => setForm({ ...form, reward_name: e.target.value })}
              />
            </Field>
            <Field label="Deskripsi">
              <textarea
                className={inputCls}
                rows={3}
                maxLength={1000}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <ModalActions onCancel={() => setForm(null)} saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  )
}

// ─── Tab: Periode & pemenang ────────────────────────────────────────────────

function PeriodeTab({ periods, rewards, onChanged, showToast }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState(periods[0]?.period_id ?? null)

  // Jika periode terpilih tidak ada (mis. data baru dimuat), pakai periode teratas
  const selected = periods.find((p) => p.period_id === selectedId) || periods[0] || null

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        period_name: form.period_name,
        started_at: form.started_at,
        ended_at: form.ended_at,
        is_active: form.is_active,
      }
      if (form.period_id) {
        await api(`/points/admin/periods/${form.period_id}`, { method: 'PUT', body })
        showToast('Periode diperbarui')
      } else {
        const res = await api('/points/admin/periods', { method: 'POST', body })
        setSelectedId(res.data.period_id)
        showToast('Periode dibuat')
      }
      setForm(null)
      onChanged()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Daftar periode */}
      <div className="rounded-[16px] border border-neutral-200/80 bg-white p-4 shadow-xs">
        <div className="flex items-center justify-between gap-2 pb-3">
          <h2 className="text-[14px] font-semibold text-[#14231F]">Periode</h2>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => setForm({ period_name: '', started_at: '', ended_at: '', is_active: true })}
          >
            <Icon name="plus" size={14} />
            Baru
          </button>
        </div>
        {periods.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-[#4A5B56]">Belum ada periode reward.</p>
        ) : (
          <ul className="space-y-1.5">
            {periods.map((p) => (
              <li key={p.period_id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.period_id)}
                  className={`w-full rounded-[10px] border px-3 py-2.5 text-left transition ${
                    p.period_id === selected?.period_id
                      ? 'border-[#1E3F70] bg-blue-50/60'
                      : 'border-neutral-200/80 hover:bg-neutral-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-[#14231F]">{p.period_name}</span>
                    {p.is_active ? (
                      <span className="shrink-0 rounded-[6px] bg-emerald-100 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-800">Aktif</span>
                    ) : (
                      <span className="shrink-0 rounded-[6px] bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-medium text-neutral-600">Selesai</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#71827D]">
                    {formatTanggal(p.started_at)} – {formatTanggal(p.ended_at)} · {p.awards.length} pemenang
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detail periode */}
      {selected ? (
        <PeriodDetail
          key={`${selected.period_id}-${selected.started_at}-${selected.ended_at}`}
          period={selected}
          rewards={rewards}
          onEdit={() =>
            setForm({
              period_id: selected.period_id,
              period_name: selected.period_name,
              started_at: selected.started_at.slice(0, 10),
              ended_at: selected.ended_at.slice(0, 10),
              is_active: selected.is_active,
            })
          }
          onChanged={onChanged}
          showToast={showToast}
        />
      ) : (
        <div className="flex items-center justify-center rounded-[16px] border border-dashed border-neutral-300 bg-white p-10 text-[13px] text-[#4A5B56]">
          Buat periode untuk mulai menetapkan pemenang reward.
        </div>
      )}

      {form && (
        <Modal title={form.period_id ? 'Ubah periode' : 'Periode baru'} onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-4">
            <Field label="Nama periode">
              <input
                className={inputCls}
                placeholder="mis. Semester Ganjil 2026/2027"
                value={form.period_name}
                maxLength={150}
                required
                onChange={(e) => setForm({ ...form, period_name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tanggal mulai">
                <input
                  type="date"
                  className={inputCls}
                  value={form.started_at}
                  required
                  onChange={(e) => setForm({ ...form, started_at: e.target.value })}
                />
              </Field>
              <Field label="Tanggal selesai">
                <input
                  type="date"
                  className={inputCls}
                  value={form.ended_at}
                  min={form.started_at || undefined}
                  required
                  onChange={(e) => setForm({ ...form, ended_at: e.target.value })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-[#14231F]">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Periode aktif
            </label>
            <ModalActions onCancel={() => setForm(null)} saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  )
}

function PeriodDetail({ period, rewards, onEdit, onChanged, showToast }) {
  const [board, setBoard] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [award, setAward] = useState(null) // { user_id, full_name, reward_id, note }
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api(`/points/admin/periods/${period.period_id}/leaderboard?limit=20`)
      .then((res) => { if (!cancelled) setBoard(res.data.leaderboard) })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [period.period_id])

  async function submitAward(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await api(`/points/admin/periods/${period.period_id}/awards`, {
        method: 'POST',
        body: { user_id: award.user_id, reward_id: Number(award.reward_id), note: award.note || undefined },
      })
      showToast(`Reward diberikan kepada ${award.full_name}`)
      setAward(null)
      onChanged()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function revoke(aw) {
    if (!window.confirm(`Cabut reward "${aw.reward_name}" dari ${aw.winner_name}?`)) return
    try {
      await api(`/points/admin/awards/${aw.award_id}`, { method: 'DELETE' })
      showToast('Penghargaan dicabut')
      onChanged()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Ringkasan periode + pemenang */}
      <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200/80 pb-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[#14231F]">{period.period_name}</h2>
            <p className="mt-0.5 text-[12.5px] text-[#4A5B56]">
              {formatTanggal(period.started_at)} – {formatTanggal(period.ended_at)}
            </p>
          </div>
          <button type="button" className={btnSecondary} onClick={onEdit}>
            <Icon name="edit" size={14} />
            Ubah periode
          </button>
        </div>

        <h3 className="mt-4 text-[13px] font-semibold text-[#14231F]">Pemenang ({period.awards.length})</h3>
        {period.awards.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-[#4A5B56]">
            Belum ada pemenang. Pilih peminjam dari papan peringkat di bawah.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {period.awards.map((aw) => (
              <li key={aw.award_id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <Icon name="award" size={15} />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-[#14231F]">{aw.winner_name}</p>
                    <p className="text-[12px] text-[#4A5B56]">{aw.reward_name}</p>
                    {aw.note && <p className="mt-0.5 text-[11.5px] italic text-[#71827D]">“{aw.note}”</p>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(aw)}
                  className="shrink-0 text-[12px] font-medium text-red-600 hover:underline"
                >
                  Cabut
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Papan peringkat */}
      <div className="rounded-[16px] border border-neutral-200/80 bg-white p-5 shadow-xs">
        <h3 className="text-[14px] font-semibold text-[#14231F]">Papan peringkat periode</h3>
        <p className="mt-0.5 text-[12.5px] text-[#4A5B56]">
          Total poin yang diperoleh peminjam selama rentang periode ini.
        </p>

        {loading ? (
          <div className="flex justify-center py-10">
            <Icon name="refresh" size={24} className="animate-spin text-[#1E3F70]" />
          </div>
        ) : error ? (
          <div className="mt-4 rounded-[12px] bg-red-50 p-3 text-center text-[13px] text-red-600">{error}</div>
        ) : board.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-[#4A5B56]">
            Belum ada aktivitas poin peminjam pada rentang tanggal ini.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/70 text-[12px] font-semibold text-[#4A5B56]">
                  <th className="px-3 py-2.5">#</th>
                  <th className="px-3 py-2.5">Peminjam</th>
                  <th className="px-3 py-2.5">Poin periode</th>
                  <th className="px-3 py-2.5">Saldo &amp; level</th>
                  <th className="px-3 py-2.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {board.map((row) => (
                  <tr key={row.user_id} className="hover:bg-neutral-50/60">
                    <td className="px-3 py-3 font-semibold text-[#14231F]">
                      {row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : row.rank}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-[#14231F]">{row.full_name}</div>
                      <div className="text-[12px] text-[#71827D]">{row.email}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className={`font-semibold ${row.period_points >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {formatPoin(row.period_points)}
                      </div>
                      <div className="text-[11.5px] text-[#71827D]">
                        {row.positive_count} positif · {row.negative_count} penalti
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-[#14231F]">{row.current_points} poin</div>
                      <div className="text-[11.5px] text-[#71827D]">
                        {LEVEL_LABELS[row.discipline_level] || row.discipline_level}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        className={btnPrimary}
                        disabled={rewards.length === 0}
                        onClick={() =>
                          setAward({
                            user_id: row.user_id,
                            full_name: row.full_name,
                            reward_id: String(rewards[0]?.reward_id ?? ''),
                            note: '',
                          })
                        }
                      >
                        <Icon name="award" size={14} />
                        Beri reward
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {award && (
        <Modal title="Beri reward" onClose={() => setAward(null)}>
          <form onSubmit={submitAward} className="space-y-4">
            <div className="rounded-[10px] bg-neutral-50 p-3 text-[13px]">
              <span className="text-[#71827D]">Penerima: </span>
              <span className="font-semibold text-[#14231F]">{award.full_name}</span>
              <span className="text-[#71827D]"> · {period.period_name}</span>
            </div>
            <Field label="Jenis reward">
              <select
                className={inputCls}
                value={award.reward_id}
                required
                onChange={(e) => setAward({ ...award, reward_id: e.target.value })}
              >
                {rewards.map((r) => (
                  <option key={r.reward_id} value={r.reward_id}>{r.reward_name}</option>
                ))}
              </select>
            </Field>
            <Field label="Catatan (opsional)">
              <textarea
                className={inputCls}
                rows={2}
                maxLength={500}
                value={award.note}
                onChange={(e) => setAward({ ...award, note: e.target.value })}
              />
            </Field>
            <ModalActions onCancel={() => setAward(null)} saving={saving} submitLabel="Berikan" />
          </form>
        </Modal>
      )}
    </div>
  )
}

// ─── Komponen kecil ─────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[16px] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-200/80 px-5 py-3.5">
          <h3 className="text-[15px] font-bold text-[#14231F]">{title}</h3>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#14231F]">{label}</span>
      {children}
    </label>
  )
}

function ModalActions({ onCancel, saving, submitLabel = 'Simpan' }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" className={btnSecondary} onClick={onCancel}>Batal</button>
      <button type="submit" className={btnPrimary} disabled={saving}>
        {saving ? 'Menyimpan...' : submitLabel}
      </button>
    </div>
  )
}
