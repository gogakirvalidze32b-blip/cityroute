import type { PinRow } from '@/types/database'
import {
  matchRoute1InstructionAudio,
  ROUTE_1_SESSION_AUDIO,
  route1VoicePreloadPaths,
} from '@/data/route-1-voice'

/** Encode Georgian filenames for browser audio URLs. */
export function audioPublicUrl(relativePath: string): string {
  return encodeURI(`/audio/${relativePath}`)
}

export const EXAM_START_TEXT = 'გთხოვთ დაიწყოთ'
export const EXAM_FINISH_TEXT = 'ფინიში'
export const EXAM_SUCCESS_TEXT = 'გილოცავთ'

export const EXAM_START_AUDIO = audioPublicUrl(ROUTE_1_SESSION_AUDIO.start)
export const EXAM_FINISH_AUDIO = audioPublicUrl(ROUTE_1_SESSION_AUDIO.finish)
export const EXAM_SUCCESS_AUDIO = audioPublicUrl(ROUTE_1_SESSION_AUDIO.success)

/**
 * Explicit audio_url wins; otherwise the instruction text is mapped EXACTLY to a local WAV
 * (see route-1-voice.ts). Returns null when there is no exact file, so TTS reads the text.
 */
export function resolvePinAudioUrl(routeSlug: string, pin: PinRow): string | null {
  if (pin.audio_url) return pin.audio_url
  if (!pin.instruction_ka) return null
  // Exact instruction -> WAV mapping; null (TTS reads the text) when there is no exact file.
  return matchRoute1InstructionAudio(pin.instruction_ka, routeSlug)
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

/** First start pin — audio already plays on ▶ გამოცდის დაწყება. */
export function isStartPinAlreadyAnnounced(routeSlug: string, pinId: string): boolean {
  return routeSlug === 'route-1' && pinId === 'p1-1'
}
