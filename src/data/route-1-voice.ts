function audioPublicUrl(relativePath: string): string {
  return encodeURI(`/audio/${relativePath}`)
}

export const ROUTE_1_SESSION_AUDIO = {
  start: 'დაწყება.wav',
  finish: 'ფინიში.wav',
  success: 'გილოცავთ.wav',
} as const

/**
 * The 24 point recordings. Each filename is the phrase, including its commas.
 * A pin uses a file only when the words and their order match that phrase.
 * Two files that differ only by a comma stay separate. A missing or extra word
 * never borrows another recording.
 */
const PHRASE_FILES = [
  '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  '300 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  '300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ.wav',
  '500 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  '500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  '500 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  '500 მეტრში, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  'გთხოვთ, იმოძრაოთ მარცხნივ.wav',
  'გთხოვთ, იმოძრაოთ მარჯვნივ.wav',
  'გთხოვთ, იმოძრაოთ პირდაპირ.wav',
  'გთხოვთ, მოუხვიოთ მარცხნივ.wav',
  'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ.wav',
  'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარჯვნივ.wav',
  'გთხოვთ, მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ.wav',
  'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ.wav',
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ.wav',
  'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  'მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ.wav',
  'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.wav',
  'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
  'წრიული მოძრაობისას, გთხოვთ იმოძრაოთ მარცხნივ.wav',
] as const

/**
 * Known typos in the stored instruction text ("გთხვოვთ"). Instruction text itself is NOT changed
 * anywhere; the typo is only tolerated at lookup time (repeated instruction = repeated audio).
 */
const TYPO_FIXES: ReadonlyArray<[RegExp, string]> = [[/გთხვოვთ/g, 'გთხოვთ']]

const FINISH_KEY = 'ფინიში'

/** Same words and order, commas kept. Only the known გთხვოვთ spelling is repaired. */
export function exactPhrase(instruction: string): string {
  let s = instruction
  for (const [re, to] of TYPO_FIXES) s = s.replace(re, to)
  return s.replace(/\s+/g, ' ').trim()
}

/** Same words and order, commas ignored. Two recordings are not collapsed. */
export function normalizeInstruction(instruction: string): string {
  return exactPhrase(instruction).replace(/[,،.]/g, ' ').replace(/\s+/g, ' ').trim()
}

const EXACT_PHRASE_TO_FILE = new Map<string, string>()
const WORDS_TO_FILES = new Map<string, string[]>()
for (const file of PHRASE_FILES) {
  const stem = file.replace(/\.wav$/i, '')
  EXACT_PHRASE_TO_FILE.set(exactPhrase(stem), file)
  const wordKey = normalizeInstruction(stem)
  const matches = WORDS_TO_FILES.get(wordKey) ?? []
  matches.push(file)
  WORDS_TO_FILES.set(wordKey, matches)
}

/** Every distinct WAV referenced by the mapping table (used for preload and audits). */
export function route1VoiceFiles(): string[] {
  return [
    ...Object.values(ROUTE_1_SESSION_AUDIO),
    ...PHRASE_FILES.map((file) => `points/${file}`),
  ]
}

/**
 * Exact instruction text -> WAV URL. Returns null when no exact mapping exists
 * (caller falls back to TTS; no fuzzy/"similar" file is ever used).
 */
export function matchInstructionAudio(instruction: string, _routeSlug?: string): string | null {
  const exactFile = EXACT_PHRASE_TO_FILE.get(exactPhrase(instruction))
  if (exactFile) return audioPublicUrl(`points/${exactFile}`)
  const key = normalizeInstruction(instruction)
  if (key === FINISH_KEY) return audioPublicUrl(ROUTE_1_SESSION_AUDIO.finish)
  const wordFiles = WORDS_TO_FILES.get(key) ?? []
  if (wordFiles.length === 1) return audioPublicUrl(`points/${wordFiles[0]}`)
  return null
}

/** Backwards-compatible name used by route-audio.ts. */
export function matchRoute1InstructionAudio(instruction: string, routeSlug?: string): string | null {
  return matchInstructionAudio(instruction, routeSlug)
}

export function route1VoicePreloadPaths(): string[] {
  return route1VoiceFiles().map((path) => audioPublicUrl(path))
}
