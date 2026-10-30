import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { ExamDriveSession } from '@/components/ExamDriveSession'
import { selectableRoutes } from '@/data/selectable-routes'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import type { PlanFeatures } from '@/lib/plan-features'
import { hasSavedExamForSlug } from '@/lib/exam-persistence'

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
      </footer>
    </div>
  )
}

function PreviewDemoRoutePage() {
  const { slug } = useParams<{ slug: string }>()
  const route = useMemo(
    () => selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === slug),
    [slug],
  )
  const [navPhase, setNavPhase] = useState<'preview' | 'active' | 'summary'>(() =>
    slug && hasSavedExamForSlug(slug, route?.name_ka, DEMO_SCOPE) ? 'active' : 'preview',
  )
  const resumeDriving = Boolean(
    slug && hasSavedExamForSlug(slug, route?.name_ka, DEMO_SCOPE) && navPhase !== 'summary',
  )
  const driving = navPhase === 'active' || resumeDriving

  useEffect(() => {
    if (!slug || navPhase === 'summary') return
    if (hasSavedExamForSlug(slug, route?.name_ka, DEMO_SCOPE) && navPhase !== 'active') {
      setNavPhase('active')
    }
  }, [slug, route?.name_ka, navPhase])

  if (!route) return <Navigate to="/preview-demo" replace />

  return (
    <div className={`route-page route-page--exam${driving ? ' route-page--driving' : ''}`}>
      {navPhase === 'preview' && !resumeDriving && (
        <div className="route-toolbar">
          <Link to="/preview-demo" className="ghost">← მარშრუტები</Link>
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
        persistenceScope={DEMO_SCOPE}
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
      <Route path="*" element={<Navigate to="/preview-demo" replace />} />
    </Routes>
  )
}
