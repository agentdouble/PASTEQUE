import { Outlet } from 'react-router-dom'
import { Button } from '@/components/ui'
import { clearAuth, getAuth } from '@/services/auth'
import { useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useCallback } from 'react'
import clsx from 'clsx'

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [auth, setAuth] = useState(() => getAuth())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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
  const navItems: Array<{ key: string; label: string; shortLabel: string; onClick: () => void; active: boolean }> = [
    {
      key: 'chat',
      label: 'Chat',
      shortLabel: 'C',
      onClick: () => navigate('/chat?new=1', { replace: true }),
      active: isChatRoute && !historyOpen,
    },
    {
      key: 'explorer',
      label: 'Explorer',
      shortLabel: 'E',
      onClick: goTo('/ia'),
      active: location.pathname === '/ia',
    },
    {
      key: 'radar',
      label: 'Radar',
      shortLabel: 'R',
      onClick: goTo('/radar'),
      active: location.pathname === '/radar',
    },
  ]
  if (canViewGraph) {
    navItems.push({
      key: 'graph',
      label: 'Graph',
      shortLabel: 'G',
      onClick: goTo('/dashboard'),
      active: location.pathname === '/dashboard',
    })
  }
  navItems.push({
    key: 'history',
    label: 'Historique',
    shortLabel: 'H',
    onClick: () => navigate('/chat?history=1', { replace: true }),
    active: isChatRoute && historyOpen,
  })
  if (auth?.isAdmin) {
    navItems.push({
      key: 'admin',
      label: 'Admin',
      shortLabel: 'A',
      onClick: goTo('/admin'),
      active: location.pathname === '/admin',
    })
  }
  const sidebarWidthPx = sidebarCollapsed ? 84 : 272

  if (!auth) {
    navigate('/login')
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-white">
      <aside
        className="fixed left-0 top-0 z-50 h-screen border-r-2 border-primary-100 bg-white/90 backdrop-blur-sm transition-[width] duration-200"
        style={{ width: sidebarWidthPx }}
      >
        <div className="flex h-full flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <img
                src={`${import.meta.env.BASE_URL}insight.svg`}
                alt="Logo FoyerInsight"
                className="h-8 w-8 shrink-0"
              />
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-bold text-primary-950 tracking-tight">FoyerInsight</h1>
                  <p className="truncate text-xs text-primary-600">De la donnée à l'action</p>
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSidebarCollapsed(prev => !prev)}
              className="!rounded-lg !p-0 h-8 w-8 shrink-0 border border-primary-200 bg-white/70 hover:bg-white"
              aria-label={sidebarCollapsed ? 'Déplier le bandeau' : 'Replier le bandeau'}
              title={sidebarCollapsed ? 'Déplier' : 'Replier'}
            >
              {sidebarCollapsed ? '>>' : '<<'}
            </Button>
          </div>
          <nav className="flex-1 overflow-y-auto" aria-label="Navigation principale">
            <div className="flex flex-col gap-1 rounded-2xl border border-primary-200 bg-white/90 p-1">
              {navItems.map(item => (
                <Button
                  key={item.key}
                  type="button"
                  variant={item.active ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={item.onClick}
                  className={clsx(
                    '!rounded-xl w-full whitespace-nowrap',
                    sidebarCollapsed ? 'justify-center !px-0' : 'justify-start',
                    item.active
                      ? 'shadow-sm'
                      : 'text-primary-700 hover:text-primary-900 hover:bg-primary-100'
                  )}
                  aria-current={item.active ? 'page' : undefined}
                  title={item.label}
                >
                  {sidebarCollapsed ? item.shortLabel : item.label}
                </Button>
              ))}
            </div>
          </nav>
          <div className="pt-1 border-t border-primary-100">
            <Button
              variant="ghost"
              onClick={handleLogout}
              size="sm"
              className={clsx(
                '!rounded-xl w-full border border-primary-200 bg-white/70 hover:bg-white',
                sidebarCollapsed ? 'justify-center !px-0' : 'justify-start'
              )}
              title="Déconnexion"
            >
              {sidebarCollapsed ? 'Out' : 'Déconnexion'}
            </Button>
          </div>
        </div>
      </aside>

      <main
        className={clsx(
          'px-3 md:px-4 transition-[margin-left] duration-200',
          isChatRoute ? 'h-screen overflow-hidden pt-3 pb-0' : 'py-4'
        )}
        style={{ marginLeft: sidebarWidthPx }}
      >
        <div className={clsx('mx-auto max-w-screen-2xl', isChatRoute && 'h-full')}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
