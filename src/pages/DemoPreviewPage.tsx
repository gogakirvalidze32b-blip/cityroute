/**
 * Demo Preview Page - See UI without authentication
 * Navigate to: http://localhost:5173/demo-preview
 */

import { AppBrand } from '@/components/AppBrand'
import { useState } from 'react'

type DemoView = 'home' | 'expired' | 'payment'

const DEMO_ROUTES = [
  { id: 1, name: 'მარშრუტი 1', tag: 'ოფიციალური' },
  { id: 2, name: 'მარშრუტი 2', tag: 'ოფიციალური' },
  { id: 3, name: 'მარშრუტი 3', tag: 'ოფიციალური' },
  { id: 4, name: 'მარშრუტი 4', tag: 'ოფიციალური' },
  { id: 5, name: 'მარშრუტი 5', tag: 'ოფიციალური' },
]

export function DemoPreviewPage() {
  const [view, setView] = useState<DemoView>('home')
  const [showPayments, setShowPayments] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState(1)

  // Home page with trial active
  if (view === 'home') {
    return (
      <div className="page home-page">
        <div style={{ background: '#fef3c7', padding: '0.75rem', textAlign: 'center', fontSize: '0.9rem', fontWeight: 600 }}>
          🎨 DEMO PREVIEW - UI გადახედვა
        </div>

        <header className="home-header">
          <AppBrand />
        </header>

        <div className="route-list">
          {DEMO_ROUTES.map((route, index) => (
            <div key={route.id} className={`route-card route-card--${index + 1}`} style={{ cursor: 'default' }}>
              <div className="route-card__content">
                <div className="route-card__number">მარშრუტი {index + 1}</div>
                <strong className="route-card__name">{route.name}</strong>
                {route.tag && <span className="tag">{route.tag}</span>}
              </div>
              <span className="chevron">→</span>
            </div>
          ))}
        </div>

        <footer className="home-footer">
          <p className="home-trial">⏱️ საცდელი: 23 საათი 15 წუთი · პრემიუმ · 99 ₾/თვე</p>
          <p className="muted home-meta">პრემიუმ · თელავი</p>
          <button type="button" className="home-signout">გასვლა</button>
        </footer>

        <div style={{ position: 'fixed', bottom: '20px', right: '20px', display: 'flex', gap: '10px', zIndex: 1000 }}>
          <button 
            onClick={() => setView('expired')}
            style={{ 
              padding: '0.75rem 1rem', 
              background: '#ef4444', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            ⏱️ Trial-ის ამოწურვა
          </button>
        </div>
      </div>
    )
  }

  // Expired trial - payment screen
  if (view === 'expired' || view === 'payment') {
    return (
      <div className="page plan-page plan-page--expired" style={{ background: '#0f172a' }}>
        <div style={{ background: '#fef3c7', padding: '0.75rem', textAlign: 'center', fontSize: '0.9rem', fontWeight: 600 }}>
          🎨 DEMO PREVIEW - გადახდის გვერდი
        </div>

        <header className="plan-page__header" style={{ paddingBottom: '1rem' }}>
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
            padding: '2rem 1.5rem',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
            maxWidth: '650px',
            marginLeft: 'auto',
            marginRight: 'auto',
            border: '1px solid rgba(255, 255, 255, 0.05)'
          }}>
            {/* Features section - vertical single column */}
            <h3 style={{ 
              margin: '0 0 1rem 0', 
              fontSize: '1.1rem', 
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
              gap: '0.6rem',
              marginBottom: '1.75rem',
              padding: '0 1rem'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.875rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1.1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>GPS ნავიგაცია</span>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.875rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1.1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>Live რუკა</span>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.875rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1.1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>გამოცდის პანელი</span>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.875rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1.1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>რუკა ↔ შეცდომები</span>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.875rem',
                color: '#e2e8f0'
              }}>
                <span style={{ fontSize: '1.1rem', color: '#22c55e', flexShrink: 0 }}>✓</span>
                <span style={{ fontWeight: 500 }}>ყველა მომავალი ფუნქცია</span>
              </div>
            </div>

            {/* Package cards - smaller */}
            <div style={{ 
              display: 'flex',
              gap: '0.75rem', 
              justifyContent: 'center'
            }}>
              {[
                { id: 1, vehicles: 1, label: '1 მანქანა', price: 99, perVehicle: 99, discount: 0 },
                { id: 2, vehicles: 2, label: '2 მანქანა', price: 180, perVehicle: 90, discount: 10 },
                { id: 3, vehicles: 3, label: '3 მანქანა', price: 250, perVehicle: 83, discount: 15 },
              ].map((pkg) => {
                const isSelected = selectedPackage === pkg.id
                
                return (
                  <button
                    key={pkg.id}
                    onClick={() => setSelectedPackage(pkg.id)}
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
                      {pkg.perVehicle} ₾ თითო
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </header>

        {!showPayments ? (
          // Payment section - direct to card entry
          <div style={{ padding: '0 1rem 1.5rem', margin: '0 auto', maxWidth: '600px' }}>
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
                transition: 'all 0.3s ease',
                marginBottom: '0.75rem'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(34, 197, 94, 0.55)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(34, 197, 94, 0.45)'
              }}
              onClick={() => {
                // TODO: Direct payment - show card entry form
                alert(`💳 გადახდის ფორმა\n\nთანხა: ${selectedPackage === 1 ? 99 : selectedPackage === 2 ? 180 : 250} ₾/თვე\nპაკეტი: ${selectedPackage} მანქანა\n\n🏗️ ბარათის მონაცემების შეყვანის ფორმა მალე დაემატება`)
              }}
            >
              💳 გადახდა - {selectedPackage === 1 ? 99 : selectedPackage === 2 ? 180 : 250} ₾/თვე
            </button>

            <div style={{ 
              textAlign: 'center', 
              color: '#94a3b8', 
              fontSize: '0.8rem',
              padding: '0.6rem',
              background: 'rgba(30, 41, 59, 0.6)',
              borderRadius: '10px',
              backdropFilter: 'blur(10px)'
            }}>
              <p style={{ margin: 0, fontWeight: 500 }}>
                {selectedPackage} მოწყობილობა · 24 საათიანი trial უფასოდ
              </p>
            </div>
          </div>
        ) : (
          // Card payment form - TODO: implement card entry
          <div style={{ padding: '0 1rem 1.5rem', margin: '0 auto', maxWidth: '600px' }}>
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
              {selectedPackage === 1 ? 99 : selectedPackage === 2 ? 180 : 250} ₾/თვე · {selectedPackage} მანქანა
            </p>

            <div style={{
              background: '#1e293b',
              padding: '2rem',
              borderRadius: '12px',
              textAlign: 'center',
              color: '#94a3b8'
            }}>
              <p style={{ fontSize: '3rem', margin: '0 0 1rem' }}>💳</p>
              <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                ბარათის შეყვანის ფორმა
              </p>
              <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>
                🏗️ განვითარების პროცესშია
              </p>
              <p style={{ fontSize: '0.85rem', opacity: 0.6, marginTop: '1rem' }}>
                ინტეგრაცია TBC/BOG გადახდის API-თან მალე დაემატება
              </p>
            </div>

            <button 
              type="button" 
              style={{
                width: '100%',
                marginTop: '1.5rem',
                padding: '0.75rem',
                background: 'transparent',
                border: '2px solid #475569',
                borderRadius: '12px',
                color: '#94a3b8',
                fontSize: '0.95rem',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
              }}
              onClick={() => setShowPayments(false)}
            >
              ← უკან პაკეტებზე
            </button>
          </div>
        )}

        <div style={{ position: 'fixed', bottom: '20px', right: '20px', display: 'flex', gap: '10px', zIndex: 1000 }}>
          <button 
            onClick={() => setView('home')}
            style={{ 
              padding: '0.75rem 1rem', 
              background: '#22c55e', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            🏠 Home-ზე დაბრუნება
          </button>
        </div>
      </div>
    )
  }

  return null
}
