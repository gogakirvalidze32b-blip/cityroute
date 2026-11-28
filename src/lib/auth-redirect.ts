// Post-login destination ("next") handling. Only a strict allowlist of
// same-origin paths is accepted, so a crafted ?next= can never send a user to
// another site (open redirect) or to an arbitrary page. Today the only allowed
// destination is the support admin page, used by the support-notify e-mail
// link `${SITE_URL}/support-admin?c=<conversation_id>`.
// This only decides WHERE to go after login; access to /support-admin is still
// decided by is_support_admin() in the database.

const BASE = 'https://cityroute.invalid'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const SUPPORT_ADMIN_PATH = '/support-admin'

/** Returns a safe, normalized path (with only known query params) or null. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return null
  }
  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE || url.pathname !== SUPPORT_ADMIN_PATH) return null

  const params = new URLSearchParams()
  const conversationId = url.searchParams.get('c')
  if (conversationId && UUID_RE.test(conversationId)) params.set('c', conversationId)
  if (url.searchParams.get('tab') === 'schools') params.set('tab', 'schools')
  const query = params.toString()
  return query ? `${url.pathname}?${query}` : url.pathname
}

/** Login URL that returns to `destination` (if it is allowed) after sign-in. */
export function loginPathWithNext(destination: string | null | undefined): string {
  const next = safeNextPath(destination)
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login'
}
