import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ALLOWED_IMAGE_TYPES, MAX_ATTACHMENTS, MAX_BODY_LENGTH } from '@/lib/support/constants'
import { validateSelection, type AcceptedImage } from '@/lib/support/image-validation'
import { loadDraft, saveDraft } from '@/lib/support/outbox-storage'
import { S } from '@/lib/support/strings'
import { uuid } from '@/lib/support/uuid'

interface Picked extends AcceptedImage {
  id: string
  previewUrl: string | null
}

export interface ComposerProps {
  /** Returns an error text if the message was rejected locally. */
  onSend: (input: { body: string; images: AcceptedImage[] }) => string | null
  disabled?: boolean
  placeholder?: string
  allowImages?: boolean
  /** When set, the unsent text is kept as a draft per user. */
  draftUserId?: string | null
}

function makeUrl(file: File): string | null {
  try {
    return URL.createObjectURL(file)
  } catch {
    return null
  }
}

export function Composer({ onSend, disabled, placeholder, allowImages = true, draftUserId }: ComposerProps) {
  const [text, setText] = useState(() => (draftUserId ? loadDraft(draftUserId) : ''))
  const [picked, setPicked] = useState<Picked[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pickedRef = useRef<Picked[]>([])
  pickedRef.current = picked

  // Auto-grow up to a comfortable height; longer text scrolls inside.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  useEffect(() => {
    if (draftUserId) saveDraft(draftUserId, text)
  }, [text, draftUserId])

  useEffect(
    () => () => {
      pickedRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
    },
    [],
  )

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const { accepted, errors: errs } = await validateSelection(pickedRef.current.length, files)
    setErrors(errs)
    if (accepted.length > 0) {
      setPicked((prev) => [...prev, ...accepted.map((a) => ({ ...a, id: uuid(), previewUrl: makeUrl(a.file) }))])
    }
  }, [])

  function removePick(id: string) {
    setPicked((prev) => {
      const gone = prev.find((p) => p.id === id)
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
    setErrors([])
  }

  function submit() {
    if (disabled) return
    const body = text.trim()
    if (!body && picked.length === 0) return
    if (body.length > MAX_BODY_LENGTH) {
      setErrors([S.bodyTooLong(MAX_BODY_LENGTH)])
      return
    }
    const err = onSend({ body, images: picked.map(({ file, mime }) => ({ file, mime })) })
    if (err) {
      setErrors([err])
      return
    }
    // The thread now owns the message (and shows "sending…" / "retry"), so
    // clearing here can never lose text. Blob URLs live on in the bubble.
    pickedRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
    setText('')
    setPicked([])
    setErrors([])
    if (draftUserId) saveDraft(draftUserId, '')
    taRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline. Never send while an IME
    // composition is active.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!allowImages) return
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length > 0) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  const canSend = !disabled && (text.trim().length > 0 || picked.length > 0)
  const remaining = MAX_BODY_LENGTH - text.length

  return (
    <div className="sc-composer">
      {errors.length > 0 && (
        <div className="sc-errors" role="alert">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {picked.length > 0 && (
        <div className="sc-previews">
          {picked.map((p) => (
            <div className="sc-preview" key={p.id}>
              {p.previewUrl && <img src={p.previewUrl} alt="" />}
              <button type="button" onClick={() => removePick(p.id)} aria-label={S.removeImage} title={S.removeImage}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="sc-composer__row">
        {allowImages && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED_IMAGE_TYPES.join(',')}
              multiple
              hidden
              data-testid="support-file-input"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                void addFiles(files)
              }}
            />
            <button
              type="button"
              className="sc-attach"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || picked.length >= MAX_ATTACHMENTS}
              aria-label={S.attach}
              title={S.attach}
            >
              📎
            </button>
          </>
        )}
        <textarea
          ref={taRef}
          className="sc-input"
          rows={1}
          value={text}
          placeholder={placeholder ?? S.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={disabled}
          aria-label={placeholder ?? S.placeholder}
          enterKeyHint="send"
        />
        <button type="button" className="sc-send" onClick={submit} disabled={!canSend}>
          {S.send}
        </button>
      </div>

      <div className="sc-composer__hint">
        <span>{S.composerHint}</span>
        {remaining < 400 && <span className={remaining < 0 ? 'sc-over' : ''}>{remaining}</span>}
      </div>
    </div>
  )
}
