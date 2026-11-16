import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pins from './audio-audit-pins.fixture.json'
import {
  collectPreloadAudioUrls,
  EXAM_START_AUDIO,
  EXAM_START_TEXT,
  EXAM_FINISH_AUDIO,
  EXAM_FINISH_TEXT,
  EXAM_SUCCESS_AUDIO,
  EXAM_SUCCESS_TEXT,
  resolvePinAudioUrl,
} from './route-audio'
import { POINT_AUDIO_STEMS, route1VoicePreloadPaths } from './route-1-voice'
import { TELAVI_ROUTES_FALLBACK } from './telavi-routes'
import type { PinRow } from '@/types/database'

const AUDIO_DIR = join(process.cwd(), 'public', 'audio')
const POINTS_DIR = join(AUDIO_DIR, 'points')

const mk = (instruction_ka: string): PinRow =>
  ({ id: 'x', route_id: 'r', lat: 0, lng: 0, radius_m: 25, trigger_distance_m: 50, instruction_ka, audio_url: null, sort_order: 1, active: true }) as PinRow

const decodeAudioPath = (url: string) => decodeURIComponent(url)

const audioStemFromUrl = (url: string): string => {
  const rel = decodeAudioPath(url).replace(/^\/audio\//, '')
  const file = rel.replace(/^points\//, '')
  return file.replace(/\.wav$/, '')
}

describe('FINAL audio audit: 126 active PINs', () => {
  it('has 126 active PINs (R1 35, R2 29, R3 30, R4 32)', () => {
    expect(pins.length).toBe(126)
    for (const [r, n] of [[1, 35], [2, 29], [3, 30], [4, 32]]) {
      expect(pins.filter((p) => p.route === r).length).toBe(n)
    }
    expect(pins.some((pin) => pin.route === 3 && pin.pin === 12)).toBe(false)
  })

  it('every PIN instruction exactly equals the resolved WAV filename stem (no remaps)', () => {
    const problems: string[] = []
    for (const p of pins) {
      const slug = `route-${p.route}`
      const url = resolvePinAudioUrl(slug, mk(p.instruction))
      if (!url) {
        problems.push(`MISSING R${p.route} #${p.pin} ${p.instruction}`)
        continue
      }
      const stem = audioStemFromUrl(url)
      const rel = decodeAudioPath(url).replace(/^\/audio\//, '')
      const abs = join(AUDIO_DIR, rel)
      if (!existsSync(abs)) {
        problems.push(`FILE NOT FOUND R${p.route} #${p.pin} ${rel}`)
        continue
      }
      if (p.instruction !== stem) {
        problems.push(`TEXT≠FILE R${p.route} #${p.pin}: instruction="${p.instruction}" stem="${stem}"`)
      }
    }
    expect(problems).toEqual([])
  })

  it('runtime TELAVI routes keep instructionText === audioFilenameWithoutExtension on every PIN', () => {
    const problems: string[] = []
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4'] as const) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      for (const pin of route.pins) {
        const url = resolvePinAudioUrl(slug, pin)
        if (!url) {
          problems.push(`${slug} #${pin.sort_order} missing audio for "${pin.instruction_ka}"`)
          continue
        }
        const stem = audioStemFromUrl(url)
        if (pin.instruction_ka !== stem) {
          problems.push(`${slug} #${pin.sort_order}: "${pin.instruction_ka}" !== "${stem}"`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('R1 #1 and #19 use მალე right-turn text that matches the played WAV stem', () => {
    const male = 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ'
    for (const pin of [1, 19] as const) {
      const p = pins.find((x) => x.route === 1 && x.pin === pin)!
      expect(p.instruction).toBe(male)
      const url = resolvePinAudioUrl('route-1', mk(p.instruction))
      expect(url).not.toBeNull()
      expect(audioStemFromUrl(url!)).toBe(male)
      expect(existsSync(join(POINTS_DIR, `${male}.wav`))).toBe(true)
    }
  })

  it('R1 #18 uses the exact "left then right" WAV (never the reversed order)', () => {
    const p = pins.find((x) => x.route === 1 && x.pin === 18)!
    expect(p.instruction).toBe('გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარჯვნივ')
    const url = resolvePinAudioUrl('route-1', mk(p.instruction))!
    expect(audioStemFromUrl(url)).toBe(p.instruction)
  })

  it('maps Route 3 #13 to an exact WAV stem', () => {
    const pin13 = pins.find((item) => item.route === 3 && item.pin === 13)!
    expect(audioStemFromUrl(resolvePinAudioUrl('route-3', mk(pin13.instruction))!)).toBe(pin13.instruction)
  })

  it('POINT_AUDIO_STEMS lists every on-disk points WAV basename exactly once', () => {
    const onDisk = readdirSync(POINTS_DIR).filter((f) => f.endsWith('.wav')).map((f) => f.slice(0, -4)).sort()
    expect([...POINT_AUDIO_STEMS].sort()).toEqual(onDisk)
  })

  it('session start/finish/success text equals the session WAV stem', () => {
    expect(EXAM_START_TEXT).toBe(audioStemFromUrl(EXAM_START_AUDIO))
    expect(EXAM_FINISH_TEXT).toBe(audioStemFromUrl(EXAM_FINISH_AUDIO))
    expect(EXAM_SUCCESS_TEXT).toBe(audioStemFromUrl(EXAM_SUCCESS_AUDIO))
  })

  it('preload list covers every mapped WAV and all files exist', () => {
    for (const path of route1VoicePreloadPaths()) {
      expect(existsSync(join(AUDIO_DIR, decodeAudioPath(path).replace(/^\/audio\//, '')))).toBe(true)
    }
    const urls = new Set(collectPreloadAudioUrls('route-4', pins.filter((p) => p.route === 4).map((p) => mk(p.instruction))))
    expect([...urls].every((u) => u.endsWith('.wav'))).toBe(true)
  })
})
