import type { PinRow } from '@/types/database'
import {
  matchRoute1InstructionAudio,
  normalizeInstruction,
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

function storedUrlMatchesInstruction(url: string, instruction: string): boolean {
  const file = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '').replace(/\.(wav|mp3)$/i, '')
  return file.length > 0 && normalizeInstruction(file) === normalizeInstruction(instruction)
}

/**
 * The pin's own instruction selects the WAV. A stored audio_url is kept only when its
 * filename is that same instruction. Another pin's file is never used as a substitute.
 */
export function resolvePinAudioUrl(routeSlug: string, pin: PinRow): string | null {
  if (pin.instruction_ka) {
    const matched = matchRoute1InstructionAudio(pin.instruction_ka, routeSlug)
    if (matched) return matched
    if (pin.audio_url && storedUrlMatchesInstruction(pin.audio_url, pin.instruction_ka)) return pin.audio_url
    return null
  }
  return pin.audio_url || null
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

/** The start chime is separate. Pin 1 still speaks its own instruction when the car reaches it. */
export function isStartPinAlreadyAnnounced(_routeSlug: string, _pinId: string): boolean {
  return false
}
