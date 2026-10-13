import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import pins from './audio-audit-pins.fixture.json'
import { collectPreloadAudioUrls, resolvePinAudioUrl } from './route-audio'
import { route1VoicePreloadPaths } from './route-1-voice'
import { applyAuditedPinInstructions } from '@/hooks/useRoutes'
import type { PinRow } from '@/types/database'

const AUDIO_DIR = join(process.cwd(), 'public', 'audio')
const POINTS_DIR = join(AUDIO_DIR, 'points')

const mk = (instruction_ka: string): PinRow =>
  ({ id: 'x', route_id: 'r', lat: 0, lng: 0, radius_m: 25, trigger_distance_m: 50, instruction_ka, audio_url: null, sort_order: 1, active: true }) as PinRow

describe('FINAL audio audit: 126 PINs', () => {
  it('has 126 PINs (R1 34, R2 29, R3 31, R4 32)', () => {
    expect(pins.length).toBe(126)
    for (const [r, n] of [[1, 34], [2, 29], [3, 31], [4, 32]]) {
      expect(pins.filter((p) => p.route === r).length).toBe(n)
    }
  })

  it('every pin text is exactly the recording it plays', () => {
    const problems: string[] = []
    for (const p of pins) {
      const url = resolvePinAudioUrl(`route-${p.route}`, mk(p.instruction))
      const expected = p.instruction === 'ფინიში'
        ? '/audio/ფინიში.wav'
        : `/audio/points/${p.instruction}.wav`
      if (decodeURI(url ?? '') !== expected) problems.push(`R${p.route} #${p.pin}: ${decodeURI(url ?? '')} != ${expected}`)
      else if (p.instruction !== 'ფინიში' && !existsSync(join(POINTS_DIR, `${p.instruction}.wav`))) {
        problems.push(`FILE NOT FOUND R${p.route} #${p.pin}`)
      }
    }
    expect(problems).toEqual([])
    expect(pins).toHaveLength(126)
  })

  it('keeps the two roundabout-right recordings on their own pins', () => {
    const route3 = pins.find((item) => item.route === 3 && item.pin === 9)!
    const route4 = pins.find((item) => item.route === 4 && item.pin === 20)!
    expect(route3.instruction).toBe('მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(route4.instruction).toBe('მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(route3.lat).toBe(41.919719)
    expect(route4.lat).toBe(41.91849)
    expect(decodeURI(resolvePinAudioUrl('route-3', mk(route3.instruction))!)).toBe(
      '/audio/points/მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
    )
    expect(decodeURI(resolvePinAudioUrl('route-4', mk(route4.instruction))!)).toBe(
      '/audio/points/მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav',
    )
    const left = pins.find((item) => item.route === 3 && item.pin === 13)!
    expect(left.instruction).toBe('მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ')
    expect(decodeURI(resolvePinAudioUrl('route-3', mk(left.instruction))!)).toContain('მარცხნივ.wav')
  })

  it('route 2 pin 8 plays the existing soon-right recording', () => {
    const pin = pins.find((item) => item.route === 2 && item.pin === 8)!
    expect(pin.instruction).toBe('მალე, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(pin.lat).toBe(41.930205)
    expect(pin.lng).toBe(45.505555)
    expect(decodeURI(resolvePinAudioUrl('route-2', mk(pin.instruction))!)).toBe(
      '/audio/points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
    )

    const routes = applyAuditedPinInstructions([
      {
        slug: 'route-2',
        pins: [
          { ...mk('500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ'), sort_order: 6, lat: 41.93062, lng: 45.499611, trigger_distance_m: 50 },
          { ...mk('50 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ'), sort_order: 8, lat: 41.930205, lng: 45.505555, trigger_distance_m: 45 },
        ],
      },
      {
        slug: 'route-1',
        pins: [{ ...mk('გთხოვთ, მოუხვიოთ მარჯვნივ'), sort_order: 1, lat: 41.931434, lng: 45.475383, trigger_distance_m: 40 }],
      },
      {
        slug: 'route-4',
        pins: [{ ...mk('წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ'), sort_order: 20, lat: 41.91849, lng: 45.483595, trigger_distance_m: 50 }],
      },
      {
        slug: 'route-3',
        pins: [{ ...mk('წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ'), sort_order: 13, lat: 41.918909, lng: 45.485299, trigger_distance_m: 50 }],
      },
    ])
    expect(routes[0].pins[0].instruction_ka).toBe('500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(routes[0].pins[0].trigger_distance_m).toBe(50)
    expect(routes[0].pins[1].instruction_ka).toBe('მალე, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(routes[0].pins[1].lat).toBe(41.930205)
    expect(routes[0].pins[1].lng).toBe(45.505555)
    expect(routes[0].pins[1].trigger_distance_m).toBe(45)
    expect(routes[0].pins[1].sort_order).toBe(8)
    expect(routes[1].pins[0].instruction_ka).toBe('მალე, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(routes[1].pins[0].lat).toBe(41.931434)
    expect(routes[2].pins[0].instruction_ka).toBe('მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(routes[3].pins[0].instruction_ka).toBe('მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ')
    expect(decodeURI(resolvePinAudioUrl('route-2', routes[0].pins[1])!)).toBe(
      '/audio/points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
    )
  })

  it('does not collapse the two მალე roundabout-right recordings', () => {
    expect(decodeURI(resolvePinAudioUrl('route-1', mk('მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ'))!)).toBe(
      '/audio/points/მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav',
    )
    expect(decodeURI(resolvePinAudioUrl('route-1', mk('მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ'))!)).toBe(
      '/audio/points/მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
    )
    expect(resolvePinAudioUrl('route-4', mk('წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ'))).toBeNull()
  })

  it('R1 #18 uses the exact "left then right" WAV (never the reversed order)', () => {
    const p = pins.find((x) => x.route === 1 && x.pin === 18)!
    expect(p.lat).toBe(41.918205)
    expect(p.lng).toBe(45.473217)
    const url = resolvePinAudioUrl('route-1', mk(p.instruction))!
    expect(decodeURI(url)).toBe('/audio/points/გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარჯვნივ.wav')
  })

  it('preload list covers every mapped WAV and all files exist', () => {
    for (const path of route1VoicePreloadPaths()) {
      expect(existsSync(join(AUDIO_DIR, decodeURI(path).replace(/^\/audio\//, '')))).toBe(true)
    }
    const urls = new Set(collectPreloadAudioUrls('route-4', pins.filter((p) => p.route === 4).map((p) => mk(p.instruction))))
    expect([...urls].every((u) => u.endsWith('.wav'))).toBe(true)
  })
})
