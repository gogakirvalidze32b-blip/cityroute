/** Tiny localStorage helpers so that text is never lost when the network
 *  drops or the tab reloads. Every access is wrapped: storage can be
 *  unavailable (private mode) or full, and the chat must still work.
 *
 *  Only TEXT-only messages are persisted. Images are held in memory for the
 *  retry button but are not written to storage (blobs are large). */

export interface StoredOutboxEntry {
  clientId: string
  conversationId: string
  body: string
  createdAt: string
}

const outboxKey = (userId: string) => `cityroute-support-outbox-${userId}`
const draftKey = (userId: string) => `cityroute-support-draft-${userId}`

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function loadOutbox(userId: string): StoredOutboxEntry[] {
  const raw = read(outboxKey(userId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is StoredOutboxEntry =>
        e &&
        typeof e.clientId === 'string' &&
        typeof e.conversationId === 'string' &&
        typeof e.body === 'string' &&
        typeof e.createdAt === 'string',
    )
  } catch {
    return []
  }
}

function saveOutbox(userId: string, entries: StoredOutboxEntry[]) {
  write(outboxKey(userId), entries.length ? JSON.stringify(entries) : null)
}

export function addToOutbox(userId: string, entry: StoredOutboxEntry) {
  const rest = loadOutbox(userId).filter((e) => e.clientId !== entry.clientId)
  saveOutbox(userId, [...rest, entry])
}

export function removeFromOutbox(userId: string, clientId: string) {
  saveOutbox(
    userId,
    loadOutbox(userId).filter((e) => e.clientId !== clientId),
  )
}

export function loadDraft(userId: string): string {
  return read(draftKey(userId)) ?? ''
}

export function saveDraft(userId: string, text: string) {
  write(draftKey(userId), text.length ? text : null)
}
