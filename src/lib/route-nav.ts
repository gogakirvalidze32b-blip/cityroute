import along from '@turf/along'
import { lineString, point } from '@turf/helpers'
import length from '@turf/length'
import bearing from '@turf/bearing'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import { distanceToPinMeters, type GpsPosition, type LatLng } from '@/lib/gps'

export type RouteProgressInfo = {
  traversedM: number
  totalM: number
  remainingM: number
  pct: number
  snapIndex: number
  snapPoint: LatLng
}

export type RouteSessionSummary = {
  routeId: string
  routeName: string
  startedAt: number
  finishedAt: number
  elapsedMs: number
  distanceTraveledM: number
  routeLengthM: number
  routeProgressPct: number
  avgSpeedKmh: number
  maxSpeedKmh: number
}

export function routeLengthMeters(route: LatLng[]): number {
  if (route.length < 2) return 0
  const line = lineString(route.map(([lat, lng]) => [lng, lat]))
  return length(line, { units: 'meters' })
}

export function routeProgressInfo(position: LatLng, route: LatLng[]): RouteProgressInfo {
  if (route.length < 2) {
    return { traversedM: 0, totalM: 0, remainingM: 0, pct: 0, snapIndex: 0, snapPoint: position }
  }

  const line = lineString(route.map(([lat, lng]) => [lng, lat]))
  const totalM = length(line, { units: 'meters' })
  const snapped = nearestPointOnLine(line, point([position[1], position[0]]))
  const idx = (snapped.properties.index as number) ?? 0
  const [snapLng, snapLat] = snapped.geometry.coordinates
  const snapPoint: LatLng = [snapLat, snapLng]

  let traversedM = 0
  for (let i = 0; i < idx; i++) {
    traversedM += distanceToPinMeters(route[i], route[i + 1])
  }
  traversedM += distanceToPinMeters(route[idx], snapPoint)

  const remainingM = Math.max(0, totalM - traversedM)
  const pct = totalM > 0 ? (traversedM / totalM) * 100 : 0

  return { traversedM, totalM, remainingM, pct, snapIndex: idx, snapPoint }
}

export function splitRouteAt(position: LatLng, route: LatLng[]): { passed: LatLng[]; remaining: LatLng[] } {
  if (route.length < 2) return { passed: [], remaining: route }

  const info = routeProgressInfo(position, route)
  const passed = [...route.slice(0, info.snapIndex + 1), info.snapPoint]
  const remaining = [info.snapPoint, ...route.slice(info.snapIndex + 1)]

  return { passed, remaining }
}

export function headingOnRoute(position: LatLng, route: LatLng[]): number {
  if (route.length < 2) return 0

  const info = routeProgressInfo(position, route)
  const from = info.snapPoint
  const nextIdx = Math.min(info.snapIndex + 1, route.length - 1)
  const to = route[nextIdx]

  if (distanceToPinMeters(from, to) < 1 && info.snapIndex > 0) {
    const prev = route[info.snapIndex]
    return bearing(point([prev[1], prev[0]]), point([from[1], from[0]]))
  }

  return bearing(point([from[1], from[0]]), point([to[1], to[0]]))
}

export function resolveHeading(
  gps: GpsPosition,
  previousRaw: LatLng | null,
  raw: LatLng,
  route: LatLng[],
): number {
  if (
    gps.heading != null &&
    !Number.isNaN(gps.heading) &&
    gps.heading >= 0 &&
    (gps.speed ?? 0) > 0.4
  ) {
    return gps.heading
  }

  if (previousRaw && distanceToPinMeters(previousRaw, raw) > 2) {
    return bearing(point([previousRaw[1], previousRaw[0]]), point([raw[1], raw[0]]))
  }

  return headingOnRoute(raw, route)
}

export function gpsToLatLng(gps: GpsPosition): LatLng {
  return [gps.lat, gps.lng]
}

/** ~5 km/h — car started rolling */
export function isDriving(speedMs: number | null, movedM: number): boolean {
  return msToKmh(speedMs) >= 5 || movedM >= 20
}

