import { normalizeRemovedRoutePinOrders } from './route-resume'

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

export type RoutePinProgressRead =
  | { status: 'missing' }
  | { status: 'valid'; orders: number[] }
  | { status: 'invalid' }
  | { status: 'unavailable' }

export function readRoutePinProgress(routeSlug: string, scope?: string): RoutePinProgressRead {
  let raw: string | null
  try {
    raw = localStorage.getItem(storageKey(routeSlug, scope))
  } catch (err) {
    console.error('Failed to load route PIN progress:', err)
    return { status: 'unavailable' }
  }
  if (raw === null) return { status: 'missing' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error('Failed to parse route PIN progress:', err)
    return { status: 'invalid' }
  }
  if (!validOrders(parsed)) {
    console.error('Failed to load route PIN progress: invalid saved data', routeSlug)
    return { status: 'invalid' }
  }
  return {
    status: 'valid',
    orders: [...normalizeRemovedRoutePinOrders(routeSlug, parsed)].sort((a, b) => a - b),
  }
}

export function loadRoutePinProgress(routeSlug: string, scope?: string): number[] | null {
  const result = readRoutePinProgress(routeSlug, scope)
  return result.status === 'valid' ? result.orders : null
}

export function saveRoutePinProgress(routeSlug: string, orders: Iterable<number>, scope?: string): void {
  const incoming = [...normalizeRemovedRoutePinOrders(routeSlug, orders)].sort((a, b) => a - b)
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
