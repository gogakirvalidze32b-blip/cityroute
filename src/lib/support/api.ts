import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import {
  MESSAGE_PAGE_SIZE,
  SIGNED_URL_TTL_SECONDS,
  SUPPORT_BUCKET,
} from './constants'
import { S } from './strings'
import { UploadError } from './upload'
import { uuid } from './uuid'
import type {
  AdminConversationRow,
  SupportAttachmentRow,
  SupportConversation,
  SupportMessageRow,
  SupportStatus,
} from './types'

/** The project's generated `Database` type predates the support tables, and
 *  editing that shared file is avoided on purpose. All support queries go
 *  through this untyped view of the same client (same auth, same session). */
export function db(): SupabaseClient {
  return getSupabase() as unknown as SupabaseClient
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------
export type SupportErrorCode =
  | 'network'
  | 'not_configured'
  | 'rate_limited'
  | 'body_too_long'
  | 'empty_message'
  | 'too_many_attachments'
  | 'attachment'
  | 'not_authenticated'
  | 'forbidden'
  | 'unknown'

export class SupportApiError extends Error {
  readonly code: SupportErrorCode
  readonly userMessage: string
  /** Worth retrying automatically (connection problem), as opposed to a
   *  definitive rejection by the server. */
  readonly transient: boolean

  constructor(code: SupportErrorCode, userMessage: string, transient: boolean, raw?: string) {
    super(raw ?? code)
    this.name = 'SupportApiError'
    this.code = code
    this.userMessage = userMessage
    this.transient = transient
  }
}

const NETWORK_RE =
  /failed to fetch|networkerror|network request failed|load failed|aborterror|signal is aborted|timed? ?out|network error|err_internet|fetch failed/i

export function toSupportError(e: unknown): SupportApiError {
  if (e instanceof SupportApiError) return e

  if (e instanceof UploadError) {
    if (e.kind === 'network' || e.kind === 'aborted') {
      return new SupportApiError('network', S.errNetwork, true, e.message)
    }
    return new SupportApiError('attachment', S.errAttachment, false, e.message)
  }

  const err = e as { message?: string; code?: string; name?: string } | null | undefined
  const message = String(err?.message ?? e ?? '')
  const code = String(err?.code ?? '')

  if (code === 'PGRST202' || code === '42P01' || /schema cache|could not find the function|does not exist/i.test(message)) {
    return new SupportApiError('not_configured', S.errNotConfigured, false, message)
  }
  if (err?.name === 'AbortError' || e instanceof TypeError || NETWORK_RE.test(message)) {
    return new SupportApiError('network', S.errNetwork, true, message)
  }

  // Database RPCs raise short tokens (see 009 migration).
  const token = message.trim()
  switch (token) {
    case 'rate_limited':
      return new SupportApiError('rate_limited', S.errRateLimited, true, token)
    case 'body_too_long':
      return new SupportApiError('body_too_long', S.errBodyTooLong, false, token)
    case 'empty_message':
      return new SupportApiError('empty_message', S.errEmpty, false, token)
    case 'too_many_attachments':
      return new SupportApiError('too_many_attachments', S.errTooManyAttachments, false, token)
    case 'not_authenticated':
      return new SupportApiError('not_authenticated', S.errNotAuthenticated, false, token)
    case 'forbidden':
      return new SupportApiError('forbidden', S.adminForbiddenText, false, token)
    default:
      if (token.startsWith('attachment_') || token === 'invalid_attachments' || token === 'admin_attachments_unsupported') {
        return new SupportApiError('attachment', S.errAttachment, false, token)
      }
      return new SupportApiError('unknown', S.errGeneric, false, token)
  }
}

function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw toSupportError(res.error)
  return res.data as T
}

// ---------------------------------------------------------------------
// User side
// ---------------------------------------------------------------------
export async function getOrCreateConversation(): Promise<SupportConversation> {
  try {
    const res = await db().rpc('get_or_create_support_conversation')
    return must<SupportConversation>(res)
  } catch (e) {
    throw toSupportError(e)
  }
}

export interface MessagePage {
  /** Ascending (oldest first). */
  messages: SupportMessageRow[]
  attachments: Record<string, SupportAttachmentRow[]>
  hasMore: boolean
}

export async function fetchAttachmentsFor(messageIds: string[]): Promise<Record<string, SupportAttachmentRow[]>> {
  const out: Record<string, SupportAttachmentRow[]> = {}
  if (messageIds.length === 0) return out
  const res = await db()
    .from('support_message_attachments')
    .select('*')
    .in('message_id', messageIds)
    .order('created_at', { ascending: true })
  const rows = must<SupportAttachmentRow[]>(res) ?? []
  for (const r of rows) (out[r.message_id] ??= []).push(r)
  return out
}

