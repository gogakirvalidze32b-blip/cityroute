function audioPublicUrl(relativePath: string): string {
  return encodeURI(`/audio/${relativePath}`)
}

export const ROUTE_1_SESSION_AUDIO = {
  start: 'დაწყება.mp3',
  finish: 'ფინიში.mp3',
  success: 'გილოცავთ.mp3',
} as const

const POINTS = {
  soonLeft: 'points/მალე, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  soonRight: 'points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  soonLeftRound: 'points/მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  soonRightRound: 'points/მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  soonStraightRound: 'points/მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ.mp3',
  soonLeftTwice: 'points/მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ.mp3',
  m300Left: 'points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  m300Right: 'points/300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  m300LeftRound: 'points/300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  m300RightRound: 'points/300 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  m500Right: 'points/500 მეტრში მარჯვნივ.mp3',
  m500LeftRound: 'points/500 მეტრში წრიული მოძრაობისას მარცხნივ.mp3',
  m500RightRound: 'points/500 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.mp3',
  m500LeftLong: 'points/ხუთას მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  turnLeft: 'points/გთხოვთ, მოუხვიოთ მარცხნივ.mp3',
  moveRight: 'points/გთხოვთ, იმოძრაოთ მარჯვნივ.mp3',
  straight: 'points/გთხოვთ, იმოძრაოთ პირდაპირ.mp3',
  rightThenLeft: 'points/გთხოვთ, მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ.mp3',
  hint: 'points/მინიშნება.mp3',
} as const

function parseDistanceM(instruction: string): number | null {
  const match = instruction.match(/(\d+)\s*მ/)
  return match ? Number(match[1]) : null
}

/** Match official manoeuvre text → new AI voice file in public/audio. */
export function matchRoute1InstructionAudio(instruction: string): string {
  if (/დაწყება/i.test(instruction)) {
    return audioPublicUrl(ROUTE_1_SESSION_AUDIO.start)
  }
  if (/დასასრული|ფინიში/i.test(instruction)) {
    return audioPublicUrl(ROUTE_1_SESSION_AUDIO.finish)
  }

  const left = /მარცხნივ/.test(instruction)
  const right = /მარჯვნივ/.test(instruction)
  const straight = /პირდაპირ/.test(instruction)
  const distance = parseDistanceM(instruction)

  if (straight && !left && !right) {
    return audioPublicUrl(POINTS.straight)
  }

  if (distance !== null) {
    if (distance <= 150) {
      if (left) return audioPublicUrl(POINTS.soonLeft)
      if (right) return audioPublicUrl(POINTS.soonRight)
    }
    if (distance <= 400) {
      if (left) return audioPublicUrl(POINTS.m300Left)
      if (right) return audioPublicUrl(POINTS.m300Right)
    }
    if (distance <= 700) {
      if (left) return audioPublicUrl(POINTS.m500LeftRound)
      if (right) return audioPublicUrl(POINTS.m500Right)
    }
    if (distance <= 1400) {
      if (left) return audioPublicUrl(POINTS.m500LeftLong)
      if (right) return audioPublicUrl(POINTS.m500RightRound)
    }
    if (left) return audioPublicUrl(POINTS.turnLeft)
    if (right) return audioPublicUrl(POINTS.moveRight)
  }

  if (left) return audioPublicUrl(POINTS.turnLeft)
  if (right) return audioPublicUrl(POINTS.moveRight)
  return audioPublicUrl(POINTS.hint)
}

export function route1VoicePreloadPaths(): string[] {
  return [
    ...Object.values(ROUTE_1_SESSION_AUDIO),
    ...Object.values(POINTS),
  ].map((path) => audioPublicUrl(path))
}
