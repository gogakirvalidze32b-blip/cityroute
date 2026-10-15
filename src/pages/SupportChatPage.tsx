import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Composer } from '@/components/support/Composer'
import { ChatThread } from '@/components/support/ChatThread'
import { useAuth } from '@/context/AuthContext'
import { getOrCreateConversation, toSupportError } from '@/lib/support/api'
import { SUPPORT_EMAIL } from '@/lib/support/constants'
import { S } from '@/lib/support/strings'
import type { SupportConversation } from '@/lib/support/types'
import { useSignedUrls } from '@/lib/support/useSignedUrls'
import { useSupportThread } from '@/lib/support/useSupportThread'
import '@/styles/support.css'

function NeedLogin() {
  return (
    <div className="page center support-page support-page--center">
      <div className="sc-card">
        <h1>{S.needLoginTitle}</h1>
        <p className="muted">{S.needLoginText}</p>
        <div className="sc-card__buttons">
          <Link to="/login" className="support-button support-button--solid">
            {S.login}
          </Link>
          <Link to="/register" className="support-button">
            {S.register}
          </Link>
        </div>
        <p className="muted">
          {S.orEmail} <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </div>
    </div>
  )
}

export function SupportChatPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [conv, setConv] = useState<SupportConversation | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)

  const userId = user?.id ?? null

  const init = useCallback(async () => {
    setInitializing(true)
    setInitError(null)
    try {
      setConv(await getOrCreateConversation())
    } catch (e) {
      setInitError(toSupportError(e).userMessage)
    } finally {
      setInitializing(false)
    }
  }, [])

  useEffect(() => {
    if (userId) void init()
    else setConv(null)
  }, [userId, init])

  const thread = useSupportThread({ conversationId: conv?.id ?? null, viewer: 'user', userId })
  const urls = useSignedUrls(thread.items)

  if (loading) {
    return (
      <div className="page center">
        <p className="muted">{S.loading}</p>
      </div>
    )
  }
  if (!user) return <NeedLogin />

  const busy = initializing || thread.loading
  const error = initError ?? thread.loadError

  return (
    <div className="support-page">
      <header className="support-header">
        <button type="button" className="support-header__back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          {S.back}
        </button>
        <div className="support-header__titles">
          <h1>{S.chatTitle}</h1>
          <span className="muted">{S.chatSubtitle}</span>
        </div>
      </header>

      {error && !conv ? (
        <div className="sc-state" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void init()}>
            {S.retry}
          </button>
        </div>
      ) : busy && thread.items.length === 0 ? (
        <div className="sc-state">
          <p className="muted">{S.loading}</p>
        </div>
      ) : (
        <>
          {thread.items.length === 0 ? (
            <div className="sc-state sc-state--empty">
              <p className="sc-state__title">{S.emptyTitle}</p>
              <p className="muted">{S.emptyText}</p>
            </div>
          ) : (
            <ChatThread
              items={thread.items}
              urls={urls}
              viewer="user"
              hasMore={thread.hasMore}
              loadingOlder={thread.loadingOlder}
              onLoadOlder={() => void thread.loadOlder()}
              onRetry={thread.retry}
              onDiscard={thread.discard}
            />
          )}
          {thread.loadError && conv && (
            <div className="sc-inline-error" role="alert">
              {thread.loadError}{' '}
              <button type="button" onClick={thread.reload}>
                {S.retry}
              </button>
            </div>
          )}
          <Composer onSend={thread.send} disabled={!conv} draftUserId={userId} />
        </>
      )}
    </div>
  )
}
