const STORAGE_PREFIX = 'cityroute-pin-progress:'

type RoutePinProgress = {
  orders: number[]
  updatedAt: number
}

function storageKey(routeSlug: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(routeSlug)}`
}

function parseProgress(value: unknown): { orders: number[]; updatedAt: number | null } | null {
  const progress =
    Array.isArray(value)
      ? { orders: value, updatedAt: null }
      : value && typeof value === 'object'
        ? value as Partial<RoutePinProgress>
        : null
  if (!progress || !Array.isArray(progress.orders) || !validOrders(progress.orders)) return null
  return {
    orders: progress.orders,
    updatedAt:
      typeof progress.updatedAt === 'number' && Number.isFinite(progress.updatedAt)
        ? progress.updatedAt
        : null,
  }
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
    const progress = parseProgress(parsed)
    if (!progress) {
      console.error('Failed to load route PIN progress: invalid saved data', routeSlug)
      return null
    }
    return [...progress.orders].sort((a, b) => a - b)
  } catch (err) {
    console.error('Failed to load route PIN progress:', err)
    return null
  }
}

export function routePinProgressUpdatedAt(routeSlug: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey(routeSlug))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parseProgress(parsed)?.updatedAt ?? null
  } catch (err) {
    console.error('Failed to read route PIN progress timestamp:', err)
    return null
  }
}

export function saveRoutePinProgress(routeSlug: string, orders: Iterable<number>): void {
  const incoming = [...new Set(orders)].sort((a, b) => a - b)
  if (!validOrders(incoming)) {
    console.error('Failed to save route PIN progress: invalid PIN order', routeSlug)
    return
  }
  const sorted = [...new Set([...(loadRoutePinProgress(routeSlug) ?? []), ...incoming])]
    .sort((a, b) => a - b)
  try {
    localStorage.setItem(storageKey(routeSlug), JSON.stringify({ orders: sorted, updatedAt: Date.now() }))
  } catch (err) {
    console.error('Failed to save route PIN progress:', err)
  }
}

export function clearRoutePinProgress(routeSlug: string): void {
  try {
    localStorage.removeItem(storageKey(routeSlug))
  } catch (err) {
    console.error('Failed to clear route PIN progress:', err)
  }
}