export function routeMidpoint(route: LatLng[]): LatLng {
  if (route.length === 0) return [0, 0]
  if (route.length === 1) return route[0]

  const line = lineString(route.map(([lat, lng]) => [lng, lat]))
  const totalM = length(line, { units: 'meters' })
  const mid = along(line, totalM / 2, { units: 'meters' })
  const [lng, lat] = mid.geometry.coordinates
  return [lat, lng]
}

export function shouldAutoFinish(
  progress: RouteProgressInfo,
  distanceTraveledM: number,
  finishPoint: LatLng,
  currentPos: LatLng,
): boolean {
  const nearFinish = distanceToPinMeters(currentPos, finishPoint) <= 45
  const enoughProgress = progress.pct >= 85
  const enoughTravel = distanceTraveledM >= progress.totalM * 0.68
  return nearFinish && enoughProgress && enoughTravel
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} კმ`
  return `${Math.round(m)} მ`
}

export function formatSpeed(kmh: number): string {
  return `${Math.round(kmh)} კმ/ს`
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('ka-GE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function msToKmh(speedMs: number | null): number {
  if (speedMs == null || Number.isNaN(speedMs)) return 0
  return Math.max(0, speedMs * 3.6)
}

/** Below this, treat as parked (GPS drift / sensor noise). */
const STATIONARY_MAX_KMH = 4
const DRIVING_START_M = 3

export type SpeedTracker = {
  drivingStarted: boolean
  movedM: number
}

export function createSpeedTracker(): SpeedTracker {
  return { drivingStarted: false, movedM: 0 }
}

function movementNoiseFloorM(current: GpsPosition, previous: GpsPosition): number {
  const accuracyM = Math.max(current.accuracy, previous.accuracy, 5)
  return Math.max(2.5, accuracyM * 0.35)
}

function displaySpeedKmh(kmh: number): number {
  const rounded = Math.round(kmh)
  return rounded <= STATIONARY_MAX_KMH ? 0 : rounded
}

/** Prefer device GPS speed; fall back to distance between last two fixes. */
export function resolveSpeedKmh(current: GpsPosition, previous: GpsPosition | null): number {
  if (previous) {
    const dtSec = (current.timestamp - previous.timestamp) / 1000
    if (dtSec >= 0.5 && dtSec <= 20) {
      const distM = distanceToPinMeters([previous.lat, previous.lng], [current.lat, current.lng])
      if (distM < movementNoiseFloorM(current, previous) || distM > 100) return 0
      return displaySpeedKmh(msToKmh(distM / dtSec))
    }
  }

  if (current.speed != null && !Number.isNaN(current.speed) && current.speed >= 0) {
    return displaySpeedKmh(msToKmh(current.speed))
  }

  return 0
}

/** Exam HUD: stay at 0 until the car has actually moved ~3 m. */
export function resolveExamSpeedKmh(
  current: GpsPosition,
  previous: GpsPosition | null,
  tracker: SpeedTracker,
): number {
  if (previous) {
    const distM = distanceToPinMeters([previous.lat, previous.lng], [current.lat, current.lng])
    if (distM >= movementNoiseFloorM(current, previous) && distM <= 100) {
      tracker.movedM += distM
    }
  }

  if (!tracker.drivingStarted) {
    if (tracker.movedM < DRIVING_START_M) return 0
    tracker.drivingStarted = true
  }

  return resolveSpeedKmh(current, previous)
}

export function saveSessionSummary(summary: RouteSessionSummary) {
  const key = `cityroute-sessions-${summary.routeId}`
  const existing = loadSessionHistory(summary.routeId)
  const next = [summary, ...existing].slice(0, 10)
  localStorage.setItem(key, JSON.stringify(next))
}

export function loadSessionHistory(routeId: string): RouteSessionSummary[] {
  try {
    const raw = localStorage.getItem(`cityroute-sessions-${routeId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RouteSessionSummary[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
