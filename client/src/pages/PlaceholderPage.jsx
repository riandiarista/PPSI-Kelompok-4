// Halaman sementara untuk menu yang belum dikerjakan.
export default function PlaceholderPage({ title }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[26px] font-extrabold leading-[32px] tracking-[-0.01em] text-dark sm:text-[30px] sm:leading-[38px]">
        {title}
      </h1>
      <div className="rounded-[14px] border border-dashed border-border-subtle bg-white px-6 py-14 text-center">
        <p className="text-[16px] font-bold text-dark">Sedang dalam pengembangan</p>
        <p className="mt-1 text-[14px] text-muted">Fitur ini akan segera tersedia.</p>
      </div>
    </div>
  )
}
