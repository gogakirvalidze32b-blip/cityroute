import { describe, expect, it } from 'vitest'
import audioPins from '@/data/audio-audit-pins.fixture.json'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyRelocatedPin } from '@/hooks/useRoutes'
import { LOCAL_TBILISI_TEST_ROUTE } from '@/data/local-tbilisi-test-pin'
import { examRouteLine, maxPinOffsetFromLineM, pinRouteLine } from '@/lib/pin-route-line'
import type { PinRow } from '@/types/database'

type FixturePin = {
  route: number
  pin: number
  lat: number
  lng: number
}

const fixture = audioPins as FixturePin[]

function fixturePins(route: number) {
  return fixture
    .filter((pin) => pin.route === route)
    .map((pin) => ({ lat: pin.lat, lng: pin.lng, sort_order: pin.pin }))
}

function visitPinsInOrder(
  pins: { lat: number; lng: number }[],
  line: [number, number][],
  maxM = 40,
) {
  let next = 0
  for (let i = 0; i < line.length - 1 && next < pins.length; i++) {
    const d = maxPinOffsetFromLineM([[pins[next].lat, pins[next].lng]], [line[i], line[i + 1]])
    if (d <= maxM) {
      next += 1
      i -= 1
    }
  }
  return next === pins.length
}

function chordM(a: [number, number], b: [number, number]) {
  const lat = (a[0] * Math.PI) / 180
  return Math.hypot((b[1] - a[1]) * Math.cos(lat) * 111_320, (b[0] - a[0]) * 110_540)
}

/** True if the line leaves `near` and returns within 12 m after travelling 80–700 m. */
function shortOutAndBackNear(line: [number, number][], near: [number, number], radiusM: number) {
  for (let i = 0; i < line.length; i++) {
    if (chordM(line[i], near) > radiusM) continue
    let travel = 0
    for (let j = i + 1; j < line.length && j < i + 80; j++) {
      travel += chordM(line[j - 1], line[j])
      if (travel < 80) continue
      if (travel > 700) break
      if (chordM(line[i], line[j]) <= 12) return true
    }
  }
  return false
}

