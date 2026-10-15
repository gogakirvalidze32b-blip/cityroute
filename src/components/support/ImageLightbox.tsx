import { useEffect } from 'react'
import { S } from '@/lib/support/strings'

export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sc-lightbox" role="dialog" aria-modal="true" aria-label={S.openImage} onClick={onClose}>
      <button type="button" className="sc-lightbox__close" onClick={onClose} aria-label={S.closeImage}>
        ✕
      </button>
      <img src={src} alt="" className="sc-lightbox__img" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}
