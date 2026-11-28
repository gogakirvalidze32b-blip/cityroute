import { Navigate, Outlet } from 'react-router-dom'
import { AdminOnlyAccountRedirect } from '@/components/AdminOnlyAccountRedirect'
import { useAuth } from '@/context/AuthContext'

export function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="page center">
        <p className="muted">იტვირთება...</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  // Instructor routes (plan, driving school, home, exam routes): the admin-only
  // account goes to /support-admin instead; everyone else is unchanged.
  return (
    <AdminOnlyAccountRedirect>
      <Outlet />
    </AdminOnlyAccountRedirect>
  )
}
