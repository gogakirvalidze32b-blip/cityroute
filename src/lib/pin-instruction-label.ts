/**
 * Instructor-facing PIN label for direction text.
 * Keeps audio/matching on raw `instruction_ka`; only UI copy uses this.
 */
export function formatPinInstructionLabel(
  sortOrder: number,
  instruction: string | null | undefined,
): string {
  const order = Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0
  const prefix = `PIN ${order}`
  const text = (instruction ?? '').trim()
  if (!text) return prefix
  if (
    text === prefix ||
    text.startsWith(`${prefix} — `) ||
    text.startsWith(`${prefix} - `) ||
    text.startsWith(`${prefix}:`)
  ) {
    return text
  }
  return `${prefix} — ${text}`
}
