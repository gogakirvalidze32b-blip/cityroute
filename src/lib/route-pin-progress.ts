const STORAGE_PREFIX = 'cityroute-pin-progress:'

function storageKey(routeSlug: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(routeSlug)}`
}

function validOrders(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((order) => Number.isInteger(order) && order > 0) &&
    new Set(value).size === value.length
  )
}

export function loadRoutePinProgress(routeSlug: string): number[] | null {
  try {
    const raw = localStorage.getItem(storageKey(routeSlug))
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

export function saveRoutePinProgress(routeSlug: string, orders: Iterable<number>): void {
  const sorted = [...new Set(orders)].sort((a, b) => a - b)
  if (!validOrders(sorted)) {
    console.error('Failed to save route PIN progress: invalid PIN order', routeSlug)
    return
  }
  try {
    localStorage.setItem(storageKey(routeSlug), JSON.stringify(sorted))
  } catch (err) {
    console.error('Failed to save route PIN progress:', err)
  }
}