describe('pin route line', () => {
  it.each([
    [1, 34],
    [2, 29],
    [3, 31],
    [4, 32],
  ])('route %s connects all %s pins in sort_order and adds no extra points', (route, count) => {
    const pins = fixturePins(route)
    expect(pins).toHaveLength(count)

    const reversed = [...pins].reverse()
    const line = pinRouteLine(reversed)

    expect(line).toHaveLength(count)
    const ordered = [...pins].sort((a, b) => a.sort_order - b.sort_order)
    expect(line).toEqual(ordered.map((pin) => [pin.lat, pin.lng]))
    expect(line[0]).toEqual([ordered[0].lat, ordered[0].lng])
    expect(line[line.length - 1]).toEqual([ordered[count - 1].lat, ordered[count - 1].lng])
  })

  it('keeps each route on its own pins', () => {
    const lines = [1, 2, 3, 4].map((route) => pinRouteLine(fixturePins(route)))
    const signatures = lines.map((line) => line.map(([lat, lng]) => `${lat},${lng}`).join('|'))
    expect(new Set(signatures).size).toBe(4)
  })

  it('uses route 1 official pins in sort_order', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')
    expect(route).toBeTruthy()
    const line = pinRouteLine(route!.pins)
    const ordered = [...route!.pins].sort((a, b) => a.sort_order - b.sort_order)
    expect(line).toHaveLength(ordered.length)
    expect(line).toEqual(ordered.map((pin) => [pin.lat, pin.lng]))
    expect(line).toEqual(pinRouteLine(fixturePins(1)))
  })

  it('does not draw a line from another route when local pins are empty', () => {
    for (const slug of ['route-2', 'route-3', 'route-4']) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)
      expect(pinRouteLine(route!.pins)).toEqual([])
      expect(examRouteLine(slug, route!.pins)).toEqual([])
    }
  })

  it('draws route 3 along the road, west loop before the eastern roundabout', () => {
    const pins = fixturePins(3)
    const line = examRouteLine('route-3', pins)
    const straight = pinRouteLine(pins)

    expect(line.length).toBeGreaterThan(straight.length)
    expect(maxPinOffsetFromLineM(straight, line)).toBeLessThanOrEqual(40)
    expect(line[0][0]).toBeCloseTo(pins[0].lat, 2)
    expect(line[0][1]).toBeCloseTo(pins[0].lng, 2)
    expect(line[line.length - 1][0]).toBeCloseTo(41.931488, 2)
    expect(line[line.length - 1][1]).toBeCloseTo(45.475166, 2)

    const westAt = line.findIndex((point) => point[1] < 45.456)
    const eastAt = line.findIndex((point) => point[1] > 45.482)
    expect(westAt).toBeGreaterThan(0)
    expect(eastAt).toBeGreaterThan(westAt)
  })

  it('keeps the straight pin line when a route 3 pin is not on that road', () => {
    const pins = fixturePins(3).map((pin) =>
      pin.sort_order === 16 ? { ...pin, lat: pin.lat + 0.02 } : pin,
    )
    expect(examRouteLine('route-3', pins)).toEqual(pinRouteLine(pins))
  })

  it.each([
    [1, 34],
    [2, 29],
    [4, 32],
  ])('draws route %s along the streets through all %s pins', (route, count) => {
    const pins = fixturePins(route)
    const line = examRouteLine(`route-${route}`, pins)
    const straight = pinRouteLine(pins)
    const ordered = [...pins].sort((a, b) => a.sort_order - b.sort_order)

    expect(pins).toHaveLength(count)
    expect(line.length).toBeGreaterThan(straight.length)
    expect(maxPinOffsetFromLineM(straight, line)).toBeLessThanOrEqual(40)
    expect(line[0][0]).toBeCloseTo(ordered[0].lat, 2)
    expect(line[0][1]).toBeCloseTo(ordered[0].lng, 2)
    expect(line[line.length - 1][0]).toBeCloseTo(ordered[count - 1].lat, 2)
    expect(line[line.length - 1][1]).toBeCloseTo(ordered[count - 1].lng, 2)
  })

  it('keeps each route on its own street line', () => {
    const lines = [1, 2, 3, 4].map((route) => examRouteLine(`route-${route}`, fixturePins(route)))
    const signatures = lines.map((line) => `${line.length}:${line[10]?.join(',')}`)
    expect(new Set(signatures).size).toBe(4)
  })

  it('visits route 2 pins in sort_order along the street, without skipping ahead', () => {
    const pins = fixturePins(2)
    const line = examRouteLine('route-2', pins)
    expect(visitPinsInOrder(pins, line)).toBe(true)
    expect(maxPinOffsetFromLineM(pins.map((pin) => [pin.lat, pin.lng]), line)).toBeLessThanOrEqual(40)
  })

  it('does not add an extra out-and-back at route 4’s eastern junction', () => {
    const pins = fixturePins(4)
    const line = examRouteLine('route-4', pins)
    const straight = pinRouteLine(pins)

    expect(line.length).toBeGreaterThan(straight.length)
    expect(maxPinOffsetFromLineM(straight, line)).toBeLessThanOrEqual(40)
    expect(shortOutAndBackNear(line, [41.919749, 45.501045], 80)).toBe(false)
  })

  it('leaves route 1 and route 3 street traces unchanged', () => {
    const route1 = examRouteLine('route-1', fixturePins(1))
    const route3 = examRouteLine('route-3', fixturePins(3))
    expect(route1).toHaveLength(344)
    expect(route1[0]).toEqual([41.931477, 45.475406])
    expect(route1[route1.length - 1]).toEqual([41.93154, 45.475194])
    expect(route3).toHaveLength(356)
    expect(route3.find((point) => point[1] < 45.456)).toBeTruthy()
  })

  it('moves only the route 1, 3 and 4 pin that used the old coordinate', () => {
    for (const route of [1, 3, 4]) {
      const pin = fixture.find((item) => item.route === route && item.pin === 2)!
      expect(pin.lat).toBe(41.930785)
      expect(pin.lng).toBe(45.475972)
    }
    const route2 = fixture.find((item) => item.route === 2 && item.pin === 2)!
    expect(route2.lat).toBe(41.931068)
    expect(route2.lng).toBe(45.476164)
    const unchanged = fixture.find((item) => item.route === 1 && item.pin === 1)!
    expect(unchanged.lat).toBe(41.931434)
    expect(unchanged.lng).toBe(45.475383)

    const pin = (lat: number, lng: number, sort_order: number): PinRow =>
      ({ id: 'x', route_id: 'r', lat, lng, radius_m: 25, trigger_distance_m: 50, instruction_ka: 'იგივე', audio_url: null, sort_order, active: true }) as PinRow
    const routes = applyRelocatedPin([
      { slug: 'route-1', pins: [pin(41.931052, 45.476154, 2), pin(41.929826, 45.475295, 3)] },
      { slug: 'route-2', pins: [pin(41.931052, 45.476154, 2)] },
      { slug: 'route-3', pins: [pin(41.931052, 45.476154, 2)] },
      { slug: 'route-4', pins: [pin(41.930785, 45.475972, 2)] },
    ])
    expect(routes[0].pins[0].lat).toBe(41.930785)
    expect(routes[0].pins[0].lng).toBe(45.475972)
    expect(routes[0].pins[0].instruction_ka).toBe('იგივე')
    expect(routes[0].pins[0].sort_order).toBe(2)
    expect(routes[0].pins[1].lat).toBe(41.929826)
    expect(routes[1].pins[0].lat).toBe(41.931052)
    expect(routes[2].pins[0].lat).toBe(41.930785)
    expect(routes[3].pins[0].lat).toBe(41.930785)
  })

  it('keeps the straight pin line when a route 1 pin is not on that road', () => {
    const pins = fixturePins(1).map((pin) =>
      pin.sort_order === 10 ? { ...pin, lat: pin.lat + 0.02 } : pin,
    )
    expect(examRouteLine('route-1', pins)).toEqual(pinRouteLine(pins))
  })

  it('draws the Tbilisi test route along the streets, not pin-to-pin chords', () => {
    const pins = LOCAL_TBILISI_TEST_ROUTE.pins
    const line = examRouteLine('test-route-tbilisi', pins)
    const straight = pinRouteLine(pins)
    const ordered = [...pins].sort((a, b) => a.sort_order - b.sort_order)

    expect(straight).toHaveLength(5)
    expect(line.length).toBeGreaterThan(straight.length)
    expect(maxPinOffsetFromLineM(straight, line)).toBeLessThanOrEqual(40)
    expect(line[0][0]).toBeCloseTo(ordered[0].lat, 3)
    expect(line[0][1]).toBeCloseTo(ordered[0].lng, 3)
    expect(line[line.length - 1][0]).toBeCloseTo(ordered[4].lat, 3)
    expect(line[line.length - 1][1]).toBeCloseTo(ordered[4].lng, 3)
    expect(line).not.toEqual(straight)
  })
})
