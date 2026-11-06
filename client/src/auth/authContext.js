import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

// Nama role harus sama dengan server/src/constants/roles.js
export const ROLES = {
  PEMINJAM: 'Peminjam',
  TENDIK: 'Tendik',
  KADEP: 'Kadep',
}

export const ROLE_LABEL = {
  [ROLES.PEMINJAM]: 'Peminjam',
  [ROLES.TENDIK]: 'Tenaga Kependidikan',
  [ROLES.KADEP]: 'Ketua Departemen',
}
