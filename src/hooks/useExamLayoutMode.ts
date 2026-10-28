import { useEffect, useState } from 'react'

export type ExamLayoutMode = 'laptop' | 'tablet' | 'mobile' | 'mobile-landscape'

/** Laptop/desktop = wide screen (1080p incl. 125% Windows scaling ≈ 1536×864). */
export function detectExamLayoutMode(): ExamLayoutMode {
  if (typeof window === 'undefined') return 'tablet'

  const w = window.visualViewport?.width ?? window.innerWidth
  const h = window.visualViewport?.height ?? window.innerHeight
  const shortSide = Math.min(w, h)

  if (w >= 1200 && h >= 680) return 'laptop'
  if (shortSide >= 600) return 'tablet'
  if (w > h) return 'mobile-landscape'
  return 'mobile'
}

const LAPTOP_MQ = '(min-width: 1200px) and (min-height: 680px)'

export function useExamLayoutMode(): ExamLayoutMode {
  const [mode, setMode] = useState<ExamLayoutMode>(detectExamLayoutMode)

  useEffect(() => {
    let fullscreenFrame = 0
    const sync = () => setMode(detectExamLayoutMode())
    const syncFullscreen = () => {
      cancelAnimationFrame(fullscreenFrame)
      fullscreenFrame = requestAnimationFrame(sync)
    }

    sync()
    window.addEventListener('resize', sync, { passive: true })
    window.addEventListener('orientationchange', sync)
    window.visualViewport?.addEventListener('resize', sync, { passive: true })
    document.addEventListener('fullscreenchange', syncFullscreen)

    const landscapeMq = window.matchMedia('(orientation: landscape)')
    landscapeMq.addEventListener('change', sync)

    const laptopMq = window.matchMedia(LAPTOP_MQ)
    laptopMq.addEventListener('change', sync)
    const standaloneMq = window.matchMedia('(display-mode: standalone)')
    standaloneMq.addEventListener('change', sync)

    return () => {
      cancelAnimationFrame(fullscreenFrame)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      window.visualViewport?.removeEventListener('resize', sync)
      document.removeEventListener('fullscreenchange', syncFullscreen)
      landscapeMq.removeEventListener('change', sync)
      laptopMq.removeEventListener('change', sync)
      standaloneMq.removeEventListener('change', sync)
    }
  }, [])

  return mode
}
