import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChatThread } from '@/components/support/ChatThread'
import { Composer } from '@/components/support/Composer'
import { useAuth } from '@/context/AuthContext'
import {
  adminListConversations,
  adminSetStatus,
  checkIsSupportAdmin,
  subscribeToAdminFeed,
  toSupportError,
} from '@/lib/support/api'
import { ADMIN_LIST_POLL_INTERVAL_MS } from '@/lib/support/constants'
import { formatShort, shortId } from '@/lib/support/format'
import { S } from '@/lib/support/strings'
import type { AdminConversationRow, SupportStatus } from '@/lib/support/types'
import { useSignedUrls } from '@/lib/support/useSignedUrls'
import { useSupportThread } from '@/lib/support/useSupportThread'
import '@/styles/support.css'

const STATUSES: SupportStatus[] = ['open', 'waiting', 'resolved']

function customerLabel(c: Pick<AdminConversationRow, 'full_name' | 'email' | 'user_id'>): string {
  return c.full_name?.trim() || c.email || `${S.adminUser} ${shortId(c.user_id)}`
}

type Access = 'checking' | 'granted' | 'denied' | 'error'

export function SupportAdminPage() {
  const { user, loading } = useAuth()
  const [access, setAccess] = useState<Access>('checking')

  // The database decides who is an admin (RPC backed by support_admins).
  // This check only chooses what to RENDER; every query and write below is
  // enforced again by Row Level Security / SECURITY DEFINER functions.
  useEffect(() => {
    if (!user) {
      setAccess('checking')
      return
    }
    let cancelled = false
    setAccess('checking')
    checkIsSupportAdmin()
      .then((ok) => !cancelled && setAccess(ok ? 'granted' : 'denied'))
      .catch(() => !cancelled && setAccess('error'))
    return () => {
      cancelled = true
    }
  }, [user])

  if (loading) {
    return (
      <div className="page center">
        <p className="muted">{S.loading}</p>
      </div>
    )
  }
  if (!user) {
    return (
      <div className="page center support-page--center">
        <div className="sc-card">
          <h1>{S.adminTitle}</h1>
          <p className="muted">{S.adminLogin}</p>
          <Link to="/login" className="support-button support-button--solid">
            {S.login}
          </Link>
        </div>
      </div>
    )
  }
  if (access === 'checking') {
    return (
      <div className="page center">
        <p className="muted">{S.adminChecking}</p>
      </div>
    )
  }
  if (access === 'denied' || access === 'error') {
    const email = user.email?.trim() ?? ''
    const setupSql = email
      ? `insert into public.support_admins (user_id, note)\nselect id, 'owner' from auth.users where email = '${email.replace(/'/g, "''")}'\non conflict do nothing;`
      : `insert into public.support_admins (user_id, note)\nselect id, 'owner' from auth.users where email = 'შენი-ელფოსტა@example.com'\non conflict do nothing;`
    return (
      <div className="page center support-page--center">
        <div className="sc-card" role="alert">
          <h1>{S.adminForbiddenTitle}</h1>
          <p className="muted">{access === 'error' ? S.errGeneric : S.adminForbiddenText}</p>
          {access === 'denied' && (
            <>
              {email && (
                <p className="muted">
                  {S.adminForbiddenSignedInAs}: <strong>{email}</strong>
                </p>
              )}
              <p className="muted">{S.adminForbiddenHint}</p>
              <pre className="sc-setup-sql" tabIndex={0}>
                {setupSql}
              </pre>
            </>
          )}
          <Link to="/" className="support-button">
            {S.back}
          </Link>
        </div>
      </div>
    )
  }
  return <AdminWorkspace />
}

