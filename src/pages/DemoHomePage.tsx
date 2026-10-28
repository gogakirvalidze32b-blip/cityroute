/**
 * Demo Home Page - Shows routes without Supabase
 * Navigate to: http://localhost:5173/demo-home
 */

import { Link } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'

const DEMO_ROUTES = [
  { id: 1, name: 'მარშრუტი 1 - თელავი', slug: 'route-1' },
  { id: 2, name: 'მარშრუტი 2 - თელავი', slug: 'route-2' },
  { id: 3, name: 'მარშრუტი 3 - თელავი', slug: 'route-3' },
  { id: 4, name: 'მარშრუტი 4 - თელავი', slug: 'route-4' },
  { id: 5, name: 'მარშრუტი 5 - თელავი', slug: 'route-5' },
]

export function DemoHomePage() {
  return (
    <div className="page home-page">
      <header className="home-header">
        <AppBrand />
        <div style={{ 
          background: '#fff3cd', 
          padding: '0.75rem', 
          borderRadius: '8px',
          marginTop: '1rem',
          fontSize: '0.9rem'
        }}>
          🎨 <strong>DEMO MODE</strong> - UI Preview (საცდელი: 12 საათი · პრემიუმ პაკეტი 99 ₾/თვე)
        </div>
      </header>

      <div className="route-list">
        {DEMO_ROUTES.map((route) => (
          <div key={route.id} className="route-card" style={{ 
            cursor: 'not-allowed',
            opacity: 0.7 
          }}>
            <div>
              <strong>{route.name}</strong>
              <span className="tag">ოფიციალური</span>
            </div>
            <span className="chevron">→</span>
          </div>
        ))}
      </div>

      <footer className="home-footer">
        <p className="home-trial">
          ⏱️ საცდელი: 11 საათი 45 წუთი · პრემიუმ · 99 ₾/თვე
        </p>
        <p className="muted home-meta" style={{ marginTop: '1rem' }}>
          <strong>✅ რა შეიცვალა:</strong>
        </p>
        <ul style={{ 
          textAlign: 'left', 
          maxWidth: '400px', 
          margin: '1rem auto',
          paddingLeft: '1.5rem',
          fontSize: '0.9rem'
        }}>
          <li>ფასი: 50/60/70 ₾ → <strong>99 ₾/თვე</strong></li>
          <li>პაკეტები: 3 ვარიანტი → <strong>1 პრემიუმ</strong></li>
          <li>გადახდა: <strong>TBC & BOG ინტეგრაცია</strong></li>
          <li>UI: <strong>გამარტივებული და თანამედროვე</strong></li>
        </ul>
        
        <div style={{ marginTop: '2rem' }}>
          <Link 
            to="/demo-payment" 
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #2196f3 0%, #1976d2 100%)',
              color: 'white',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: 600,
              marginBottom: '1rem'
            }}
          >
            💳 გადახდის UI ნახვა
          </Link>
        </div>
        
        <Link 
          to="/choose-plan"
          style={{ 
            display: 'block',
            marginTop: '1rem',
            color: '#1976d2',
            textDecoration: 'none'
          }}
        >
          ← Plan Selection-ზე დაბრუნება
        </Link>
      </footer>
    </div>
  )
}
