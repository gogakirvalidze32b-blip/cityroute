export type SupportStatus = 'open' | 'waiting' | 'resolved'
export type SupportSenderType = 'user' | 'admin'

/** Row shapes of the support tables (see supabase/migrations/009). */
export interface SupportConversation {
  id: string
  user_id: string
  status: SupportStatus
  last_message_at: string
  last_message_preview: string
  last_sender_type: SupportSenderType | null
  user_unread_count: number
  admin_unread_count: number
  created_at: string
  updated_at: string
}

export interface SupportMessageRow {
  id: string
  conversation_id: string
  sender_id: string | null
  sender_type: SupportSenderType
  body: string
  client_id: string | null
  read_at: string | null
  created_at: string
}

export interface SupportAttachmentRow {
  id: string
  message_id: string
  conversation_id: string
  storage_path: string
  mime_type: string
  size_bytes: number
  created_at: string
}

/** Row returned by support_admin_list_conversations(). */
export interface AdminConversationRow {
  id: string
  user_id: string
  status: SupportStatus
  last_message_at: string
  last_message_preview: string
  last_sender_type: SupportSenderType | null
  admin_unread_count: number
  created_at: string
  full_name: string | null
  email: string | null
}

export type Delivery = 'sent' | 'sending' | 'failed'

/** An image that is part of a message in the UI.
 *  - confirmed attachments have a storage `path` (shown through a signed URL)
 *  - not-yet-confirmed ones only have a local `previewUrl` (a blob: URL) */
export interface ChatAttachment {
  key: string
  path: string | null
  mime: string
  size: number
  previewUrl: string | null
}

/** One bubble in the thread. */
export interface ChatItem {
  /** Stable React key: the client-generated id, or the server id for
   *  messages that were not sent from this browser. */
  key: string
  /** Server id once confirmed. */
  id: string | null
  clientId: string | null
  senderType: SupportSenderType
  body: string
  createdAt: string
  readAt: string | null
  attachments: ChatAttachment[]
  delivery: Delivery
  error: string | null
  /** 0–100 while images are uploading. */
  progress: number | null
}

/** Payload kept so a failed message can be retried without losing anything. */
export interface PendingPayload {
  clientId: string
  body: string
  /** Original files (kept in memory only — blobs are not persisted). */
  files: { file: File; mime: 'image/jpeg' | 'image/png' | 'image/webp' }[]
  /** Already uploaded storage paths, so a retry never uploads twice. */
  uploaded: { path: string; mime: string; size: number; fileIndex: number }[]
}
