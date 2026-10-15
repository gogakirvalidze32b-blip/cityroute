import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchAttachmentsFor,
  fetchMessages,
  markRead,
  sendMessage,
  subscribeToThread,
  toSupportError,
  triggerEmailNotifications,
  db,
} from './api'
import {
  applyServerMessage,
  applyServerMessages,
  hasUnreadFrom,
  makePendingItem,
  markFailed,
  markReadLocally,
  markSending,
  oldestConfirmedAt,
  removeByClientId,
  setProgress,
  sortItems,
} from './chat-state'
import { MAX_BODY_LENGTH, POLL_INTERVAL_MS } from './constants'
import type { AcceptedImage } from './image-validation'
import { addToOutbox, loadOutbox, removeFromOutbox } from './outbox-storage'
import { S } from './strings'
import type { ChatAttachment, ChatItem, PendingPayload, SupportSenderType } from './types'
import { uploadSupportImage } from './upload'
import { uuid } from './uuid'

export interface UseSupportThreadOptions {
  conversationId: string | null
  /** Whose view this is. Decides who the "other party" is for read receipts. */
  viewer: SupportSenderType
  /** Needed only for the user-side offline outbox (text survives a reload). */
  userId: string | null
}

export interface SendInput {
  body: string
  images: AcceptedImage[]
}

export interface SupportThread {
  items: ChatItem[]
  loading: boolean
  loadError: string | null
  hasMore: boolean
  loadingOlder: boolean
  reload: () => void
  loadOlder: () => Promise<void>
  /** Returns an error string when the input was rejected locally. */
  send: (input: SendInput) => string | null
  retry: (clientId: string) => void
  discard: (clientId: string) => void
}

const other = (v: SupportSenderType): SupportSenderType => (v === 'user' ? 'admin' : 'user')

