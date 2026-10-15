import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { dayKey, dayLabel, formatTime } from '@/lib/support/format'
import { S } from '@/lib/support/strings'
import type { ChatAttachment, ChatItem, SupportSenderType } from '@/lib/support/types'
import { ImageLightbox } from './ImageLightbox'

export interface ChatThreadProps {
  items: ChatItem[]
  urls: Map<string, string>
  /** Who is looking: decides which side is "mine" and the author labels. */
  viewer: SupportSenderType
  /** Name shown for the customer in the admin view. */
  customerName?: string
  hasMore: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onRetry: (clientId: string) => void
  onDiscard: (clientId: string) => void
}

function authorLabel(item: ChatItem, viewer: SupportSenderType, customerName?: string): string {
  if (viewer === 'user') return item.senderType === 'user' ? S.you : S.supportTeam
  return item.senderType === 'admin' ? S.youAsSupport : customerName || S.adminAnonymous
}

function Picture({
  att,
  urls,
  onOpen,
}: {
  att: ChatAttachment
  urls: Map<string, string>
  onOpen: (src: string) => void
}) {
  const [failed, setFailed] = useState(false)
  // Prefer the stored copy; fall back to the local blob while it is being signed.
  const src = (att.path && urls.get(att.path)) || att.previewUrl
  if (failed) return <div className="sc-img sc-img--broken">{S.imageLoadFailed}</div>
  if (!src) return <div className="sc-img sc-img--loading" aria-busy="true" />
  return (
    <button type="button" className="sc-img" onClick={() => onOpen(src)} aria-label={S.openImage}>
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    </button>
  )
}

export function ChatThread({
  items,
  urls,
  viewer,
  customerName,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onRetry,
  onDiscard,
}: ChatThreadProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  // Keep the view pinned to the newest message unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (prevHeight.current !== null) {
      // History was prepended: keep the visible message where it was.
      el.scrollTop += el.scrollHeight - prevHeight.current
      prevHeight.current = null
      return
    }
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [items, urls])

  useEffect(() => {
    if (loadingOlder) prevHeight.current = scroller.current?.scrollHeight ?? null
  }, [loadingOlder])

  function onScroll() {
    const el = scroller.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  let lastDay = ''
  return (
    <div className="sc-thread" ref={scroller} onScroll={onScroll} role="log" aria-live="polite">
      {hasMore && (
        <button type="button" className="sc-older" onClick={onLoadOlder} disabled={loadingOlder}>
          {loadingOlder ? S.loadingOlder : S.loadOlder}
        </button>
      )}

      {items.map((item) => {
        const mine = item.senderType === viewer
        const day = dayKey(item.createdAt)
        const showDay = day !== lastDay
        lastDay = day
        return (
          <Fragment key={item.key}>
            {showDay && <div className="sc-day">{dayLabel(item.createdAt)}</div>}
            <div className={`sc-row ${mine ? 'sc-row--mine' : 'sc-row--theirs'}`}>
              <div
                className={`sc-bubble ${mine ? 'sc-bubble--mine' : 'sc-bubble--theirs'} ${
                  item.senderType === 'admin' ? 'sc-bubble--admin' : ''
                } ${item.delivery === 'failed' ? 'sc-bubble--failed' : ''}`}
              >
                <div className="sc-author">{authorLabel(item, viewer, customerName)}</div>

                {item.attachments.length > 0 && (
                  <div className="sc-imgs">
                    {item.attachments.map((a) => (
                      <Picture key={a.key} att={a} urls={urls} onOpen={setOpen} />
                    ))}
                  </div>
                )}

                {item.body && <p className="sc-text">{item.body}</p>}

                {item.delivery === 'sending' && item.progress !== null && item.progress < 100 && (
                  <div className="sc-progress" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="sc-progress__bar" style={{ width: `${item.progress}%` }} />
                    <span className="sc-progress__label">{S.uploading(item.progress)}</span>
                  </div>
                )}

                <div className="sc-meta">
                  {item.delivery === 'sending' && <span>{S.sending}</span>}
                  {item.delivery === 'failed' && <span className="sc-meta__err">{item.error || S.failed}</span>}
                  {item.delivery === 'sent' && <span>{formatTime(item.createdAt)}</span>}
                  {item.delivery === 'sent' && mine && item.readAt && <span className="sc-meta__seen">✓ {S.seen}</span>}
                </div>

                {item.delivery === 'failed' && item.clientId && (
                  <div className="sc-actions">
                    <button type="button" onClick={() => onRetry(item.clientId!)}>
                      {S.retrySend}
                    </button>
                    <button type="button" className="sc-actions__ghost" onClick={() => onDiscard(item.clientId!)}>
                      {S.discard}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Fragment>
        )
      })}

      {open && <ImageLightbox src={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
