import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { matchInstructionAudio } from '@/data/route-1-voice'
import { applyRelocatedPin, selectRoutePins } from '@/hooks/useRoutes'
import { prepareRouteGeometry, projectPointToRoute, type ActiveRouteId } from '@/lib/pure-route-geometry'
import route1Road from '@/data/route-1-road.json'
import route2Road from '@/data/route-2-road.json'
import route3Road from '@/data/route-3-road.json'
import route4Road from '@/data/route-4-road.json'

const MOVED = [
  [[41.926909, 45.461327], [41.92676, 45.461276]],
  [[41.926626, 45.461236], [41.924657, 45.460514]],
  [[41.926429, 45.461338], [41.923787, 45.460435]],
  [[41.922093, 45.469893], [41.921785, 45.469907]],
  [[41.917228, 45.475799], [41.91729, 45.475646]],
  [[41.917267, 45.475761], [41.91745, 45.475199]],
  [[41.920189, 45.470198], [41.920288, 45.470219]],
  [[41.929098, 45.475144], [41.92918, 45.475192]],
] as const

const ROADS: Record<ActiveRouteId, readonly [number, number][]> = {
  'route-1': route1Road as [number, number][],
  'route-2': route2Road as [number, number][],
  'route-3': route3Road as [number, number][],
  'route-4': route4Road as [number, number][],
}

function close(left: number, right: number) {
  return Math.abs(left - right) < 1e-7
}

describe('eight corrected Telavi pin coordinates', () => {
  it('replaces stale coordinates and keeps instruction, order, and audio', () => {
    const stale = applyRelocatedPin([
      {
        slug: 'route-1',
        pins: MOVED.map(([from], index) => ({
          id: `stale-${index}`,
          lat: from[0],
          lng: from[1],
          sort_order: index + 9,
          instruction_ka: 'მალე, გთხოვთ მოუხვიოთ მარცხნივ',
          audio_url: null,
        })),
      },
    ])

    stale[0].pins.forEach((pin, index) => {
      expect(pin.lat).toBeCloseTo(MOVED[index][1][0], 6)
      expect(pin.lng).toBeCloseTo(MOVED[index][1][1], 6)
      expect(pin.sort_order).toBe(index + 9)
      expect(pin.instruction_ka).toBe('მალე, გთხოვთ მოუხვიოთ მარცხნივ')
      const url = matchInstructionAudio(pin.instruction_ka, 'route-1')
      expect(decodeURIComponent(url!)).toBe('/audio/points/მალე, გთხოვთ მოუხვიოთ მარცხნივ.wav')
    })
  })

  it('keeps every exam PIN on its road centerline with playable instruction audio', () => {
    const routes = applyRelocatedPin(TELAVI_ROUTES_FALLBACK)
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4'] as const) {
      const route = routes.find((item) => item.slug === slug)!
      const geometry = prepareRouteGeometry(
        slug,
        ROADS[slug].map(([lat, lng]) => [lat, lng] as const),
      )
      for (const pin of route.pins) {
        const projection = projectPointToRoute(geometry, [pin.lat, pin.lng])
        expect(projection, `${slug} #${pin.sort_order}`).not.toBeNull()
        // Field-placed PINs may sit a few metres off the digitized centerline.
        expect(projection!.crossTrackMeters, `${slug} #${pin.sort_order}`).toBeLessThanOrEqual(12)
        const url = matchInstructionAudio(pin.instruction_ka, slug)
        expect(url, `${slug} #${pin.sort_order} audio`).toBeTruthy()
        expect(existsSync(resolve('public', decodeURIComponent(url!).slice(1)))).toBe(true)
      }
    }
  })

  it('does not move a pin that is already at the new coordinate', () => {
    const [pin] = applyRelocatedPin([
      { pins: [{ lat: 41.924423, lng: 45.46041, instruction_ka: 'უცვლელი', sort_order: 10 }] },
    ])[0].pins
    expect(pin).toEqual({ lat: 41.924423, lng: 45.46041, instruction_ka: 'უცვლელი', sort_order: 10 })
  })

  it('prefers bundled local pins over stale Supabase pins so new Route 1 PINs stay on the map', () => {
    const local = applyRelocatedPin(TELAVI_ROUTES_FALLBACK).find((route) => route.slug === 'route-1')!
    expect(local.pins).toHaveLength(35)
    expect(local.pins.map((pin) => pin.sort_order)).toEqual(
      Array.from({ length: 35 }, (_, index) => index + 1),
    )

    const staleRemote = local.pins.slice(0, 34).map((pin) => ({ ...pin, lat: 0, lng: 0 }))
    const chosen = selectRoutePins(local.pins, staleRemote)
    expect(chosen).toHaveLength(35)
    expect(chosen.every((pin) => pin.lat !== 0)).toBe(true)
  })

  it('preserves PIN order and instruction text after centerline snaps', () => {
    const routes = applyRelocatedPin(TELAVI_ROUTES_FALLBACK)
    const expected = [
      { slug: 'route-3', order: 10, instruction: '300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ' },
      { slug: 'route-3', order: 13, instruction: 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ' },
      { slug: 'route-3', order: 29, instruction: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ' },
      { slug: 'route-4', order: 7, instruction: '500 მეტრში, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ' },
      { slug: 'route-1', order: 5, instruction: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ' },
      { slug: 'route-2', order: 25, instruction: 'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ' },
      { slug: 'route-3', order: 17, instruction: '300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ' },
      { slug: 'route-3', order: 28, instruction: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
    ] as const

    for (const { slug, order, instruction } of expected) {
      const route = routes.find((item) => item.slug === slug)!
      expect(route.pins).toHaveLength({ 'route-1': 35, 'route-2': 29, 'route-3': 30, 'route-4': 32 }[slug])
      const pin = route.pins.find((item) => item.sort_order === order)!
      expect(pin.instruction_ka).toBe(instruction)
    }
    const route3 = routes.find((item) => item.slug === 'route-3')!
    expect(route3.pins.some((pin) => close(pin.lat, 41.918243) && close(pin.lng, 45.482661))).toBe(false)
    expect(route3.pins.map((pin) => pin.sort_order)).toContain(13)
    expect(route3.pins.map((pin) => pin.sort_order)).toContain(14)
  })
})
