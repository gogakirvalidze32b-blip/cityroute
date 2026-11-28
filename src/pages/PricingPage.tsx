import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PublicPageLayout } from '@/components/PublicPageLayout'
import { loadDeviceSlotPackages, type DeviceSlotPackage } from '@/lib/device-slot-packages'
import { SUPPORT_EMAIL } from '@/lib/support/constants'

export function PricingPage() {
  const [packages, setPackages] = useState<DeviceSlotPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadDeviceSlotPackages()
      .then((activePackages) => {
        if (!cancelled) setPackages(activePackages)
      })
      .catch((catalogError: unknown) => {
        console.error('Public package catalog failed to load:', catalogError)
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PublicPageLayout
      title="ფასები და პაკეტები"
      intro="CityRoute Premium-ის აქტიური პაკეტები, ფასები და წვდომის პირობები."
    >
      <section aria-labelledby="public-pricing-title">
        <h2 id="public-pricing-title">ხელმისაწვდომი პაკეტები</h2>
        {loading && <p role="status">მიმდინარე პაკეტები იტვირთება...</p>}
        {error && (
          <p role="alert">
            მიმდინარე პაკეტების ჩატვირთვა ვერ მოხერხდა. ფასის დასაზუსტებლად სცადეთ მოგვიანებით ან
            მოგვწერეთ <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>-ზე.
          </p>
        )}
        {!loading && !error && packages.length === 0 && (
          <p role="status">ამჟამად აქტიური პაკეტი ვერ მოიძებნა.</p>
        )}
        {!loading && !error && packages.length > 0 && (
          <div className="public-pricing-list">
            {packages.map((item) => (
              <article className="public-pricing-package" key={`${item.subscription_plan}-${item.device_slots}`}>
                <h2>{item.device_slots} ავტომობილისთვის</h2>
                <strong className="public-pricing-package__price">{item.price_amount} ₾</strong>
                <p>წვდომის ხანგრძლივობა: 30 დღე</p>
                <p>მაქსიმუმ {item.device_slots} მოწყობილობა ერთ ანგარიშზე</p>
              </article>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2>უფასო საცდელი წვდომა</h2>
        <p>
          ახალი ანგარიშისთვის ხელმისაწვდომია 12-საათიანი საცდელი პერიოდი. ის ანგარიშის შექმნის
          მომენტიდან აითვლება, იმავე ანგარიშზე ხელახლა არ იწყება და მის დასაწყებად გადახდა საჭირო არ არის.
          საცდელი პერიოდის დასრულების შემდეგ თანხა ავტომატურად არ ჩამოიჭრება.
        </p>
      </section>
      <section>
        <h2>პაკეტის არჩევა და გადახდა</h2>
        <p>
          პაკეტის შესაძენად შედით ან შექმენით ანგარიში, შემდეგ გადახდა თავად დაიწყეთ CityRoute-ის
          გადახდის ღილაკიდან. გადახდა მუშავდება საქართველოს ბანკის გვერდზე; ფასიანი წვდომა აქტიურდება
          მხოლოდ წარმატებული დადასტურების შემდეგ.
        </p>
        <div className="public-pricing-actions">
          <Link to="/register">ანგარიშის შექმნა</Link>
          <Link to="/login">შესვლა და პაკეტის არჩევა</Link>
        </div>
      </section>
    </PublicPageLayout>
  )
}
