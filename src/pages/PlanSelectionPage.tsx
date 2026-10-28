import { Navigate, useNavigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { PaymentButton } from '@/components/PaymentButton'
import { useAuth } from '@/context/AuthContext'
import { calculatePrice } from '@/data/subscription-plans'
import { accessLabel } from '@/types/database'
import { useEffect, useState } from 'react'

export function PlanSelectionPage() {
  const { user, loading, hasAccess, needsPlanSelection, profile, selectPlan } = useAuth()
  const [deviceSlots, setDeviceSlots] = useState<1 | 2>(profile?.device_slots === 2 ? 2 : 1)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (profile?.device_slots === 1 || profile?.device_slots === 2) {
      setDeviceSlots(profile.device_slots)
    }
  }, [profile?.device_slots])

  if (!loading && !user) return <Navigate to="/login" replace />
  if (!loading && user && !hasAccess) return <Navigate to="/" replace />

  const chosen = 'premium'
  const isFirstPick = needsPlanSelection
  const activeTrial = profile?.subscription_status === 'trial' && hasAccess
  const totalPrice = calculatePrice(chosen, deviceSlots)

  async function onContinue() {
    setSubmitting(true)
    setError(null)
    try {
      const selectError = await selectPlan('premium', deviceSlots)
      if (selectError) {
        setError(selectError)
        return
      }
      navigate('/')
    } catch (selectError) {
      console.error('Premium trial selection failed:', selectError)
      setError('პაკეტის შენახვა ვერ მოხერხდა. სცადე თავიდან.')
    } finally {
      setSubmitting(false)
    }
  }

  function continueToRoutes() {
    if (isFirstPick) {
      void onContinue()
      return
    }
    navigate('/')
  }

  return (
    <div className="page plan-page plan-page--premium">
      <div className="premium-layout">
        <section className="premium-intro">
          <header className="premium-intro__header">
            <AppBrand centered />
            <h1>CityRoute <span>Premium</span></h1>
            <p className="premium-intro__subtitle">მოამზადე მოსწავლე მართვის პრაქტიკული გამოცდისთვის</p>
            <p className="premium-intro__trial-summary">
              <strong>12 საათი უფასოდ</strong> · შემდეგ {totalPrice} ₾/თვე
            </p>
            <p className="premium-intro__description">
              CityRoute ინსტრუქტორებს ეხმარება მოსწავლეები ქალაქ თელავში პრაქტიკული მართვის გამოცდისთვის მოამზადონ.
            </p>
          </header>

          {activeTrial && profile && (
            <div className="premium-trial-status">
              <span className="premium-trial-status__icon" aria-hidden="true">✓</span>
              <div>
                <strong>უფასო Trial აქტიურია</strong>
                <p>{accessLabel(profile)}</p>
              </div>
            </div>
          )}

          <ul className="premium-benefits">
            <li>საგამოცდო მარშრუტები — ქალაქი თელავი</li>
            <li>ხმოვანი მითითებები გზაზე</li>
            <li>მოსწავლის მომზადება რეალურ მარშრუტებზე</li>
            <li>მოსახერხებელი GPS ნავიგაცია</li>
          </ul>

          {activeTrial && (
            <button
              type="button"
              className="premium-routes-button"
              disabled={submitting}
              onClick={continueToRoutes}
            >
              {submitting ? 'ინახება...' : 'მარშრუტებზე გადასვლა'}
              {!submitting && <span aria-hidden="true">→</span>}
            </button>
          )}
        </section>

        <section className="premium-checkout" aria-labelledby="premium-checkout-title">
          <h2 id="premium-checkout-title">რამდენი ავტომობილისთვის?</h2>
          <div className="device-selector">
            <div className="device-selector__buttons">
              <button
                type="button"
                className={`device-btn ${deviceSlots === 1 ? 'device-btn--active' : ''}`}
                aria-pressed={deviceSlots === 1}
                onClick={() => setDeviceSlots(1)}
              >
                <span className="device-btn__icon" aria-hidden="true">🚗</span>
                <strong>1 მანქანა</strong>
                <span className="device-btn__price">99 ₾ / 30 დღე</span>
              </button>
              <button
                type="button"
                className={`device-btn ${deviceSlots === 2 ? 'device-btn--active' : ''}`}
                aria-pressed={deviceSlots === 2}
                onClick={() => setDeviceSlots(2)}
              >
                <span className="device-btn__icon" aria-hidden="true">🚗🚗</span>
                <strong>2 მანქანა</strong>
                <span className="device-btn__price">179 ₾ / 30 დღე</span>
              </button>
            </div>
          </div>

          <p className="premium-checkout__device-note">
            1 ანგარიში (ერთი ელფოსტა) = მაქსიმუმ {deviceSlots} მოწყობილობა
          </p>
          <div className="premium-total">
            <span>არჩეული პაკეტი</span>
            <strong>{totalPrice} ₾ <small>/ 30 დღე</small></strong>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <PaymentButton deviceSlots={deviceSlots} onError={setError} />
          <p className="premium-checkout__trial-copy">ან გააგრძელე 12-საათიანი უფასო საცდელი პერიოდით:</p>
          <button
            type="button"
            className="primary plan-page__cta premium-cta"
            disabled={submitting}
            onClick={() => void onContinue()}
          >
            {submitting ? 'ინახება...' : '12 საათიანი უფასო წვდომის დაწყება'}
          </button>
          <p className="muted plan-page__fine">ანგარიშიდან გასვლით შეგიძლია სხვა მოწყობილობაზე შესვლა</p>
        </section>
      </div>
    </div>
  )
}
