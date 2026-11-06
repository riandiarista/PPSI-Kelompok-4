import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import croppedIcon from '../assets/cropped-icon.png'
import { useAuth } from '../auth/authContext'
import { homeFor } from '../navigation'

// Akun demo dari `npm run seed:dev` di folder server. Hanya tampil saat development.
const DEMO_ACCOUNTS = [
  { label: 'Peminjam', email: 'peminjam@demo.test' },
  { label: 'Tendik', email: 'tendik@demo.test' },
  { label: 'Kadep', email: 'kadep@demo.test' },
]
const DEMO_PASSWORD = 'password123'

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  if (user) return <Navigate to={homeFor(user.role)} replace />

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const loggedIn = await login(email, password)
      navigate(homeFor(loggedIn.role), { replace: true })
    } catch (err) {
      setError(err.message)
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-surface font-sans selection:bg-gold selection:text-navy">
      {/* Panel Merek (Kiri) */}
      <aside className="w-full lg:w-[592px] lg:min-w-[592px] bg-navy flex flex-col justify-between p-8 sm:p-12 lg:px-[56px] lg:pt-[55px] lg:pb-[56px] min-h-[560px] lg:min-h-screen">
        {/* Merek */}
        <div className="flex flex-row items-center gap-[14px]">
          <div className="w-[44px] h-[44px] bg-gold rounded-[10px] flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
            <img src={croppedIcon} alt="Logo UNP" className="w-[38px] h-[38px] object-contain" />
          </div>
          <div className="flex flex-col items-start justify-center">
            <h2 className="font-bold text-[15px] leading-[19px] text-white">Departemen Bahasa Inggris</h2>
            <p className="font-medium text-[15px] leading-[19px] text-mint">Universitas Negeri Padang</p>
          </div>
        </div>

        {/* Pesan Utama */}
        <div className="my-10 lg:my-0 flex flex-col items-start gap-[24px] max-w-[480px]">
          <h1 className="font-extrabold text-[32px] sm:text-[38px] lg:text-[44px] leading-[40px] sm:leading-[44px] lg:leading-[50px] text-white tracking-[-0.02em]">
            Pinjam inventaris tanpa surat dan tanpa antre buku catatan.
          </h1>
          <p className="font-normal text-[15px] sm:text-[17px] leading-[24px] sm:leading-[27px] text-mint">
            Lihat ketersediaan barang, ajukan peminjaman, dan pantau statusnya dalam satu sistem.
            Kembalikan tepat waktu, kumpulkan poin.
          </p>
        </div>

        {/* Poin Informasi */}
        <div className="flex flex-col items-start gap-[14px] max-w-[401px]">
          {[
            'Pengajuan akhir pekan masuk antrean hari kerja berikutnya',
            'Pengingat jatuh tempo dikirim lewat email',
            'Semua waktu mengikuti zona WIB',
          ].map((text) => (
            <div key={text} className="flex flex-row items-center gap-[12px]">
              <span className="w-[8px] h-[8px] bg-gold rounded-full shrink-0" />
              <span className="font-normal text-[14px] leading-[18px] text-mint">{text}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* Panel Form (Kanan) */}
      <main className="flex-1 bg-surface flex flex-col justify-center items-center p-6 sm:p-12 lg:p-[56px] min-h-[500px]">
        <div className="w-full max-w-[400px] flex flex-col gap-[28px]">
          <div className="flex flex-col items-start gap-[8px]">
            <h2 className="font-extrabold text-[28px] leading-[35px] text-dark tracking-[-0.01em]">Masuk</h2>
            <p className="font-normal text-[15px] leading-[22px] text-muted">
              Gunakan akun yang didaftarkan Tenaga Kependidikan. Menu yang tampil menyesuaikan peran
              Anda.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-[18px] w-full">
            {error && (
              <div
                role="alert"
                className="rounded-[10px] border border-danger/30 bg-red-50 px-[14px] py-[10px] text-[14px] leading-[20px] text-danger"
              >
                {error}
              </div>
            )}

            <div className="flex flex-col items-start gap-[6px] w-full">
              <label htmlFor="email" className="font-semibold text-[14px] leading-[18px] text-dark">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                className="w-full h-[44px] bg-white border border-border-subtle rounded-[10px] px-[14px] font-normal text-[14px] leading-[18px] text-dark placeholder:text-muted outline-none focus:border-navy focus:ring-1 focus:ring-navy transition-all duration-150 box-border"
              />
            </div>

            <div className="flex flex-col items-start gap-[6px] w-full">
              <label htmlFor="password" className="font-semibold text-[14px] leading-[18px] text-dark">
                Kata sandi
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Kata sandi"
                className="w-full h-[44px] bg-white border border-border-subtle rounded-[10px] px-[14px] font-normal text-[14px] leading-[18px] text-dark placeholder:text-muted outline-none focus:border-navy focus:ring-1 focus:ring-navy transition-all duration-150 box-border"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-[48px] bg-navy hover:bg-navy/90 active:bg-navy/95 text-white rounded-[10px] font-bold text-[15px] leading-[19px] flex items-center justify-center transition-all duration-150 cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed shadow-sm"
            >
              {isLoading ? 'Memproses...' : 'Masuk'}
            </button>
          </form>

          {import.meta.env.DEV && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-border-subtle p-[14px]">
              <p className="text-[12px] leading-[16px] text-muted">
                Akun demo (hanya mode development) · kata sandi <b>{DEMO_PASSWORD}</b>
              </p>
              <div className="flex flex-wrap gap-2">
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => {
                      setEmail(acc.email)
                      setPassword(DEMO_PASSWORD)
                    }}
                    className="rounded-full border border-border-subtle bg-white px-3 py-1 text-[13px] font-semibold text-dark hover:border-navy"
                  >
                    {acc.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
