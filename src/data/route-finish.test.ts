import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from './telavi-routes'
import { resolvePinAudioUrl } from './route-audio'
import {
  COMMON_FINISH_INSTRUCTIONS,
  isRouteFinishGpsReady,
  isStartAudioAllowed,
  ROUTE_FINISH_PIN_RANGES,
  START_AUDIO_PIN_RANGES,
  finishSectionStartIndex,
} from './route-finish'
import { decidePinAudio } from '@/lib/pin-audio'
import route1Road from './route-1-road.json'
import route2Road from './route-2-road.json'
import route3Road from './route-3-road.json'
import route4Road from './route-4-road.json'
import {
  matchGpsPosition,
  prepareRouteGeometry,
  type ActiveRouteId,
  type LatLng,
  type PreparedRouteGeometry,
} from '@/lib/pure-route-geometry'

const roads: Record<ActiveRouteId, LatLng[]> = {
  'route-1': route1Road.map(([lat, lng]) => [lat, lng] as const),
  'route-2': route2Road.map(([lat, lng]) => [lat, lng] as const),
  'route-3': route3Road.map(([lat, lng]) => [lat, lng] as const),
  'route-4': route4Road.map(([lat, lng]) => [lat, lng] as const),
}

function pointAt(geometry: PreparedRouteGeometry, requestedChainage: number): LatLng {
  const bounded = Math.max(0, Math.min(geometry.totalLengthMeters, requestedChainage))
  const index = geometry.cumulativeMeters.findIndex(
    (value, current) =>
      current < geometry.cumulativeMeters.length - 1 &&
      value <= bounded &&
      bounded <= geometry.cumulativeMeters[current + 1],
  )
  const segment = index < 0 ? geometry.coordinates.length - 2 : index
  const start = geometry.coordinates[segment]
  const end = geometry.coordinates[segment + 1]
  const segmentLength = geometry.cumulativeMeters[segment + 1] - geometry.cumulativeMeters[segment]
  const fraction = (bounded - geometry.cumulativeMeters[segment]) / segmentLength
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ]
}

function makeFinalForwardMatch(routeId: ActiveRouteId) {
  const geometry = prepareRouteGeometry(routeId, roads[routeId])
  let state = null as ReturnType<typeof matchGpsPosition>['nextState']
  let timestampMs = 100_000
  for (let chainage = 0; chainage < geometry.totalLengthMeters - 50; chainage += 50) {
    timestampMs += 1_000
    const result = matchGpsPosition(
      geometry,
      {
        position: pointAt(geometry, chainage),
        accuracyMeters: 3,
        timestampMs,
      },
      state,
      { nowMs: timestampMs, maxAccuracyMeters: 12, maxCrossTrackMeters: 20 },
    )
    if (result.accepted && result.nextState) state = result.nextState
  }
  if (!state) throw new Error('Expected route match before final segment')
  timestampMs += 1_000
  const previousResult = matchGpsPosition(
    geometry,
    {
      position: pointAt(geometry, geometry.totalLengthMeters - 50),
      accuracyMeters: 3,
      timestampMs,
    },
    state,
    { nowMs: timestampMs, maxAccuracyMeters: 12, maxCrossTrackMeters: 20 },
  )
  if (!previousResult.accepted || !previousResult.nextState) {
    throw new Error('Expected forward road match before finish')
  }
  state = previousResult.nextState
  timestampMs += 1_000
  const match = matchGpsPosition(
    geometry,
    {
      position: pointAt(geometry, geometry.totalLengthMeters - 5),
      accuracyMeters: 3,
      timestampMs,
    },
    state,
    { nowMs: timestampMs, maxAccuracyMeters: 12, maxCrossTrackMeters: 20 },
  )
  return { geometry, previous: state, match }
}

