import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { resolveAutoStart } from './auto-start-pin'

const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === 'route-1')!
const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
const at = (order: number) => pins.find((p) => p.sort_order === order)!
const done = (n: number) => new Set(Array.from({ length: n }, (_, i) => i + 1))

describe('resolveAutoStart', () => {
  it('uses the first unpassed PIN from the shared resolver', () => {
    expect(resolveAutoStart(pins, done(13))).toEqual({ pin: at(14), aheadSuggestion: null })
  })

  it('starts a new route at PIN 1', () => {
    expect(resolveAutoStart(pins, new Set()).pin).toBe(at(1))
  })

  it('does not skip an incomplete PIN based on GPS', () => {
    expect(resolveAutoStart(pins, done(13)).pin).toBe(at(14))
  })

  it('does not restart a fully completed route at PIN 1', () => {
    expect(resolveAutoStart(pins, done(pins.length))).toEqual({ pin: null, aheadSuggestion: null })
  })

  it('uses the current route position to resume the nearest PIN only when no progress exists', () => {
    const pin7 = at(7)
    const position = [pin7.lat, pin7.lng] as const
    const result = resolveAutoStart(
      pins,
      new Set(),
      position,
      route.polyline,
      'route-1',
    )
    expect(result.pin?.sort_order).toBe(7)
  })
})
