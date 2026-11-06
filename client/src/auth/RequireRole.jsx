import { Navigate, Outlet } from 'react-router-dom'
import { homeFor } from '../navigation'
import { useAuth } from './authContext'

// Membatasi halaman untuk role tertentu. Belum login -> ke /login,
// role lain -> ke halaman utama role-nya sendiri.
export default function RequireRole({ role }) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />
  return <Outlet />
}
