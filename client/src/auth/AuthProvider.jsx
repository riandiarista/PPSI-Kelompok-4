import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken } from '../lib/api'
import { AuthContext } from './authContext'

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // Kalau ada token tersimpan, cek dulu ke server sebelum menampilkan halaman
  const [checking, setChecking] = useState(() => Boolean(getToken()))

  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    api('/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.data.user)
      })
      .catch(() => {
        if (!cancelled) setToken(null)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { email, password } })
    setToken(res.data.token)
    setUser(res.data.user)
    return res.data.user
  }, [])

  const loginWithGoogle = useCallback(async (credential) => {
    const res = await api('/auth/google', { method: 'POST', body: { credential } })
    if (res.data?.token) {
      setToken(res.data.token)
      setUser(res.data.user)
      return { success: true, user: res.data.user }
    }
    // Jika berstatus pending atau registrasi baru, return data tanpa setToken
    return {
      success: false,
      pending: res.data?.registration_status === 'pending',
      data: res.data,
      message: res.message,
    }
  }, [])

  const changePassword = useCallback(async (oldPassword, newPassword) => {
    const res = await api('/auth/change-password', {
      method: 'POST',
      body: { old_password: oldPassword, new_password: newPassword },
    })
    // Perbarui state must_change_password
    setUser((prev) => (prev ? { ...prev, must_change_password: false } : prev))
    return res
  }, [])

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      // Tetap logout di sisi browser walaupun server tidak merespon
    }
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, checking, login, loginWithGoogle, changePassword, logout }),
    [user, checking, login, loginWithGoogle, changePassword, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
