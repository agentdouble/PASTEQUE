import { Outlet } from 'react-router-dom'
import { Button } from '@/components/ui'
import { clearAuth, getAuth } from '@/services/auth'
import { useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
// Navigation secondaire supprimée: boutons déplacés dans le header
import { useCallback } from 'react'
import clsx from 'clsx'

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [auth, setAuth] = useState(() => getAuth())
  const canViewGraph = Boolean(auth?.isAdmin || auth?.canViewGraph)

  useEffect(() => {
    const currentAuth = getAuth()
    setAuth(currentAuth)
  }, [])

  const handleLogout = () => {
    clearAuth()
    setAuth(null)
    navigate('/login')
  }

  const goTo = useCallback(
    (path: string) => () => {
      navigate(path)
    },
    [navigate]
  )

  const isChatRoute = location.pathname === '/chat'
  const historyOpen = isChatRoute && new URLSearchParams(location.search).get('history') === '1'
  const navItems: Array<{ key: string; label: string; onClick: () => void; active: boolean }> = [
    {
      key: 'chat',
      label: 'Chat',
      onClick: () => navigate('/chat?new=1', { replace: true }),
      active: isChatRoute && !historyOpen,
    },
    {
      key: 'explorer',
      label: 'Explorer',
      onClick: goTo('/ia'),
      active: location.pathname === '/ia',
    },
    {
      key: 'radar',
      label: 'Radar',
      onClick: goTo('/radar'),
      active: location.pathname === '/radar',
    },
  ]
  if (canViewGraph) {
    navItems.push({
      key: 'graph',
      label: 'Graph',
      onClick: goTo('/dashboard'),
      active: location.pathname === '/dashboard',
    })
  }
  navItems.push({
    key: 'history',
    label: 'Historique',
    onClick: () => navigate('/chat?history=1', { replace: true }),
    active: isChatRoute && historyOpen,
  })
  if (auth?.isAdmin) {
    navItems.push({
      key: 'admin',
      label: 'Admin',
      onClick: goTo('/admin'),
      active: location.pathname === '/admin',
    })
  }

  if (!auth) {
    navigate('/login')
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-white">
      <header className="border-b-2 border-primary-100 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-screen-2xl px-3 md:px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-3">
              <img
                src={`${import.meta.env.BASE_URL}insight.svg`}
                alt="Logo FoyerInsight"
                className="h-8 w-8"
              />
              <h1 className="text-xl md:text-2xl font-bold text-primary-950 tracking-tight truncate">
                FoyerInsight
              </h1>
              <div className="hidden md:block h-6 w-px bg-primary-200" />
              <p className="hidden md:block text-sm text-primary-600">De la donnée à l'action</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" onClick={handleLogout} size="sm" className="!rounded-xl border border-primary-200 bg-white/70 hover:bg-white">
                Déconnexion
              </Button>
            </div>
          </div>
          <nav className="overflow-x-auto scrollbar-none" aria-label="Navigation principale">
            <div className="inline-flex min-w-full md:min-w-0 items-center gap-1 rounded-2xl border border-primary-200 bg-white/90 p-1">
              {navItems.map(item => (
                <Button
                  key={item.key}
                  type="button"
                  variant={item.active ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={item.onClick}
                  className={clsx(
                    '!rounded-xl whitespace-nowrap',
                    item.active
                      ? 'shadow-sm'
                      : 'text-primary-700 hover:text-primary-900 hover:bg-primary-100'
                  )}
                  aria-current={item.active ? 'page' : undefined}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl px-3 md:px-4 py-4">
        <Outlet />
      </main>
    </div>
  )
}
