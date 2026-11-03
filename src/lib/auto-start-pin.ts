import type { StartPinInput } from '@/lib/start-pin'
import { resolvePinProgress } from '@/lib/route-resume'

export type AutoStartResult<T extends StartPinInput> = {
  /** PIN the Auto start will actually use. */
  pin: T | null
  /** Retained as a stable result shape; GPS never changes the resolved PIN. */
  aheadSuggestion: null
}

/**
 * Auto start resolves only from persisted completed PIN orders. GPS is deliberately not an input.
 */
export function resolveAutoStart<T extends StartPinInput & { id: string }>(
  sortedPins: readonly T[],
  completed: ReadonlySet<number>,
): AutoStartResult<T> {
  const resolution = resolvePinProgress(sortedPins, completed)
  const pin = resolution.status === 'resume' && resolution.nextSortOrder !== null
    ? sortedPins.find((item) => item.sort_order === resolution.nextSortOrder) ?? null
    : null
  return { pin, aheadSuggestion: null }
}
