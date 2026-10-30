import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { PaymentButton } from '@/components/PaymentButton'
import { useAuth } from '@/context/AuthContext'
import { calculatePrice } from '@/data/subscription-plans'
import { accessLabel, isAccessActive } from '@/types/database'
import { useEffect, useState } from 'react'
import './subscription-page.css'

const VEHICLE_OPTIONS = [1, 2] as const

export function PlanSelectionPage() {
  const { user, loading, hasAccess, needsPlanSelection, profile, entitlement, entitlementStatusUnavailable, deviceBlocked, refreshProfile, selectPlan, signOut } = useAuth()
  const [deviceSlots, setDeviceSlots] = useState<1 | 2>(profile?.device_slots === 2 ? 2 : 1)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checkingSession, setCheckingSession] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (profile?.device_slots === 1 || profile?.device_slots === 2) {
      setDeviceSlots(profile.device_slots)
    }
  }, [profile?.device_slots])

  if (!loading && !user) return <Navigate to="/login" replace />

  const chosen = 'premium'
  const isFirstPick = needsPlanSelection
  const trialActive =
    entitlement?.source === 'trial' &&
    profile?.subscription_status === 'trial' &&
    new Date(profile.subscription_expires_at).getTime() > Date.now()
  const activeSubscription =
    profile?.subscription_status === 'active' && isAccessActive(profile)
  const paidSubscriptionActive = activeSubscription && entitlement?.source === 'paid'
  const legacySubscriptionActive = activeSubscription && entitlement?.source === 'legacy'
  const paymentUnverified =
    activeSubscription &&
    entitlement?.source === 'inactive' &&
    entitlement.paymentStatus !== null
  const activeTrial = trialActive && hasAccess
  const earlyPayment = new URLSearchParams(location.search).get('earlyPayment') === '1'
  const totalPrice = calculatePrice(chosen, deviceSlots)

  async function onContinue() {
    setSubmitting(true)
    setError(null)
    try {
      const selectError = await selectPlan('premium')
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

  async function handleSignOut() {
    setSignOutError(null)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (signOutFailure) {
      console.error('Sign out from plan selection failed:', signOutFailure)
      setSignOutError('ანგარიშიდან გასვლა ვერ მოხერხდა. სცადე თავიდან.')
    }
  }

  async function retrySessionCheck() {
    setCheckingSession(true)
    try {
      await refreshProfile()
    } finally {
      setCheckingSession(false)
    }
  }

  return (
    <main className="subscription-page">
      <div className="subscription-layout">
        <section className="subscription-intro">
          <AppBrand centered />
          <h1 className="subscription-title">CityRoute <span>Premium</span></h1>
          <p className="subscription-hero__subtitle">მოამზადე მოსწავლე მართვის პრაქტიკული გამოცდისთვის</p>
          <p className="subscription-hero__description">
            CityRoute ინსტრუქტორებს ეხმარება მოსწავლეები ქალაქ თელავში პრაქტიკული მართვის გამოცდისთვის მოამზადონ.
          </p>

          {entitlementStatusUnavailable ? (
            <div className="subscription-status subscription-status--expired" role="status">
              <span className="subscription-status__icon" aria-hidden="true">!</span>
              <div>
                <strong>გეგმის სტატუსი სერვერზე ვერ მოწმდება</strong>
                <p>
                  {hasAccess
                    ? 'მიმდინარე წვდომა შენარჩუნებულია, თუმცა Trial, Premium და გადახდის სტატუსი დაუდასტურებელია.'
                    : 'Trial, Premium და გადახდის სტატუსი ვერ დადასტურდა. გთხოვთ, მოგვიანებით სცადოთ ხელახლა.'}
                </p>
              </div>
            </div>
          ) : trialActive ? (
            <div className="subscription-status subscription-status--trial">
              <span className="subscription-status__icon" aria-hidden="true">12</span>
              <div>
                <strong>უფასო Trial აქტიურია</strong>
                <p>{profile ? accessLabel(profile) : 'Trial რეგისტრაციისას დაიწყო'}</p>
              </div>
            </div>
          ) : paidSubscriptionActive ? (
            <div className="subscription-status subscription-status--active">
              <span className="subscription-status__icon" aria-hidden="true">✓</span>
              <div>
                <strong>გადახდილი Premium აქტიურია</strong>
                <p>{profile ? accessLabel(profile) : 'Premium აქტიურია'}</p>
              </div>
            </div>
          ) : legacySubscriptionActive ? (
            <div className="subscription-status subscription-status--active">
              <span className="subscription-status__icon" aria-hidden="true">✓</span>
              <div>
                <strong>ძველი გამოწერა აქტიურია</strong>
                <p>{profile ? accessLabel(profile) : 'არსებული წვდომა აქტიურია'}</p>
              </div>
            </div>
          ) : paymentUnverified ? (
            <div className="subscription-status subscription-status--expired">
              <span className="subscription-status__icon" aria-hidden="true">!</span>
              <div>
                <strong>გადახდა ვერ დადასტურდა</strong>
                <p>Premium წვდომა ჩაირთვება მხოლოდ წარმატებული გადახდის დადასტურების შემდეგ.</p>
              </div>
            </div>
          ) : (
            <div className="subscription-status subscription-status--expired">
              <span className="subscription-status__icon" aria-hidden="true">↻</span>
              <div>
                <strong>გააქტიურე Premium</strong>
                <p>{profile ? accessLabel(profile) : 'აირჩიე პაკეტი და გააგრძელე'}</p>
              </div>
            </div>
          )}
          {deviceBlocked && (
            <>
              <p className="subscription-error" role="alert">
                {activeSubscription ? 'გამოწერა აქტიურია, მაგრამ სესიის შემოწმება ვერ დასრულდა' : 'მოწყობილობა დაბლოკილია'}:
                {' '}{deviceBlocked}
              </p>
              {activeSubscription && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={checkingSession}
                  onClick={() => void retrySessionCheck()}
                >
                  {checkingSession ? 'სესია მოწმდება...' : 'სესიის ხელახლა შემოწმება'}
                </button>
              )}
            </>
          )}
          <ul className="subscription-benefits">
            <li><span aria-hidden="true">✓</span> საგამოცდო მარშრუტები — ქალაქი თელავი</li>
            <li><span aria-hidden="true">✓</span> ხმოვანი მითითებები გზაზე</li>
            <li><span aria-hidden="true">✓</span> მოსწავლის მომზადება რეალურ მარშრუტებზე</li>
            <li><span aria-hidden="true">✓</span> მოსახერხებელი GPS ნავიგაცია</li>
          </ul>

          {activeTrial && (
            <button
              type="button"
              className="subscription-trial-button"
              disabled={submitting}
              onClick={continueToRoutes}
            >
              {submitting ? 'ინახება...' : 'მარშრუტებზე გადასვლა'}
            </button>
          )}
          {entitlementStatusUnavailable && hasAccess && (
            <button
              type="button"
              className="subscription-trial-button"
              onClick={() => navigate('/')}
            >
              მარშრუტებზე გადასვლა
            </button>
          )}
          {earlyPayment && activeTrial && (
            <p className="subscription-early-payment-note">
              Premium-ის შეძენა შეგიძლია Trial-ის დასრულებამდე; მარშრუტებზე წვდომა აქტიური დარჩება.
            </p>
          )}
        </section>

        <section className="subscription-checkout" aria-labelledby="subscription-checkout-title">
          <div className="subscription-checkout__body">
            <h2 id="subscription-checkout-title">რამდენი ავტომობილისთვის?</h2>
            <div className="subscription-options" role="radiogroup" aria-label="მანქანების რაოდენობა">
              {VEHICLE_OPTIONS.map((slots) => {
                const optionPrice = calculatePrice('premium', slots)
                return (
                  <button
                    key={slots}
                    type="button"
                    role="radio"
                    aria-checked={deviceSlots === slots}
                    className={`subscription-option${deviceSlots === slots ? ' is-selected' : ''}`}
                    onClick={() => setDeviceSlots(slots)}
                  >
                    <span className="subscription-option__icon" aria-hidden="true">
                      {slots === 1 ? '🚗' : '🚗🚗'}
                    </span>
                    <span className="subscription-option__copy">
                      <strong>{slots} მანქანა</strong>
                      <small>30 დღე · {slots} მოწყობილობა</small>
                    </span>
                    <span className="subscription-option__price">{optionPrice} ₾</span>
                  </button>
                )
              })}
            </div>
            <p className="subscription-disclaimer">
              1 ანგარიში (ერთი ელფოსტა) = მაქსიმუმ {deviceSlots} მოწყობილობა
            </p>
            <div className="subscription-total">
              <span>არჩეული პაკეტი</span>
              <strong>{totalPrice} ₾ <small>/ 30 დღე</small></strong>
            </div>
            {error && <p className="subscription-error" role="alert">{error}</p>}
            <PaymentButton deviceSlots={deviceSlots} onError={setError} />
            {!entitlementStatusUnavailable && (
              <>
                <p className="subscription-trial-copy">ან გააგრძელე 12-საათიანი უფასო საცდელი პერიოდით:</p>
                <button
                  type="button"
                  className="subscription-trial-button"
                  disabled={submitting}
                  onClick={() => void onContinue()}
                >
                  {submitting ? 'ინახება...' : '12 საათიანი უფასო წვდომის დაწყება'}
                </button>
              </>
            )}
            {signOutError && <p className="subscription-error" role="alert">{signOutError}</p>}
            <button type="button" className="subscription-signout" onClick={() => void handleSignOut()}>
              ანგარიშიდან გასვლა
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
