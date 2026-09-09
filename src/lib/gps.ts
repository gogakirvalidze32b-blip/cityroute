import { lineString, point } from '@turf/helpers'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import distance from '@turf/distance'
import bearing from '@turf/bearing'

export type LatLng = [number, number]

export function snapToRoute(position: LatLng, route: LatLng[]): LatLng {
  if (route.length < 2) return position
  const line = lineString(route.map(([lat, lng]) => [lng, lat]))
  const pt = point([position[1], position[0]])
  const snapped = nearestPointOnLine(line, pt)
  const [lng, lat] = snapped.geometry.coordinates
  return [lat, lng]
}

export function distanceToPinMeters(from: LatLng, to: LatLng): number {
  return distance(point([from[1], from[0]]), point([to[1], to[0]]), { units: 'meters' })
}

export function headingMatches(user: LatLng, pin: LatLng, userHeading: number | null, tolerance = 55): boolean {
  if (userHeading == null || Number.isNaN(userHeading)) return true
  const target = bearing(point([user[1], user[0]]), point([pin[1], pin[0]]))
  let diff = Math.abs(target - userHeading)
  if (diff > 180) diff = 360 - diff
  return diff <= tolerance
}

export type GpsPosition = {
  lat: number
  lng: number
  accuracy: number
  heading: number | null
  speed: number | null
  timestamp: number
}

export function getGpsEnvironmentIssue(): string | null {
  if (typeof window === 'undefined') return null
  if (!window.isSecureContext) {
    return 'GPS მუშაობს მხოლოდ localhost-ზე ან HTTPS-ზე. კომპიუტერზე გახსენი http://localhost:5173, ტელეფონზე — https მისამართით (npm run dev).'
  }
  if (!navigator.geolocation) {
    return 'შენი ბრაუზერი GPS-ს არ უჭერს მხარს.'
  }
  return null
}

const GPS_CONSENT_KEY = 'cityroute-gps-consent'

export function markGpsConsentGranted() {
  try {
    localStorage.setItem(GPS_CONSENT_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function clearGpsConsent() {
  try {
    localStorage.removeItem(GPS_CONSENT_KEY)
  } catch {
    /* ignore */
  }
}

function hasStoredGpsConsent(): boolean {
  try {
    return localStorage.getItem(GPS_CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

export function hasGpsConsent(): boolean {
  return hasStoredGpsConsent()
}

export async function queryGeolocationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (!('permissions' in navigator)) return 'unknown'
  try {
    const result = await navigator.permissions.query({ name: 'geolocation' })
    return result.state
  } catch {
    return 'unknown'
  }
}

/** True when browser already allowed GPS or user allowed once in this app. */
export async function shouldAutoStartGps(): Promise<boolean> {
  if (getGpsEnvironmentIssue()) return false
  const perm = await queryGeolocationPermission()
  if (perm === 'denied') return false
  if (perm === 'granted') return true
  return hasStoredGpsConsent()
}

export function formatGpsError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'ლოკაცია უარყოფილია. ბრაუზერში დაუშვი ლოკაცია (🔒 → საიტის პარამეტრები) და Windows-ში ჩართე ლოკაცია.'
    case err.POSITION_UNAVAILABLE:
      return 'GPS ვერ მოიძებნა. ჩართე ტელეფონზე ლოკაცია და გადადი ღია ადგილას.'
    case err.TIMEOUT:
      return 'GPS-ის მიღება შეფერხდა. სცადე თავიდან.'
    default:
      return err.message || 'GPS შეცდომა'
  }
}

export function requestGpsOnce(options?: { allowCached?: boolean }): Promise<GpsPosition> {
  return new Promise((resolve, reject) => {
    const envIssue = getGpsEnvironmentIssue()
    if (envIssue) {
      reject(new Error(envIssue))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (p) => {
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          heading: p.coords.heading,
          speed: p.coords.speed,
          timestamp: p.timestamp,
        })
      },
      (err) => reject(new Error(formatGpsError(err))),
      {
        enableHighAccuracy: true,
        maximumAge: options?.allowCached ? 60_000 : 0,
        timeout: 15000,
      },
    )
  })
}

export function watchGps(
  onUpdate: (pos: GpsPosition) => void,
  onError?: (err: GeolocationPositionError) => void,
): () => void {
  const envIssue = getGpsEnvironmentIssue()
  if (envIssue) {
    onError?.({
      code: 1,
      message: envIssue,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError)
    return () => undefined
  }

  const id = navigator.geolocation.watchPosition(
    (p) => {
      onUpdate({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        heading: p.coords.heading,
        speed: p.coords.speed,
        timestamp: p.timestamp,
      })
    },
    (err) => onError?.(err),
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    },
  )

  return () => navigator.geolocation.clearWatch(id)
}

export async function requestWakeLock(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request('screen')
    return () => void lock?.release()
  } catch {
    return () => undefined
  }
}
