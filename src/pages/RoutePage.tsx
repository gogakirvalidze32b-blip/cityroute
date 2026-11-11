import { useEffect, useMemo, useState } from 'react'

import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { ExamDriveSession } from '@/components/ExamDriveSession'

import { useAuth } from '@/context/AuthContext'

import {
  claimLegacyExamPersistenceScope,
  hasSavedExamForSlug,
} from '@/lib/exam-persistence'
import { claimUniqueExamTabId, getDeviceFingerprint } from '@/lib/device'

import { useRoutes } from '@/hooks/useRoutes'
import { selectableRoutes } from '@/data/selectable-routes'

type NavPhase = 'preview' | 'active' | 'summary'

function CarFullscreenButton({ floating = false }: { floating?: boolean }) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const sync = () => setActive(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  if (typeof document === 'undefined' || !document.fullscreenEnabled) return null

  return (
    <button
      type="button"
      className={`car-fullscreen-btn${floating ? ' car-fullscreen-btn--floating' : ''}`}
      onClick={() => {
        if (document.fullscreenElement) {
          void document.exitFullscreen()
          return
        }
        void document.documentElement.requestFullscreen().catch(() => {})
      }}
    >
      {active ? 'ჩვეულებრივი' : 'სრული ეკრანი'}
    </button>
  )
}

export function RoutePage() {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { hasAccess, deviceBlocked, user } = useAuth()
  const { routes } = useRoutes()
  const [tabId, setTabId] = useState<string | null>(null)
  const [tabIdentityError, setTabIdentityError] = useState<string | null>(null)
  const deviceId = useMemo(
    () => user ? getDeviceFingerprint() : undefined,
    [user?.id],
  )
  const persistenceScope = user && deviceId && tabId
    ? `user:${user.id}:device:${deviceId}:tab:${tabId}`
    : undefined
  const legacyPersistenceScope = user && deviceId
    ? `user:${user.id}:device:${deviceId}`
    : undefined
  const route = useMemo(
    () => selectableRoutes(routes).find((r) => r.slug === slug),
    [routes, slug],
  )
  const routeName = route?.name_ka
  const [navPhase, setNavPhase] = useState<NavPhase>(() =>
    slug && tabId && hasSavedExamForSlug(slug, routeName, persistenceScope) ? 'active' : 'preview',
  )
  const [navigationBlocked, setNavigationBlocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    void claimUniqueExamTabId()
      .then((claimedTabId) => {
        if (!cancelled) setTabId(claimedTabId)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const detail = error instanceof Error ? error.message : 'უცნობი შეცდომა'
        setTabIdentityError(`გამოცდის tab-ის იდენტიფიკაცია ვერ მოხერხდა: ${detail}`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (legacyPersistenceScope && persistenceScope && tabId) {
      claimLegacyExamPersistenceScope(legacyPersistenceScope, persistenceScope, tabId)
    }
  }, [legacyPersistenceScope, persistenceScope, tabId])

  const resumeDriving = Boolean(
    slug && hasSavedExamForSlug(slug, routeName, persistenceScope) && navPhase !== 'summary',
  )
  const driving = navPhase === 'active' || resumeDriving

  useEffect(() => {
    if (!slug || navPhase === 'summary') return
    if (hasSavedExamForSlug(slug, routeName, persistenceScope) && navPhase !== 'active') {
      setNavPhase('active')
    }
  }, [slug, routeName, navPhase, persistenceScope])

  if ((deviceBlocked || !hasAccess) && !resumeDriving) return <Navigate to="/" replace />

  if (!route) {
    return (
      <div className="page center">
        <p>მარშრუტი ვერ მოიძებნა</p>
        <Link to="/">უკან</Link>
      </div>
    )
  }

  if (tabIdentityError) {
    return <p role="alert" className="error-text">{tabIdentityError}</p>
  }
  if (!tabId) {
    return <p role="status" className="session-hint">გამოცდის სესიის მომზადება...</p>
  }

  return (
    <div
      className={`route-page route-page--exam${driving ? ' route-page--driving' : ''}${navPhase === 'summary' ? ' route-page--summary' : ''}`}
    >
      {(location.state as { activeExamNavigationBlocked?: boolean } | null)?.activeExamNavigationBlocked && (
        <p role="alert" className="exam-navigation-blocked">
          გთხოვთ, დაასრულოთ მარშრუტი და შემდეგ გამოხვიდეთ.
        </p>
      )}
      {navigationBlocked && (
        <p role="alert" className="exam-navigation-blocked">
          გთხოვთ, დაასრულოთ მარშრუტი და შემდეგ გამოხვიდეთ.
        </p>
      )}
      {navPhase === 'preview' && !resumeDriving && (
        <div className="route-toolbar">
          <Link
            to="/"
            className="ghost"
            onClick={(event) => {
              if (slug && hasSavedExamForSlug(slug, routeName, persistenceScope)) {
                event.preventDefault()
                setNavigationBlocked(true)
              }
            }}
          >
            ← მარშრუტები
          </Link>

          <div className="toolbar-title">
            <strong>{route.name_ka}</strong>
            {route.license_category && (
              <span className="tag tag--category">
                {route.license_category === 'B' && '🚗 B'}
                {route.license_category === 'C' && '🚛 C'}
                {route.license_category === 'C,D' && '🚛🚌 C+D'}
              </span>
            )}
            {route.official_label && <span className="tag">{route.official_label}</span>}
          </div>

          <span className="tag tag--exam">გამოცდა</span>
          <CarFullscreenButton />
        </div>
      )}

      {driving && <CarFullscreenButton floating />}

      <ExamDriveSession
        route={route}
        userId={user?.id}
        deviceId={deviceId}
        tabId={tabId}
        persistenceScope={persistenceScope}
        onPhaseChange={setNavPhase}
        onReturnToMenu={() => navigate('/', { replace: true })}
      />
    </div>
  )
}
