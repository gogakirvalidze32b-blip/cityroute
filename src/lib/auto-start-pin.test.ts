import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import { positionAtChainageMeters } from '@/lib/pure-route-geometry'
import { prepareDemoRouteGeometry, resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'
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

  it('uses route progress, not the broad route-start radius, for PINs 1 and 2', () => {
    const geometry = prepareDemoRouteGeometry('route-1', road)
    const firstChainage = resolveDemoPinChainage(geometry, pins, 1, 0)
    expect(firstChainage).not.toBeNull()
    const secondChainage = resolveDemoPinChainage(geometry, pins, 2, firstChainage!)
    expect(secondChainage).not.toBeNull()

    const between = positionAtChainageMeters(
      geometry,
      (firstChainage! + secondChainage!) / 2,
    )!
    const result = resolveAutoStart(pins, new Set(), between, road, 'route-1')
    expect(result.pin?.sort_order).toBe(2)
  })

  it('starts before PIN 1 or at PIN 1, and selects PIN 2 when genuinely at PIN 2', () => {
    const first = at(1)
    const second = at(2)
    expect(
      resolveAutoStart(pins, new Set(), road[0], road, 'route-1').pin?.sort_order,
    ).toBe(1)
    expect(
      resolveAutoStart(pins, new Set(), [first.lat, first.lng], road, 'route-1').pin?.sort_order,
    ).toBe(1)
    expect(
      resolveAutoStart(pins, new Set(), [second.lat, second.lng], road, 'route-1').pin?.sort_order,
    ).toBe(2)
  })

  it('selects Route 3 PIN 26 when GPS is between PINs 25 and 26', () => {
    const route3 = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    const route3Pins = [...route3.pins].sort((a, b) => a.sort_order - b.sort_order)
    const route3Line = examRouteLine('route-3', route3Pins)
    const geometry = prepareDemoRouteGeometry('route-3', route3Line)
    const pin25Chainage = resolveDemoPinChainage(geometry, route3Pins, 25, 0)
    expect(pin25Chainage).not.toBeNull()
    const pin26Chainage = resolveDemoPinChainage(geometry, route3Pins, 26, pin25Chainage!)
    expect(pin26Chainage).not.toBeNull()

    const between = positionAtChainageMeters(
      geometry,
      (pin25Chainage! + pin26Chainage!) / 2,
    )!
    const result = resolveAutoStart(
      route3Pins,
      new Set(),
      between,
      route3Line,
      'route-3',
    )

    expect(result.pin?.sort_order).toBe(26)
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
