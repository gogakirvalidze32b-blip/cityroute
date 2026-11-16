import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import { PASSED_PIN_SKIP_M, resolveAutoStart } from './auto-start-pin'

const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === 'route-1')!
const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
const road = examRouteLine('route-1', pins)
const at = (order: number) => pins.find((p) => p.sort_order === order)!
const done = (n: number) => new Set(Array.from({ length: n }, (_, i) => i + 1))

describe('resolveAutoStart', () => {
  it('uses the first unpassed PIN from the shared resolver when GPS is absent', () => {
    expect(resolveAutoStart(pins, done(13))).toEqual({ pin: at(14), aheadSuggestion: null })
  })

  it('starts a new route at PIN 1 without GPS', () => {
    expect(resolveAutoStart(pins, new Set()).pin).toBe(at(1))
  })

  it('does not restart a fully completed route at PIN 1', () => {
    expect(resolveAutoStart(pins, done(pins.length))).toEqual({ pin: null, aheadSuggestion: null })
  })

  it('uses the current route position to resume the nearest PIN when no progress exists', () => {
    const pin7 = at(7)
    const position = [pin7.lat, pin7.lng] as const
    const result = resolveAutoStart(
      pins,
      new Set(),
      position,
      road,
      'route-1',
    )
    expect(result.pin?.sort_order).toBe(7)
  })

  it('skips saved next when live GPS is already near a later PIN', () => {
    const pin18 = at(18)
    const result = resolveAutoStart(
      pins,
      done(15),
      [pin18.lat, pin18.lng],
      road,
      'route-1',
    )
    // Must jump forward from saved next (16) to the live area — never stay behind.
    expect(result.pin?.sort_order).toBeGreaterThanOrEqual(18)
    expect(result.pin?.sort_order).toBeLessThanOrEqual(19)
  })

  it(`treats a PIN ${PASSED_PIN_SKIP_M}m+ behind GPS as already passed`, () => {
    const pin14 = at(14)
    const pin15 = at(15)
    // Sit on PIN 15 while saved next is still 14 — must advance to 15, not stay behind.
    const result = resolveAutoStart(
      pins,
      done(13),
      [pin15.lat, pin15.lng],
      road,
      'route-1',
    )
    expect(result.pin?.sort_order).toBeGreaterThanOrEqual(15)
    expect(result.pin?.sort_order).not.toBe(pin14.sort_order)
  })
})
