import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export function PlanGate() {
  const { hasAccess, needsPlanSelection, loading } = useAuth()

  if (loading) {
    return (
      <div className="page center">
        <p className="muted">იტვირთება...</p>
      </div>
    )
  }

  if (!hasAccess || needsPlanSelection) return <Navigate to="/choose-plan" replace />
  return <Outlet />
}
