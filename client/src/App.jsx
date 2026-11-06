import { useState } from 'react'
import croppedIcon from './assets/cropped-icon.png'

export default function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    setIsLoading(true)
    console.log('Login attempt:', { email, password })
    setTimeout(() => {
      setIsLoading(false)
    }, 600)
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-surface font-sans selection:bg-gold selection:text-navy">
      {/* Panel Merek (Kiri) - 100% Tailwind CSS */}
      <aside className="w-full lg:w-[592px] lg:min-w-[592px] bg-navy flex flex-col justify-between p-8 sm:p-12 lg:px-[56px] lg:pt-[55px] lg:pb-[56px] min-h-[560px] lg:min-h-screen">
        {/* Merek */}
        <div className="flex flex-row items-center gap-[14px]">
          {/* Logo Box */}
          <div className="w-[44px] h-[44px] bg-gold rounded-[10px] flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
            <img
              src={croppedIcon}
              alt="Logo UNP"
              className="w-[38px] h-[38px] object-contain"
            />
          </div>

          {/* Teks Merek */}
          <div className="flex flex-col items-start justify-center">
            <h2 className="font-bold text-[15px] leading-[19px] text-white">
              Departemen Bahasa Inggris
            </h2>
            <p className="font-medium text-[15px] leading-[19px] text-mint">
              Universitas Negeri Padang
            </p>
          </div>
        </div>

        {/* Pesan Utama */}
        <div className="my-10 lg:my-0 flex flex-col items-start gap-[24px] max-w-[480px]">
          <h1 className="font-extrabold text-[32px] sm:text-[38px] lg:text-[44px] leading-[40px] sm:leading-[44px] lg:leading-[50px] text-white tracking-[-0.02em]">
            Pinjam inventaris tanpa surat dan tanpa antre buku catatan.
          </h1>
          <p className="font-normal text-[15px] sm:text-[17px] leading-[24px] sm:leading-[27px] text-mint">
            Lihat ketersediaan barang, ajukan peminjaman, dan pantau statusnya
            dalam satu sistem. Kembalikan tepat waktu, kumpulkan poin.
          </p>
        </div>

        {/* Poin Informasi */}
        <div className="flex flex-col items-start gap-[14px] max-w-[401px]">
          <div className="flex flex-row items-center gap-[12px]">
            <span className="w-[8px] h-[8px] bg-gold rounded-full shrink-0" />
            <span className="font-normal text-[14px] leading-[18px] text-mint">
              Pengajuan akhir pekan masuk antrean hari kerja berikutnya
            </span>
          </div>

          <div className="flex flex-row items-center gap-[12px]">
            <span className="w-[8px] h-[8px] bg-gold rounded-full shrink-0" />
            <span className="font-normal text-[14px] leading-[18px] text-mint">
              Pengingat jatuh tempo dikirim lewat email
            </span>
          </div>

          <div className="flex flex-row items-center gap-[12px]">
            <span className="w-[8px] h-[8px] bg-gold rounded-full shrink-0" />
            <span className="font-normal text-[14px] leading-[18px] text-mint">
              Semua waktu mengikuti zona WIB
            </span>
          </div>
        </div>
      </aside>

      {/* Panel Form (Kanan) - 100% Tailwind CSS */}
      <main className="flex-1 bg-surface flex flex-col justify-center items-center p-6 sm:p-12 lg:p-[56px] min-h-[500px]">
        <div className="w-full max-w-[400px] flex flex-col gap-[28px]">
          {/* Judul Form */}
          <div className="flex flex-col items-start gap-[8px]">
            <h2 className="font-extrabold text-[28px] leading-[35px] text-dark tracking-[-0.01em]">
              Masuk
            </h2>
            <p className="font-normal text-[15px] leading-[22px] text-muted">
              Gunakan akun yang didaftarkan Tenaga Kependidikan. Menu yang tampil
              menyesuaikan peran Anda.
            </p>
          </div>

          {/* Form Isian */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-[18px] w-full">
            {/* Field / Email */}
            <div className="flex flex-col items-start gap-[6px] w-full">
              <label
                htmlFor="email"
                className="font-semibold text-[14px] leading-[18px] text-dark"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                className="w-full h-[44px] bg-white border border-border-subtle rounded-[10px] px-[14px] font-normal text-[14px] leading-[18px] text-dark placeholder:text-muted outline-none focus:border-navy focus:ring-1 focus:ring-navy transition-all duration-150 box-border"
              />
            </div>

            {/* Field / Kata Sandi */}
            <div className="flex flex-col items-start gap-[6px] w-full">
              <label
                htmlFor="password"
                className="font-semibold text-[14px] leading-[18px] text-dark"
              >
                Kata sandi
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Kata sandi"
                className="w-full h-[44px] bg-white border border-border-subtle rounded-[10px] px-[14px] font-normal text-[14px] leading-[18px] text-dark placeholder:text-muted outline-none focus:border-navy focus:ring-1 focus:ring-navy transition-all duration-150 box-border"
              />
            </div>

            {/* Button / Masuk */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-[48px] bg-navy hover:bg-navy/90 active:bg-navy/95 text-white rounded-[10px] font-bold text-[15px] leading-[19px] flex items-center justify-center transition-all duration-150 cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed shadow-sm"
            >
              {isLoading ? 'Memproses...' : 'Masuk'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
