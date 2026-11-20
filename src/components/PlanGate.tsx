import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export function PlanGate() {
  const { hasAccess, needsPlanSelection, loading } = useAuth()
  const { pathname } = useLocation()
  // Keep an in-flight exam mounted across auth/access blips so collapse/expand
  // never flashes the Trial (/choose-plan) page or remounts the route shell.
  const onExamRoute = pathname.startsWith('/route/')

  if (loading && !onExamRoute) {
    return (
      <div className="page center">
        <p className="muted">იტვირთება...</p>
      </div>
    )
  }

  if ((!hasAccess || needsPlanSelection) && !onExamRoute) {
    return <Navigate to="/choose-plan" replace />
  }
  return <Outlet />
}
