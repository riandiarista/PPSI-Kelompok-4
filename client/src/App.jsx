import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AuthProvider from './auth/AuthProvider'
import RequireRole from './auth/RequireRole'
import { useAuth } from './auth/authContext'
import AppLayout from './components/AppLayout'
import { homeFor, MENUS } from './navigation'
import LoginPage from './pages/LoginPage'
import PlaceholderPage from './pages/PlaceholderPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

function AppRoutes() {
  const { user, checking } = useAuth()

  // Menunggu cek sesi ke server supaya tidak "berkedip" ke halaman login
  if (checking) {
    return <div className="flex min-h-screen items-center justify-center text-[14px] text-muted">Memuat...</div>
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {Object.entries(MENUS).map(([role, menu]) => (
        <Route key={role} element={<RequireRole role={role} />}>
          <Route element={<AppLayout />}>
            {menu.map((item) => (
              <Route key={item.path} path={item.path} element={<PlaceholderPage title={item.label} />} />
            ))}
          </Route>
        </Route>
      ))}

      <Route path="*" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
    </Routes>
  )
}
