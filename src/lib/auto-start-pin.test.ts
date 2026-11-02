import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { AUTO_GPS_MAX_SKIP_PINS, resolveAutoStart, type AutoStartFix } from './auto-start-pin'

const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === 'route-1')!
const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
const at = (order: number) => pins.find((p) => p.sort_order === order)!
const done = (n: number) => new Set(Array.from({ length: n }, (_, i) => i + 1))

function movingFix(order: number, extra: Partial<AutoStartFix> = {}): AutoStartFix {
  const from = at(order)
  const to = at(order + 1)
  const dLng = ((to.lng - from.lng) * Math.PI) / 180
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const heading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  return { lat: from.lat, lng: from.lng, accuracy: 5, heading, speed: 8, ...extra }
}

describe('resolveAutoStart', () => {
  it('keeps the limit at 3 PINs', () => {
    expect(AUTO_GPS_MAX_SKIP_PINS).toBe(3)
  })

  it('uses the first unpassed PIN without a fix', () => {
    expect(resolveAutoStart(pins, done(13), null, null)).toEqual({ pin: at(14), aheadSuggestion: null })
  })

  it('uses PIN 1 when there is no saved progress, even with a fix', () => {
    expect(resolveAutoStart(pins, new Set(), movingFix(15), null).pin).toBe(at(1))
  })

  it('follows a reliable moving fix up to 3 PINs ahead', () => {
    const result = resolveAutoStart(pins, done(13), movingFix(15), null)
    expect(result.pin).toBe(at(16))
    expect(result.aheadSuggestion).toBeNull()
  })

  it('ignores stationary, heading-less and inaccurate fixes', () => {
    for (const extra of [{ speed: 0 }, { heading: null }, { accuracy: 60 }] as Partial<AutoStartFix>[]) {
      expect(resolveAutoStart(pins, done(13), movingFix(15, extra), null).pin).toBe(at(14))
    }
  })

  it('does not jump when the fix is more than 3 PINs ahead and reports a suggestion instead', () => {
    const result = resolveAutoStart(pins, done(13), movingFix(18), null)
    expect(result.pin).toBe(at(14))
    expect(result.aheadSuggestion?.pin).toBe(at(19))
    expect(result.aheadSuggestion?.skippedOrders).toEqual([14, 15, 16, 17, 18])
  })

  it('never moves before the saved progress', () => {
    expect(resolveAutoStart(pins, done(13), movingFix(5), null).pin).toBe(at(14))
  })
})
