import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'
import { type SubscriptionPlan } from '@/data/subscription-plans'
import { useEffect, useState } from 'react'

export function PlanSelectionPage() {
  const { user, loading, hasAccess, needsPlanSelection, profile, selectPlan } = useAuth()
  const [selected, setSelected] = useState<SubscriptionPlan>(profile?.subscription_plan ?? 'premium')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (profile?.subscription_plan) setSelected(profile.subscription_plan)
  }, [profile?.subscription_plan])

  if (!loading && !user) return <Navigate to="/login" replace />
  if (!loading && user && !hasAccess) return <Navigate to="/" replace />

  const chosen = 'premium'
  const isFirstPick = needsPlanSelection

  async function onContinue() {
    if (!user) {
      setError('გთხოვთ გაიაროთ ავტორიზაცია')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await selectPlan(chosen)
      navigate('/')
    } catch (err) {
      console.error('Plan selection failed:', err)
      setError(err instanceof Error ? err.message : 'დაფიქსირდა შეცდომა')
      setSubmitting(false)
    }
  }

  return (
    <div className="page plan-page">
      <header className="plan-page__header">
        <AppBrand centered />
        <h1>პრემიუმ პაკეტი</h1>
        <p className="muted plan-page__lead">
          ინსტრუქტორისთვის · <strong>24 საათი უფასოდ</strong> · შემდეგ 99 ₾/თვე
        </p>
      </header>

      <div className="plan-summary">
        <h2>სრული ფუნქციონალი</h2>
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
        {error && <p className="error-text">{error}</p>}
        <button type="button" className="primary plan-page__cta" disabled={submitting} onClick={() => void onContinue()}>
          {submitting ? 'ინახება...' : isFirstPick ? 'საცდელის დაწყება' : 'შენახვა'}
        </button>
        {!isFirstPick && (
          <Link to="/" className="plan-page__back">
            ← მარშრუტებზე დაბრუნება
          </Link>
        )}
        <p className="muted plan-page__fine">1 ანგარიში = 1 მანქანა</p>
      </footer>
    </div>
  )
}
