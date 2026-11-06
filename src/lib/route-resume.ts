/**
 * Saved exam progress only. Pin order stays sort_order.
 * This does not look at the route line or GPS, and it does not skip pins.
 */

export type ExamProgressPin = {
  id: string
  sort_order: number
}

export type ExamProgress = {
  lastPassedPinId: string | null
  nextPinId: string | null
}

export function normalizeRemovedRoutePinOrders(
  routeSlug: string,
  orders: Iterable<number>,
): Set<number> {
  const removedOrders = routeSlug === 'route-3' ? new Set([12]) : new Set<number>()
  return new Set([...orders].filter((order) => !removedOrders.has(order)))
}

export function examProgress(
  pins: readonly ExamProgressPin[],
  handledIds: ReadonlySet<string>,
): ExamProgress {
  const ordered = [...pins].sort((a, b) => a.sort_order - b.sort_order)
  let lastPassedPinId: string | null = null
  for (const pin of ordered) {
    if (!handledIds.has(pin.id)) {
      return { lastPassedPinId, nextPinId: pin.id }
    }
    lastPassedPinId = pin.id
  }
  return { lastPassedPinId, nextPinId: null }
}

export type ExamStartChoice = 'resume' | 'new'

/** Active-session presence selects Resume; resolvePinProgress selects the next PIN. */
export function decideExamStart(saved: { triggeredPins: readonly string[] } | null): ExamStartChoice {
  return saved ? 'resume' : 'new'
}

export const RESUME_UNRESOLVED_MESSAGE =
  'შენახული პროგრესი ვერ აღდგა. შემდეგი PIN ვერ დგინდება. გამოცდა PIN 1-იდან არ დაიწყება.'

export const RESUME_PENDING_MESSAGE =
  'შენახული პროგრესი ამ მარშრუტის PIN-ებს ჯერ ვერ დაუკავშირდა. დაელოდეთ მონაცემების ჩატვირთვას და ხელახლა დააჭირეთ.'

/** Ids of the pins in this list whose sort_order is already handled. */
export function pinIdsForOrders(
  pins: readonly ExamProgressPin[],
  orders: ReadonlySet<number>,
): Set<string> {
  return new Set(pins.filter((pin) => orders.has(pin.sort_order)).map((pin) => pin.id))
}

/**
 * Sort orders for saved ids. Live ids and this route's local `p{route}-{order}` ids are known.
 * Anything else (a Supabase UUID while the local list is shown) is unknown, not dropped.
 */
export function ordersForIds(
  ids: Iterable<string>,
  pins: readonly ExamProgressPin[],
  routeSlug: string,
): { orders: Set<number>; unknown: string[] } {
  const byId = new Map(pins.map((pin) => [pin.id, pin.sort_order]))
  const routeNumber = /^route-(\d+)$/.exec(routeSlug)?.[1]
  const orders = new Set<number>()
  const unknown: string[] = []
  for (const id of ids) {
    const live = byId.get(id)
    if (live !== undefined) {
      orders.add(live)
      continue
    }
    const local = /^p(\d+)-(\d+)$/.exec(id)
    if (local && routeNumber && local[1] === routeNumber) {
      orders.add(Number(local[2]))
      continue
    }
    unknown.push(id)
  }
  return { orders: normalizeRemovedRoutePinOrders(routeSlug, orders), unknown }
}

export function nextSortOrder(
  pins: readonly ExamProgressPin[],
  orders: ReadonlySet<number>,
): { lastPassedSortOrder: number | null; nextSortOrder: number | null } {
  const ordered = [...pins].sort((a, b) => a.sort_order - b.sort_order)
  let lastPassedSortOrder: number | null = null
  for (const pin of ordered) {
    if (!orders.has(pin.sort_order)) return { lastPassedSortOrder, nextSortOrder: pin.sort_order }
    lastPassedSortOrder = pin.sort_order
  }
  return { lastPassedSortOrder, nextSortOrder: null }
}

export type ResumeResolution =
  | { status: 'pending'; message: string }
  | { status: 'error'; message: string }
  | {
      status: 'resume'
      /** null: an old id-only save that is placed when the pin list loads. */
      handledOrders: number[] | null
      lastPassedSortOrder: number | null
      nextSortOrder: number | null
      triggeredIds: string[]
    }

/**
 * Resolve a route's next PIN from completed sort orders only.
 * The route slug scopes persistence; local route ids and Supabase UUIDs do not affect PIN order.
 */
