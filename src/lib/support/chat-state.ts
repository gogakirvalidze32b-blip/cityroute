import type {
  ChatAttachment,
  ChatItem,
  SupportAttachmentRow,
  SupportMessageRow,
  SupportSenderType,
} from './types'

/** Pure helpers that keep the message list consistent. Everything that can
 *  arrive twice (RPC response, Realtime echo, polling, history paging) is
 *  merged here by server id OR client id, so a message never shows up twice. */

function time(iso: string): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

function compareConfirmed(a: ChatItem, b: ChatItem): number {
  const d = time(a.createdAt) - time(b.createdAt)
  if (d !== 0) return d
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return (a.id ?? a.key) < (b.id ?? b.key) ? -1 : 1
}

/** Confirmed messages in server order, then not-yet-confirmed ones in the
 *  order the user created them (so "sending…" bubbles stay at the bottom). */
export function sortItems(items: ChatItem[]): ChatItem[] {
  const confirmed: ChatItem[] = []
  const pending: ChatItem[] = []
  for (const it of items) (it.delivery === 'sent' ? confirmed : pending).push(it)
  confirmed.sort(compareConfirmed)
  return [...confirmed, ...pending]
}

export function attachmentFromRow(row: SupportAttachmentRow): ChatAttachment {
  return {
    key: row.id,
    path: row.storage_path,
    mime: row.mime_type,
    size: row.size_bytes,
    previewUrl: null,
  }
}

export function itemFromServer(
  msg: SupportMessageRow,
  atts: SupportAttachmentRow[] | undefined,
): ChatItem {
  return {
    key: msg.client_id ?? msg.id,
    id: msg.id,
    clientId: msg.client_id,
    senderType: msg.sender_type,
    body: msg.body,
    createdAt: msg.created_at,
    readAt: msg.read_at,
    attachments: (atts ?? []).map(attachmentFromRow),
    delivery: 'sent',
    error: null,
    progress: null,
  }
}

export function makePendingItem(args: {
  clientId: string
  senderType: SupportSenderType
  body: string
  createdAt: string
  attachments: ChatAttachment[]
}): ChatItem {
  return {
    key: args.clientId,
    id: null,
    clientId: args.clientId,
    senderType: args.senderType,
    body: args.body,
    createdAt: args.createdAt,
    readAt: null,
    attachments: args.attachments,
    delivery: 'sending',
    error: null,
    progress: args.attachments.length > 0 ? 0 : null,
  }
}

/** Insert or update a message that the SERVER has confirmed.
 *  `atts === undefined` means "attachments unknown" (e.g. a read-receipt
 *  UPDATE event): keep what we already have. */
export function applyServerMessage(
  items: ChatItem[],
  msg: SupportMessageRow,
  atts?: SupportAttachmentRow[],
): ChatItem[] {
  const idx = items.findIndex(
    (i) => (i.id !== null && i.id === msg.id) || (msg.client_id !== null && i.clientId === msg.client_id),
  )

  if (idx === -1) {
    return sortItems([...items, itemFromServer(msg, atts)])
  }

  const existing = items[idx]
  const next = itemFromServer(msg, atts)

  if (atts === undefined) {
    next.attachments = existing.attachments
  } else {
    // Keep the local blob preview of the same picture so the image does not
    // flash while the signed URL for the stored copy is being created.
    next.attachments = next.attachments.map((a, n) => ({
      ...a,
      previewUrl: existing.attachments[n]?.previewUrl ?? null,
    }))
  }
  // Keep the stable React key so the bubble is not re-mounted.
  next.key = existing.key

  const copy = items.slice()
  copy[idx] = next
  return sortItems(copy)
}

export function applyServerMessages(
  items: ChatItem[],
  msgs: SupportMessageRow[],
  attsByMessage: Record<string, SupportAttachmentRow[]>,
): ChatItem[] {
  let out = items
  for (const m of msgs) out = applyServerMessage(out, m, attsByMessage[m.id] ?? [])
  return out
}

function patch(items: ChatItem[], clientId: string, fn: (i: ChatItem) => ChatItem): ChatItem[] {
  return items.map((i) => (i.clientId === clientId ? fn(i) : i))
}

/** Only an item that is still unconfirmed can fail — if the server (or the
 *  Realtime echo) already confirmed it, a late network error must not flip a
 *  delivered message back to "failed". */
export function markFailed(items: ChatItem[], clientId: string, error: string): ChatItem[] {
  return patch(items, clientId, (i) =>
    i.delivery === 'sent' ? i : { ...i, delivery: 'failed', error, progress: null },
  )
}

export function markSending(items: ChatItem[], clientId: string): ChatItem[] {
  return patch(items, clientId, (i) =>
    i.delivery === 'sent' ? i : { ...i, delivery: 'sending', error: null },
  )
}

export function setProgress(items: ChatItem[], clientId: string, progress: number): ChatItem[] {
  return patch(items, clientId, (i) => (i.delivery === 'sent' ? i : { ...i, progress }))
}

export function removeByClientId(items: ChatItem[], clientId: string): ChatItem[] {
  return items.filter((i) => i.clientId !== clientId || i.delivery === 'sent')
}

/** Stamp read_at locally on messages written by `from` so that the same
 *  messages are not marked read over and over. */
export function markReadLocally(
  items: ChatItem[],
  from: SupportSenderType,
  readAt: string,
): ChatItem[] {
  return items.map((i) =>
    i.delivery === 'sent' && i.senderType === from && i.readAt === null ? { ...i, readAt } : i,
  )
}

export function hasUnreadFrom(items: ChatItem[], from: SupportSenderType): boolean {
  return items.some((i) => i.delivery === 'sent' && i.senderType === from && i.readAt === null)
}

export function oldestConfirmedAt(items: ChatItem[]): string | null {
  for (const i of items) if (i.delivery === 'sent') return i.createdAt
  return null
}

/** Storage paths that still need a signed URL. */
export function pathsNeedingUrls(items: ChatItem[], known: Map<string, string>): string[] {
  const want = new Set<string>()
  for (const i of items) {
    for (const a of i.attachments) {
      if (a.path && !known.has(a.path)) want.add(a.path)
    }
  }
  return [...want]
}
