import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import ProtectedRoute from '@/components/ProtectedRoute'
import Login from '@/features/auth/Login'
import Chat from '@/features/chat/Chat'
import Dashboard from '@/features/dashboard/Dashboard'
import AdminPanel from '@/features/admin/AdminPanel'
import Loop from '@/features/loop/Loop'
import IaView from '@/features/ai/IaView'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<Chat />} />
          <Route path="ia" element={<IaView />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="radar" element={<Loop />} />
          <Route
            path="admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminPanel />
              </ProtectedRoute>
            }
          />
          <Route
            path="feedback"
            element={
              <ProtectedRoute requireAdmin>
                <Navigate to="/admin?tab=feedback" replace />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
