import { useEffect, useRef } from 'react'
import { TERMS_CONTENT } from '@/pages/PublicInfoPage'
import '@/styles/rules-terms.css'

type Props = {
  open: boolean
  /** Closed without confirming (✕, Esc, backdrop). */
  onClose: () => void
  /** The button at the very end of the text ("წავიკითხე" — the terms were read). */
  onRead: () => void
  /** Label of that end button (default "წავიკითხე"). */
  readLabel?: string
}

/**
 * Full Rules & Terms in a dialog (same text as the /terms page). The confirm
 * button sits at the end of the text, so the reader scrolls through it first.
 */
export function TermsDialog({ open, onClose, onRead, readLabel = 'წავიკითხე' }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="terms-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="terms-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-dialog-title"
        tabIndex={-1}
        data-testid="terms-dialog"
      >
        <div className="terms-dialog__header">
          <h2 id="terms-dialog-title">{TERMS_CONTENT.title}</h2>
          <button type="button" className="terms-dialog__close" aria-label="დახურვა" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="terms-dialog__body">
          <p className="rules-terms__intro">{TERMS_CONTENT.intro}</p>
          {TERMS_CONTENT.sections.map((section) => (
            <section key={section.heading} className="rules-terms__section">
              <h3>{section.heading}</h3>
              {section.content}
            </section>
          ))}
          <button type="button" className="terms-dialog__read" onClick={onRead}>
            {readLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
