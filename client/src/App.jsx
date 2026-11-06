import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-800 rounded-2xl shadow-xl p-8 border border-slate-700 text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500/10 text-indigo-400 rounded-xl mb-2">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>

        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Enventory
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Tailwind CSS berhasil dikonfigurasi dengan Vite & React!
          </p>
        </div>

        <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
          <p className="text-xs font-mono text-emerald-400 mb-2">✓ Tailwind CSS v4 Active</p>
          <button
            onClick={() => setCount((c) => c + 1)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-sm rounded-lg shadow transition cursor-pointer"
          >
            Tombol Test (Klik: {count})
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Mulai kembangkan aplikasi di <code className="text-slate-300 bg-slate-700/50 px-1 py-0.5 rounded">src/App.jsx</code>
        </p>
      </div>
    </div>
  )
}

export default App
