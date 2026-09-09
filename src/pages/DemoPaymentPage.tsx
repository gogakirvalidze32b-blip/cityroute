/**
 * Demo Payment Page - Shows payment UI without Supabase
 * Navigate to: http://localhost:5173/demo-payment
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'

export function DemoPaymentPage() {
  const [selectedBank, setSelectedBank] = useState<'tbc' | 'bog' | null>(null)

  function handlePayment(bank: 'tbc' | 'bog') {
    setSelectedBank(bank)
    alert(`🎉 Demo Mode!\n\nთქვენ აირჩიეთ: ${bank === 'tbc' ? 'TBC Bank' : 'Bank of Georgia'}\n\nსრული ფუნქციონალისთვის საჭიროა:\n✅ Supabase Edge Functions\n✅ TBC/BOG API credentials`)
  }

  return (
    <div className="page plan-page plan-page--expired">
      <header className="plan-page__header">
        <AppBrand centered />
        <h1>საცდელი პერიოდი დასრულებულია</h1>
        <p className="muted plan-page__lead">
          გააქტიურე გამოწერა - 99 ₾/თვე
        </p>
        <p className="muted" style={{ fontSize: '0.9rem', color: '#ff9800' }}>
          🎨 <strong>DEMO MODE</strong> - UI Preview
        </p>
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
        
        <div className="payment-buttons">
          <button
            type="button"
            className="payment-button"
            onClick={() => handlePayment('bog')}
            data-provider="bog"
          >
            🏦 BOG გადახდა Bank of Georgia-ით
          </button>
        </div>

        <div style={{ 
          marginTop: '2rem', 
          padding: '1rem', 
          background: '#f0f7ff', 
          borderRadius: '8px',
          fontSize: '0.9rem'
        }}>
          <strong>📋 რა შეიცვალა:</strong>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', textAlign: 'left' }}>
            <li>✅ ფასი: 50/60/70 ₾ → <strong>99 ₾</strong></li>
            <li>✅ პაკეტები: 3 პაკეტი → <strong>1 პრემიუმ</strong></li>
            <li>✅ BOG ინტეგრაცია მზადაა</li>
            <li>✅ გადახდის UI განახლებულია</li>
            <li>💡 მომავალში: Credo განვადება</li>
          </ul>
        </div>

        <Link to="/" style={{ 
          display: 'inline-block', 
          marginTop: '1.5rem',
          color: '#1976d2',
          textDecoration: 'none'
        }}>
          ← უკან (Login Page)
        </Link>
      </footer>
    </div>
  )
}
