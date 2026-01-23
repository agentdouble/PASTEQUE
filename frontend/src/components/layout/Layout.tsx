import { Outlet } from 'react-router-dom'
import { Button } from '@/components/ui'
import { clearAuth, getAuth } from '@/services/auth'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
// Navigation secondaire supprimée: boutons déplacés dans le header
import { useCallback } from 'react'

export default function Layout() {
  const navigate = useNavigate()
  const [auth, setAuth] = useState(() => getAuth())

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

  if (!auth) {
    navigate('/login')
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-white">
      <header className="border-b-2 border-primary-100 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-screen-2xl px-3 md:px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={`${import.meta.env.BASE_URL}insight.svg`}
                alt="Logo FoyerInsight"
                className="h-8 w-8"
              />
              <h1 className="text-2xl font-bold text-primary-950 tracking-tight">
                FoyerInsight
              </h1>
              <div className="h-6 w-px bg-primary-200" />
              <p className="text-sm text-primary-600">De la donnée à l'action</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate('/chat?new=1', { replace: true })} className="!rounded-full">
                Chat
              </Button>
              <Button variant="secondary" size="sm" onClick={goTo('/ia')} className="!rounded-full">
                Explorer
              </Button>
              <Button variant="secondary" size="sm" onClick={goTo('/radar')} className="!rounded-full">
                Radar
              </Button>
              <Button variant="secondary" size="sm" onClick={goTo('/dashboard')} className="!rounded-full">
                Graph
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/chat?history=1', { replace: true })}
                className="!rounded-full"
              >
                Historique
              </Button>
              {auth.isAdmin && (
                <Button variant="secondary" size="sm" onClick={goTo('/admin')} className="!rounded-full">
                  Admin
                </Button>
              )}
              <Button variant="ghost" onClick={handleLogout} size="sm">
                Se déconnecter
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl px-3 md:px-4 py-4">
        <Outlet />
      </main>
    </div>
  )
}