export function resolvePinProgress(
  pins: readonly ExamProgressPin[],
  handledOrders: Iterable<number>,
): ResumeResolution {
  const ordered = [...pins].sort((a, b) => a.sort_order - b.sort_order)
  const orders = [...new Set(handledOrders)].sort((a, b) => a - b)
  const pinOrders = ordered.map((pin) => pin.sort_order)
  if (
    ordered.length === 0 ||
    pinOrders.some((order) => !isOrder(order)) ||
    new Set(pinOrders).size !== pinOrders.length ||
    orders.some((order) => !isOrder(order) || !pinOrders.includes(order))
  ) {
    return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  }

  const prefix = ordered.slice(0, orders.length).map((pin) => pin.sort_order)
  if (prefix.some((order, index) => order !== orders[index])) {
    return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  }

  const progress = nextSortOrder(ordered, new Set(orders))
  return {
    status: 'resume',
    handledOrders: orders,
    lastPassedSortOrder: progress.lastPassedSortOrder,
    nextSortOrder: progress.nextSortOrder,
    triggeredIds: [...pinIdsForOrders(ordered, new Set(orders))],
  }
}

export type SavedResume = {
  triggeredPins: readonly string[]
  triggeredSortOrders?: readonly number[] | null
  lastPassedSortOrder?: number | null
  nextSortOrder?: number | null
}

const isOrder = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

/** Handled sort orders from a save, or null when the save only has ids this list cannot place yet. */
export function savedHandledOrders(
  saved: SavedResume,
  pins: readonly ExamProgressPin[],
  routeSlug: string,
): Set<number> | 'invalid' | null {
  if (saved.triggeredSortOrders != null) {
    if (
      !Array.isArray(saved.triggeredSortOrders) ||
      !saved.triggeredSortOrders.every(isOrder) ||
      new Set(saved.triggeredSortOrders).size !== saved.triggeredSortOrders.length
    ) {
      return 'invalid'
    }
    return normalizeRemovedRoutePinOrders(routeSlug, saved.triggeredSortOrders)
  }
  const derived = ordersForIds(saved.triggeredPins, pins, routeSlug)
  if (derived.unknown.length > 0) return null
  return derived.orders
}

/**
 * Next pin comes only from the saved handled sort orders.
 * GPS is not an input. A save that cannot be placed is never turned into "start at pin 1",
 * and no pin is marked done to fill a gap.
 */
export function resolveExamResume(
  saved: SavedResume,
  pins: readonly ExamProgressPin[],
  routeSlug: string,
): ResumeResolution {
  if (
    (saved.nextSortOrder != null && !isOrder(saved.nextSortOrder)) ||
    (saved.lastPassedSortOrder != null && !isOrder(saved.lastPassedSortOrder))
  ) {
    return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  }
  const orders = savedHandledOrders(saved, pins, routeSlug)
  if (orders === 'invalid') return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  if (orders === null && pins.length === 0) {
    // Placed by sort_order once this route's pins arrive; until then no pin is next.
    return {
      status: 'resume',
      handledOrders: null,
      lastPassedSortOrder: null,
      nextSortOrder: null,
      triggeredIds: [...saved.triggeredPins],
    }
  }
  if (orders === null) return { status: 'pending', message: RESUME_PENDING_MESSAGE }

  if (pins.length === 0) {
    const handledOrders = [...orders].sort((a, b) => a - b)
    return {
      status: 'resume',
      handledOrders,
      lastPassedSortOrder: handledOrders.length ? handledOrders[handledOrders.length - 1] : null,
      nextSortOrder: isOrder(saved.nextSortOrder) ? saved.nextSortOrder : null,
      triggeredIds: [],
    }
  }

  const resolution = resolvePinProgress(pins, orders)
  if (resolution.status !== 'resume') return resolution
  const { lastPassedSortOrder, nextSortOrder: resolvedNextSortOrder } = resolution
  const removedRoute3Pin12 = routeSlug === 'route-3' && !pins.some((pin) => pin.sort_order === 12)
  const expectedNextSortOrder =
    removedRoute3Pin12 && saved.nextSortOrder === 12 && resolvedNextSortOrder === 13
      ? resolvedNextSortOrder
      : saved.nextSortOrder
  const expectedLastPassedSortOrder =
    removedRoute3Pin12 && saved.lastPassedSortOrder === 12 && lastPassedSortOrder === 11
      ? lastPassedSortOrder
      : saved.lastPassedSortOrder
  if (isOrder(expectedNextSortOrder) && expectedNextSortOrder !== resolvedNextSortOrder) {
    return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  }
  if (isOrder(expectedLastPassedSortOrder) && expectedLastPassedSortOrder !== lastPassedSortOrder) {
    return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  }

  return {
    ...resolution,
  }
}
