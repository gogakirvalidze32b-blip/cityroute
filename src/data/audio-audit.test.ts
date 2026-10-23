import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pins from './audio-audit-pins.fixture.json'
import { collectPreloadAudioUrls, resolvePinAudioUrl } from './route-audio'
import { normalizeInstruction, route1VoicePreloadPaths } from './route-1-voice'
import type { PinRow } from '@/types/database'

const AUDIO_DIR = join(process.cwd(), 'public', 'audio')
const POINTS_DIR = join(AUDIO_DIR, 'points')

const mk = (instruction_ka: string): PinRow =>
  ({ id: 'x', route_id: 'r', lat: 0, lng: 0, radius_m: 25, trigger_distance_m: 50, instruction_ka, audio_url: null, sort_order: 1, active: true }) as PinRow

/**
 * Expected WAV when instruction text ≠ filename (tracked file only).
 * Plain „გთხოვთ, მოუხვიოთ მარჯვნივ“ (incl. R1 #1/#19) → existing `მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav`.
 */
const EXPECTED_OVERRIDES = new Map<string, string>([
  ['1:1', 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav'],
  ['1:19', 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav'],
  ['1:23', 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ.wav'],
  ['3:1', 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav'],
  ['4:1', 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav'],
  ['4:14', 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav'],
  ['2:8', 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav'],
  ['3:9', 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.wav'],
  ['3:13', 'წრიული მოძრაობისას, გთხოვთ იმოძრაოთ მარცხნივ.wav'],
  ['3:18', 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.wav'],
  ['4:9', 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.wav'],
  ['2:18', 'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ.wav'],
  ['4:20', 'მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav'],
])

const decodeAudioPath = (url: string) => decodeURIComponent(url)

const norm = (s: string) => normalizeInstruction(s.replace(/\.wav$/, ''))

describe('FINAL audio audit: 127 PINs', () => {
  const files = readdirSync(POINTS_DIR).filter((f) => f.endsWith('.wav'))
  const byNorm = new Map(files.map((f) => [norm(f), f]))

  it('has 127 PINs (R1 35, R2 29, R3 31, R4 32)', () => {
    expect(pins.length).toBe(127)
    for (const [r, n] of [[1, 35], [2, 29], [3, 31], [4, 32]]) {
      expect(pins.filter((p) => p.route === r).length).toBe(n)
    }
  })

  it('every PIN maps to the expected, existing WAV (127/127 MAPPED, 0 MISSING, 0 AMBIGUOUS)', () => {
    let mapped = 0
    const problems: string[] = []
    for (const p of pins) {
      const slug = `route-${p.route}`
      const url = resolvePinAudioUrl(slug, mk(p.instruction))
      const key = `${p.route}:${p.pin}`
      if (!url) { problems.push(`MISSING R${p.route} #${p.pin} ${p.instruction}`); continue }
      const rel = decodeAudioPath(url).replace(/^\/audio\//, '')
      const file = rel.replace(/^points\//, '')
      const abs = join(AUDIO_DIR, rel)
      if (!existsSync(abs)) { problems.push(`FILE NOT FOUND R${p.route} #${p.pin} ${rel}`); continue }
      if (p.instruction === 'ფინიში') {
        if (rel !== 'ფინიში.wav') problems.push(`WRONG FINISH R${p.route} #${p.pin}`)
        mapped++; continue
      }
      const expected = EXPECTED_OVERRIDES.get(key) ?? byNorm.get(norm(p.instruction))
      if (file !== expected) problems.push(`WRONG R${p.route} #${p.pin}: got ${file}, expected ${expected}`)
      else mapped++
    }
    expect(problems).toEqual([])
    expect(mapped).toBe(127)
  })

  it('R1 #18 uses the exact "left then right" WAV (never the reversed order)', () => {
    const p = pins.find((x) => x.route === 1 && x.pin === 18)!
    expect(p.lat).toBe(41.918009)
    expect(p.lng).toBe(45.473452)
    const url = resolvePinAudioUrl('route-1', mk(p.instruction))!
    expect(decodeAudioPath(url)).toBe('/audio/points/გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარჯვნივ.wav')
  })

  it('R1 #1 and #19 keep plain text; play existing მალე right-turn WAV (never null)', () => {
    const malePath = '/audio/points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav'
    for (const [pin, lat, lng] of [
      [1, 41.931434, 45.475383],
      [19, 41.917305, 45.474576],
    ] as const) {
      const p = pins.find((x) => x.route === 1 && x.pin === pin)!
      expect(p.lat).toBe(lat)
      expect(p.lng).toBe(lng)
      expect(p.instruction).toBe('გთხოვთ, მოუხვიოთ მარჯვნივ')
      const url = resolvePinAudioUrl('route-1', mk(p.instruction))
      expect(url).not.toBeNull()
      expect(decodeAudioPath(url!)).toBe(malePath)
      expect(existsSync(join(POINTS_DIR, 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav'))).toBe(true)
    }
  })

  it('keeps the requested Route 3 coordinate edits and maps PIN #13 to its exact existing WAV', () => {
    const expectedCoordinates: Record<string, readonly [number, number]> = {
      '3:9': [41.92025, 45.484497],
      '3:13': [41.918749, 45.484602],
      '3:14': [41.91946, 45.485263],
      '3:21': [41.923473, 45.464528],
      '4:9': [41.92025, 45.484497],
    }

    for (const [key, [lat, lng]] of Object.entries(expectedCoordinates)) {
      const [route, pin] = key.split(':').map(Number)
      const p = pins.find((x) => x.route === route && x.pin === pin)!
      expect([p.lat, p.lng]).toEqual([lat, lng])
    }

    const route3Pin9 = pins.find((x) => x.route === 3 && x.pin === 9)!
    const route4Pin9 = pins.find((x) => x.route === 4 && x.pin === 9)!
    expect(route3Pin9.instruction).toBe('წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(route4Pin9.instruction).toBe('წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ')

    const pin13 = pins.find((x) => x.route === 3 && x.pin === 13)!
    expect(pin13.instruction).toBe('წრიული მოძრაობისას, გთხოვთ იმოძრაოთ მარცხნივ')
    const wav = 'წრიული მოძრაობისას, გთხოვთ იმოძრაოთ მარცხნივ.wav'
    expect(decodeAudioPath(resolvePinAudioUrl('route-3', mk(pin13.instruction))!))
      .toBe(`/audio/points/${wav}`)
    expect(existsSync(join(POINTS_DIR, wav))).toBe(true)
  })

  it('preload list covers every mapped WAV and all files exist', () => {
    for (const path of route1VoicePreloadPaths()) {
      expect(existsSync(join(AUDIO_DIR, decodeAudioPath(path).replace(/^\/audio\//, '')))).toBe(true)
    }
    const urls = new Set(collectPreloadAudioUrls('route-4', pins.filter((p) => p.route === 4).map((p) => mk(p.instruction))))
    expect([...urls].every((u) => u.endsWith('.wav'))).toBe(true)
  })
})
