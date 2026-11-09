import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import croppedIcon from '../assets/cropped-icon.png'
import { useAuth } from '../auth/authContext'
import Icon from '../components/Icon'
import { homeFor } from '../navigation'

// Akun demo dari `npm run seed:dev` di folder server. Hanya tampil saat development.
const DEMO_ACCOUNTS = [
  { label: 'Peminjam', email: 'peminjam@demo.test' },
  { label: 'Tendik', email: 'tendik@demo.test' },
  { label: 'Kadep', email: 'kadep@demo.test' },
]
const DEMO_PASSWORD = 'password123'

export default function LoginPage() {
  const { user, login, loginWithGoogle, changePassword } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // State untuk modal status Google OAuth
  const [pendingModal, setPendingModal] = useState({ open: false, email: '', name: '' })
  const [rejectedModal, setRejectedModal] = useState({ open: false, reason: '' })
  const [googleDevModal, setGoogleDevModal] = useState(false)
  const [simulatedEmail, setSimulatedEmail] = useState('mahasiswa.baru@student.unp.ac.id')
  const [simulatedName, setSimulatedName] = useState('Mahasiswa Peminjam Baru')

  // State untuk modal ganti password pertama kali
  const [changePasswordModal, setChangePasswordModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changePasswordError, setChangePasswordError] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  const googleBtnContainerRef = useRef(null)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
  const isGoogleConfigured = clientId && !clientId.includes('your-google-client-id')

  // Handle respons kredensial Google
  const handleGoogleCredentialResponse = useCallback(
    async (response) => {
      if (!response?.credential) return
      setError('')
      setIsLoading(true)

      try {
        const result = await loginWithGoogle(response.credential)
        if (result.success) {
          navigate(homeFor(result.user.role), { replace: true })
        } else if (result.pending) {
          setPendingModal({
            open: true,
            email: result.data?.user?.email || '',
            name: result.data?.user?.full_name || '',
          })
        }
      } catch (err) {
        if (err.message?.includes('menunggu persetujuan')) {
          setPendingModal({ open: true, email: '', name: '' })
        } else if (err.message?.includes('ditolak')) {
          setRejectedModal({ open: true, reason: err.message })
        } else {
          setError(err.message)
        }
      } finally {
        setIsLoading(false)
      }
    },
    [loginWithGoogle, navigate]
  )

  // Inisialisasi Google Identity Services (GIS) jika client ID sudah dikonfigurasi
  useEffect(() => {
    if (!isGoogleConfigured || typeof window === 'undefined') return

    const initializeGis = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleCredentialResponse,
          auto_select: false,
        })

        if (googleBtnContainerRef.current) {
          window.google.accounts.id.renderButton(googleBtnContainerRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: googleBtnContainerRef.current.offsetWidth || 350,
          })
        }
      }
    }

    if (window.google?.accounts?.id) {
      initializeGis()
    } else {
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval)
          initializeGis()
        }
      }, 300)
      return () => clearInterval(interval)
    }
  }, [clientId, isGoogleConfigured, handleGoogleCredentialResponse])

  if (user && !user.must_change_password) {
    return <Navigate to={homeFor(user.role)} replace />
  }

  const handleGoogleClick = () => {
    setError('')
    if (isGoogleConfigured && window.google?.accounts?.id) {
      // Buka popup pemilih akun Google
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // Jika prompt ditolak browser, trigger klik tombol render
          const renderedBtn = googleBtnContainerRef.current?.querySelector('div[role="button"]')
          if (renderedBtn) renderedBtn.click()
        }
      })
    } else {
      // Jika Google Client ID belum diset, buka modal bantuan konfigurasi & simulator dev
      setGoogleDevModal(true)
    }
  }

  // Simulasi Google OAuth untuk lingkungan development lokal
  const handleDevGoogleLogin = async (e) => {
    e.preventDefault()
    setGoogleDevModal(false)
    setIsLoading(true)
    setError('')

    try {
      const mockPayload = btoa(
        unescape(
          encodeURIComponent(
            JSON.stringify({
              sub: 'google_dev_sub_' + Math.abs(simulatedEmail.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)),
              email: simulatedEmail.trim().toLowerCase(),
              name: simulatedName.trim(),
              picture: 'https://lh3.googleusercontent.com/a/default-user',
            })
          )
        )
      )

      await handleGoogleCredentialResponse({ credential: `dev-mock:${mockPayload}` })
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const loggedIn = await login(email, password)
      if (loggedIn.must_change_password) {
        setChangePasswordModal(true)
      } else {
        navigate(homeFor(loggedIn.role), { replace: true })
      }
    } catch (err) {
      if (err.message?.includes('menunggu persetujuan')) {
        setPendingModal({ open: true, email, name: '' })
      } else if (err.message?.includes('ditolak')) {
        setRejectedModal({ open: true, reason: err.message })
      } else {
        setError(err.message)
      }
      setIsLoading(false)
    }
  }

  const handleChangePasswordSubmit = async (e) => {
    e.preventDefault()
    setChangePasswordError('')

    if (newPassword.length < 6) {
      setChangePasswordError('Kata sandi baru minimal 6 karakter')
      return
    }

    if (newPassword !== confirmPassword) {
      setChangePasswordError('Konfirmasi kata sandi tidak cocok')
      return
    }

    setIsChangingPassword(true)
    try {
      await changePassword(password, newPassword)
      setChangePasswordModal(false)
      navigate(homeFor(user.role), { replace: true })
    } catch (err) {
      setChangePasswordError(err.message)
    } finally {
      setIsChangingPassword(false)
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
            'Peminjam dapat mendaftar mandiri dengan akun Google',
            'Pendaftaran Google ditinjau oleh Tendik sebelum dapat mengakses sistem',
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
              Masuk menggunakan akun terdaftar atau lanjutkan menggunakan akun Google Anda.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-[10px] border border-danger/30 bg-red-50 px-[14px] py-[10px] text-[14px] leading-[20px] text-danger"
            >
              {error}
            </div>
          )}

          {/* Tombol Lanjutkan dengan Google */}
          <div className="flex flex-col gap-2 w-full">
            <button
              type="button"
              onClick={handleGoogleClick}
              disabled={isLoading}
              className="w-full h-[46px] bg-white hover:bg-neutral-50 active:bg-neutral-100 border border-border-subtle rounded-[10px] font-semibold text-[14px] text-dark flex items-center justify-center gap-3 transition-all duration-150 shadow-xs cursor-pointer disabled:opacity-75"
            >
              <GoogleIcon />
              <span>Lanjutkan dengan Google</span>
            </button>

            {/* Container tersembunyi untuk fallback render tombol GIS resmi jika diperlukan */}
            <div ref={googleBtnContainerRef} className="hidden" aria-hidden="true" />

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-border-subtle/50"></div>
              <span className="shrink mx-3 text-[13px] text-muted">atau masuk dengan email</span>
              <div className="flex-grow border-t border-border-subtle/50"></div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-[18px] w-full">
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

      {/* Modal: Pendaftaran Google Pending / Menunggu Persetujuan */}
      {pendingModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 sm:p-8 max-w-[460px] w-full shadow-xl flex flex-col items-center text-center gap-4">
            <div className="w-[56px] h-[56px] rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
              <Icon name="clock" size={28} />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[20px] font-bold text-dark">Pendaftaran Menunggu Persetujuan</h3>
              <p className="text-[14px] leading-[22px] text-muted">
                Pendaftaran akun Anda telah tercatat dan saat ini berstatus{' '}
                <strong className="text-amber-700">Menunggu Persetujuan (Pending)</strong> dari Tenaga Kependidikan (Tendik).
              </p>
              <div className="mt-2 p-3 bg-surface rounded-[10px] text-[13px] text-left text-muted border border-border-subtle/40">
                <p><strong>Ketentuan Akses:</strong></p>
                <p className="mt-1">
                  Akun peminjam yang didaftarkan melalui Google harus diverifikasi terlebih dahulu sebelum dapat mengakses katalog dan fitur peminjaman.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingModal({ open: false, email: '', name: '' })}
              className="w-full mt-2 h-[44px] bg-navy text-white font-semibold text-[14px] rounded-[10px] hover:bg-navy/90 transition cursor-pointer"
            >
              Mengerti
            </button>
          </div>
        </div>
      )}

      {/* Modal: Pendaftaran Google Rejected / Ditolak */}
      {rejectedModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 sm:p-8 max-w-[460px] w-full shadow-xl flex flex-col items-center text-center gap-4">
            <div className="w-[56px] h-[56px] rounded-full bg-red-50 text-danger flex items-center justify-center">
              <Icon name="x-circle" size={28} />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[20px] font-bold text-dark">Pendaftaran Ditolak</h3>
              <p className="text-[14px] leading-[22px] text-muted">
                Mohon maaf, pendaftaran akun Anda telah ditolak oleh administrator sehingga Anda tidak dapat mengakses aplikasi.
              </p>
              {rejectedModal.reason && (
                <div className="mt-2 p-3 bg-red-50/60 rounded-[10px] text-[13px] text-left text-danger border border-red-200">
                  <strong>Keterangan penolakan:</strong>
                  <p className="mt-1">{rejectedModal.reason.replace(/^Pendaftaran Anda ditolak:?\s*/i, '')}</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setRejectedModal({ open: false, reason: '' })}
              className="w-full mt-2 h-[44px] bg-navy text-white font-semibold text-[14px] rounded-[10px] hover:bg-navy/90 transition cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Modal: Bantuan Konfigurasi Google Cloud & Simulator Dev */}
      {googleDevModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 sm:p-8 max-w-[520px] w-full shadow-xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle/40">
              <div className="flex items-center gap-2">
                <GoogleIcon />
                <h3 className="text-[18px] font-bold text-dark">Integrasi Google OAuth</h3>
              </div>
              <button
                type="button"
                onClick={() => setGoogleDevModal(false)}
                className="text-muted hover:text-dark p-1 rounded-md"
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            <div className="text-[14px] leading-[22px] text-muted space-y-3">
              <p>
                Aplikasi saat ini berjalan di lingkungan <strong>localhost</strong>. Google OAuth 2.0 Client ID resmi dapat dikonfigurasikan di file <code className="bg-surface px-1.5 py-0.5 rounded text-navy font-semibold">client/.env</code> dan <code className="bg-surface px-1.5 py-0.5 rounded text-navy font-semibold">server/.env</code>.
              </p>

              <div className="p-3 bg-surface rounded-[10px] border border-border-subtle/50 text-[13px]">
                <p className="font-semibold text-dark">Langkah konfigurasi Google Cloud Console:</p>
                <ol className="list-decimal list-inside mt-1 space-y-1 text-muted">
                  <li>Buka <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-primary underline">Google Cloud Console</a>.</li>
                  <li>Buat OAuth 2.0 Client ID (Web Application).</li>
                  <li>Authorized JavaScript Origins: <code className="text-navy font-semibold">http://localhost:5173</code></li>
                  <li>Authorized redirect URIs: <code className="text-navy font-semibold">http://localhost:5173</code></li>
                  <li>Salin Client ID ke <code className="text-navy">VITE_GOOGLE_CLIENT_ID</code> di <code className="text-navy">client/.env</code> dan <code className="text-navy">server/.env</code>.</li>
                </ol>
              </div>

              {import.meta.env.DEV && (
                <div className="mt-4 pt-4 border-t border-border-subtle/40">
                  <p className="font-bold text-dark mb-2">Simulasi Pendaftaran Google (Pengujian Lokal)</p>
                  <p className="text-[13px] text-muted mb-3">
                    Anda dapat langsung menguji alur backend Google (Pendaftaran → Status Pending → Persetujuan Tendik) dengan simulator di bawah ini:
                  </p>
                  <form onSubmit={handleDevGoogleLogin} className="flex flex-col gap-3">
                    <div>
                      <label className="text-[12px] font-semibold text-dark block mb-1">Nama Mahasiswa</label>
                      <input
                        type="text"
                        value={simulatedName}
                        onChange={(e) => setSimulatedName(e.target.value)}
                        required
                        className="w-full h-[38px] px-3 bg-surface border border-border-subtle rounded-[8px] text-[13px]"
                      />
                    </div>
                    <div>
                      <label className="text-[12px] font-semibold text-dark block mb-1">Email Google</label>
                      <input
                        type="email"
                        value={simulatedEmail}
                        onChange={(e) => setSimulatedEmail(e.target.value)}
                        required
                        className="w-full h-[38px] px-3 bg-surface border border-border-subtle rounded-[8px] text-[13px]"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full h-[42px] bg-navy text-white rounded-[10px] text-[14px] font-semibold hover:bg-navy/90 transition cursor-pointer mt-1"
                    >
                      Lanjutkan Simulasi Google OAuth
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Wajib Ganti Password Pertama Kali */}
      {changePasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-[16px] p-6 sm:p-8 max-w-[440px] w-full shadow-xl flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-[20px] font-bold text-dark">Ganti Kata Sandi Awal</h3>
              <p className="text-[14px] text-muted">
                Untuk keamanan akun Anda, silakan buat kata sandi baru untuk menggantikan kata sandi sementara dari administrator.
              </p>
            </div>

            {changePasswordError && (
              <div className="rounded-[10px] border border-danger/30 bg-red-50 px-3 py-2 text-[13px] text-danger">
                {changePasswordError}
              </div>
            )}

            <form onSubmit={handleChangePasswordSubmit} className="flex flex-col gap-3">
              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">Kata Sandi Baru</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="w-full h-[42px] px-3 border border-border-subtle rounded-[10px] text-[14px] outline-none focus:border-navy"
                />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-dark block mb-1">Konfirmasi Kata Sandi Baru</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi kata sandi baru"
                  className="w-full h-[42px] px-3 border border-border-subtle rounded-[10px] text-[14px] outline-none focus:border-navy"
                />
              </div>

              <button
                type="submit"
                disabled={isChangingPassword}
                className="w-full mt-2 h-[44px] bg-navy text-white font-semibold text-[14px] rounded-[10px] hover:bg-navy/90 transition cursor-pointer disabled:opacity-75"
              >
                {isChangingPassword ? 'Menyimpan...' : 'Simpan Kata Sandi Baru'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
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
