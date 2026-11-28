import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  activeCarCount,
  canAddCar,
  currentOwnerLicense,
  freeCarSlots,
  loadMySchoolCars,
  loadMySchoolLicenses,
  MAX_CAR_LABEL_LENGTH,
  ownerCarErrorMessage,
  ownerSetCarStatus,
  ownerUpsertCar,
  type OwnerCarAction,
  type OwnerSchoolCar,
  type OwnerSchoolLicense,
} from '@/lib/driving-school'

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ka-GE')
}

type PendingAction = { car: OwnerSchoolCar; action: OwnerCarAction }

const ACTION_TEXT: Record<OwnerCarAction, { button: string; confirm: string; done: string }> = {
  disable: { button: 'გამორთვა', confirm: 'გამოირთოს მანქანა', done: 'მანქანა გამოირთო.' },
  enable: { button: 'ჩართვა', confirm: 'ჩაირთოს მანქანა', done: 'მანქანა ჩაირთო.' },
  release_device: {
    button: 'მოწყობილობის გათავისუფლება',
    confirm: 'გათავისუფლდეს ამ მანქანაზე მიბმული მოწყობილობა',
    done: 'მოწყობილობა გათავისუფლდა.',
  },
}

/**
 * „ჩემი ავტოსკოლა" — car management for an Approved school owner. Uses only
 * the school's own rows (RLS) and the owner RPCs from migration 038; the car
 * limit, ownership and Approved status are enforced again in the database.
 * Never touches individual Premium packages, device slots or payments.
 */
