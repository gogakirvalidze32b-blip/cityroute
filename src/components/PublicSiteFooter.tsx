import { Link } from 'react-router-dom'
import { SUPPORT_ADDRESS, SUPPORT_EMAIL, SUPPORT_PHONE } from '@/lib/support/constants'
import '@/styles/public-information.css'

const PUBLIC_LINKS = [
  { to: '/about', label: 'ჩვენ შესახებ' },
  { to: '/contact', label: 'კონტაქტი' },
  { to: '/support', label: 'მხარდაჭერა' },
  { to: '/pricing', label: 'ფასები და პაკეტები' },
  { to: '/terms', label: 'წესები და პირობები' },
  { to: '/cancellation-refunds', label: 'გაუქმება და დაბრუნება' },
  { to: '/privacy-policy', label: 'კონფიდენციალურობა' },
]

type Props = {
  className?: string
}

export function PublicSiteFooter({ className = '' }: Props) {
  return (
    <footer className={`public-site-footer ${className}`.trim()}>
      <div className="public-site-footer__inner">
        <div className="public-site-footer__contact">
          <strong>CityRoute</strong>
          <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}>{SUPPORT_PHONE}</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <address>{SUPPORT_ADDRESS}</address>
        </div>
        <nav className="public-site-footer__links" aria-label="საჯარო გვერდები">
          {PUBLIC_LINKS.map((item) => (
            <Link key={item.to} to={item.to}>{item.label}</Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
