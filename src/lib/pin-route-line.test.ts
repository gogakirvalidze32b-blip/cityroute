import { describe, expect, it } from 'vitest'
import audioPins from '@/data/audio-audit-pins.fixture.json'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRoadTrace, examRouteLine, maxPinOffsetFromLineM, pinRouteLine } from '@/lib/pin-route-line'

type FixturePin = { route: number; pin: number; lat: number; lng: number }

function fixturePins(route: number) {
  return (audioPins as FixturePin[])
    .filter((pin) => pin.route === route)
    .map((pin) => ({ lat: pin.lat, lng: pin.lng, sort_order: pin.pin }))
}

describe('production street line for routes 2 and 3 only', () => {
  it('does not change route 1 or 4 local pin lists', () => {
    expect(TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-1')!.pins.length).toBeGreaterThan(1)
    expect(TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-4')!.pins).toEqual([])
  })

  it('has no bundled street trace for routes 1 and 4', () => {
    expect(examRoadTrace('route-1', fixturePins(1))).toBeNull()
    expect(examRoadTrace('route-4', fixturePins(4))).toBeNull()
  })

  it.each([
    ['route-2', 29],
    ['route-3', 31],
  ] as const)('%s local pins follow the street trace in pin order', (slug, count) => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const line = examRouteLine(slug, pins)
    expect(pins).toHaveLength(count)
    expect(pins.map((pin) => pin.sort_order)).toEqual(Array.from({ length: count }, (_, index) => index + 1))
    expect(line).toEqual(examRoadTrace(slug, pins))
    expect(line.length).toBeGreaterThan(pinRouteLine(pins).length)
    expect(maxPinOffsetFromLineM(pins.map((pin) => [pin.lat, pin.lng]), line)).toBeLessThanOrEqual(40)
  })
})
