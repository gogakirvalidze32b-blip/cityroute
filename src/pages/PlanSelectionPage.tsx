import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'
import { type SubscriptionPlan, calculatePrice } from '@/data/subscription-plans'
import { useEffect, useState } from 'react'

export function PlanSelectionPage() {
  const { user, loading, hasAccess, needsPlanSelection, profile, selectPlan } = useAuth()
  const [selected, setSelected] = useState<SubscriptionPlan>(profile?.subscription_plan ?? 'premium')
  const [deviceSlots, setDeviceSlots] = useState(profile?.device_slots ?? 1)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (profile?.subscription_plan) setSelected(profile.subscription_plan)
    if (profile?.device_slots) setDeviceSlots(profile.device_slots)
  }, [profile?.subscription_plan, profile?.device_slots])

  if (!loading && !user) return <Navigate to="/login" replace />
  if (!loading && user && !hasAccess) return <Navigate to="/" replace />

  const chosen = 'premium'
  const isFirstPick = needsPlanSelection
  const totalPrice = calculatePrice(chosen, deviceSlots)

  async function onContinue() {
    // Start 24-hour trial with selected device slots
    navigate('/')
  }

  return (
    <div className="page plan-page">
      <header className="plan-page__header">
        <AppBrand centered />
        <h1>პრემიუმ პაკეტი</h1>
        <p className="muted plan-page__lead">
          <strong>24 საათი უფასოდ</strong> · შემდეგ {totalPrice} ₾/თვე
        </p>
      </header>

      <div className="device-selector">
        <p className="device-selector__label">რამდენ მანქანაზე გინდა გამოყენება?</p>
        <div className="device-selector__buttons">
          <button
            type="button"
            className={`device-btn ${deviceSlots === 1 ? 'device-btn--active' : ''}`}
            onClick={() => setDeviceSlots(1)}
          >
            <span className="device-btn__icon">🚗</span>
            <strong>1 მანქანა</strong>
            <span className="device-btn__price">99 ₾/თვე</span>
          </button>
          <button
            type="button"
            className={`device-btn ${deviceSlots === 2 ? 'device-btn--active' : ''}`}
            onClick={() => setDeviceSlots(2)}
          >
            <span className="device-btn__icon">🚗🚗</span>
            <strong>2 მანქანა</strong>
            <span className="device-btn__price">198 ₾/თვე</span>
          </button>
          <button
            type="button"
            className={`device-btn ${deviceSlots === 3 ? 'device-btn--active' : ''}`}
            onClick={() => setDeviceSlots(3)}
          >
            <span className="device-btn__icon">🚗🚗🚗</span>
            <strong>3 მანქანა</strong>
            <span className="device-btn__price">297 ₾/თვე</span>
          </button>
        </div>
        <p className="device-selector__note">1 ანგარიში (ერთი ემაილი) = {deviceSlots} მოწყობილობა</p>
      </div>

      <div className="plan-summary">
        <h2>სრული ფუნქციონალი</h2>
        <p className="plan-price">{totalPrice} ₾/თვე</p>
        <ul className="plan-features">
          <li>GPS ხმოვანი მარშრუტი</li>
          <li>Live რუკა მძღოლობისას</li>
          <li>გამოცდის პანელი</li>
          <li>გადართვა: რუკა ↔ შეცდომები</li>
          <li>ყველა მომავალი ფუნქცია</li>
        </ul>
      </div>

      <footer className="plan-page__footer">
        {error && <p className="error-text">{error}</p>}
        <button type="button" className="primary plan-page__cta premium-cta" disabled={submitting} onClick={() => void onContinue()}>
          {submitting ? 'ინახება...' : '🚀 24 საათიანი უფასო წვდომის დაწყება'}
        </button>
        {!isFirstPick && (
          <Link to="/" className="plan-page__back">
            ← მარშრუტებზე დაბრუნება
          </Link>
        )}
        <p className="muted plan-page__fine">ანგარიშიდან გასვლით შეგიძლია სხვა მოწყობილობაზე შესვლა</p>
      </footer>
    </div>
  )
}
