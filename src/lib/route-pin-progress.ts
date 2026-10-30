const STORAGE_PREFIX = 'cityroute-pin-progress:'
const SCOPE_STORAGE_PREFIX = 'cityroute-preview:'

function storageKey(routeSlug: string, scope?: string): string {
  const key = `${STORAGE_PREFIX}${encodeURIComponent(routeSlug)}`
  return scope ? `${SCOPE_STORAGE_PREFIX}${encodeURIComponent(scope)}:${key}` : key
}

function validOrders(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((order) => Number.isInteger(order) && order > 0) &&
    new Set(value).size === value.length
  )
}

export function loadRoutePinProgress(routeSlug: string, scope?: string): number[] | null {
  try {
    const raw = localStorage.getItem(storageKey(routeSlug, scope))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!validOrders(parsed)) {
      console.error('Failed to load route PIN progress: invalid saved data', routeSlug)
      return null
    }
    return [...parsed].sort((a, b) => a - b)
  } catch (err) {
    console.error('Failed to load route PIN progress:', err)
    return null
  }
}

export function saveRoutePinProgress(routeSlug: string, orders: Iterable<number>, scope?: string): void {
  const incoming = [...new Set(orders)].sort((a, b) => a - b)
  if (!validOrders(incoming)) {
    console.error('Failed to save route PIN progress: invalid PIN order', routeSlug)
    return
  }
  const sorted = [...new Set([...(loadRoutePinProgress(routeSlug, scope) ?? []), ...incoming])]
    .sort((a, b) => a - b)
  try {
    localStorage.setItem(storageKey(routeSlug, scope), JSON.stringify(sorted))
  } catch (err) {
    console.error('Failed to save route PIN progress:', err)
  }
}

export function clearRoutePinProgress(routeSlug: string, scope?: string): void {
  try {
    localStorage.removeItem(storageKey(routeSlug, scope))
  } catch (err) {
    console.error('Failed to clear route PIN progress:', err)
  }
}
