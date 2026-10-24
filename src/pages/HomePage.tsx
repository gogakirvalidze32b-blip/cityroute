import { Link, Navigate } from 'react-router-dom'

import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'
import { SupportButton, SupportFooterLinks } from '@/components/support/SupportLinks'

import { accessLabel, routeSourceLabel } from '@/types/database'

import { useExamLayoutMode } from '@/hooks/useExamLayoutMode'
import { useRoutes } from '@/hooks/useRoutes'
import { planName } from '@/data/subscription-plans'
import { selectableRoutes } from '@/data/selectable-routes'
import { PREVIEW_TEST_ROUTE_ENABLED } from '@/lib/debug-flags'

export function HomePage() {
  const { profile, hasAccess, deviceBlocked, signOut } = useAuth()
  const { routes, source } = useRoutes()
  const visibleRoutes = selectableRoutes(routes, PREVIEW_TEST_ROUTE_ENABLED)
  const layoutMode = useExamLayoutMode()
  const onTrial = profile?.subscription_status === 'trial' && hasAccess

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

      <div className="route-list" data-testid="home-route-list">
        {visibleRoutes.map((route, index) => (
          <Link 
            key={route.id} 
            to={`/route/${route.slug}`} 
            className={`route-card route-card--${index + 1}`}
            data-testid={`home-route-card-${route.slug}`}
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
        {onTrial && profile && <p className="home-trial">{accessLabel(profile)}</p>}
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
