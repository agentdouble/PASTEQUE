import { Navigate } from 'react-router-dom'
import { getAuth } from '@/services/auth'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireAdmin?: boolean
}

export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const auth = getAuth()

  if (!auth) {
    return <Navigate to="/login" replace />
  }

  if (requireAdmin && !auth.isAdmin) {
    return <Navigate to="/chat" replace />
  }

  return <>{children}</>
}
