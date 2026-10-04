import type { LatLng } from '@/lib/gps'
import type { YMaps21Api } from '@/types/yandex-maps-21-global'
import { YANDEX_STREET_ZOOM } from '@/data/telavi-routes'

const SCRIPT_ID = 'cityroute-yandex-maps-21'

let loadPromise: Promise<YMaps21Api> | null = null

export function getYandexMapsApiKey(): string | null {
  const key = import.meta.env.VITE_YANDEX_MAPS_KEY?.trim()
  return key || null
}

export function hasYandexMapsKey(): boolean {
  return Boolean(getYandexMapsApiKey())
}

function rejectLoad(error: Error) {
  loadPromise = null
  document.getElementById(SCRIPT_ID)?.remove()
  delete window.ymaps
  return error
}

export function loadYandexMaps(apiKey: string): Promise<YMaps21Api> {
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const finishReady = () => {
      if (!window.ymaps) {
        reject(rejectLoad(new Error('Yandex Maps API unavailable')))
        return
      }
      window.ymaps.ready(() => {
        if (!window.ymaps) {
          reject(rejectLoad(new Error('Yandex Maps API unavailable')))
          return
        }
        resolve(window.ymaps)
      })
    }

    if (window.ymaps) {
      finishReady()
      return
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', finishReady, { once: true })
      existing.addEventListener('error', () => reject(rejectLoad(new Error('Yandex script failed to load'))), {
        once: true,
      })
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.async = true
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`
    script.onload = finishReady
    script.onerror = () => reject(rejectLoad(new Error('Yandex script failed to load')))
    document.head.appendChild(script)
  })

  return loadPromise.catch((error: Error) => {
    throw rejectLoad(error instanceof Error ? error : new Error(String(error)))
  })
}

export function toYandex21Coords(latLng: LatLng): number[] {
  return [latLng[0], latLng[1]]
}

export function toYandex21Line(points: LatLng[]): number[][] {
  return points.map(toYandex21Coords)
}

export { YANDEX_STREET_ZOOM }

export function createNavArrowLayout(ymaps: YMaps21Api) {
  return ymaps.templateLayoutFactory.createClass(
    '<div class="nav-arrow-marker"><div class="nav-arrow-wrap"><div class="nav-arrow"></div><div class="nav-arrow-dot"></div></div></div>',
  )
}

export function createPinLayout(ymaps: YMaps21Api, pulse: boolean) {
  const pulseClass = pulse ? ' exam-yandex-pin--pulse' : ''
  return ymaps.templateLayoutFactory.createClass(`<div class="exam-yandex-pin${pulseClass}"></div>`)
}
