import { useCallback, useEffect, useState } from 'react'
import { DRIVING_SCHOOL_CAR_COUNTS, DRIVING_SCHOOL_STATUS_LABELS, type DrivingSchoolCarCount } from '@/lib/driving-school'
import {
  activeLicense,
  adminErrorMessage,
  adminGetSchoolCars,
  adminGetSchoolLicenses,
  adminGrantDrivingSchoolLicense,
  adminListDrivingSchools,
  adminReviewDrivingSchool,
  canGrantLicense,
  DEFAULT_LICENSE_DURATION_DAYS,
  MAX_REVIEW_NOTE_LENGTH,
  validateReview,
  type AdminDrivingSchool,
  type AdminDrivingSchoolCar,
  type AdminDrivingSchoolLicense,
  type AdminReviewDecision,
  type AdminSchoolFilter,
} from '@/lib/driving-school-admin'
import './driving-schools-admin.css'

const FILTERS: { key: AdminSchoolFilter; label: string }[] = [
  { key: 'pending', label: 'განხილვაში' },
  { key: 'approved', label: 'დადასტურებული' },
  { key: 'rejected', label: 'უარყოფილი' },
  { key: 'all', label: 'ყველა' },
]

const LICENSE_STATUS: Record<AdminDrivingSchoolLicense['status'], string> = {
  active: 'აქტიური',
  replaced: 'ჩანაცვლებული',
  revoked: 'გაუქმებული',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ka-GE')
}

type Confirmation =
  | { kind: 'review'; decision: AdminReviewDecision; school: AdminDrivingSchool; note: string }
  | { kind: 'grant'; school: AdminDrivingSchool; carCount: DrivingSchoolCarCount; days: number; current: AdminDrivingSchoolLicense | null }

/**
 * Driving Schools tab of /support-admin. Rendered only after SupportAdminPage's
 * is_support_admin() check; that check only decides what to RENDER - the
 * database re-checks is_support_admin() in RLS and in every RPC. Nothing is
 * written on load; every action needs an explicit confirmation.
 */
