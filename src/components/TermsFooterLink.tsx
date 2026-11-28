import { useCallback, useState } from 'react'
import { TermsDialog } from '@/components/TermsDialog'
import '@/styles/rules-terms.css'

/**
 * Bottom of the signed-in page: a small "წესები და პირობები" text link (same
 * size as the footer text, same look as on the Login page) that opens the full
 * terms in the same window as on Login. Also used by the Preview Demo home.
 */
export function HomeTermsFooter() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <div className="home-terms" data-testid="home-terms">
      <button type="button" className="home-terms__link" onClick={() => setOpen(true)}>
        წესები და პირობები
      </button>
      <TermsDialog open={open} onClose={close} onRead={close} readLabel="დახურვა" />
    </div>
  )
}
