// Accounts that are used ONLY as the CityRoute admin account, never as an
// instructor. This is a routing restriction, not a permission: it only keeps
// these accounts OUT of instructor screens and sends them to /support-admin.
// Whether they may actually use the admin panel is still decided by
// is_support_admin() in the database (support_admins + active session). An
// admin-only email that is not in support_admins sees the access-denied state.

export const ADMIN_ONLY_ACCOUNT_EMAILS: readonly string[] = ['cityroute.ge@gmail.com']

export const ADMIN_HOME_PATH = '/support-admin'

export function isAdminOnlyAccount(user: { email?: string | null } | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase()
  return Boolean(email) && ADMIN_ONLY_ACCOUNT_EMAILS.includes(email as string)
}
