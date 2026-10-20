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
 * Instruction text -> real WAV file (public/audio/points).
 * Keys are normalized (see normalizeInstruction): commas removed, whitespace collapsed.
 * Source of truth: the final PIN audio audit (instruction→WAV). Do not add fuzzy matching:
 * a wrong maneuver/order must never fall back to a "similar" file.
 */
const INSTRUCTION_TO_FILE: Record<string, string> = {
  // Turn now
  'გთხოვთ მოუხვიოთ მარცხნივ': 'გთხოვთ, მოუხვიოთ მარცხნივ.wav',
  // Plain right-turn text uses the existing tracked მალე-named WAV (no separate recording).
  'გთხოვთ მოუხვიოთ მარჯვნივ': 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  'გთხოვთ იმოძრაოთ პირდაპირ': 'გთხოვთ, იმოძრაოთ პირდაპირ.wav',
  'გთხოვთ შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ': 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ.wav',
  // Two maneuvers
  'გთხოვთ მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ': 'გთხოვთ, მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ.wav',
  'გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ': 'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ.wav',
  'გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარჯვნივ': 'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარჯვნივ.wav',
  'მალე გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ': 'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ.wav',
  // Soon
  'მალე გთხოვთ მოუხვიოთ მარცხნივ': 'მალე, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  'მალე გთხოვთ მოუხვიოთ მარჯვნივ': 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  'მალე წრიული მოძრაობისას გთხოვთ იმოძრაოთ პირდაპირ': 'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ.wav',
  'მალე წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ': 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  'მალე წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ': 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  // Roundabout, no "soon" word (user-directed: same maneuver, extra word accepted)
  'წრიული მოძრაობისას გთხოვთ იმოძრაოთ პირდაპირ': 'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ.wav',
  'წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ': 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  'წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ': 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  // 50 m: no 50 m audio exists, user-directed -> "soon" right
  '50 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ': 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  // 300 m
  '300 მეტრში გთხოვთ მოუხვიოთ მარცხნივ': '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ': '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  'გთხოვთ 300 მეტრში მოუხვიოთ მარჯვნივ': '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  '300 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ': '300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ.wav',
  '300 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ': '300 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  // 500 m
  '500 მეტრში გთხოვთ მოუხვიოთ მარცხნივ': '500 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  '500 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ': '500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  '500 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ': '500 მეტრში, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  '500 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ': '500 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav',
}

/**
 * Known typos in the stored instruction text ("გთხვოვთ"). Instruction text itself is NOT changed
 * anywhere; the typo is only tolerated at lookup time (repeated instruction = repeated audio).
 */
const TYPO_FIXES: ReadonlyArray<[RegExp, string]> = [[/გთხვოვთ/g, 'გთხოვთ']]

/**
 * Per-route override for the one instruction whose final audit mapping differs between routes:
 * Route 4 PIN #20 uses the no-comma roundabout file.
 */
const ROUTE_OVERRIDES: Record<string, Record<string, string>> = {
  'route-4': {
    'წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ': 'მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  },
}

const FINISH_KEY = 'ფინიში'

export function normalizeInstruction(instruction: string): string {
  let s = instruction
  for (const [re, to] of TYPO_FIXES) s = s.replace(re, to)
  return s.replace(/[,،.]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Every distinct WAV referenced by the mapping table (used for preload and audits). */
export function route1VoiceFiles(): string[] {
  const files = new Set<string>([
    ...Object.values(ROUTE_1_SESSION_AUDIO),
    ...Object.values(INSTRUCTION_TO_FILE).map((f) => `points/${f}`),
  ])
  for (const route of Object.values(ROUTE_OVERRIDES)) {
    for (const f of Object.values(route)) files.add(`points/${f}`)
  }
  return [...files]
}

/**
 * Exact instruction text -> WAV URL. Returns null when no exact mapping exists
 * (caller must not synthesize speech; no fuzzy/"similar" file is ever used).
 */
export function matchInstructionAudio(instruction: string, routeSlug?: string): string | null {
  const key = normalizeInstruction(instruction)
  if (key === FINISH_KEY) return audioPublicUrl(ROUTE_1_SESSION_AUDIO.finish)
  const override = routeSlug ? ROUTE_OVERRIDES[routeSlug]?.[key] : undefined
  const file = override ?? INSTRUCTION_TO_FILE[key]
  return file ? audioPublicUrl(`points/${file}`) : null
}

/** Backwards-compatible name used by route-audio.ts. */
export function matchRoute1InstructionAudio(instruction: string, routeSlug?: string): string | null {
  return matchInstructionAudio(instruction, routeSlug)
}

export function route1VoicePreloadPaths(): string[] {
  return route1VoiceFiles().map((path) => audioPublicUrl(path))
}
