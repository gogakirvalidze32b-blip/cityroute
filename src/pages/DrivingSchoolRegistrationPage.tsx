import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { DrivingSchoolOwnerCars } from '@/components/DrivingSchoolOwnerCars'
import { useAuth } from '@/context/AuthContext'
import {
  DRIVING_SCHOOL_STATUS_LABELS,
  loadMyDrivingSchool,
  submitDrivingSchoolApplication,
  validateDrivingSchoolApplication,
  type DrivingSchool,
  type DrivingSchoolApplication,
} from '@/lib/driving-school'
import './subscription-page.css'

const EMPTY_FORM: DrivingSchoolApplication = {
  name: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  address: '',
  city: 'თელავი',
  registrationCode: '',
  verificationInfo: '',
}

function formFromSchool(school: DrivingSchool): DrivingSchoolApplication {
  return {
    name: school.name,
    contactName: school.contact_name,
    contactPhone: school.contact_phone,
    contactEmail: school.contact_email,
    address: school.address,
    city: school.city,
    registrationCode: school.registration_code ?? '',
    verificationInfo: school.verification_info,
  }
}

const FIELDS: { key: keyof DrivingSchoolApplication; label: string; type?: string; multiline?: boolean; optional?: boolean }[] = [
  { key: 'name', label: 'ავტოსკოლის სახელი' },
  { key: 'contactName', label: 'საკონტაქტო პირი' },
  { key: 'contactPhone', label: 'ტელეფონი', type: 'tel' },
  { key: 'contactEmail', label: 'ელფოსტა', type: 'email' },
  { key: 'address', label: 'მისამართი' },
  { key: 'city', label: 'ქალაქი' },
  { key: 'registrationCode', label: 'საიდენტიფიკაციო კოდი', optional: true },
  { key: 'verificationInfo', label: 'დამატებითი ინფორმაცია დადასტურებისთვის (ლიცენზია, ვებგვერდი და ა.შ.)', multiline: true, optional: true },
]

export function DrivingSchoolRegistrationPage() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [school, setSchool] = useState<DrivingSchool | null>(null)
  const [form, setForm] = useState<DrivingSchoolApplication>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof DrivingSchoolApplication, string>>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    let cancelled = false
    void loadMyDrivingSchool(userId)
      .then((mySchool) => {
        if (cancelled) return
        setSchool(mySchool)
        if (mySchool) setForm(formFromSchool(mySchool))
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        console.error('Driving school failed to load:', loadError)
        setError('ავტოსკოლის მონაცემების ჩატვირთვა ვერ მოხერხდა.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const editable = school?.status !== 'approved'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    const errors = validateDrivingSchoolApplication(form)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    setSubmitting(true)
    try {
      await submitDrivingSchoolApplication(form)
      const refreshed = userId ? await loadMyDrivingSchool(userId) : null
      setSchool(refreshed)
      setNotice('განაცხადი გაიგზავნა. სტატუსი: განხილვაშია.')
    } catch (submitError) {
      console.error('Driving school application failed:', submitError)
      setError('განაცხადის გაგზავნა ვერ მოხერხდა. სცადე თავიდან.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="subscription-page cr-scroll-page">
      <div className="subscription-layout">
        <section className="subscription-intro">
          <AppBrand centered />
          <h1 className="subscription-title">ავტოსკოლის <span>რეგისტრაცია</span></h1>
          <p className="subscription-hero__description">
            5 ან 10 მანქანიანი პაკეტის შეძენა შეუძლია მხოლოდ დადასტურებულ ავტოსკოლას. შეავსე განაცხადი —
            მას CityRoute-ის გუნდი განიხილავს.
          </p>
          {school && (
            <div className="subscription-status" role="status">
              <span className="subscription-status__icon" aria-hidden="true">
                {school.status === 'approved' ? '✓' : school.status === 'rejected' ? '!' : '…'}
              </span>
              <div>
                <strong>სტატუსი: {DRIVING_SCHOOL_STATUS_LABELS[school.status]}</strong>
                {school.review_note && <p>{school.review_note}</p>}
              </div>
            </div>
          )}
          <Link className="subscription-signout" to="/choose-plan">Premium პაკეტებზე დაბრუნება</Link>
        </section>

        <section className="subscription-checkout" aria-labelledby="driving-school-form-title">
          <form className="subscription-checkout__body driving-school-form" onSubmit={(event) => void onSubmit(event)} noValidate>
            <h2 id="driving-school-form-title">ავტოსკოლის მონაცემები</h2>
            {loading && <p className="session-hint" role="status">იტვირთება...</p>}
            {FIELDS.map((field) => (
              <label key={field.key} className="driving-school-form__field">
                <span>{field.label}{field.optional ? ' (არასავალდებულო)' : ''}</span>
                {field.multiline ? (
                  <textarea
                    value={form[field.key]}
                    disabled={!editable || submitting}
                    rows={4}
                    onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                  />
                ) : (
                  <input
                    type={field.type ?? 'text'}
                    value={form[field.key]}
                    disabled={!editable || submitting}
                    onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                  />
                )}
                {fieldErrors[field.key] && <small className="driving-school-form__error">{fieldErrors[field.key]}</small>}
              </label>
            ))}
            {error && <p className="subscription-error" role="alert">{error}</p>}
            {notice && <p className="session-hint" role="status">{notice}</p>}
            {editable ? (
              <button type="submit" className="payment-button" disabled={submitting || loading}>
                {submitting ? 'იგზავნება...' : school ? 'განაცხადის ხელახლა გაგზავნა' : 'განაცხადის გაგზავნა'}
              </button>
            ) : (
              <p className="subscription-disclaimer">დადასტურებული ავტოსკოლის მონაცემების შეცვლა შესაძლებელია მხარდაჭერის გავლით.</p>
            )}
          </form>
        </section>
        {school?.status === 'approved' && <DrivingSchoolOwnerCars schoolId={school.id} />}
      </div>
    </main>
  )
}
