import {
  MAX_GPS_PASS_GAP_MS,
  projectPointToRoute,
  type PreparedRouteGeometry,
  type RouteMatchResult,
  type RouteMatchState,
} from '@/lib/pure-route-geometry'

export const COMMON_FINISH_INSTRUCTIONS = [
  '500 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ',
  '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ',
  'მალე, გთხოვთ მოუხვიოთ მარჯვნივ',
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ',
  'ფინიში',
] as const

export const FINISH_SECTION_PIN_COUNT = 3

export interface PinOrderRange {
  readonly start: number
  readonly end: number
}

/** Routes that play session დაწყება / ფინიში voices. */
export const SESSION_VOICE_ROUTES = new Set(['route-1', 'route-2', 'route-3', 'route-4'])

/**
 * Fallback circle around PIN 1 (agency) for ფინიში / გილოცავთ.
 * Primary finish gate is ALAZANI_SESSION_ZONE.
 */
export const SESSION_VOICE_PIN1_RADIUS_M = 800

/** დაწყება — only within this radius of PIN 1. */
export const SESSION_START_VOICE_RADIUS_M = 30
/**
 * Alazani Avenue corridor around the MIA Telavi agency (red-oval exam zone).
 * Finish / success voices play while GPS is inside this box.
 */
export const ALAZANI_SESSION_ZONE = {
  minLat: 41.9235,
  maxLat: 41.9375,
  minLng: 45.4675,
  maxLng: 45.4835,
} as const

/** @deprecated Kept for finish-range docs/tests; start voice is PIN 1 30 m gated. */
export const START_AUDIO_PIN_RANGES: Readonly<Record<string, PinOrderRange>> = {
  'route-1': { start: 1, end: 1 },
  'route-2': { start: 1, end: 1 },
  'route-3': { start: 1, end: 1 },
  'route-4': { start: 1, end: 1 },
}

export const ROUTE_FINISH_PIN_RANGES: Readonly<Record<string, PinOrderRange>> = {
  'route-1': { start: 29, end: 34 },
  'route-2': { start: 22, end: 28 },
  'route-3': { start: 25, end: 30 },
  'route-4': { start: 26, end: 31 },
}

/** Empty: exam never auto-finishes — examiner must press დასრულება. */
const GPS_AUTO_FINISH_ROUTES = new Set<string>()
const FINISH_PIN_APPROACH_METERS = 20
const MAX_FINISH_CROSS_TRACK_METERS = 20

type LatLngLike = { readonly lat: number; readonly lng: number } | readonly [number, number]

function asLatLng(point: LatLngLike): [number, number] {
  if (typeof point === 'object' && point !== null && 'lat' in point && 'lng' in point) {
    return [point.lat, point.lng]
  }
  return [point[0], point[1]]
}

function distanceMeters(a: LatLngLike, b: LatLngLike): number {
  const [lat1, lng1] = asLatLng(a)
  const [lat2, lng2] = asLatLng(b)
  const earthRadiusMeters = 6371000
  const latitudeDelta = ((lat2 - lat1) * Math.PI) / 180
  const longitudeDelta = ((lng2 - lng1) * Math.PI) / 180
  const latitude1 = (lat1 * Math.PI) / 180
  const latitude2 = (lat2 * Math.PI) / 180
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(value))
}

/** True when GPS is on the Alazani Avenue exam corridor (agency strip). */
export function isInAlazaniSessionZone(
  position: LatLngLike | null | undefined,
): boolean {
  if (!position) return false
  const [lat, lng] = asLatLng(position)
  return (
    lat >= ALAZANI_SESSION_ZONE.minLat &&
    lat <= ALAZANI_SESSION_ZONE.maxLat &&
    lng >= ALAZANI_SESSION_ZONE.minLng &&
    lng <= ALAZANI_SESSION_ZONE.maxLng
  )
}

/** True on Alazani corridor, or within SESSION_VOICE_PIN1_RADIUS_M of PIN 1. */
export function isNearPin1ForSessionVoice(
  position: LatLngLike | null | undefined,
  pin1: LatLngLike | null | undefined,
  radiusM = SESSION_VOICE_PIN1_RADIUS_M,
): boolean {
  if (!position) return false
  if (isInAlazaniSessionZone(position)) return true
  if (!pin1) return false
  return distanceMeters(position, pin1) <= radiusM
}

