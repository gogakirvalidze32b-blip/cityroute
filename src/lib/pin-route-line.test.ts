import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRoadTrace, examRouteLine, maxPinOffsetFromLineM, pinRouteLine } from '@/lib/pin-route-line'

describe('production street line for Telavi routes 1–4', () => {
  it('keeps route 1 official pins and route 4 audited pins', () => {
    expect(TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-1')!.pins.length).toBeGreaterThan(1)
    expect(TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-4')!.pins).toHaveLength(32)
  })

  it.each([
    ['route-1', 34],
    ['route-2', 29],
    ['route-3', 31],
    ['route-4', 32],
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
