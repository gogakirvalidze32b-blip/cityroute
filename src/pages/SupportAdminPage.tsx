import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChatThread } from '@/components/support/ChatThread'
import { Composer } from '@/components/support/Composer'
import { useAuth } from '@/context/AuthContext'
import {
  adminListDeviceSessions,
  adminGetDeviceLimitOverride,
  adminGrantDeviceLimitOverride,
  adminListConversations,
  adminRevokeDeviceSession,
  adminRevokeDeviceLimitOverride,
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
        <DeviceLimitOverridePanel />
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

function DeviceLimitOverridePanel() {
  const [profileId, setProfileId] = useState('')
  const [loadedProfileId, setLoadedProfileId] = useState('')
  const [override, setOverride] = useState<Awaited<ReturnType<typeof adminGetDeviceLimitOverride>>>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [limit, setLimit] = useState('2')
  const [grantReason, setGrantReason] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deviceSessions, setDeviceSessions] = useState<Awaited<ReturnType<typeof adminListDeviceSessions>>>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionReasons, setSessionReasons] = useState<Record<string, string>>({})
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)

  async function loadSessions(targetProfileId: string) {
    setSessionsLoading(true)
    setSessionsError(null)
    try {
      setDeviceSessions(await adminListDeviceSessions(targetProfileId))
    } catch (e) {
      setSessionsError(toSupportError(e).userMessage)
      setDeviceSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }

  async function loadOverride(targetProfileId: string) {
    setLoading(true)
    setError(null)
    try {
      setOverride(await adminGetDeviceLimitOverride(targetProfileId))
      setLoadedProfileId(targetProfileId)
      setLoadError(null)
      void loadSessions(targetProfileId)
    } catch (e) {
      setLoadError(toSupportError(e).userMessage)
      setLoadedProfileId('')
    } finally {
      setLoading(false)
    }
  }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const targetProfileId = profileId.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetProfileId)) {
      setError('შეიყვანეთ მომხმარებლის ვალიდური UUID.')
      return
    }
    await loadOverride(targetProfileId)
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!loadedProfileId || profileId.trim() !== loadedProfileId) return
    const sessionLimit = Number(limit)
    if (!Number.isInteger(sessionLimit) || sessionLimit < 1 || sessionLimit > 100) {
      setError('ლიმიტი უნდა იყოს მთელი რიცხვი 1-დან 100-მდე.')
      return
    }
    if (grantReason.trim().length < 5 || grantReason.trim().length > 500) {
      setError('მიზეზი უნდა შეიცავდეს 5-დან 500 სიმბოლომდე.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await adminGrantDeviceLimitOverride(loadedProfileId, sessionLimit, grantReason.trim())
      setGrantReason('')
      await loadOverride(loadedProfileId)
    } catch (e) {
      setError(toSupportError(e).userMessage)
    } finally {
      setSaving(false)
    }
  }

  async function revoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!override || !loadedProfileId || profileId.trim() !== loadedProfileId) return
    if (revokeReason.trim().length < 5 || revokeReason.trim().length > 500) {
      setError('გაუქმების მიზეზი უნდა შეიცავდეს 5-დან 500 სიმბოლომდე.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await adminRevokeDeviceLimitOverride(override.override_id, revokeReason.trim())
      setRevokeReason('')
      await loadOverride(loadedProfileId)
    } catch (e) {
      setError(toSupportError(e).userMessage)
    } finally {
      setSaving(false)
    }
  }

  async function revokeDeviceSession(event: FormEvent<HTMLFormElement>, sessionId: string) {
    event.preventDefault()
    if (!loadedProfileId || profileId.trim() !== loadedProfileId) return
    const reason = sessionReasons[sessionId]?.trim() ?? ''
    if (reason.length < 5 || reason.length > 500) {
      setSessionsError('გაუქმების მიზეზი უნდა შეიცავდეს 5-დან 500 სიმბოლომდე.')
      return
    }
    setRevokingSessionId(sessionId)
    setSessionsError(null)
    try {
      await adminRevokeDeviceSession(loadedProfileId, sessionId, reason)
      setSessionReasons((current) => ({ ...current, [sessionId]: '' }))
      await loadSessions(loadedProfileId)
    } catch (e) {
      setSessionsError(toSupportError(e).userMessage)
    } finally {
      setRevokingSessionId(null)
    }
  }

  return (
    <section className="sa-device-limits" aria-labelledby="sa-device-limits-title">
      <h2 id="sa-device-limits-title">მოწყობილობების ლიმიტი</h2>
      <form onSubmit={(event) => void lookup(event)}>
        <label>
          მომხმარებლის პროფილის UUID
          <input value={profileId} onChange={(event) => setProfileId(event.target.value)} required />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? 'იტვირთება...' : 'მომხმარებლის მოძებნა'}
        </button>
      </form>
      {loadError && <p role="alert">{loadError}</p>}
      {loadedProfileId && profileId.trim() === loadedProfileId && override ? (
        <>
          <p>აქტიური ადმინისტრატორის ლიმიტი: <strong>{override.session_limit}</strong></p>
          <p className="muted">მიზეზი: {override.grant_reason}</p>
          <form onSubmit={(event) => void revoke(event)}>
            <label>
              გაუქმების მიზეზი
              <input value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} minLength={5} maxLength={500} required />
            </label>
            <button type="submit" disabled={saving}>
              {saving ? 'ინახება...' : 'გაუქმება (პაკეტის ლიმიტის აღდგენა)'}
            </button>
          </form>
        </>
      ) : loadedProfileId && profileId.trim() === loadedProfileId && !loading && !loadError ? (
        <form onSubmit={(event) => void grant(event)}>
          <label>
            მოწყობილობების ლიმიტი (1–100)
            <input type="number" min={1} max={100} step={1} value={limit} onChange={(event) => setLimit(event.target.value)} required />
          </label>
          <label>
            მინიჭების მიზეზი
            <input value={grantReason} onChange={(event) => setGrantReason(event.target.value)} minLength={5} maxLength={500} required />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? 'ინახება...' : 'ლიმიტის მინიჭება'}
          </button>
        </form>
      ) : null}
      {loadedProfileId && profileId.trim() === loadedProfileId && (
        <section aria-labelledby="sa-device-sessions-title">
          <h3 id="sa-device-sessions-title">მოწყობილობის სესიები</h3>
          {sessionsLoading && <p className="muted">სესიები იტვირთება...</p>}
          {sessionsError && <p className="sc-inline-error" role="alert">{sessionsError}</p>}
          {!sessionsLoading && !sessionsError && deviceSessions.length === 0 && (
            <p className="muted">აქტიური სესიის ჩანაწერები არ მოიძებნა.</p>
          )}
          {deviceSessions.map((deviceSession) => (
            <article key={deviceSession.session_id} className="sa-device-session">
              <p>Session ID: <code>{deviceSession.session_id}</code></p>
              <p>სტატუსი: <strong>{deviceSession.status}</strong></p>
              <p className="muted">
                ბოლო აქტივობა: {new Date(deviceSession.last_activity_at).toLocaleString()}
                {' · '}ბოლო presence: {new Date(deviceSession.last_seen_at).toLocaleString()}
              </p>
              <form onSubmit={(event) => void revokeDeviceSession(event, deviceSession.session_id)}>
                <label>
                  გაუქმების მიზეზი
                  <input
                    value={sessionReasons[deviceSession.session_id] ?? ''}
                    onChange={(event) => setSessionReasons((current) => ({
                      ...current,
                      [deviceSession.session_id]: event.target.value,
                    }))}
                    minLength={5}
                    maxLength={500}
                    required
                  />
                </label>
                <button type="submit" disabled={revokingSessionId !== null}>
                  {revokingSessionId === deviceSession.session_id ? 'უქმდება...' : 'სესიის გაუქმება'}
                </button>
              </form>
            </article>
          ))}
        </section>
      )}
      {loading && <p className="muted">იტვირთება...</p>}
      {!loadedProfileId && !loading && !loadError && (
        <p className="muted">მოძებნეთ მომხმარებელი UUID-ით, რომ ნახოთ ან შეცვალოთ მისი ლიმიტი.</p>
      )}
      {error && <p className="sc-inline-error" role="alert">{error}</p>}
      {loadedProfileId && profileId.trim() === loadedProfileId && (
        <p className="muted">მომხმარებლის ID: {loadedProfileId}</p>
      )}
    </section>
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
