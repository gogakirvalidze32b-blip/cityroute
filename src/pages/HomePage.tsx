import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useState } from 'react'

import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'
import { SupportButton, SupportFooterLinks } from '@/components/support/SupportLinks'

import { accessLabel, routeSourceLabel } from '@/types/database'

import { useExamLayoutMode } from '@/hooks/useExamLayoutMode'
import { useRoutes } from '@/hooks/useRoutes'
import { planName } from '@/data/subscription-plans'
import { selectableRoutes } from '@/data/selectable-routes'
import { hasSavedExamForSlug } from '@/lib/exam-persistence'

export function HomePage() {
  const { profile, hasAccess, deviceBlocked, signOut } = useAuth()
  const { routes, source } = useRoutes()
  const visibleRoutes = selectableRoutes(routes)
  const navigate = useNavigate()
  const layoutMode = useExamLayoutMode()
  const onTrial = profile?.subscription_status === 'trial' && hasAccess
  const [selectionMode, setSelectionMode] = useState<'automatic' | 'manual'>('automatic')
  const [selectedRouteSlug, setSelectedRouteSlug] = useState<string | null>(null)
  const routeToStart = selectionMode === 'automatic'
    ? visibleRoutes.find((route) => hasSavedExamForSlug(route.slug, route.name_ka)) ?? visibleRoutes[0]
    : visibleRoutes.find((route) => route.slug === selectedRouteSlug)

  function handleStartExam() {
    if (routeToStart) navigate(`/route/${routeToStart.slug}`)
  }

  if (deviceBlocked) {
    return (
      <div className="page center">
        <h1>მოწყობილობა დაბლოკილია</h1>
        <p>{deviceBlocked}</p>
        <p className="muted">1 ანგარიში = მაქსიმუმ 2 მანქანა. მხარდაჭერასთან დაუკავშირდი მოწყობილობის გადატვირთვისთვის.</p>
        <SupportButton />
        <button type="button" onClick={() => void signOut()}>
          გასვლა
        </button>
      </div>
    )
  }

  if (!hasAccess) return <Navigate to="/choose-plan" replace />

  return (
    <div className={`page home-page home-page--${layoutMode}`}>
      <header className="home-header">
        <AppBrand />
      </header>

      <main className="home-exam-start">
        <div className="home-mode-controls" role="group" aria-label="PIN-ის არჩევის რეჟიმი">
          <button
            type="button"
            className={`home-mode-button${selectionMode === 'automatic' ? ' is-active' : ''}`}
            aria-pressed={selectionMode === 'automatic'}
            onClick={() => setSelectionMode('automatic')}
          >
            PIN-ის არჩევა ავტომატურად
          </button>
          <button
            type="button"
            className={`home-mode-button${selectionMode === 'manual' ? ' is-active' : ''}`}
            aria-pressed={selectionMode === 'manual'}
            onClick={() => setSelectionMode('manual')}
          >
            PIN-ის არჩევა ხელით
          </button>
        </div>

        {selectionMode === 'manual' && (
          <div className="route-list" data-testid="home-route-list">
            {visibleRoutes.map((route, index) => (
              <button
                key={route.id}
                type="button"
                className={`route-card route-card--${index + 1}${selectedRouteSlug === route.slug ? ' is-selected' : ''}`}
                data-testid={`home-route-card-${route.slug}`}
                aria-pressed={selectedRouteSlug === route.slug}
                onClick={() => setSelectedRouteSlug(route.slug)}
              >
                <span className="route-card__content">
                  <strong className="route-card__name">{route.name_ka}</strong>
                  <span className="route-card__tags">
                    {route.license_category && (
                      <span className="tag tag--category">
                        {route.license_category === 'B' && '🚗 B კატეგორია'}
                        {route.license_category === 'C' && '🚛 C კატეგორია'}
                        {route.license_category === 'C,D' && '🚛🚌 C+D კატეგორია'}
                      </span>
                    )}
                    {route.official_label && <span className="tag">{route.official_label}</span>}
                  </span>
                </span>
                <span className="chevron" aria-hidden="true">
                  {selectedRouteSlug === route.slug ? '✓' : '→'}
                </span>
              </button>
            ))}
            {visibleRoutes.length === 0 && <p className="muted">მარშრუტები იტვირთება...</p>}
          </div>
        )}

        {selectionMode === 'automatic' && (
          <p className="home-start-hint">
            შენახული გამოცდა გაგრძელდება; ახალი გამოცდისთვის აირჩევა მარშრუტი 1.
          </p>
        )}
        <button
          type="button"
          className="home-start-button"
          onClick={handleStartExam}
          disabled={!routeToStart}
        >
          გამოცდის დაწყება
        </button>
      </main>

      <footer className="home-footer">
        {onTrial && profile && <p className="home-trial">{accessLabel(profile)}</p>}
        {onTrial && (
          <Link
            to="/choose-plan?earlyPayment=1"
            className="home-early-payment"
            data-testid="home-early-payment"
          >
            Premium-ის შეძენა ვადის ამოწურვამდე
          </Link>
        )}
        <p className="muted home-meta">
          {!onTrial && profile && accessLabel(profile)}
          {!onTrial && profile && ' · '}
          {profile?.subscription_plan && planName(profile.subscription_plan)}
          {profile?.subscription_plan && ' · '}
          {routeSourceLabel(source)}
        </p>
        <SupportButton />
        <button type="button" className="home-signout" onClick={() => void signOut()}>
          გასვლა
        </button>
        <SupportFooterLinks />
      </footer>
    </div>
  )
}
