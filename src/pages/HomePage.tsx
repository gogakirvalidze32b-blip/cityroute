import { Link } from 'react-router-dom'

import { AppBrand } from '@/components/AppBrand'
import { PaymentButton } from '@/components/PaymentButton'
import { useAuth } from '@/context/AuthContext'

import { accessLabel, routeSourceLabel } from '@/types/database'

import { useRoutes } from '@/hooks/useRoutes'
import { planName, VEHICLE_PACKAGES, type VehiclePackage } from '@/data/subscription-plans'
import { useState } from 'react'

export function HomePage() {
  const { profile, hasAccess, deviceBlocked, signOut } = useAuth()
  const { routes, source } = useRoutes()
  const onTrial = profile?.subscription_status === 'trial' && hasAccess
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState<VehiclePackage>('1-vehicle')

  const selectedPkg = VEHICLE_PACKAGES[selectedPackage]

  function handlePaymentInitiated(paymentId: string, paymentUrl: string) {
    console.log('Payment initiated:', paymentId, paymentUrl)
    // Store selected package info
    localStorage.setItem('cityroute-selected-package', selectedPackage)
    localStorage.setItem('cityroute-payment-amount', selectedPkg.price.toString())
    // Redirect to payment URL
    window.location.href = paymentUrl
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
      <div className="page plan-page plan-page--expired" style={{ background: '#0f172a', overflow: 'hidden', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header className="plan-page__header" style={{ paddingBottom: '1rem', flex: '0 0 auto' }}>
          <AppBrand centered />
          <h1 style={{ color: '#fff', fontSize: '1.6rem', margin: '0.75rem 0 0.5rem', fontWeight: 700 }}>24 საათი ამოიწურა</h1>
          
          <p className="muted plan-page__lead" style={{ 
            color: '#94a3b8', 
            fontSize: '0.9rem', 
            margin: '0 auto 1.25rem',
            textAlign: 'center',
            maxWidth: '550px'
          }}>
            აირჩიე პაკეტი და გააქტიურე გამოწერა
          </p>

          {/* Main container with features + packages */}
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '20px',
            padding: '1.5rem',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
            maxWidth: '650px',
            marginLeft: 'auto',
            marginRight: 'auto',
            border: '1px solid rgba(255, 255, 255, 0.05)'
          }}>
            {/* Features section - vertical single column */}
            <h3 style={{ 
              margin: '0 0 0.75rem 0', 
              fontSize: '1rem', 
              color: '#fff',
              fontWeight: 700,
              textAlign: 'center',
              letterSpacing: '0.5px'
            }}>
              რას მოიცავს პრემიუმი
            </h3>
            <div style={{ 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1.25rem',
              padding: '0 1rem'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.8rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>GPS ნავიგაცია</span>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.8rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>Live რუკა</span>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.8rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>გამოცდის პანელი</span>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.8rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>რუკა ↔ შეცდომები</span>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.8rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>ყველა მომავალი ფუნქცია</span>
              </div>
            </div>

            {/* Package cards - smaller */}
            <div style={{ 
              display: 'flex',
              gap: '0.75rem', 
              justifyContent: 'center'
            }}>
              {(Object.keys(VEHICLE_PACKAGES) as VehiclePackage[]).map((key) => {
                const pkg = VEHICLE_PACKAGES[key]
                const isSelected = selectedPackage === key
                
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedPackage(key)}
                    style={{
                      flex: 1,
                      padding: '1rem 0.5rem',
                      background: isSelected 
                        ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' 
                        : 'rgba(15, 23, 42, 0.6)',
                      border: isSelected ? '2.5px solid #22c55e' : '2px solid rgba(71, 85, 105, 0.5)',
                      borderRadius: '12px',
                      color: '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      position: 'relative',
                      overflow: 'hidden',
                      boxShadow: isSelected 
                        ? '0 8px 28px rgba(34, 197, 94, 0.4)' 
                        : '0 4px 16px rgba(0, 0, 0, 0.2)',
                      transform: isSelected ? 'translateY(-4px) scale(1.03)' : 'scale(1)',
                    }}
                  >
                    {pkg.discount > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '5px',
                        right: '5px',
                        background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                        color: '#fff',
                        fontSize: '0.55rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.35rem',
                        borderRadius: '5px',
                        boxShadow: '0 2px 8px rgba(239, 68, 68, 0.6)',
                      }}>
                        -{pkg.discount}%
                      </div>
                    )}
                    <div style={{ fontSize: '1.4rem', marginBottom: '0.4rem' }}>
                      {pkg.vehicles === 1 ? '🚗' : pkg.vehicles === 2 ? '🚗🚗' : '🚗🚗🚗'}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', opacity: isSelected ? 1 : 0.9 }}>
                      {pkg.label}
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.15rem', letterSpacing: '-0.5px' }}>
                      {pkg.price} ₾
                    </div>
                    <div style={{ fontSize: '0.7rem', opacity: isSelected ? 0.95 : 0.7 }}>
                      {pkg.pricePerVehicle} ₾ თითო
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </header>

        {!showPayment ? (
          // Payment button - no info text below
          <div style={{ padding: '0 1rem 1.5rem', margin: '0 auto', maxWidth: '650px', flex: '0 0 auto' }}>
            <button 
              type="button"
              style={{
                width: '100%',
                padding: '0.95rem',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
                fontSize: '1.05rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(34, 197, 94, 0.45)',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(34, 197, 94, 0.55)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(34, 197, 94, 0.45)'
              }}
              onClick={() => setShowPayment(true)}
            >
              💳 გადახდა - {selectedPkg.price} ₾/თვე
            </button>
          </div>
        ) : (
          // Card payment form directly
          <div style={{ padding: '0 1rem 1.5rem', margin: '0 auto', maxWidth: '650px', flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h2 style={{ 
              color: '#fff', 
              fontSize: '1.3rem', 
              textAlign: 'center', 
              marginBottom: '0.5rem',
              fontWeight: 600
            }}>
              ბარათის მონაცემები
            </h2>
            <p style={{ 
              color: '#94a3b8', 
              textAlign: 'center', 
              marginBottom: '1.5rem',
              fontSize: '1.05rem',
              fontWeight: 600
            }}>
              {selectedPkg.price} ₾/თვე · {selectedPkg.label}
            </p>

            {/* Card input form - TODO */}
            <div style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              padding: '2rem',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              textAlign: 'center',
              color: '#94a3b8',
              marginBottom: '1rem'
            }}>
              <p style={{ fontSize: '3rem', margin: '0 0 1rem' }}>💳</p>
              <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: '#e2e8f0' }}>
                ბარათის შეყვანის ფორმა
              </p>
              <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>
                🏗️ განვითარების პროცესშია
              </p>
              <p style={{ fontSize: '0.85rem', opacity: 0.6, marginTop: '1rem' }}>
                ბარათის ნომერი, ვადა, CVV და მფლობელის სახელი
              </p>
              <p style={{ fontSize: '0.8rem', opacity: 0.5, marginTop: '0.5rem' }}>
                TBC/BOG გადახდის API ინტეგრაცია მალე დაემატება
              </p>
            </div>

            {paymentError && (
              <p style={{ 
                color: '#ef4444', 
                textAlign: 'center', 
                fontSize: '0.9rem',
                padding: '0.75rem',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: '8px',
                marginBottom: '1rem'
              }}>
                {paymentError}
              </p>
            )}

            <button 
              type="button" 
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'transparent',
                border: '2px solid #475569',
                borderRadius: '12px',
                color: '#94a3b8',
                fontSize: '0.95rem',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = '#64748b'
                e.currentTarget.style.color = '#cbd5e1'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = '#475569'
                e.currentTarget.style.color = '#94a3b8'
              }}
              onClick={() => setShowPayment(false)}
            >
              ← უკან
            </button>
          </div>
        )}

        <button type="button" className="home-signout" onClick={() => void signOut()} style={{ margin: '2rem auto', display: 'block' }}>
          გასვლა
        </button>
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
