import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { PaymentButton } from '@/components/PaymentButton'
import { SupportFooterLinks } from '@/components/support/SupportLinks'
import { useAuth } from '@/context/AuthContext'
import { calculatePrice } from '@/data/subscription-plans'
import { accessLabel, isAccessActive } from '@/types/database'
import { getBogSandboxPaymentBlockReason } from '@/lib/bog-sandbox'
import './subscription-page.css'

const VEHICLE_OPTIONS = [1, 2] as const
type PreviewMode = 'trial' | 'expired'

export function PlanSelectionPage({ previewMode }: { previewMode?: PreviewMode } = {}) {
  const { user, loading, hasAccess, needsPlanSelection, profile, deviceBlocked, selectPackage } = useAuth()
  const [deviceSlots, setDeviceSlots] = useState<1 | 2>(profile?.device_slots === 2 ? 2 : 1)
  const [error, setError] = useState<string | null>(null)
  const [previewNotice, setPreviewNotice] = useState<string | null>(null)
  const [trialSubmitting, setTrialSubmitting] = useState(false)
  const navigate = useNavigate()
  const isPreview = Boolean(previewMode)

  if (loading && !isPreview) {
    return (
      <main className="subscription-page subscription-page--center">
        <p className="muted">იტვირთება...</p>
      </main>
    )
  }

  if (!isPreview && !user) return <Navigate to="/login" replace />
  if (!isPreview && hasAccess && profile?.subscription_plan && !needsPlanSelection) {
    return <Navigate to="/" replace />
  }

  const price = calculatePrice('premium', deviceSlots)
  const trialActive = previewMode
    ? previewMode === 'trial'
    : profile?.subscription_status === 'trial' && isAccessActive(profile)
  const paymentBlockReason = isPreview
    ? 'Sandbox გადახდა ხელმისაწვდომი გახდება ცალკე Preview Supabase-ის კონფიგურაციის შემდეგ.'
    : getBogSandboxPaymentBlockReason()

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
              <span className="subscription-status__icon" aria-hidden="true">24</span>
              <div>
                <strong>უფასო Trial აქტიურია</strong>
                <p>
                  {previewMode === 'trial'
                    ? 'დემო Trial · რეალური წვდომა ანგარიშის სტატუსზეა დამოკიდებული'
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

          {!isPreview && deviceBlocked && (
            <p className="subscription-error" role="alert">
              Trial აქტიურია, მაგრამ ეს მოწყობილობა დაბლოკილია: {deviceBlocked}
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

            {trialActive && !isPreview && (
              <button
                type="button"
                className="subscription-trial-button"
                disabled={trialSubmitting}
                onClick={() => void continueWithTrial()}
              >
                {trialSubmitting ? 'ინახება...' : '24-საათიანი უფასო Trial'}
                {!trialSubmitting && <span aria-hidden="true">→</span>}
              </button>
            )}
            {trialActive && !isPreview && (
              <p className="subscription-trial-copy">უფასო წვდომა 24 საათით, გადახდის გარეშე.</p>
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
                  disabled={!profile || Boolean(paymentBlockReason)}
                  onError={setError}
                />
                {paymentBlockReason && (
                  <p className="subscription-disclaimer" role="status">
                    {paymentBlockReason}
                  </p>
                )}
              </>
            )}
            {isPreview && (
              <>
                <div className="subscription-total">
                  <span>არჩეული პაკეტი</span>
                  <strong>{price} ₾ <small>/ 30 დღე</small></strong>
                </div>
                <button type="button" className="payment-button" disabled>
                  გადახდა — {price} ₾
                </button>
                <p className="subscription-disclaimer" role="status">
                  {paymentBlockReason}
                </p>
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
    </main>
  )
}