export function useSupportThread({ conversationId, viewer, userId }: UseSupportThreadOptions): SupportThread {
  const [items, setItems] = useState<ChatItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const itemsRef = useRef<ChatItem[]>([])
  itemsRef.current = items
  const payloads = useRef(new Map<string, PendingPayload>())
  const inFlight = useRef(new Set<string>())
  const markingRef = useRef(false)
  const aliveRef = useRef(true)
  const convRef = useRef<string | null>(conversationId)
  convRef.current = conversationId

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const update = useCallback((fn: (prev: ChatItem[]) => ChatItem[]) => {
    setItems((prev) => {
      const next = fn(prev)
      itemsRef.current = next
      return next
    })
  }, [])

  // ----- initial load, reset on conversation change ----------------------
  useEffect(() => {
    payloads.current.clear()
    inFlight.current.clear()
    itemsRef.current = []
    setItems([])
    setHasMore(false)
    setLoadError(null)
    if (!conversationId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const page = await fetchMessages(conversationId)
        if (cancelled) return
        let next = applyServerMessages([], page.messages, page.attachments)

        // Text that was typed but never confirmed (network drop, reload):
        // bring it back as a "failed — retry" bubble instead of losing it.
        if (viewer === 'user' && userId) {
          for (const e of loadOutbox(userId)) {
            if (e.conversationId !== conversationId) continue
            if (next.some((i) => i.clientId === e.clientId)) {
              removeFromOutbox(userId, e.clientId)
              continue
            }
            const pending = makePendingItem({
              clientId: e.clientId,
              senderType: 'user',
              body: e.body,
              createdAt: e.createdAt,
              attachments: [],
            })
            pending.delivery = 'failed'
            pending.error = S.errNetwork
            pending.progress = null
            payloads.current.set(e.clientId, { clientId: e.clientId, body: e.body, files: [], uploaded: [] })
            next = sortItems([...next, pending])
          }
        }
        itemsRef.current = next
        setItems(next)
        setHasMore(page.hasMore)
      } catch (e) {
        if (!cancelled) setLoadError(toSupportError(e).userMessage)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [conversationId, viewer, userId, reloadToken])

  // ----- realtime + polling safety net ------------------------------------
  useEffect(() => {
    if (!conversationId) return
    const convId = conversationId

    const refreshLatest = async () => {
      try {
        const page = await fetchMessages(convId)
        if (!aliveRef.current || convRef.current !== convId) return
        update((prev) => applyServerMessages(prev, page.messages, page.attachments))
      } catch {
        /* next tick will try again */
      }
    }

    const unsubscribe = subscribeToThread(convId, (row, event) => {
      if (convRef.current !== convId) return
      if (event === 'UPDATE') {
        update((prev) => applyServerMessage(prev, row))
        return
      }
      void (async () => {
        try {
          const atts = (await fetchAttachmentsFor([row.id]))[row.id] ?? []
          if (aliveRef.current && convRef.current === convId) update((prev) => applyServerMessage(prev, row, atts))
        } catch {
          void refreshLatest()
        }
      })()
    })

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshLatest()
    }, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshLatest()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    return () => {
      unsubscribe()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [conversationId, update])

  // ----- read receipts ----------------------------------------------------
  useEffect(() => {
    if (!conversationId || markingRef.current) return
    if (document.visibilityState !== 'visible') return
    if (!hasUnreadFrom(items, other(viewer))) return
    markingRef.current = true
    void markRead(conversationId, viewer === 'admin')
      .then(() => {
        if (aliveRef.current) update((prev) => markReadLocally(prev, other(viewer), new Date().toISOString()))
      })
      .catch(() => undefined)
      .finally(() => {
        markingRef.current = false
      })
  }, [items, conversationId, viewer, update])

  // ----- history paging ---------------------------------------------------
  const loadOlder = useCallback(async () => {
    const convId = convRef.current
    const before = oldestConfirmedAt(itemsRef.current)
    if (!convId || !before || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await fetchMessages(convId, { before })
      if (!aliveRef.current || convRef.current !== convId) return
      update((prev) => applyServerMessages(prev, page.messages, page.attachments))
      setHasMore(page.hasMore)
    } catch (e) {
      setLoadError(toSupportError(e).userMessage)
    } finally {
      if (aliveRef.current) setLoadingOlder(false)
    }
  }, [loadingOlder, update])

  // ----- sending ----------------------------------------------------------
  const deliver = useCallback(
    async (clientId: string) => {
      const convId = convRef.current
      const payload = payloads.current.get(clientId)
      if (!convId || !payload || inFlight.current.has(clientId)) return
      inFlight.current.add(clientId)
      update((prev) => markSending(prev, clientId))

      try {
        const total = payload.files.length
        if (total > 0) {
          const client = db()
          for (let idx = 0; idx < total; idx++) {
            if (payload.uploaded.some((u) => u.fileIndex === idx)) continue
            const f = payload.files[idx]
            const done = payload.uploaded.length
            const up = await uploadSupportImage({
              client,
              conversationId: convId,
              file: f.file,
              mime: f.mime,
              onProgress: (fr) =>
                update((prev) => setProgress(prev, clientId, Math.round(((done + fr) / total) * 100))),
            })
            payload.uploaded.push({ path: up.path, mime: up.mime, size: up.size, fileIndex: idx })
          }
        }

        const res = await sendMessage({
          conversationId: convId,
          body: payload.body,
          clientId,
          attachments: payload.uploaded
            .slice()
            .sort((a, b) => a.fileIndex - b.fileIndex)
            .map(({ path, mime, size }) => ({ path, mime, size })),
          asAdmin: viewer === 'admin',
        })

        if (userId) removeFromOutbox(userId, clientId)
        payloads.current.delete(clientId)
        // Only now — after the server confirmed the save — does it show as sent.
        if (aliveRef.current) {
          update((prev) => {
            const old = prev.find((i) => i.clientId === clientId)
            const merged = applyServerMessage(prev, res.message, res.attachments)
            // Free local blob previews once the stored copy is displayed.
            old?.attachments.forEach((a) => a.previewUrl && safeRevoke(a.previewUrl))
            return merged
          })
        }
        triggerEmailNotifications()
      } catch (e) {
        const err = toSupportError(e)
        if (aliveRef.current) update((prev) => markFailed(prev, clientId, err.userMessage))
      } finally {
        inFlight.current.delete(clientId)
      }
    },
    [update, viewer, userId],
  )

  const send = useCallback(
    (input: SendInput): string | null => {
      const convId = convRef.current
      const body = input.body.trim()
      if (!convId) return S.errGeneric
      if (!body && input.images.length === 0) return S.errEmpty
      if (body.length > MAX_BODY_LENGTH) return S.bodyTooLong(MAX_BODY_LENGTH)

      const clientId = uuid()
      const attachments: ChatAttachment[] = input.images.map((img, n) => ({
        key: `${clientId}-${n}`,
        path: null,
        mime: img.mime,
        size: img.file.size,
        previewUrl: safeObjectUrl(img.file),
      }))
      const createdAt = new Date().toISOString()
      payloads.current.set(clientId, { clientId, body, files: input.images, uploaded: [] })

      // Text-only messages survive a reload / dropped connection.
      if (viewer === 'user' && userId && input.images.length === 0) {
        addToOutbox(userId, { clientId, conversationId: convId, body, createdAt })
      }

      update((prev) =>
        sortItems([
          ...prev,
          makePendingItem({ clientId, senderType: viewer, body, createdAt, attachments }),
        ]),
      )
      void deliver(clientId)
      return null
    },
    [deliver, update, userId, viewer],
  )

  const retry = useCallback(
    (clientId: string) => {
      void deliver(clientId)
    },
    [deliver],
  )

  const discard = useCallback(
    (clientId: string) => {
      const it = itemsRef.current.find((i) => i.clientId === clientId)
      it?.attachments.forEach((a) => a.previewUrl && safeRevoke(a.previewUrl))
      payloads.current.delete(clientId)
      if (userId) removeFromOutbox(userId, clientId)
      update((prev) => removeByClientId(prev, clientId))
    },
    [update, userId],
  )

  // Connection came back: retry whatever failed because of the network.
  useEffect(() => {
    const onOnline = () => {
      for (const it of itemsRef.current) {
        if (it.delivery === 'failed' && it.clientId && payloads.current.has(it.clientId)) void deliver(it.clientId)
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [deliver])

  // Release blob URLs on unmount.
  useEffect(
    () => () => {
      for (const it of itemsRef.current) it.attachments.forEach((a) => a.previewUrl && safeRevoke(a.previewUrl))
    },
    [],
  )

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  return { items, loading, loadError, hasMore, loadingOlder, reload, loadOlder, send, retry, discard }
}

function safeObjectUrl(file: File): string | null {
  try {
    return URL.createObjectURL(file)
  } catch {
    return null
  }
}

function safeRevoke(url: string) {
  try {
    URL.revokeObjectURL(url)
  } catch {
    /* ignore */
  }
}