export function DrivingSchoolOwnerCars({ schoolId }: { schoolId: string }) {
  const [licenses, setLicenses] = useState<OwnerSchoolLicense[]>([])
  const [cars, setCars] = useState<OwnerSchoolCar[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [newSlot, setNewSlot] = useState<number | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<PendingAction | null>(null)

  const load = useCallback(async () => {
    try {
      const [schoolLicenses, schoolCars] = await Promise.all([loadMySchoolLicenses(schoolId), loadMySchoolCars(schoolId)])
      setLicenses(schoolLicenses)
      setCars(schoolCars)
      setLabels(Object.fromEntries(schoolCars.map((car) => [car.id, car.label])))
      setLoadError(null)
    } catch (loadFailure) {
      console.error('Driving-school cars failed to load:', loadFailure)
      setLoadError('მანქანების ჩატვირთვა ვერ მოხერხდა.')
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => {
    void load()
  }, [load])

  const license = currentOwnerLicense(licenses)
  const free = license ? freeCarSlots(license.car_count, cars) : []
  const addAllowed = canAddCar(license, cars)

  const freeKey = free.join(',')
  useEffect(() => {
    const slots = freeKey ? freeKey.split(',').map(Number) : []
    setNewSlot((current) => (current !== null && slots.includes(current) ? current : slots[0] ?? null))
  }, [freeKey])

  async function run(task: () => Promise<unknown>, done: string) {
    setWorking(true)
    setError(null)
    setSuccess(null)
    try {
      await task()
      setSuccess(done)
      await load()
    } catch (failure) {
      console.error('Driving-school car action failed:', failure)
      setError(ownerCarErrorMessage(failure))
    } finally {
      setWorking(false)
    }
  }

  function addCar(event: FormEvent) {
    event.preventDefault()
    if (!addAllowed || newSlot === null) {
      setError('ლიცენზიის მანქანების ლიმიტი ამოწურულია.')
      return
    }
    if (newLabel.trim().length > MAX_CAR_LABEL_LENGTH) {
      setError(`დასახელება არ უნდა აღემატებოდეს ${MAX_CAR_LABEL_LENGTH} სიმბოლოს.`)
      return
    }
    void run(async () => {
      await ownerUpsertCar(newSlot, newLabel)
      setNewLabel('')
    }, `მანქანა დაემატა (#${newSlot}).`)
  }

  function saveLabel(car: OwnerSchoolCar) {
    const label = (labels[car.id] ?? '').trim()
    if (label.length > MAX_CAR_LABEL_LENGTH) {
      setError(`დასახელება არ უნდა აღემატებოდეს ${MAX_CAR_LABEL_LENGTH} სიმბოლოს.`)
      return
    }
    void run(() => ownerUpsertCar(car.slot_number, label), 'დასახელება შეინახა.')
  }

  function confirmPending() {
    if (!pending) return
    const { car, action } = pending
    setPending(null)
    void run(() => ownerSetCarStatus(car.id, action), ACTION_TEXT[action].done)
  }

  return (
    <section className="subscription-checkout dso-section" aria-labelledby="dso-title">
      <div className="subscription-checkout__body">
        <h2 id="dso-title">ჩემი ავტოსკოლის მანქანები</h2>
        {loading && <p className="session-hint" role="status">იტვირთება...</p>}
        {loadError && <p className="subscription-error" role="alert">{loadError}</p>}

        {!loading && !loadError && (
          <>
            {license ? (
              <p className="dso-license">
                ლიცენზია: <strong>{license.car_count} მანქანა</strong> · აქტიური: {activeCarCount(cars)}/{license.car_count} · იწურება{' '}
                {formatDate(license.expires_at)}
              </p>
            ) : (
              <p className="subscription-disclaimer dso-license">
                აქტიური ლიცენზია არ არის. მანქანების დამატებისთვის საჭიროა CityRoute-ის მიერ მინიჭებული ლიცენზია.
              </p>
            )}

            {cars.length === 0 ? (
              <p className="session-hint">მანქანები ჯერ არ არის დამატებული.</p>
            ) : (
              <ul className="dso-cars">
                {cars.map((car) => (
                  <li key={car.id} className={`dso-car${car.status === 'disabled' ? ' is-disabled' : ''}`}>
                    <div className="dso-car__head">
                      <strong>#{car.slot_number}</strong>
                      <span>{car.status === 'active' ? 'აქტიური' : 'გამორთული'}</span>
                      <span>{car.android_device_id ? 'მოწყობილობა მიბმულია' : 'მოწყობილობა არ არის მიბმული'}</span>
                    </div>
                    <div className="dso-car__row">
                      <input
                        aria-label={`მანქანა #${car.slot_number} დასახელება`}
                        value={labels[car.id] ?? ''}
                        maxLength={MAX_CAR_LABEL_LENGTH}
                        placeholder="მაგ. AA-123-BB"
                        disabled={working}
                        onChange={(event) => setLabels({ ...labels, [car.id]: event.target.value })}
                      />
                      <button type="button" className="dso-button" disabled={working} onClick={() => saveLabel(car)}>
                        შენახვა
                      </button>
                    </div>
                    <div className="dso-car__row">
                      {car.status === 'active' ? (
                        <button type="button" className="dso-button" disabled={working} onClick={() => setPending({ car, action: 'disable' })}>
                          {ACTION_TEXT.disable.button}
                        </button>
                      ) : (
                        <button type="button" className="dso-button" disabled={working} onClick={() => setPending({ car, action: 'enable' })}>
                          {ACTION_TEXT.enable.button}
                        </button>
                      )}
                      <button
                        type="button"
                        className="dso-button"
                        disabled={working || !car.android_device_id}
                        title={car.android_device_id ? undefined : 'მოწყობილობა არ არის მიბმული'}
                        onClick={() => setPending({ car, action: 'release_device' })}
                      >
                        {ACTION_TEXT.release_device.button}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {license && (
              <form className="dso-add" onSubmit={addCar}>
                <h3>მანქანის დამატება</h3>
                {addAllowed ? (
                  <>
                    <label className="dso-field">
                      <span>ადგილი (slot)</span>
                      <select value={newSlot ?? ''} disabled={working} onChange={(event) => setNewSlot(Number(event.target.value))}>
                        {free.map((slot) => (
                          <option key={slot} value={slot}>#{slot}</option>
                        ))}
                      </select>
                    </label>
                    <label className="dso-field">
                      <span>დასახელება (არასავალდებულო)</span>
                      <input
                        value={newLabel}
                        maxLength={MAX_CAR_LABEL_LENGTH}
                        placeholder="მაგ. AA-123-BB"
                        disabled={working}
                        onChange={(event) => setNewLabel(event.target.value)}
                      />
                    </label>
                    <button type="submit" className="payment-button" disabled={working}>
                      {working ? 'სრულდება...' : 'მანქანის დამატება'}
                    </button>
                  </>
                ) : (
                  <p className="subscription-disclaimer">ლიცენზიის მანქანების ლიმიტი ამოწურულია ({license.car_count}).</p>
                )}
              </form>
            )}
          </>
        )}

        {error && <p className="subscription-error" role="alert">{error}</p>}
        {success && <p className="session-hint" role="status">{success}</p>}
      </div>

      {pending && (
        <div className="dso-dialog-backdrop">
          <div className="dso-dialog" role="dialog" aria-modal="true" aria-labelledby="dso-dialog-title">
            <h2 id="dso-dialog-title">დაადასტურე</h2>
            <p>{ACTION_TEXT[pending.action].confirm} #{pending.car.slot_number}?</p>
            <div className="dso-actions">
              <button type="button" className="dso-button" onClick={() => setPending(null)}>გაუქმება</button>
              <button type="button" className="dso-button dso-button--primary" onClick={confirmPending}>დადასტურება</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
