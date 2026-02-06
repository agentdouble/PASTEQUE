import { Outlet } from 'react-router-dom'
import { Button } from '@/components/ui'
import { clearAuth, getAuth } from '@/services/auth'
import { useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useCallback } from 'react'
import clsx from 'clsx'
import { HiChevronDoubleLeft, HiChevronDoubleRight } from 'react-icons/hi2'

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [auth, setAuth] = useState(() => getAuth())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const canViewGraph = Boolean(auth?.isAdmin || auth?.canViewGraph)
  const isChatRoute = location.pathname === '/chat'

  useEffect(() => {
    const currentAuth = getAuth()
    setAuth(currentAuth)
  }, [])

  useEffect(() => {
    if (!isChatRoute) return
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    const previousBodyOverscroll = document.body.style.overscrollBehavior
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
      document.body.style.overscrollBehavior = previousBodyOverscroll
    }
  }, [isChatRoute])

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

  const historyOpen = isChatRoute && new URLSearchParams(location.search).get('history') === '1'
  const navItems: Array<{ key: string; label: string; shortLabel: string; onClick: () => void; active: boolean }> = [
    {
      key: 'new_chat',
      label: 'Nouveau chat',
      shortLabel: 'N',
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
  const sidebarWidthPx = sidebarCollapsed ? 76 : 248

  if (!auth) {
    navigate('/login')
    return null
  }

  return (
    <div
      className={clsx(
        'bg-gradient-to-br from-primary-50 to-white',
        isChatRoute ? 'h-[100dvh] overflow-hidden' : 'min-h-screen'
      )}
    >
      <aside
        className="fixed left-0 top-0 z-50 h-[100dvh] border-r border-primary-800 bg-gradient-to-b from-primary-900 via-primary-800 to-primary-900 transition-[width] duration-200"
        style={{ width: sidebarWidthPx }}
      >
        <div className={clsx('flex h-full flex-col', sidebarCollapsed ? 'gap-3 p-3' : 'gap-2 px-2.5 py-2')}>
          <div className={clsx('flex items-center', sidebarCollapsed ? 'justify-center' : 'justify-between gap-2')}>
            {!sidebarCollapsed && (
              <div className="min-w-0 flex items-center gap-2">
                <img
                  src={`${import.meta.env.BASE_URL}insight.svg`}
                  alt="Logo FoyerInsight"
                  className="h-7 w-7 shrink-0 brightness-0 invert"
                />
                <div className="min-w-0">
                  <h1 className="truncate text-base font-bold tracking-tight text-white">FoyerInsight</h1>
                  <p className="truncate text-xs text-primary-200">De la donnée à l'action</p>
                </div>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSidebarCollapsed(prev => !prev)}
              className="h-7 w-7 shrink-0 !rounded-full !p-0 !border !border-primary-500/40 !bg-primary-800/70 !text-primary-100 hover:!bg-primary-700 hover:!text-white"
              aria-label={sidebarCollapsed ? 'Déplier le bandeau' : 'Replier le bandeau'}
              title={sidebarCollapsed ? 'Déplier' : 'Replier'}
            >
              {sidebarCollapsed ? (
                <HiChevronDoubleRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <HiChevronDoubleLeft className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
          <nav className="flex-1 overflow-y-auto" aria-label="Navigation principale">
            <div className="flex flex-col gap-1">
              {navItems.map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className={clsx(
                    'w-full rounded-xl no-focus-ring transition-colors duration-200',
                    sidebarCollapsed ? 'h-10 px-0 text-center' : 'px-2 py-1 text-left',
                    item.active
                      ? 'bg-white/15 text-white font-semibold'
                      : 'text-primary-200 hover:text-white hover:bg-white/10'
                  )}
                  aria-current={item.active ? 'page' : undefined}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  {sidebarCollapsed ? item.shortLabel : item.label}
                </button>
              ))}
            </div>
          </nav>
          <div className={clsx('border-t border-primary-700/70', sidebarCollapsed ? 'pt-1' : 'pt-0.5')}>
            <Button
              variant="ghost"
              onClick={handleLogout}
              size="sm"
              className={clsx(
                '!rounded-xl w-full !border !border-primary-500/45 !bg-primary-800/65 !text-primary-100 hover:!bg-primary-700 hover:!text-white',
                sidebarCollapsed ? 'justify-center !px-0' : 'justify-start !py-1'
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
          'box-border px-3 md:px-4 transition-[margin-left] duration-200',
          isChatRoute ? 'h-[100dvh] min-h-0 overflow-hidden pt-3 pb-0' : 'py-4'
        )}
        style={{ marginLeft: sidebarWidthPx }}
      >
        <div className={clsx('mx-auto max-w-screen-2xl', isChatRoute && 'h-full min-h-0')}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