/** დაწყება — only within 30 m of PIN 1 (not PIN 2 / whole Alazani strip). */
export function isStartAudioAllowed(
  routeSlug: string,
  position: LatLngLike | null | undefined,
  pin1: LatLngLike | null | undefined,
  _pin2?: LatLngLike | null | undefined,
): boolean {
  if (!SESSION_VOICE_ROUTES.has(routeSlug) || !position) return false
  if (pin1 && distanceMeters(position, pin1) <= SESSION_START_VOICE_RADIUS_M) return true
  return false
}

/** ფინიში / გილოცავთ — same Alazani / PIN-1 gate as start. */
export function isFinishAudioAllowed(
  routeSlug: string,
  position: LatLngLike | null | undefined,
  pin1: LatLngLike | null | undefined,
): boolean {
  return SESSION_VOICE_ROUTES.has(routeSlug) && isNearPin1ForSessionVoice(position, pin1)
}

export interface RouteFinishGpsInput {
  readonly routeSlug: string
  readonly pins: readonly { readonly sort_order: number; readonly lat: number; readonly lng: number }[]
  readonly handledOrders: ReadonlySet<number>
  readonly geometry: PreparedRouteGeometry
  readonly match: RouteMatchResult
  readonly previous: RouteMatchState | null
}

export function isRouteFinishGpsReady(input: RouteFinishGpsInput): boolean {
  const { routeSlug, pins, handledOrders, geometry, match, previous } = input
  const finishRange = ROUTE_FINISH_PIN_RANGES[routeSlug]
  if (!finishRange || !GPS_AUTO_FINISH_ROUTES.has(routeSlug)) return false
  const finalOrder = Math.max(...pins.map((pin) => pin.sort_order))
  if (
    pins.length === 0 ||
    !pins.some((pin) => pin.sort_order === finishRange.start) ||
    !pins.some((pin) => pin.sort_order === finishRange.end) ||
    !pins.every((pin) => pin.sort_order > finalOrder || handledOrders.has(pin.sort_order))
  ) {
    return false
  }
  for (let order = finishRange.start; order <= finishRange.end; order += 1) {
    if (!pins.some((pin) => pin.sort_order === order) || !handledOrders.has(order)) return false
  }
  if (
    !match.accepted ||
    !match.projection ||
    !match.nextState ||
    !previous ||
    match.nextState.timestampMs - previous.timestampMs > MAX_GPS_PASS_GAP_MS ||
    match.direction !== 'forward' ||
    match.nextState.chainageMeters - previous.chainageMeters < 2 ||
    match.projection.crossTrackMeters > MAX_FINISH_CROSS_TRACK_METERS
  ) {
    return false
  }

  const finalPin = pins.find((pin) => pin.sort_order === finalOrder)
  if (!finalPin) return false
  const finalPinProjection = projectPointToRoute(geometry, [finalPin.lat, finalPin.lng])
  return finalPinProjection !== null &&
    match.projection.chainageMeters >= finalPinProjection.chainageMeters - FINISH_PIN_APPROACH_METERS
}

export function applyCommonFinishInstructions<T extends { instruction_ka: string; sort_order: number }>(
  pins: T[],
): T[] {
  const firstFinishOrder =
    Math.max(...pins.map((pin) => pin.sort_order)) - COMMON_FINISH_INSTRUCTIONS.length + 1
  return pins.map((pin) => {
    const instructionIndex = pin.sort_order - firstFinishOrder
    return instructionIndex < 0 || instructionIndex >= COMMON_FINISH_INSTRUCTIONS.length
      ? pin
      : { ...pin, instruction_ka: COMMON_FINISH_INSTRUCTIONS[instructionIndex] }
  })
}

export function finishSectionStartIndex(totalPins: number): number {
  return Math.max(0, totalPins - FINISH_SECTION_PIN_COUNT)
}
