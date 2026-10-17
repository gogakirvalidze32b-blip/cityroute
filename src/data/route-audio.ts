import type { PinRow } from '@/types/database'
import {
  audioPublicUrl,
  matchRoute1InstructionAudio,
  ROUTE_1_SESSION_AUDIO,
  route1VoicePreloadPaths,
} from '@/data/route-1-voice'

export { audioPublicUrl }

export const EXAM_START_TEXT = 'გთხოვთ დაიწყოთ'
export const EXAM_FINISH_TEXT = 'ფინიში'
export const EXAM_SUCCESS_TEXT = 'გილოცავთ'

export const EXAM_START_AUDIO = audioPublicUrl(ROUTE_1_SESSION_AUDIO.start)
export const EXAM_FINISH_AUDIO = audioPublicUrl(ROUTE_1_SESSION_AUDIO.finish)
export const EXAM_SUCCESS_AUDIO = audioPublicUrl(ROUTE_1_SESSION_AUDIO.success)

/**
 * Exact instruction → original WAV (see route-1-voice.ts) is the source of truth.
 * A stale/wrong pin.audio_url must not bypass that map (it previously caused missing
 * files and browser TTS). Falls back to pin.audio_url only when the map has no entry.
 * Returns null when no original WAV is known — callers must not synthesize speech.
 */
export function resolvePinAudioUrl(routeSlug: string, pin: PinRow): string | null {
  if (pin.instruction_ka) {
    const mapped = matchRoute1InstructionAudio(pin.instruction_ka, routeSlug)
    if (mapped) return mapped
  }
  if (pin.audio_url) return pin.audio_url
  return null
}

export function enrichPinsWithLocalAudio(routeSlug: string, pins: PinRow[]): PinRow[] {
  return pins.map((pin) => ({
    ...pin,
    audio_url: resolvePinAudioUrl(routeSlug, pin),
  }))
}

export function collectPreloadAudioUrls(routeSlug: string, pins: PinRow[]): string[] {
  const urls = new Set<string>([EXAM_START_AUDIO, EXAM_FINISH_AUDIO, EXAM_SUCCESS_AUDIO])
  if (routeSlug === 'route-1') {
    route1VoicePreloadPaths().forEach((url) => urls.add(url))
  }
  for (const pin of enrichPinsWithLocalAudio(routeSlug, pins)) {
    if (pin.audio_url) urls.add(pin.audio_url)
  }
  return [...urls]
}

/**
 * First start pin used to be skipped because EXAM_START_AUDIO covered it.
 * Session-start voice is off, so the first PIN must speak via GPS like the rest.
 */
export function isStartPinAlreadyAnnounced(_routeSlug: string, _pinId: string): boolean {
  return false
}
