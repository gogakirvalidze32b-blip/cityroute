import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  canPurchaseDrivingSchoolPackage,
  DRIVING_SCHOOL_STATUS_LABELS,
  DEFAULT_DRIVING_SCHOOL_PACKAGES,
  formatDrivingSchoolPrice,
  loadDrivingSchoolPackages,
  loadMyDrivingSchool,
  type DrivingSchool,
  type DrivingSchoolPackage,
} from '@/lib/driving-school'

type DrivingSchoolPackagesProps = {
  userId: string | null
}

/**
 * ავტოსკოლის 5 / 10 მანქანიანი პაკეტები. Deliberately has no PaymentButton:
 * the BOG flow and device_slot_packages stay exclusive to the 99 ₾ / 179 ₾ packages.
 */
export function DrivingSchoolPackages({ userId }: DrivingSchoolPackagesProps) {
  const [packages, setPackages] = useState<DrivingSchoolPackage[]>([...DEFAULT_DRIVING_SCHOOL_PACKAGES])
  const [school, setSchool] = useState<DrivingSchool | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number>(5)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      loadDrivingSchoolPackages(),
      userId ? loadMyDrivingSchool(userId) : Promise.resolve(null),
    ])
      .then(([catalog, mySchool]) => {
        if (cancelled) return
        if (catalog.length > 0) setPackages(catalog)
        setSchool(mySchool)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        console.error('Driving-school packages failed to load:', loadError)
        setError('ავტოსკოლის პაკეტების ჩატვირთვა ვერ მოხერხდა. სცადე თავიდან.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const selectedPackage = packages.find((item) => item.car_count === selected) ?? packages[0]
  const purchasable = selectedPackage ? canPurchaseDrivingSchoolPackage(school, selectedPackage) : false

  return (
    <div className="driving-school-packages">
      <h2 id="subscription-checkout-title">ავტოსკოლის პაკეტი</h2>
      <div className="subscription-options" role="radiogroup" aria-label="ავტოსკოლის მანქანების რაოდენობა">
        {packages.map((item) => (
          <button
            key={item.car_count}
            type="button"
            role="radio"
            aria-checked={selected === item.car_count}
            className={`subscription-option${selected === item.car_count ? ' is-selected' : ''}`}
            onClick={() => setSelected(item.car_count)}
          >
            <span className="subscription-option__icon" aria-hidden="true">🚗 × {item.car_count}</span>
            <span className="subscription-option__copy">
              <strong>{item.car_count} მანქანა (ავტოსკოლა)</strong>
              <small>{item.duration_days} დღე · 1 მფლობელის ანგარიში</small>
            </span>
            <span className="subscription-option__price">{formatDrivingSchoolPrice(item)}</span>
          </button>
        ))}
      </div>
      <p className="subscription-disclaimer">
        თითოეული მანქანის ლიცენზია ერთ მოწყობილობაზე იმუშავებს. პაკეტის შეძენა შეუძლია მხოლოდ დადასტურებულ ავტოსკოლას.
      </p>

      {loading && <p className="session-hint" role="status">ავტოსკოლის მონაცემები იტვირთება...</p>}
      {error && <p className="subscription-error" role="alert">{error}</p>}

      {!loading && !error && (
        <div className="driving-school-packages__status" data-testid="driving-school-status">
          {school ? (
            <p>
              ავტოსკოლა <strong>{school.name}</strong> — სტატუსი:{' '}
              <strong>{DRIVING_SCHOOL_STATUS_LABELS[school.status]}</strong>
              {school.status === 'rejected' && school.review_note ? ` (${school.review_note})` : ''}
            </p>
          ) : (
            <p>შეძენამდე ავტოსკოლამ უნდა გაიაროს რეგისტრაცია და დადასტურება.</p>
          )}
          <Link className="subscription-trial-button driving-school-packages__link" to="/driving-school">
            {school ? 'ავტოსკოლის რეგისტრაციის ნახვა' : 'ავტოსკოლის რეგისტრაცია'}
          </Link>
        </div>
      )}

      {purchasable ? (
        <Link className="payment-button driving-school-packages__buy" to="/support">
          შეძენის მოთხოვნა
        </Link>
      ) : (
        <button type="button" className="payment-button" disabled>
          {selectedPackage?.price_amount === null ? 'ფასი დაზუსტდება' : 'საჭიროა დადასტურებული ავტოსკოლა'}
        </button>
      )}
    </div>
  )
}
