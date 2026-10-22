export const VOICE_PEAK_CEILING_DBFS = -3

export type VoiceFileLevel = {
  activeRmsDbfs: number
  peakDbfs: number
}

/** Levels measured from the original bundled WAVs; source files stay untouched. */
export const VOICE_LEVELS_BY_FILE: Readonly<Record<string, VoiceFileLevel>> = {
  '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ.wav': { activeRmsDbfs: -34.5, peakDbfs: -13.8 },
  '300 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav': { activeRmsDbfs: -35.3, peakDbfs: -16.2 },
  '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -34.3, peakDbfs: -14.4 },
  '300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -34.6, peakDbfs: -12.3 },
  '500 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -35.7, peakDbfs: -14.9 },
  '500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ.wav': { activeRmsDbfs: -36.5, peakDbfs: -16.7 },
  '500 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav': { activeRmsDbfs: -34.8, peakDbfs: -13.0 },
  '500 მეტრში, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -34.9, peakDbfs: -13.7 },
  'გთხოვთ, იმოძრაოთ მარცხნივ.wav': { activeRmsDbfs: -35.3, peakDbfs: -16.0 },
  'გთხოვთ, იმოძრაოთ მარჯვნივ.wav': { activeRmsDbfs: -35.8, peakDbfs: -17.7 },
  'გთხოვთ, იმოძრაოთ პირდაპირ.wav': { activeRmsDbfs: -33.5, peakDbfs: -17.9 },
  'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -35.4, peakDbfs: -14.1 },
  'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარჯვნივ.wav': { activeRmsDbfs: -35.6, peakDbfs: -13.2 },
  'გთხოვთ, მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -34.0, peakDbfs: -13.3 },
  'გთხოვთ, მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -35.6, peakDbfs: -14.2 },
  'გთხოვთ, მოუხვიოთ მარჯვნივ.wav': { activeRmsDbfs: -35.7, peakDbfs: -21.2 },
  'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ.wav': { activeRmsDbfs: -35.0, peakDbfs: -14.4 },
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -34.1, peakDbfs: -13.6 },
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -35.3, peakDbfs: -17.7 },
  'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav': { activeRmsDbfs: -35.7, peakDbfs: -21.2 },
  'მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.wav': { activeRmsDbfs: -34.7, peakDbfs: -15.7 },
  'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ.wav': { activeRmsDbfs: -34.8, peakDbfs: -15.0 },
  'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.wav': { activeRmsDbfs: -34.4, peakDbfs: -13.6 },
  'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.wav': { activeRmsDbfs: -36.1, peakDbfs: -18.3 },
  'წრიული მოძრაობისას, გთხოვთ იმოძრაოთ მარცხნივ.wav': { activeRmsDbfs: -33.4, peakDbfs: -15.4 },
  'გილოცავთ.wav': { activeRmsDbfs: -33.6, peakDbfs: -16.4 },
  'დაწყება.wav': { activeRmsDbfs: -34.4, peakDbfs: -14.8 },
  'ფინიში.wav': { activeRmsDbfs: -37.4, peakDbfs: -22.8 },
}

function audioFilename(url: string): string | null {
  try {
    const pathname = new URL(url, 'https://cityroute.invalid').pathname
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1))
  } catch {
    return null
  }
}

export function safeVoiceGain(url: string, requestedGain: number): number {
  const filename = audioFilename(url)
  const levels = filename ? VOICE_LEVELS_BY_FILE[filename] : undefined
  if (!levels) return requestedGain

  const peakSafeGain = 10 ** ((VOICE_PEAK_CEILING_DBFS - levels.peakDbfs) / 20)
  return Math.min(requestedGain, peakSafeGain)
}
