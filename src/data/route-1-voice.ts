/**
 * Build a public /audio/... URL.
 * Encode each path segment for spaces/Unicode, but keep commas literal (%2C breaks
 * static file lookup on Vite preview and some hosts — filenames contain ", ").
 */
export function audioPublicUrl(relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, '').replace(/^audio\//, '')
  return `/audio/${trimmed
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%2C/gi, ','))
    .join('/')}`
}

export const ROUTE_1_SESSION_AUDIO = {
  start: 'დაწყება.wav',
  finish: 'ფინიში.wav',
  success: 'გილოცავთ.wav',
} as const

/**
 * Exact WAV basenames under public/audio/points (without .wav).
 * Instruction text on every active PIN must equal one of these stems — filename is source of truth.
 * Unused files stay listed so a matching instruction can resolve without remaps.
 */
export const POINT_AUDIO_STEMS = [
  '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ',
  '300 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ',
  '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  '300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ',
  '300 მეტრში, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ',
  '500 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  '500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ',
  '500 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ',
  '500 მეტრში, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ',
  '500 მეტრში, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ',
  'გთხოვთ, იმოძრაოთ მარცხნივ',
  'გთხოვთ, იმოძრაოთ მარჯვნივ',
  'გთხოვთ, იმოძრაოთ პირდაპირ',
  'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ',
  'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარჯვნივ',
  'გთხოვთ, მოუხვიოთ მარცხნივ',
  'გთხოვთ, მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ',
  'გთხოვთ, მოუხვიოთ მარჯვნივ',
  'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ',
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ',
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ',
  'მალე, გთხოვთ მოუხვიოთ მარჯვნივ',
  'მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ',
  'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ',
  'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ',
  'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ',
  'წრიული მოძრაობისას, გთხოვთ იმოძრაოთ მარცხნივ',
] as const

const POINT_STEM_SET = new Set<string>(POINT_AUDIO_STEMS)

const FINISH_KEY = 'ფინიში'

/** @deprecated Kept for older tests that still import normalize helpers; matching no longer remaps. */
export function normalizeInstruction(instruction: string): string {
  return instruction.replace(/[,،.]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Every distinct WAV referenced by session + point stems (preload / audits). */
export function route1VoiceFiles(): string[] {
  return [
    ...Object.values(ROUTE_1_SESSION_AUDIO),
    ...POINT_AUDIO_STEMS.map((stem) => `points/${stem}.wav`),
  ]
}

/**
 * Exact instruction text → WAV URL. Filename stem is the only allowed key.
 * No punctuation remaps and no “similar” file fallbacks.
 */
export function matchInstructionAudio(instruction: string, _routeSlug?: string): string | null {
  if (instruction === FINISH_KEY) return audioPublicUrl(ROUTE_1_SESSION_AUDIO.finish)
  if (POINT_STEM_SET.has(instruction)) return audioPublicUrl(`points/${instruction}.wav`)
  return null
}

/** Backwards-compatible name used by route-audio.ts. */
export function matchRoute1InstructionAudio(instruction: string, routeSlug?: string): string | null {
  return matchInstructionAudio(instruction, routeSlug)
}

export function route1VoicePreloadPaths(): string[] {
  return route1VoiceFiles().map((path) => audioPublicUrl(path))
}
