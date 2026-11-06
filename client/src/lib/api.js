const TOKEN_KEY = 'enventory_token'
const UNREACHABLE = 'Tidak dapat terhubung ke server. Pastikan backend sudah dijalankan (npm run dev di folder server).'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // localStorage tidak tersedia (mode privat), abaikan
  }
}

/**
 * Panggil API backend. Token login otomatis dikirim.
 * Melempar Error berisi pesan dari server kalau respon tidak sukses.
 */
export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken()
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(UNREACHABLE)
  }

  // 502/503/504 tanpa JSON = proxy Vite tidak bisa menghubungi backend
  const data = await res.json().catch(() => null)
  if (!data && res.status >= 502 && res.status <= 504) {
    throw new Error(UNREACHABLE)
  }
  if (!res.ok) {
    const error = new Error(data?.message || 'Terjadi kesalahan pada server')
    error.status = res.status
    throw error
  }
  return data
}
