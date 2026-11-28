import { useCallback, useState } from 'react'
import { TermsDialog } from '@/components/TermsDialog'
import '@/styles/rules-terms.css'

type Props = {
  accepted: boolean
  onAcceptedChange: (accepted: boolean) => void
}

/**
 * Required "ვეთანხმები წესებსა და პირობებს" checkbox (Registration).
 * Never pre-checked; it can only be ticked after the terms were read
 * ("წავიკითხე" at the end of the text) — before that, clicking it opens them.
 */
export function TermsConsent({ accepted, onAcceptedChange }: Props) {
  const [read, setRead] = useState(false)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const markRead = useCallback(() => {
    setRead(true)
    setOpen(false)
  }, [])

  return (
    <>
      <label className={`terms-consent ${read ? '' : 'is-unread'}`.trim()}>
        <input
          type="checkbox"
          required
          checked={accepted}
          aria-describedby="terms-consent-hint"
          onChange={(e) => {
            // Not read yet: never tick — open the terms instead.
            if (!read) {
              setOpen(true)
              return
            }
            onAcceptedChange(e.target.checked)
          }}
          data-testid="terms-consent"
        />
        <span>
          ვეთანხმები{' '}
          <button
            type="button"
            className="terms-consent__link"
            onClick={(e) => {
              // Opens the terms; does not tick the checkbox.
              e.preventDefault()
              e.stopPropagation()
              setOpen(true)
            }}
          >
            წესებსა და პირობებს
          </button>
        </span>
      </label>
      {!accepted && (
        <p id="terms-consent-hint" className="terms-consent__hint">
          {read ? 'გასაგრძელებლად მონიშნეთ თანხმობა.' : 'ჯერ გაეცანით წესებსა და პირობებს.'}
        </p>
      )}
      <TermsDialog open={open} onClose={close} onRead={markRead} />
    </>
  )
}
