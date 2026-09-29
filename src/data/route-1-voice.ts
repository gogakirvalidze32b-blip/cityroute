function audioPublicUrl(relativePath: string): string {
  return encodeURI(`/audio/${relativePath}`)
}

export const ROUTE_1_SESSION_AUDIO = {
  start: 'დაწყება.mp3',
  finish: 'ფინიში.mp3',
  success: 'გილოცავთ.mp3',
} as const

const POINTS = {
  // Soon (მალე)
  soonLeft: 'points/მალე, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  soonRight: 'points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  soonLeftRound: 'points/მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  soonRightRound: 'points/მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  soonStraightRound: 'points/მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ.mp3',
  soonLeftTwice: 'points/მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ.mp3',
  
  // 300 meters
  m300Left: 'points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  m300Right: 'points/300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  m300LeftRound: 'points/300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  m300RightRound: 'points/300 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  
  // 500 meters
  m500Right: 'points/500 მეტრში მარჯვნივ.mp3',
  m500LeftRound: 'points/500 მეტრში წრიული მოძრაობისას მარცხნივ.mp3',
  m500RightRound: 'points/500 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  m500LeftLong: 'points/ხუთას მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  
  // Turn now (გთხოვთ)
  turnLeft: 'points/გთხოვთ, მოუხვიოთ მარცხნივ.mp3',
  turnRight: 'points/გთხოვთ, იმოძრაოთ მარჯვნივ.mp3', // Using available file
  moveRight: 'points/გთხოვთ, იმოძრაოთ მარჯვნივ.mp3',
  straight: 'points/გთხოვთ, იმოძრაოთ პირდაპირ.mp3',
  straightNext: 'points/გთხოვთ, შემდეგ მინიშნებამდე იმოძრავეთ პირდაპირ.mp3',
  
  // Complex turns
  rightThenLeft: 'points/გთხოვთ, მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ.mp3',
  
  // Hint
  hint: 'points/მინიშნება.mp3',
} as const

function parseDistanceM(instruction: string): number | null {
  const match = instruction.match(/(\d+)\s*მ/)
  return match ? Number(match[1]) : null
}

/** Match official manoeuvre text → new AI voice file in public/audio. */
export function matchRoute1InstructionAudio(instruction: string): string {
  // Finish
  if (/ფინიში/i.test(instruction)) {
    return audioPublicUrl(ROUTE_1_SESSION_AUDIO.finish)
  }

  // Start
  if (/დაწყება/i.test(instruction)) {
    return audioPublicUrl(ROUTE_1_SESSION_AUDIO.start)
  }

  // Exact matches first (for complex instructions)
  const normalized = instruction.trim()
  
  // "შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ"
  if (/შემდეგ მინიშნებამდე.*პირდაპირ/i.test(normalized)) {
    return audioPublicUrl(POINTS.straightNext)
  }

  // "მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ"
  if (/მალე.*მარცხნივ.*შემდეგ.*მარცხნივ/i.test(normalized)) {
    return audioPublicUrl(POINTS.soonLeftTwice)
  }

  // "მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარჯვნივ" (not available, use hint)
  if (/მარცხნივ.*შემდეგ.*მარჯვნივ/i.test(normalized)) {
    return audioPublicUrl(POINTS.hint) // No exact audio file available
  }

  // "მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ"
  if (/მარჯვნივ.*შემდეგ.*მარცხნივ/i.test(normalized)) {
    return audioPublicUrl(POINTS.rightThenLeft)
  }

  const left = /მარცხნივ/.test(normalized)
  const right = /მარჯვნივ/.test(normalized)
  const straight = /პირდაპირ/.test(normalized)
  const roundabout = /წრიული/.test(normalized)
  
  // Distance-based instructions
  if (/500 მეტრში/.test(normalized)) {
    if (roundabout && right) return audioPublicUrl(POINTS.m500RightRound)
    if (roundabout && left) return audioPublicUrl(POINTS.m500LeftRound)
    if (right) return audioPublicUrl(POINTS.m500Right)
    if (left) return audioPublicUrl(POINTS.m500LeftLong)
  }

  if (/300 მეტრში/.test(normalized)) {
    if (roundabout && left) return audioPublicUrl(POINTS.m300LeftRound)
    if (roundabout && right) return audioPublicUrl(POINTS.m300RightRound)
    if (left) return audioPublicUrl(POINTS.m300Left)
    if (right) return audioPublicUrl(POINTS.m300Right)
  }

  if (/მალე/.test(normalized)) {
    if (roundabout && straight) return audioPublicUrl(POINTS.soonStraightRound)
    if (roundabout && left) return audioPublicUrl(POINTS.soonLeftRound)
    if (roundabout && right) return audioPublicUrl(POINTS.soonRightRound)
    if (left) return audioPublicUrl(POINTS.soonLeft)
    if (right) return audioPublicUrl(POINTS.soonRight)
  }

  // Turn now (no distance)
  if (/გთხოვთ/.test(normalized)) {
    if (straight) return audioPublicUrl(POINTS.straight)
    if (left) return audioPublicUrl(POINTS.turnLeft)
    if (right) return audioPublicUrl(POINTS.turnRight)
  }

  // Default
  return audioPublicUrl(POINTS.hint)
}

export function route1VoicePreloadPaths(): string[] {
  return [
    ...Object.values(ROUTE_1_SESSION_AUDIO),
    ...Object.values(POINTS),
  ].map((path) => audioPublicUrl(path))
}