function AdminWorkspace() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('c')
  const [filter, setFilter] = useState<SupportStatus | null>(null)
  const [rows, setRows] = useState<AdminConversationRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const filterRef = useRef(filter)
  filterRef.current = filter

  const refresh = useCallback(async () => {
    try {
      const data = await adminListConversations(filterRef.current)
      setRows(data)
      setListError(null)
    } catch (e) {
      setListError(toSupportError(e).userMessage)
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    setListLoading(true)
    void refresh()
  }, [filter, refresh])

  // Live updates: Realtime (debounced) + polling as a safety net.
  useEffect(() => {
    let t: number | undefined
    const debounced = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => void refresh(), 400)
    }
    let unsub: () => void = () => undefined
    try {
      unsub = subscribeToAdminFeed(debounced)
    } catch {
      /* polling still works */
    }
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, ADMIN_LIST_POLL_INTERVAL_MS)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(poll)
      unsub()
    }
  }, [refresh])

  const selected = rows.find((r) => r.id === selectedId) ?? null
  const select = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('c', id)
    else next.delete('c')
    setParams(next, { replace: false })
  }

  const totalUnread = rows.reduce((n, r) => n + (r.admin_unread_count || 0), 0)

  return (
    <div className={`sa-layout ${selectedId ? 'sa-layout--detail' : ''}`}>
      <aside className="sa-list">
        <header className="sa-list__head">
          <h1>
            {S.adminTitle}
            {totalUnread > 0 && <span className="sa-badge">{totalUnread}</span>}
          </h1>
          <button type="button" className="sa-refresh" onClick={() => void refresh()} title={S.adminRefresh} aria-label={S.adminRefresh}>
            ↻
          </button>
        </header>

        <div className="sa-filters" role="tablist">
          <button type="button" role="tab" aria-selected={filter === null} className={filter === null ? 'is-active' : ''} onClick={() => setFilter(null)}>
            {S.adminAll}
          </button>
          {STATUSES.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={filter === s} className={filter === s ? 'is-active' : ''} onClick={() => setFilter(s)}>
              {S.status[s]}
            </button>
          ))}
        </div>

        <div className="sa-items">
          {listError && (
            <div className="sc-inline-error" role="alert">
              {S.adminListError} <button type="button" onClick={() => void refresh()}>{S.retry}</button>
            </div>
          )}
          {listLoading && rows.length === 0 && <p className="muted sa-empty">{S.loading}</p>}
          {!listLoading && rows.length === 0 && !listError && <p className="muted sa-empty">{S.adminNoConversations}</p>}
          {rows.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`sa-item ${r.id === selectedId ? 'is-selected' : ''} ${r.admin_unread_count > 0 ? 'is-unread' : ''}`}
              onClick={() => select(r.id)}
            >
              <div className="sa-item__top">
                <strong>{customerLabel(r)}</strong>
                <span className="muted">{formatShort(r.last_message_at)}</span>
              </div>
              <div className="sa-item__preview">
                {r.last_sender_type === 'admin' && <span className="muted">↩ </span>}
                {r.last_message_preview || '—'}
              </div>
              <div className="sa-item__bottom">
                <span className={`sa-status sa-status--${r.status}`}>{S.status[r.status]}</span>
                {r.admin_unread_count > 0 && <span className="sa-badge">{r.admin_unread_count}</span>}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="sa-detail">
        {selected ? (
          <ConversationPane key={selected.id} conv={selected} onChanged={() => void refresh()} onBack={() => select(null)} />
        ) : selectedId && listLoading ? (
          <div className="sc-state"><p className="muted">{S.loading}</p></div>
        ) : (
          <div className="sc-state sc-state--empty">
            <p className="muted">{S.adminSelect}</p>
          </div>
        )}
      </section>
    </div>
  )
}

function ConversationPane({
  conv,
  onChanged,
  onBack,
}: {
  conv: AdminConversationRow
  onChanged: () => void
  onBack: () => void
}) {
  const thread = useSupportThread({ conversationId: conv.id, viewer: 'admin', userId: null })
  const urls = useSignedUrls(thread.items)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function changeStatus(next: SupportStatus) {
    setSaving(true)
    setStatusError(null)
    try {
      await adminSetStatus(conv.id, next)
      onChanged()
    } catch (e) {
      setStatusError(toSupportError(e).userMessage)
    } finally {
      setSaving(false)
    }
  }

  const name = customerLabel(conv)
  return (
    <>
      <header className="sa-detail__head">
        <button type="button" className="support-header__back sa-back" onClick={onBack}>
          {S.adminBackToList}
        </button>
        <div className="sa-detail__who">
          <strong>{name}</strong>
          <span className="muted">
            {conv.email ? `${conv.email} · ` : ''}ID {shortId(conv.user_id)}
          </span>
        </div>
        <label className="sa-status-select">
          <span className="muted">{S.adminStatus}</span>
          <select value={conv.status} disabled={saving} onChange={(e) => void changeStatus(e.target.value as SupportStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {S.status[s]}
              </option>
            ))}
          </select>
        </label>
      </header>
      {statusError && <div className="sc-inline-error" role="alert">{statusError}</div>}

      {thread.loading && thread.items.length === 0 ? (
        <div className="sc-state"><p className="muted">{S.loading}</p></div>
      ) : thread.loadError && thread.items.length === 0 ? (
        <div className="sc-state" role="alert">
          <p>{thread.loadError}</p>
          <button type="button" onClick={thread.reload}>{S.retry}</button>
        </div>
      ) : (
        <ChatThread
          items={thread.items}
          urls={urls}
          viewer="admin"
          customerName={name}
          hasMore={thread.hasMore}
          loadingOlder={thread.loadingOlder}
          onLoadOlder={() => void thread.loadOlder()}
          onRetry={thread.retry}
          onDiscard={thread.discard}
        />
      )}
      <Composer onSend={thread.send} placeholder={S.placeholderAdmin} allowImages={false} />
    </>
  )
}
