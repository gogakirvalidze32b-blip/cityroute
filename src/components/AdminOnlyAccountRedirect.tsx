import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { ADMIN_HOME_PATH, isAdminOnlyAccount } from '@/lib/admin-account'

/**
 * Keeps the admin-only account (cityroute.ge@gmail.com) out of instructor
 * screens by sending it to /support-admin. Every other account renders
 * `children` exactly as before. Grants nothing: /support-admin still checks
 * is_support_admin() in the database.
 */
export function AdminOnlyAccountRedirect({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (isAdminOnlyAccount(user)) return <Navigate to={ADMIN_HOME_PATH} replace />
  return <>{children}</>
}
