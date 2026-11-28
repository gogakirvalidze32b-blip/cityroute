import { useCallback, useState } from 'react'
import { TermsDialog } from '@/components/TermsDialog'
import '@/styles/rules-terms.css'

type Props = {
  className?: string
}

/**
 * Small "წესები და პირობები" text link at the bottom of a page (Login, the
 * signed-in Home, the Preview Demo home). Opens the full terms window.
 */
export function TermsFooterLink({ className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <div className={`home-terms ${className}`.trim()} data-testid="home-terms">
      <button type="button" className="home-terms__link" onClick={() => setOpen(true)}>
        წესები და პირობები
      </button>
      <TermsDialog open={open} onClose={close} onRead={close} readLabel="დახურვა" />
    </div>
  )
}
