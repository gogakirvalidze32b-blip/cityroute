import { describe, expect, it } from 'vitest'
import { collectPreloadAudioUrls, resolvePinAudioUrl } from './route-audio'
import type { PinRow } from '@/types/database'

const pin = (instruction_ka: string, audio_url: string | null = null): PinRow =>
  ({ id: 'x', route_id: 'r', lat: 0, lng: 0, radius_m: 25, trigger_distance_m: 50, instruction_ka, audio_url, sort_order: 1, active: true }) as PinRow

describe('resolvePinAudioUrl (MP3 path for every route)', () => {
  it('an exact local WAV wins over a stored audio_url on every route', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
      const url = resolvePinAudioUrl(slug, pin('მალე, გთხოვთ მოუხვიოთ მარცხნივ', '/other-pin.wav'))
      expect(decodeURI(url!)).toBe('/audio/points/მალე, გთხოვთ მოუხვიოთ მარცხნივ.wav')
    }
  })

  it('does not borrow a მალე file when the pin text does not say მალე', () => {
    const instruction = 'გთხოვთ, მოუხვიოთ მარჯვნივ'
    expect(resolvePinAudioUrl('route-2', pin(instruction))).toBeNull()
    expect(resolvePinAudioUrl('route-2', pin(instruction, '/custom.wav'))).toBeNull()
    expect(resolvePinAudioUrl('route-2', pin(instruction, encodeURI('/audio/points/გთხოვთ, მოუხვიოთ მარჯვნივ.wav')))).toBe(
      encodeURI('/audio/points/გთხოვთ, მოუხვიოთ მარჯვნივ.wav'),
    )
  })

  it('route 1 resolves exact WAVs; unknown text gets no file (TTS reads it)', () => {
    expect(decodeURI(resolvePinAudioUrl('route-1', pin('მალე, გთხოვთ მოუხვიოთ მარცხნივ'))!)).toBe('/audio/points/მალე, გთხოვთ მოუხვიოთ მარცხნივ.wav')
    expect(resolvePinAudioUrl('route-1', pin('რაღაც უცნობი'))).toBeNull()
  })

  it('routes 2–4 with audio_url = null now get the same local MP3 as route 1', () => {
    for (const slug of ['route-2', 'route-3', 'route-4']) {
      expect(decodeURI(resolvePinAudioUrl(slug, pin('300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ'))!)).toBe('/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.wav')
      expect(decodeURI(resolvePinAudioUrl(slug, pin('ფინიში'))!)).toBe('/audio/ფინიში.wav')
    }
  })

  it('routes 2–4: an unrecognised instruction is NOT mapped to the generic hint (TTS reads the exact text)', () => {
    expect(resolvePinAudioUrl('route-2', pin('თბილისის ქუჩით სამხრევით'))).toBeNull()
    expect(resolvePinAudioUrl('route-3', pin(''))).toBeNull()
  })

  it('preload list contains the resolved MP3s of routes 2–4', () => {
    const urls = collectPreloadAudioUrls('route-2', [pin('მალე, გთხოვთ მოუხვიოთ მარჯვნივ')])
    expect(urls.map(decodeURI)).toContain('/audio/points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav')
  })
})
