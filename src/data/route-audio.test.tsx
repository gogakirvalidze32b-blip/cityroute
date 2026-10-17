import { describe, expect, it } from 'vitest'
import { collectPreloadAudioUrls, isStartPinAlreadyAnnounced, resolvePinAudioUrl } from './route-audio'
import type { PinRow } from '@/types/database'

const pin = (instruction_ka: string, audio_url: string | null = null): PinRow =>
  ({
    id: 'x',
    route_id: 'r',
    lat: 0,
    lng: 0,
    radius_m: 25,
    trigger_distance_m: 50,
    instruction_ka,
    audio_url,
    sort_order: 1,
    active: true,
  }) as PinRow

describe('resolvePinAudioUrl (original WAV path for every route)', () => {
  const decodeAudioPath = (url: string) => decodeURIComponent(url)

  it('exact instruction→WAV map wins over a stale/wrong pin.audio_url', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4', 'test-route-tbilisi']) {
      const url = resolvePinAudioUrl(
        slug,
        pin('გთხოვთ, მოუხვიოთ მარჯვნივ', '/audio/points/გთხოვთ, იმოძრაოთ პირდაპირ.wav'),
      )
      // Tracked file; instruction text stays without „მალე“ (untracked twin is byte-identical).
      expect(decodeAudioPath(url!)).toBe('/audio/points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav')
    }
  })

  it('pin.audio_url is used only when the instruction has no exact map entry', () => {
    expect(resolvePinAudioUrl('route-1', pin('რაღაც უცნობი', '/custom.wav'))).toBe('/custom.wav')
  })

  it('route 1 resolves exact WAVs; unknown text with no url gets null (no TTS)', () => {
    expect(decodeAudioPath(resolvePinAudioUrl('route-1', pin('მალე, გთხოვთ მოუხვიოთ მარცხნივ'))!)).toBe(
      '/audio/points/მალე, გთხოვთ მოუხვიოთ მარცხნივ.wav',
    )
    expect(resolvePinAudioUrl('route-1', pin('რაღაც უცნობი'))).toBeNull()
  })

  it('routes 2–4 with audio_url = null now get the same local WAV as route 1', () => {
    for (const slug of ['route-2', 'route-3', 'route-4']) {
      expect(decodeAudioPath(resolvePinAudioUrl(slug, pin('300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ'))!)).toBe(
        '/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.wav',
      )
      expect(decodeAudioPath(resolvePinAudioUrl(slug, pin('ფინიში'))!)).toBe('/audio/ფინიში.wav')
    }
  })

  it('unrecognised instructions are not mapped to a similar file', () => {
    expect(resolvePinAudioUrl('route-2', pin('თბილისის ქუჩით სამხრევით'))).toBeNull()
    expect(resolvePinAudioUrl('route-3', pin(''))).toBeNull()
  })

  it('preload list contains the resolved WAVs of routes 2–4', () => {
    const urls = collectPreloadAudioUrls('route-2', [pin('მალე, გთხოვთ მოუხვიოთ მარჯვნივ')])
    expect(urls.map(decodeAudioPath)).toContain('/audio/points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav')
  })

  it('does not skip the first PIN as already announced (session-start voice is off)', () => {
    expect(isStartPinAlreadyAnnounced('route-1', 'p1-1')).toBe(false)
    expect(isStartPinAlreadyAnnounced('route-2', 'any')).toBe(false)
  })
})