export function DrivingSchoolsAdminPanel() {
  const [filter, setFilter] = useState<AdminSchoolFilter>('pending')
  const [schools, setSchools] = useState<AdminDrivingSchool[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminDrivingSchool | null>(null)
  const [licenses, setLicenses] = useState<AdminDrivingSchoolLicense[]>([])
  const [cars, setCars] = useState<AdminDrivingSchoolCar[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [carCount, setCarCount] = useState<DrivingSchoolCarCount>(5)
  const [days, setDays] = useState(String(DEFAULT_LICENSE_DURATION_DAYS))
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [working, setWorking] = useState(false)

  const loadList = useCallback(async (nextFilter: AdminSchoolFilter) => {
    setListLoading(true)
    try {
      setSchools(await adminListDrivingSchools(nextFilter))
      setListError(null)
    } catch (error) {
      console.error('Driving-school admin list failed:', error)
      setListError(adminErrorMessage(error))
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (school: AdminDrivingSchool) => {
    setDetailLoading(true)
    setDetailError(null)
    try {
      const [schoolLicenses, schoolCars] = await Promise.all([
        adminGetSchoolLicenses(school.id),
        adminGetSchoolCars(school.id),
      ])
      setLicenses(schoolLicenses)
      setCars(schoolCars)
    } catch (error) {
      console.error('Driving-school admin detail failed:', error)
      setDetailError(adminErrorMessage(error))
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList(filter)
  }, [filter, loadList])

  useEffect(() => {
    const school = schools.find((item) => item.id === selectedId) ?? null
    setSelected((current) => (school ?? (current?.id === selectedId ? current : null)))
  }, [schools, selectedId])

  function openSchool(school: AdminDrivingSchool) {
    setSelectedId(school.id)
    setSelected(school)
    setNote('')
    setFormError(null)
    setSuccess(null)
    setConfirmation(null)
    setLicenses([])
    setCars([])
    void loadDetail(school)
  }

  function requestReview(decision: AdminReviewDecision) {
    if (!selected) return
    setSuccess(null)
    const problem = validateReview(decision, note)
    if (problem) {
      setFormError(problem)
      return
    }
    setFormError(null)
    setConfirmation({ kind: 'review', decision, school: selected, note })
  }

  function requestGrant() {
    if (!selected) return
    setSuccess(null)
    const duration = Number(days)
    if (!canGrantLicense(selected, carCount)) {
      setFormError('ლიცენზიის მინიჭება შესაძლებელია მხოლოდ დადასტურებულ ავტოსკოლაზე.')
      return
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 366) {
      setFormError('ვადა უნდა იყოს 1-დან 366 დღემდე.')
      return
    }
    setFormError(null)
    setConfirmation({ kind: 'grant', school: selected, carCount, days: duration, current: activeLicense(licenses) })
  }

  async function confirmAction() {
    if (!confirmation) return
    setWorking(true)
    setFormError(null)
    try {
      if (confirmation.kind === 'review') {
        await adminReviewDrivingSchool(confirmation.school.id, confirmation.decision, confirmation.note)
        setSuccess(confirmation.decision === 'approved' ? 'ავტოსკოლა დადასტურდა.' : 'ავტოსკოლა უარყოფილია.')
        setNote('')
      } else {
        await adminGrantDrivingSchoolLicense(confirmation.school, confirmation.carCount, confirmation.days)
        setSuccess(`${confirmation.carCount}-მანქანიანი ლიცენზია მიენიჭა ${confirmation.days} დღით.`)
      }
      const school = confirmation.school
      setConfirmation(null)
      const refreshed = await adminListDrivingSchools(filter).catch(() => null)
      if (refreshed) setSchools(refreshed)
      const updated = (await adminListDrivingSchools('all').catch(() => null))?.find((item) => item.id === school.id)
      if (updated) setSelected(updated)
      await loadDetail(updated ?? school)
    } catch (error) {
      console.error('Driving-school admin action failed:', error)
      setFormError(adminErrorMessage(error))
      setConfirmation(null)
    } finally {
      setWorking(false)
    }
  }

  const current = activeLicense(licenses)

  return (
    <div className="dsa-page">
      <h2 className="dsa-title">ავტოსკოლები</h2>

      <div className="dsa-layout">
        <aside className="dsa-list" aria-label="ავტოსკოლების განაცხადები">
          <div className="dsa-filters" role="tablist" aria-label="სტატუსის ფილტრი">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                className={filter === item.key ? 'is-active' : ''}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
            <button type="button" className="dsa-refresh" aria-label="განახლება" onClick={() => void loadList(filter)}>↻</button>
          </div>
          {listError && (
            <p className="dsa-error" role="alert">
              {listError} <button type="button" onClick={() => void loadList(filter)}>თავიდან</button>
            </p>
          )}
          {listLoading && schools.length === 0 && <p className="muted" role="status">იტვირთება...</p>}
          {!listLoading && !listError && schools.length === 0 && <p className="muted">განაცხადები არ არის.</p>}
          <ul className="dsa-items">
            {schools.map((school) => (
              <li key={school.id}>
                <button
                  type="button"
                  className={`dsa-item${school.id === selectedId ? ' is-selected' : ''}`}
                  onClick={() => openSchool(school)}
                >
                  <strong>{school.name}</strong>
                  <span>{school.contact_name} · {school.city}</span>
                  <span className={`dsa-status dsa-status--${school.status}`}>{DRIVING_SCHOOL_STATUS_LABELS[school.status]}</span>
                  <small>{formatDate(school.submitted_at)}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="dsa-detail" aria-label="განაცხადის დეტალები">
          {!selected ? (
            <p className="muted">აირჩიე განაცხადი სიიდან.</p>
          ) : (
            <>
              <h2>{selected.name}</h2>
              <p>
                სტატუსი: <span className={`dsa-status dsa-status--${selected.status}`}>{DRIVING_SCHOOL_STATUS_LABELS[selected.status]}</span>
              </p>
              <dl className="dsa-fields">
                <dt>საკონტაქტო პირი</dt><dd>{selected.contact_name}</dd>
                <dt>ტელეფონი</dt><dd>{selected.contact_phone}</dd>
                <dt>ელფოსტა</dt><dd>{selected.contact_email}</dd>
                <dt>მისამართი</dt><dd>{selected.address}</dd>
                <dt>ქალაქი</dt><dd>{selected.city}</dd>
                <dt>საიდენტიფიკაციო კოდი</dt><dd>{selected.registration_code || '—'}</dd>
                <dt>დამატებითი ინფორმაცია</dt><dd className="dsa-pre">{selected.verification_info || '—'}</dd>
                <dt>მფლობელის ანგარიში (ID)</dt><dd><code>{selected.owner_id}</code></dd>
                <dt>გაგზავნილია</dt><dd>{formatDate(selected.submitted_at)}</dd>
                <dt>განხილულია</dt><dd>{formatDate(selected.reviewed_at)}</dd>
                <dt>ადმინის შენიშვნა</dt><dd className="dsa-pre">{selected.review_note || '—'}</dd>
              </dl>

              <h3>ლიცენზიები</h3>
              {detailLoading && <p className="muted" role="status">იტვირთება...</p>}
              {detailError && <p className="dsa-error" role="alert">{detailError}</p>}
              {!detailLoading && !detailError && licenses.length === 0 && <p className="muted">ლიცენზია არ არის.</p>}
              {licenses.length > 0 && (
                <table className="dsa-table">
                  <thead><tr><th>მანქანები</th><th>სტატუსი</th><th>წყარო</th><th>იწყება</th><th>იწურება</th></tr></thead>
                  <tbody>
                    {licenses.map((item) => (
                      <tr key={item.id}>
                        <td>{item.car_count}</td>
                        <td>{LICENSE_STATUS[item.status]}{item.status === 'active' && new Date(item.expires_at).getTime() <= Date.now() ? ' (ვადაგასული)' : ''}</td>
                        <td>{item.source === 'admin' ? 'ადმინი' : 'BOG'}</td>
                        <td>{formatDate(item.starts_at)}</td>
                        <td>{formatDate(item.expires_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h3>მანქანები</h3>
              {!detailLoading && !detailError && cars.length === 0 && <p className="muted">მანქანები არ არის დამატებული.</p>}
              {cars.length > 0 && (
                <table className="dsa-table">
                  <thead><tr><th>#</th><th>დასახელება</th><th>სტატუსი</th><th>მოწყობილობა</th></tr></thead>
                  <tbody>
                    {cars.map((car) => (
                      <tr key={car.id}>
                        <td>{car.slot_number}</td>
                        <td>{car.label || '—'}</td>
                        <td>{car.status === 'active' ? 'აქტიური' : 'გათიშული'}</td>
                        <td>{car.android_device_id ? 'მიბმულია' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {(selected.status === 'pending' || selected.status === 'approved') && (
                <div className="dsa-box">
                  <h3>განხილვა</h3>
                  <label className="dsa-field">
                    <span>ადმინის შენიშვნა {selected.status === 'pending' ? '(უარყოფისას სავალდებულო)' : '(სავალდებულო)'}</span>
                    <textarea
                      value={note}
                      maxLength={MAX_REVIEW_NOTE_LENGTH}
                      rows={3}
                      disabled={working}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </label>
                  <div className="dsa-actions">
                    {selected.status === 'pending' && (
                      <button type="button" className="dsa-button dsa-button--primary" disabled={working} onClick={() => requestReview('approved')}>
                        დადასტურება (Approve)
                      </button>
                    )}
                    <button type="button" className="dsa-button dsa-button--danger" disabled={working} onClick={() => requestReview('rejected')}>
                      უარყოფა (Reject)
                    </button>
                  </div>
                </div>
              )}

              {selected.status === 'approved' && (
                <div className="dsa-box">
                  <h3>ლიცენზიის მინიჭება</h3>
                  {current && (
                    <p className="muted">
                      მიმდინარე აქტიური ლიცენზია: {current.car_count} მანქანა, იწურება {formatDate(current.expires_at)}.
                    </p>
                  )}
                  <div className="dsa-radio" role="radiogroup" aria-label="მანქანების რაოდენობა">
                    {DRIVING_SCHOOL_CAR_COUNTS.map((count) => (
                      <label key={count}>
                        <input
                          type="radio"
                          name="dsa-car-count"
                          checked={carCount === count}
                          disabled={working}
                          onChange={() => setCarCount(count)}
                        />
                        {count} მანქანა
                      </label>
                    ))}
                  </div>
                  <label className="dsa-field dsa-field--short">
                    <span>ვადა (დღე)</span>
                    <input type="number" min={1} max={366} value={days} disabled={working} onChange={(event) => setDays(event.target.value)} />
                  </label>
                  <button type="button" className="dsa-button dsa-button--primary" disabled={working} onClick={requestGrant}>
                    ლიცენზიის მინიჭება
                  </button>
                </div>
              )}

              {formError && <p className="dsa-error" role="alert">{formError}</p>}
              {success && <p className="dsa-success" role="status">{success}</p>}
            </>
          )}
        </section>
      </div>

      {confirmation && (
        <div className="dsa-dialog-backdrop">
          <div className="dsa-dialog" role="dialog" aria-modal="true" aria-labelledby="dsa-dialog-title">
            <h2 id="dsa-dialog-title">დაადასტურე მოქმედება</h2>
            {confirmation.kind === 'review' ? (
              <p>
                {confirmation.decision === 'approved' ? 'დაადასტურებ' : 'უარყოფ'} ავტოსკოლას <strong>{confirmation.school.name}</strong>?
                {confirmation.decision === 'rejected' && ' უარყოფისას მისი აქტიური ლიცენზია (თუ არის) გაუქმდება.'}
              </p>
            ) : (
              <>
                <p>
                  მიანიჭებ <strong>{confirmation.carCount}-მანქანიან</strong> ლიცენზიას <strong>{confirmation.days} დღით</strong> ავტოსკოლას{' '}
                  <strong>{confirmation.school.name}</strong>?
                </p>
                <p className="dsa-warning">
                  {confirmation.current
                    ? `მიმდინარე ${confirmation.current.car_count}-მანქანიანი ლიცენზია ჩანაცვლდება.`
                    : 'ეს იქნება ავტოსკოლის პირველი აქტიური ლიცენზია.'}
                  {confirmation.current && confirmation.current.car_count > confirmation.carCount
                    ? ` ლიმიტის ზემოთ მყოფი მანქანები (${confirmation.carCount}-ის ზემოთ) გაითიშება.`
                    : ''}
                  {' '}ლიცენზია ადმინის მიერ, გადახდის გარეშე ენიჭება.
                </p>
              </>
            )}
            <div className="dsa-actions">
              <button type="button" className="dsa-button" disabled={working} onClick={() => setConfirmation(null)}>გაუქმება</button>
              <button type="button" className="dsa-button dsa-button--primary" disabled={working} onClick={() => void confirmAction()}>
                {working ? 'სრულდება...' : 'დადასტურება'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
