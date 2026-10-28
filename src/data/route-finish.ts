export const COMMON_FINISH_INSTRUCTIONS = [
  '500 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ',
  '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ',
  'მალე, გთხოვთ მოუხვიოთ მარჯვნივ',
  'მალე, გთხოვთ მოუხვიოთ მარცხნივ',
  'ფინიში',
] as const

export const FINISH_SECTION_PIN_COUNT = 3

export function applyCommonFinishInstructions<T extends { instruction_ka: string }>(pins: T[]): T[] {
  const start = pins.length - COMMON_FINISH_INSTRUCTIONS.length
  return pins.map((pin, index) =>
    index < start
      ? pin
      : { ...pin, instruction_ka: COMMON_FINISH_INSTRUCTIONS[index - start] },
  )
}

export function finishSectionStartIndex(totalPins: number): number {
  return Math.max(0, totalPins - FINISH_SECTION_PIN_COUNT)
}
