const STORAGE_PREFIX = 'cityroute-manual-pin:'
const SCOPE_STORAGE_PREFIX = 'cityroute-preview:'

function storageKey(routeSlug: string, scope?: string): string {
  const key = `${STORAGE_PREFIX}${encodeURIComponent(routeSlug)}`
  return scope ? `${SCOPE_STORAGE_PREFIX}${encodeURIComponent(scope)}:${key}` : key
}

/** The PIN a user picked by hand on a route's start page but has not started yet (per route). */
export function loadManualPinSelection(routeSlug: string, scope?: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey(routeSlug, scope))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

export function saveManualPinSelection(routeSlug: string, sortOrder: number, scope?: string): void {
  try {
    localStorage.setItem(storageKey(routeSlug, scope), JSON.stringify(sortOrder))
  } catch (err) {
    console.error('Failed to save manual PIN selection:', err)
  }
}

export function clearManualPinSelection(routeSlug: string, scope?: string): void {
  try {
    localStorage.removeItem(storageKey(routeSlug, scope))
  } catch (err) {
    console.error('Failed to clear manual PIN selection:', err)
  }
}