describe('shared finish sequence', () => {
  it('uses one ordered finish instruction sequence for all four routes', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const finishPins = route.pins.slice(-COMMON_FINISH_INSTRUCTIONS.length)

      expect(finishPins.map((pin) => pin.instruction_ka)).toEqual(COMMON_FINISH_INSTRUCTIONS)
      for (const pin of finishPins) {
        expect(resolvePinAudioUrl(slug, pin)).not.toBeNull()
      }
    }
  })

  it('keeps finish-section gating shared and applies it to each route size', () => {
    expect(
      [35, 29, 30, 32].map((pinCount) => finishSectionStartIndex(pinCount)),
    ).toEqual([32, 26, 27, 29])
  })

  it('keeps Route 3 PIN orders and finish instructions stable across the removed #12 gap', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    expect(pins.some((pin) => pin.sort_order === 12)).toBe(false)
    expect(pins.map((pin) => pin.sort_order).slice(9, 13)).toEqual([10, 11, 13, 14])
    expect(pins.slice(-7).map((pin) => pin.instruction_ka)).toEqual(COMMON_FINISH_INSTRUCTIONS)
    expect(pins.find((pin) => pin.sort_order === 29)?.instruction_ka).toBe(
      'მალე, გთხოვთ მოუხვიოთ მარჯვნივ',
    )
  })

  it('defines the requested inclusive start and finish PIN ranges', () => {
    expect(START_AUDIO_PIN_RANGES).toEqual({
      'route-1': { start: 1, end: 5 },
      'route-2': { start: 1, end: 4 },
      'route-3': { start: 1, end: 5 },
      'route-4': { start: 1, end: 5 },
    })
    expect(ROUTE_FINISH_PIN_RANGES).toEqual({
      'route-1': { start: 29, end: 34 },
      'route-2': { start: 22, end: 28 },
      'route-3': { start: 25, end: 30 },
      'route-4': { start: 26, end: 31 },
    })

    for (const [slug, range] of Object.entries(START_AUDIO_PIN_RANGES)) {
      expect(isStartAudioAllowed(slug, range.start)).toBe(true)
      expect(isStartAudioAllowed(slug, range.end)).toBe(true)
      expect(isStartAudioAllowed(slug, range.start - 1)).toBe(false)
      expect(isStartAudioAllowed(slug, range.end + 1)).toBe(false)
    }
    expect(isStartAudioAllowed('route-5', 1)).toBe(false)
  })

  it.each(['route-1', 'route-2', 'route-4'] as const)(
    '%s completes only after all route PINs and forward GPS reaches the final trace segment',
    (routeSlug) => {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === routeSlug)!
      const { geometry, previous, match } = makeFinalForwardMatch(routeSlug)
      const handledOrders = new Set(route.pins.map((pin) => pin.sort_order))
      expect(isRouteFinishGpsReady({
        routeSlug,
        pins: route.pins,
        handledOrders,
        geometry,
        match,
        previous,
      })).toBe(true)

      expect(isRouteFinishGpsReady({
        routeSlug,
        pins: route.pins,
        handledOrders: new Set([...handledOrders].filter((order) => order !== ROUTE_FINISH_PIN_RANGES[routeSlug].end)),
        geometry,
        match,
        previous,
      })).toBe(false)
      expect(match.direction).toBe('forward')

      expect(isRouteFinishGpsReady({
        routeSlug,
        pins: route.pins,
        handledOrders,
        geometry,
        match: {
          ...match,
          nextState: {
            ...match.nextState!,
            timestampMs: previous.timestampMs + 60_001,
          },
        },
        previous,
      })).toBe(false)
    },
  )

  it('does not auto-finish Route 3 while its PIN 30 turn direction is kept isolated', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    const geometry = prepareRouteGeometry('route-3', roads['route-3'])
    expect(isRouteFinishGpsReady({
      routeSlug: 'route-3',
      pins: route.pins,
      handledOrders: new Set(route.pins.map((pin) => pin.sort_order)),
      geometry,
      match: {
        status: 'invalid-fix',
        accepted: false,
        projection: null,
        direction: 'unknown',
        nextState: null,
      },
      previous: null,
    })).toBe(false)
  })

  it('keeps Route 2 #3 and #25 as separate, sequential audio PINs', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')!
    const pin3 = route.pins.find((pin) => pin.sort_order === 3)!
    const pin25 = route.pins.find((pin) => pin.sort_order === 25)!
    expect([pin3.lat, pin3.lng]).toEqual([41.931648, 45.476800])
    expect([pin25.lat, pin25.lng]).toEqual([41.933312, 45.477867])
    expect([pin3.lat, pin3.lng]).not.toEqual([pin25.lat, pin25.lng])
    expect(resolvePinAudioUrl('route-2', pin3)).not.toBeNull()
    expect(resolvePinAudioUrl('route-2', pin25)).not.toBeNull()

    const pinIds = route.pins.map((pin) => pin.id)
    const firstTriggered = new Set(pinIds.slice(0, 2))
    const firstDecision = decidePinAudio({
      pinIds,
      triggered: firstTriggered,
      distanceTo: (index) => (index === 2 ? 10 : 500),
      headingOkAt: () => true,
      minDist: new Map(),
    })
    expect(firstDecision?.index).toBe(2)

    const lateTriggered = new Set(pinIds.slice(0, 24))
    const lateDecision = decidePinAudio({
      pinIds,
      triggered: lateTriggered,
      distanceTo: (index) => (index === 24 ? 10 : 500),
      headingOkAt: () => true,
      minDist: new Map(),
    })
    expect(lateDecision?.index).toBe(24)
  })

  it('maps the updated Route 1 #23 and #24 texts to exact WAV filename stems', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
    const pins = [23, 24].map((order) => route.pins.find((pin) => pin.sort_order === order)!)
    expect([pins[0].lat, pins[0].lng]).toEqual([41.918370, 45.483146])
    expect([pins[1].lat, pins[1].lng]).toEqual([41.918155, 45.481760])
    for (const pin of pins) {
      const filename = decodeURIComponent(resolvePinAudioUrl('route-1', pin)!).split('/').pop()!
      expect(pin.instruction_ka).toBe(filename.replace(/\.wav$/, ''))
    }
  })

  it('updates requested PIN coordinates and preserves Route 3 finish order and audio text', () => {
    const expected = [
      ['route-1', 33],
      ['route-2', 27],
      ['route-3', 29],
      ['route-4', 30],
    ] as const
    for (const [slug, order] of expected) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const pin = route.pins.find((item) => item.sort_order === order)!
      expect([pin.lat, pin.lng]).toEqual([41.931694, 45.476574])
      expect(resolvePinAudioUrl(slug, pin)).not.toBeNull()
    }

    const route3 = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    expect(route3.pins.find((pin) => pin.sort_order === 28)?.instruction_ka).toBe('300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(route3.pins.find((pin) => pin.sort_order === 29)?.instruction_ka).toBe('მალე, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(route3.pins.find((pin) => pin.sort_order === 30)?.instruction_ka).toBe('მალე, გთხოვთ მოუხვიოთ მარცხნივ')
    expect([route3.pins.find((pin) => pin.sort_order === 30)?.lat, route3.pins.find((pin) => pin.sort_order === 30)?.lng])
      .toEqual([41.931327, 45.475788])
  })

  it('updates Route 2 PIN 10 and 11 coordinates without changing their order or instructions', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')!
    const pin10 = route.pins.find((pin) => pin.sort_order === 10)!
    const pin11 = route.pins.find((pin) => pin.sort_order === 11)!
    expect([pin10.lat, pin10.lng]).toEqual([41.923793, 45.502894])
    expect([pin11.lat, pin11.lng]).toEqual([41.922461, 45.501986])
    expect(pin10.instruction_ka).toBe('500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(pin11.instruction_ka).toBe('300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ')
  })
})
