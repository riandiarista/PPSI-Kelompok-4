import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ROLE_LABEL, useAuth } from '../auth/authContext'
import { MENUS } from '../navigation'
import Icon from './Icon'

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = MENUS[user.role] || []

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-surface lg:flex">
      {/* Bar atas khusus layar kecil */}
      <header className="flex items-center justify-between bg-navy px-4 py-3 lg:hidden">
        <Brand role={user.role} />
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="Buka menu"
          className="rounded-[8px] p-2 text-white hover:bg-white/10"
        >
          <Icon name="menu" />
        </button>
      </header>

      <aside
        className={`${menuOpen ? 'flex' : 'hidden'} flex-col justify-between bg-navy px-4 pb-6 pt-4 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[230px] lg:shrink-0 lg:pt-7`}
      >
        <div className="flex flex-col gap-6">
          <div className="hidden px-2 lg:block">
            <Brand role={user.role} />
          </div>
          <nav className="flex flex-col gap-1">
            {menu.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-[10px] px-3 py-[10px] text-[14px] font-medium transition ${
                    isActive ? 'bg-primary text-white' : 'text-white/85 hover:bg-white/10'
                  }`
                }
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="mt-6 flex flex-col gap-3 px-2">
          <div className="text-[12px] leading-[16px] text-mint">
            Masuk sebagai
            <div className="truncate text-[13px] font-semibold text-white">{user.full_name}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="self-start text-[14px] font-medium text-white/85 hover:text-white"
          >
            Keluar
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
        <Outlet />
      </main>
    </div>
  )
}

function Brand({ role }) {
  return (
    <div>
      <div className="text-[15px] font-extrabold leading-[19px] text-white">Inventaris</div>
      <div className="text-[12px] leading-[16px] text-mint">{ROLE_LABEL[role]}</div>
    </div>
  )
}