export async function fetchMessages(
  conversationId: string,
  opts: { before?: string | null; limit?: number } = {},
): Promise<MessagePage> {
  const limit = opts.limit ?? MESSAGE_PAGE_SIZE
  try {
    let q = db()
      .from('support_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (opts.before) q = q.lt('created_at', opts.before)

    const rows = (must<SupportMessageRow[]>(await q) ?? []).slice().reverse()
    const attachments = await fetchAttachmentsFor(rows.map((r) => r.id))
    return { messages: rows, attachments, hasMore: rows.length === limit }
  } catch (e) {
    throw toSupportError(e)
  }
}

export interface SendResult {
  message: SupportMessageRow
  attachments: SupportAttachmentRow[]
  deduplicated: boolean
}

export async function sendMessage(args: {
  conversationId: string
  body: string
  clientId: string
  attachments?: { path: string; mime: string; size: number }[]
  asAdmin?: boolean
}): Promise<SendResult> {
  try {
    const res = await db().rpc('send_support_message', {
      p_conversation_id: args.conversationId,
      p_body: args.body,
      p_client_id: args.clientId,
      p_attachments: (args.attachments ?? []).map((a) => ({ path: a.path, mime: a.mime, size: a.size })),
      p_as_admin: Boolean(args.asAdmin),
    })
    const data = must<{ message: SupportMessageRow; attachments: SupportAttachmentRow[]; deduplicated: boolean }>(res)
    if (!data || !data.message) throw new SupportApiError('unknown', S.errGeneric, false, 'empty response')
    return {
      message: data.message,
      attachments: data.attachments ?? [],
      deduplicated: Boolean(data.deduplicated),
    }
  } catch (e) {
    throw toSupportError(e)
  }
}

export async function markRead(conversationId: string, asAdmin: boolean): Promise<void> {
  try {
    const res = await db().rpc('mark_support_read', {
      p_conversation_id: conversationId,
      p_as_admin: asAdmin,
    })
    if (res.error) throw toSupportError(res.error)
  } catch (e) {
    throw toSupportError(e)
  }
}

/** Fire-and-forget: asks the support-notify Edge Function to flush queued
 *  e-mail notifications. A failure here is harmless — the jobs stay queued
 *  and are retried on the next call. The chat message is already saved. */
export function triggerEmailNotifications(): void {
  try {
    void db()
      .functions.invoke('support-notify', { body: {} })
      .catch(() => undefined)
  } catch {
    /* ignore */
  }
}

export async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(paths)]
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const { data, error } = await db().storage.from(SUPPORT_BUCKET).createSignedUrls(chunk, SIGNED_URL_TTL_SECONDS)
    if (error) throw toSupportError(error)
    for (const row of data ?? []) {
      if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl)
    }
  }
  return out
}

export async function fetchMyUnreadCount(userId: string): Promise<number> {
  const res = await db()
    .from('support_conversations')
    .select('user_unread_count')
    .eq('user_id', userId)
  const rows = must<{ user_unread_count: number }[]>(res) ?? []
  return rows.reduce((sum, r) => sum + (r.user_unread_count ?? 0), 0)
}

// ---------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------
/** Asks the DATABASE who is an admin. Nothing the browser says is trusted. */
export async function checkIsSupportAdmin(): Promise<boolean> {
  const res = await db().rpc('is_support_admin')
  if (res.error) throw toSupportError(res.error)
  return res.data === true
}

export async function adminListConversations(status: SupportStatus | null): Promise<AdminConversationRow[]> {
  try {
    const res = await db().rpc('support_admin_list_conversations', {
      p_status: status,
      p_limit: 200,
    })
    return must<AdminConversationRow[]>(res) ?? []
  } catch (e) {
    throw toSupportError(e)
  }
}

export async function adminSetStatus(conversationId: string, status: SupportStatus): Promise<void> {
  try {
    const res = await db().rpc('support_admin_set_status', {
      p_conversation_id: conversationId,
      p_status: status,
    })
    if (res.error) throw toSupportError(res.error)
  } catch (e) {
    throw toSupportError(e)
  }
}

// ---------------------------------------------------------------------
// Realtime (postgres_changes obeys the SELECT policies in 009)
// ---------------------------------------------------------------------
export function subscribeToThread(
  conversationId: string,
  onMessage: (row: SupportMessageRow, event: 'INSERT' | 'UPDATE') => void,
): () => void {
  const client = db()
  const channel = client
    .channel(`support-thread-${conversationId}-${uuid()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onMessage(payload.new as SupportMessageRow, 'INSERT'),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onMessage(payload.new as SupportMessageRow, 'UPDATE'),
    )
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}

export function subscribeToAdminFeed(onChange: () => void): () => void {
  const client = db()
  const channel = client
    .channel(`support-admin-${uuid()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, () => onChange())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, () => onChange())
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}

export function subscribeToMyConversation(userId: string, onChange: () => void): () => void {
  const client = db()
  const channel = client
    .channel(`support-mine-${userId}-${uuid()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'support_conversations', filter: `user_id=eq.${userId}` },
      () => onChange(),
    )
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}
