import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PublicSiteFooter } from '@/components/PublicSiteFooter'
import '@/styles/public-information.css'

type Props = {
  title: string
  intro?: string
  children: ReactNode
}

export function PublicPageLayout({ title, intro, children }: Props) {
  return (
    <div className="public-page cr-scroll-page">
      <div className="public-page__inner">
        <header className="public-page__header">
          <Link className="public-page__brand" to="/login">CityRoute</Link>
          <nav className="public-page__account-links" aria-label="ანგარიში">
            <Link to="/login">შესვლა</Link>
            <Link to="/register">რეგისტრაცია</Link>
          </nav>
        </header>
        <main className="public-page__main">
          <h1>{title}</h1>
          {intro && <p className="public-page__intro">{intro}</p>}
          <div className="public-page__content">{children}</div>
        </main>
      </div>
      <PublicSiteFooter className="public-site-footer--page" />
    </div>
  )
}
