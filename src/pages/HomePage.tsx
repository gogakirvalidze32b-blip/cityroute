import { Link } from 'react-router-dom'

import { AppBrand } from '@/components/AppBrand'
import { PaymentButton } from '@/components/PaymentButton'
import { useAuth } from '@/context/AuthContext'

import { accessLabel, routeSourceLabel } from '@/types/database'

import { useRoutes } from '@/hooks/useRoutes'
import { planName } from '@/data/subscription-plans'
import { useState } from 'react'

export function HomePage() {
  const { profile, hasAccess, deviceBlocked, signOut } = useAuth()
  const { routes, source } = useRoutes()
  const onTrial = profile?.subscription_status === 'trial' && hasAccess
  const [paymentError, setPaymentError] = useState<string | null>(null)

  function handlePaymentInitiated(paymentId: string, paymentUrl: string) {
    console.log('Payment initiated:', paymentId, paymentUrl)
    // Store payment info if needed
  }

  function handlePaymentError(error: string) {
    setPaymentError(error)
  }

  if (deviceBlocked) {
    return (
      <div className="page center">
        <h1>მოწყობილობა დაბლოკილია</h1>
        <p>{deviceBlocked}</p>
        <p className="muted">1 ანგარიში = 1 მანქანა. მხარდაჭერასთან დაუკავშირდი მოწყობილობის გადატვირთვისთვის.</p>
        <button type="button" onClick={() => void signOut()}>
          გასვლა
        </button>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="page plan-page plan-page--expired">
        <header className="plan-page__header">
          <AppBrand centered />
          <h1>საცდელი პერიოდი დასრულებულია</h1>
          <p className="muted plan-page__lead">
            გააქტიურე გამოწერა - 99 ₾/თვე
          </p>
          {profile && <p className="home-trial">{accessLabel(profile)}</p>}
        </header>

        <div className="plan-summary">
          <h2>პრემიუმ პაკეტი</h2>
          <p className="plan-price">99 ₾/თვე</p>
          <ul className="plan-features">
            <li>GPS ხმოვანი მარშრუტი</li>
            <li>Live რუკა მძღოლობისას</li>
            <li>გამოცდის პანელი</li>
            <li>გადართვა: რუკა ↔ შეცდომები</li>
            <li>ყველა მომავალი ფუნქცია</li>
          </ul>
        </div>

        <footer className="plan-page__footer">
          <p className="payment-instructions">
            აირჩიე გადახდის მეთოდი:
          </p>
          {paymentError && <p className="error-text">{paymentError}</p>}
          
          <div className="payment-buttons">
            <PaymentButton
              provider="tbc"
              amount={99}
              onPaymentInitiated={handlePaymentInitiated}
              onError={handlePaymentError}
            />
            <PaymentButton
              provider="bog"
              amount={99}
              onPaymentInitiated={handlePaymentInitiated}
              onError={handlePaymentError}
            />
          </div>

          <button type="button" className="home-signout" onClick={() => void signOut()}>
            გასვლა
          </button>
        </footer>
      </div>
    )
  }

  return (
    <div className="page home-page">
      <header className="home-header">
        <AppBrand />
      </header>

      <div className="route-list">
        {routes.map((route, index) => (
          <Link 
            key={route.id} 
            to={`/route/${route.slug}`} 
            className={`route-card route-card--${index + 1}`}
          >
            <div className="route-card__content">
              <div className="route-card__number">მარშრუტი {index + 1}</div>
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
        <button type="button" className="home-signout" onClick={() => void signOut()}>
          გასვლა
        </button>
      </footer>
    </div>
  )
}
