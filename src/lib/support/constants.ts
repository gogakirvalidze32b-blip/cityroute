/** Shared limits for the support chat. The same numbers are enforced by the
 *  database (009/010 migrations); the client checks exist for fast feedback. */
export const SUPPORT_EMAIL = 'support@cityroute.ge'
export const SUPPORT_BUCKET = 'support-attachments'

export const MAX_BODY_LENGTH = 4000
export const MAX_ATTACHMENTS = 5
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

export const EXT_BY_MIME: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Page size for message history (newest first on first load, then older). */
export const MESSAGE_PAGE_SIZE = 50
/** Signed URLs live one hour; the UI refreshes them before they expire. */
export const SIGNED_URL_TTL_SECONDS = 3600
/** Safety-net polling in case the Realtime socket silently drops (mobile). */
export const POLL_INTERVAL_MS = 20_000
export const ADMIN_LIST_POLL_INTERVAL_MS = 15_000
export const UNREAD_POLL_INTERVAL_MS = 60_000
