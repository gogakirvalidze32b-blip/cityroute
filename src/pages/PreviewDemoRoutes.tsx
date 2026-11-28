import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { TermsFooterLink } from '@/components/TermsFooterLink'
import { LoginView } from '@/pages/LoginPage'
import { ExamDriveSession } from '@/components/ExamDriveSession'
import { selectableRoutes } from '@/data/selectable-routes'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import type { PlanFeatures } from '@/lib/plan-features'
import { hasSavedExamForSlug } from '@/lib/exam-persistence'
import { PreviewGpsDemoPanel } from '@/components/PreviewGpsDemoPanel'
import { createPreviewGpsSource } from '@/lib/preview-gps-source'
import type { PreviewDemoControls } from '@/components/ExamDriveSession'

const DEMO_SCOPE = 'preview-demo-user'
const DEMO_FEATURES: PlanFeatures = {
  routeAudio: true,
  mapNav: true,
  errorPanel: true,
  canSwitchViews: true,
}

function PreviewDemoHomePage() {
  const routes = selectableRoutes(TELAVI_ROUTES_FALLBACK)

  return (
    <div className="page home-page">
      <header className="home-header">
        <AppBrand />
        <p className="tag" role="status">DEMO · ადგილობრივი მონაცემები · სინთეზური მომხმარებელი</p>
      </header>

      <div className="route-list" data-testid="demo-route-list">
        {routes.map((route, index) => (
          <Link
            key={route.id}
            to={`/preview-demo/route/${route.slug}`}
            className={`route-card route-card--${index + 1}`}
            data-testid={`demo-route-card-${route.slug}`}
          >
            <div className="route-card__content">
              <strong className="route-card__name">{route.name_ka}</strong>
              <div className="route-card__tags">
                {route.license_category && (
                  <span className="tag tag--category">
                    {route.license_category === 'B' && '🚗 B კატეგორია'}
                    {route.license_category === 'C' && '🚛 C კატეგორია'}
                    {route.license_category === 'C,D' && '🚛🚌 C+D კატეგორია'}
                  </span>
                )}
                {route.official_label && <span className="tag">{route.official_label}</span>}
              </div>
            </div>
            <span className="chevron">→</span>
          </Link>
        ))}
      </div>

      <footer className="home-footer">
        <p className="muted home-meta">Demo progress is stored only in this browser.</p>
        <Link to="/preview-demo/login" className="tag" data-testid="demo-login-preview-link">
          DEMO · შესვლის გვერდი
        </Link>
        <TermsFooterLink />
      </footer>
    </div>
  )
}

/** The real Login screen with demo handlers — nothing signs in or touches the backend. */
function PreviewDemoLoginPage() {
  const demoSignIn = useCallback(async () => DEMO_LOGIN_MESSAGE, [])
  return (
    <>
      <LoginView
        signIn={demoSignIn}
        signInWithGoogle={demoSignIn}
        persistCredentials={false}
      />
      <Link to="/preview-demo" className="tag demo-login-back" data-testid="demo-login-back">
        ← DEMO მარშრუტები
      </Link>
    </>
  )
}

const DEMO_LOGIN_MESSAGE = 'DEMO: ეს მხოლოდ გადახედვაა — შესვლა არ სრულდება.'

function PreviewDemoRoutePage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const route = useMemo(
    () => selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === slug),
    [slug],
  )
  const [navPhase, setNavPhase] = useState<'preview' | 'active' | 'summary'>(() =>
    slug && hasSavedExamForSlug(slug, route?.name_ka, DEMO_SCOPE) ? 'active' : 'preview',
  )
  const [demoControls, setDemoControls] = useState<PreviewDemoControls | null>(null)
  const demoGpsSource = useMemo(() => createPreviewGpsSource(), [slug])
  const receiveDemoControls = useCallback(
    (controls: PreviewDemoControls | null) => setDemoControls(controls),
    [],
  )
  const resumeDriving = Boolean(
    slug && hasSavedExamForSlug(slug, route?.name_ka, DEMO_SCOPE) && navPhase !== 'summary',
  )
  // Keep the route/map shell mounted through Summary so finish does not kick the user off the map.
  const driving = navPhase === 'active' || navPhase === 'summary' || resumeDriving

  useEffect(() => {
    if (!slug || navPhase === 'summary') return
    if (hasSavedExamForSlug(slug, route?.name_ka, DEMO_SCOPE) && navPhase !== 'active') {
      setNavPhase('active')
    }
  }, [slug, route?.name_ka, navPhase])

  if (!route) return <Navigate to="/preview-demo" replace />

  return (
    <div
      className={`route-page route-page--exam${driving ? ' route-page--driving' : ''}${navPhase === 'summary' ? ' route-page--summary' : ''}`}
    >
      <PreviewGpsDemoPanel
        route={route}
        routes={selectableRoutes(TELAVI_ROUTES_FALLBACK)}
        controls={demoControls}
        source={demoGpsSource}
      />
      {navPhase === 'preview' && !resumeDriving && (
        <div className="route-toolbar">
          <Link to="/preview-demo" className="ghost">
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
          </div>
          <span className="tag tag--exam">DEMO</span>
        </div>
      )}

      <ExamDriveSession
        route={route}
        onPhaseChange={setNavPhase}
        onReturnToMenu={() => navigate('/preview-demo', { replace: true })}
        persistenceScope={DEMO_SCOPE}
        previewGpsSource={demoGpsSource}
        onPreviewDemoControls={receiveDemoControls}
        offlineMaps
        planFeaturesOverride={DEMO_FEATURES}
        debugPanels={false}
      />
    </div>
  )
}

export function PreviewDemoRoutes() {
  return (
    <Routes>
      <Route path="/preview-demo" element={<PreviewDemoHomePage />} />
      <Route path="/preview-demo/route/:slug" element={<PreviewDemoRoutePage />} />
      <Route path="/preview-demo/login" element={<PreviewDemoLoginPage />} />
      <Route path="*" element={<Navigate to="/preview-demo" replace />} />
    </Routes>
  )
}
