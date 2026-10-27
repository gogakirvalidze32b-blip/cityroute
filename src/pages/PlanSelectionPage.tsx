import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { PaymentButton } from '@/components/PaymentButton'
import { SupportFooterLinks } from '@/components/support/SupportLinks'
import { useAuth } from '@/context/AuthContext'
import { calculatePrice } from '@/data/subscription-plans'
import { accessLabel, trialExpiresAt } from '@/types/database'
import './subscription-page.css'

const VEHICLE_OPTIONS = [1, 2] as const
type PreviewMode = 'trial' | 'expired' | 'blocked-trial'

export function PlanSelectionPage({ previewMode }: { previewMode?: PreviewMode } = {}) {
  const {
    user,
    loading,
    hasAccess,
    needsPlanSelection,
    profile,
    deviceBlocked,
    selectPackage,
    signOut,
  } = useAuth()
  const [deviceSlots, setDeviceSlots] = useState<1 | 2>(profile?.device_slots === 2 ? 2 : 1)
  const [error, setError] = useState<string | null>(null)
  const [previewNotice, setPreviewNotice] = useState<string | null>(null)
  const [trialSubmitting, setTrialSubmitting] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const isPreview = Boolean(previewMode)
  const earlyPayment = new URLSearchParams(location.search).get('earlyPayment') === '1'

  if (loading && !isPreview) {
    return (
      <main className="subscription-page subscription-page--center">
        <p className="muted">იტვირთება...</p>
      </main>
    )
  }

  if (!isPreview && !user) return <Navigate to="/login" replace />

  const price = calculatePrice('premium', deviceSlots)
  const trialActive = previewMode
    ? previewMode !== 'expired'
    : profile?.subscription_status === 'trial' &&
      trialExpiresAt(profile) > Date.now()

  if (
    !isPreview &&
    hasAccess &&
    profile?.subscription_plan &&
    !needsPlanSelection &&
    !(earlyPayment && trialActive)
  ) {
    return <Navigate to="/" replace />
  }

  async function continueWithTrial() {
    if (isPreview) {
      setPreviewNotice('ეს ვიზუალური Preview-ია — Trial არ აქტიურდება და ანგარიში არ იცვლება.')
      return
    }
    setTrialSubmitting(true)
    setError(null)
    try {
      const saveError = await selectPackage(deviceSlots)
      if (saveError) {
        setError(`პაკეტის შენახვა ვერ მოხერხდა: ${saveError}`)
        return
      }
      navigate('/', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'პაკეტის შენახვა ვერ მოხერხდა')
    } finally {
      setTrialSubmitting(false)
    }
  }

  function continueToRoutes() {
    if (needsPlanSelection) {
      void continueWithTrial()
      return
    }
    navigate('/', { replace: true })
  }

  async function handleSignOut() {
    setError(null)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ანგარიშიდან გასვლა ვერ მოხერხდა')
    }
  }

  return (
    <main className="subscription-page">
      <div className="subscription-layout">
        <section className="subscription-intro">
          <h1 className="subscription-title">CityRoute <span>Premium</span></h1>
          <p className="subscription-hero__subtitle">
            მოამზადე მოსწავლე მართვის პრაქტიკული გამოცდისთვის
          </p>
          <p className="subscription-hero__description">
            CityRoute ინსტრუქტორებს ეხმარება მოსწავლეები ქალაქ თელავში პრაქტიკული მართვის გამოცდისთვის მოამზადონ.
          </p>

          {trialActive ? (
            <div className="subscription-status subscription-status--trial">
              <span className="subscription-status__icon" aria-hidden="true">12</span>
              <div>
                <strong>უფასო Trial აქტიურია</strong>
                <p>
                  {previewMode && previewMode !== 'expired'
                    ? 'ადგილობრივი დემო · 12 სთ სატესტო წვდომა'
                    : profile
                      ? accessLabel(profile)
                      : 'Trial რეგისტრაციისას დაიწყო'}
                </p>
              </div>
            </div>
          ) : (
            <div className="subscription-status subscription-status--expired">
              <span className="subscription-status__icon" aria-hidden="true">↻</span>
              <div>
                <strong>გააქტიურე Premium</strong>
                <p>
                  {previewMode === 'expired'
                    ? 'Trial დასრულებულია · აირჩიე პაკეტი'
                    : profile
                      ? accessLabel(profile)
                      : 'ანგარიშის გამოწერის მონაცემები ვერ ჩაიტვირთა'}
                </p>
              </div>
            </div>
          )}
          {trialActive && !isPreview && !deviceBlocked && (
            <div className="subscription-trial-actions">
              <button
                type="button"
                className="subscription-trial-action"
                disabled={trialSubmitting}
                onClick={continueToRoutes}
              >
                მარშრუტებზე გადასვლა
                <span aria-hidden="true">→</span>
              </button>
            </div>
          )}
          {((!isPreview && deviceBlocked) || (isPreview && previewMode === 'blocked-trial')) && (
            <p className="subscription-error" role="alert">
              Trial-ს ჯერ კიდევ დარჩენილი დრო აქვს, მაგრამ ეს მოწყობილობა დაბლოკილია
              {!isPreview && deviceBlocked ? `: ${deviceBlocked}` : '.'}
              {' '}მარშრუტებზე წვდომისთვის დაუკავშირდი მხარდაჭერას და მოითხოვე მოწყობილობის განბლოკვა.
            </p>
          )}

          <ul className="subscription-benefits">
            <li><span aria-hidden="true">✓</span> საგამოცდო მარშრუტები — ქალაქი თელავი</li>
            <li><span aria-hidden="true">✓</span> ხმოვანი მითითებები გზაზე</li>
            <li><span aria-hidden="true">✓</span> მოსწავლის მომზადება რეალურ მარშრუტებზე</li>
            <li><span aria-hidden="true">✓</span> მოსახერხებელი GPS ნავიგაცია</li>
          </ul>
        </section>

        <section className="subscription-checkout" aria-labelledby="subscription-title">
          <div className="subscription-checkout__body">
            <h2 id="subscription-title">რამდენი ავტომობილისთვის?</h2>

            <div className="subscription-options" role="radiogroup" aria-label="მანქანების რაოდენობა">
              {VEHICLE_OPTIONS.map((slots) => {
                const optionPrice = calculatePrice('premium', slots)
                const selected = deviceSlots === slots
                return (
                  <button
                    key={slots}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`subscription-option${selected ? ' is-selected' : ''}`}
                    onClick={() => {
                      setDeviceSlots(slots)
                      setError(null)
                    }}
                  >
                    <span className="subscription-option__left">
                      <span className="subscription-option__icon" aria-hidden="true">
                        {slots === 1 ? '🚗' : '🚗🚗'}
                      </span>
                      <span className="subscription-option__copy">
                        <strong>{slots} {slots === 1 ? 'მანქანა' : 'მანქანისთვის'}</strong>
                        <small>{optionPrice} ₾ / 30 დღე</small>
                      </span>
                    </span>
                    <span className="subscription-option__right">
                      {slots === 2 && (
                        <>
                          <s className="subscription-option__old-price">198 ₾</s>
                          <span className="subscription-option__discount">დაზოგავ 19 ₾-ს</span>
                        </>
                      )}
                      {selected && <span className="subscription-option__check" aria-hidden="true">✓</span>}
                    </span>
                  </button>
                )
              })}
            </div>

            {trialActive && !earlyPayment && !isPreview && !deviceBlocked && (
              <button
                type="button"
                className="subscription-trial-button"
                disabled={trialSubmitting}
                onClick={() => void continueWithTrial()}
              >
                {trialSubmitting ? 'ინახება...' : '12-საათიანი უფასო Trial'}
                {!trialSubmitting && <span aria-hidden="true">→</span>}
              </button>
            )}
            {trialActive && !earlyPayment && !isPreview && !deviceBlocked && (
              <p className="subscription-trial-copy">უფასო წვდომა 12 საათით, გადახდის გარეშე.</p>
            )}
            {earlyPayment && trialActive && (
              <p className="subscription-trial-copy">
                Trial აქტიურია — გადახდა სურვილისამებრ შეგიძლია ვადის ამოწურვამდე.
              </p>
            )}

            {previewNotice && <p className="subscription-preview-notice" role="status">{previewNotice}</p>}
            {error && <p className="subscription-error" role="alert">{error}</p>}
            {!isPreview && (
              <>
                <div className="subscription-total">
                  <span>არჩეული პაკეტი</span>
                  <strong>{price} ₾ <small>/ 30 დღე</small></strong>
                </div>

                {!profile && (
                  <p className="subscription-error" role="alert">
                    გამოწერის მონაცემები მიუწვდომელია. სცადე გვერდის განახლება ან დაუკავშირდი მხარდაჭერას.
                  </p>
                )}

                <PaymentButton
                  deviceSlots={deviceSlots}
                  disabled={!profile}
                  onError={setError}
                />
              </>
            )}
            {isPreview && !trialActive && (
              <>
                <div className="subscription-total">
                  <span>არჩეული პაკეტი</span>
                  <strong>{price} ₾ <small>/ 30 დღე</small></strong>
                </div>
                <button type="button" className="payment-button" disabled>
                  გადახდა — {price} ₾
                </button>
              </>
            )}
            {!isPreview && (
              <p className="subscription-disclaimer">
                Premium გააქტიურდება გადახდის დადასტურების შემდეგ.
              </p>
            )}
          </div>

        </section>
      </div>
      <p className="subscription-support">
        კითხვები გაქვს? მოგვწერე: <a href="mailto:support@cityroute.ge">support@cityroute.ge</a>
      </p>
      <div className="subscription-bottom-links"><SupportFooterLinks /></div>
      {!isPreview && user && (
        <div className="subscription-signout-wrap">
          <button
            type="button"
            className="subscription-signout"
            onClick={() => void handleSignOut()}
          >
            გამოსვლა
          </button>
        </div>
      )}
    </main>
  )
}
