import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { matchInstructionAudio } from '@/data/route-1-voice'
import { applyRelocatedPin, selectRoutePins } from '@/hooks/useRoutes'

const MOVED = [
  [[41.926909, 45.461327], [41.92676, 45.461276]],
  [[41.926626, 45.461236], [41.924423, 45.46041]],
  [[41.926429, 45.461338], [41.923787, 45.460435]],
  [[41.922093, 45.469893], [41.921785, 45.469907]],
  [[41.917228, 45.475799], [41.91729, 45.475646]],
  [[41.917267, 45.475761], [41.91745, 45.475199]],
  [[41.920189, 45.470198], [41.920288, 45.470219]],
  [[41.929098, 45.475144], [41.92918, 45.475192]],
  [[41.933977, 45.478151], [41.933177, 45.477598]],
] as const

function close(left: number, right: number) {
  return Math.abs(left - right) < 1e-7
}

describe('nine corrected Telavi pin coordinates', () => {
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

  it('keeps the new coordinates on routes 1–4 and plays each instruction wav', () => {
    const routes = applyRelocatedPin(TELAVI_ROUTES_FALLBACK)
    for (const [, next] of MOVED) {
      const hits = routes.filter((route) =>
        route.pins.some((pin) => close(pin.lat, next[0]) && close(pin.lng, next[1])),
      )
      expect(hits.length).toBeGreaterThan(0)
      for (const route of hits) {
        const pin = route.pins.find((item) => close(item.lat, next[0]) && close(item.lng, next[1]))!
        const url = matchInstructionAudio(pin.instruction_ka, route.slug)
        expect(url).toBeTruthy()
        expect(existsSync(resolve('public', decodeURIComponent(url!).slice(1)))).toBe(true)
      }
    }

    const shared = [MOVED[5][1], MOVED[6][1], MOVED[7][1], MOVED[8][1]]
    for (const slug of ['route-2', 'route-3', 'route-4']) {
      const pins = routes.find((route) => route.slug === slug)!.pins
      const present = shared.filter(([lat, lng]) => pins.some((pin) => close(pin.lat, lat) && close(pin.lng, lng)))
      if (slug === 'route-2') expect(present).toHaveLength(4)
      else expect(present).toHaveLength(2)
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
    expect(local.pins[16]).toMatchObject({ lat: 41.919129, lng: 45.471847, sort_order: 17 })
    expect(local.pins[18]).toMatchObject({ lat: 41.917305, lng: 45.474576, sort_order: 19 })
    expect(local.pins[25]).toMatchObject({ lat: 41.918461, lng: 45.472799, sort_order: 26 })
    expect(local.pins[31]).toMatchObject({ lat: 41.933177, lng: 45.477598, sort_order: 32 })

    const staleRemote = local.pins.slice(0, 34).map((pin) => ({ ...pin, lat: 0, lng: 0 }))
    const chosen = selectRoutePins(local.pins, staleRemote)
    expect(chosen).toHaveLength(35)
    expect(chosen[18]).toMatchObject({ lat: 41.917305, lng: 45.474576 })
    expect(chosen[25]).toMatchObject({ lat: 41.918461, lng: 45.472799 })
    expect(chosen.every((pin) => pin.lat !== 0)).toBe(true)
  })

  it('applies the requested active coordinates without changing route PIN order or text', () => {
    const routes = applyRelocatedPin(TELAVI_ROUTES_FALLBACK)
    const expected = [
      { slug: 'route-1', order: 5, lat: 41.925694, lng: 45.472556, instruction: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ' },
      { slug: 'route-1', order: 13, lat: 41.922777, lng: 45.468705, instruction: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ' },
      { slug: 'route-1', order: 14, lat: 41.921785, lng: 45.469907, instruction: '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ' },
      { slug: 'route-1', order: 16, lat: 41.919549, lng: 45.470136, instruction: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
      { slug: 'route-1', order: 17, lat: 41.919129, lng: 45.471847, instruction: '300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ' },
      { slug: 'route-1', order: 22, lat: 41.91874, lng: 45.484602, instruction: 'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ' },
      { slug: 'route-1', order: 23, lat: 41.918762, lng: 45.484674, instruction: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
      { slug: 'route-1', order: 26, lat: 41.918461, lng: 45.472799, instruction: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
      { slug: 'route-1', order: 32, lat: 41.933177, lng: 45.477598, instruction: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
      { slug: 'route-2', order: 17, lat: 41.918762, lng: 45.484674, instruction: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
      { slug: 'route-2', order: 26, lat: 41.933177, lng: 45.477598, instruction: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
      { slug: 'route-3', order: 28, lat: 41.933177, lng: 45.477598, instruction: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
      { slug: 'route-4', order: 29, lat: 41.933177, lng: 45.477598, instruction: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
    ] as const

    for (const { slug, order, lat, lng, instruction } of expected) {
      const route = routes.find((item) => item.slug === slug)!
      expect(route.pins).toHaveLength({ 'route-1': 35, 'route-2': 29, 'route-3': 31, 'route-4': 32 }[slug])
      const pin = route.pins.find((item) => item.sort_order === order)!
      expect([pin.lat, pin.lng]).toEqual([lat, lng])
      expect(pin.instruction_ka).toBe(instruction)
    }
  })
})
