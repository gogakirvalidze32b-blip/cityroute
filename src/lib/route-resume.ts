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

/**
 * The start button resumes only a saved unfinished exam for this route.
 * No save, another route, or a finished exam (already cleared) starts at the first pin.
 */
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
  return { orders, unknown }
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
      nextPinId: string | null
      triggeredIds: string[]
    }

export type SavedResume = {
  triggeredPins: readonly string[]
  triggeredSortOrders?: readonly number[] | null
  lastPassedSortOrder?: number | null
  nextSortOrder?: number | null
  nextPinId?: string | null
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
    if (!Array.isArray(saved.triggeredSortOrders) || !saved.triggeredSortOrders.every(isOrder)) return 'invalid'
    return new Set(saved.triggeredSortOrders)
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
  const orders = savedHandledOrders(saved, pins, routeSlug)
  if (orders === 'invalid') return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  if (orders === null && pins.length === 0) {
    // Placed by sort_order once this route's pins arrive; until then no pin is next.
    return {
      status: 'resume',
      handledOrders: null,
      lastPassedSortOrder: null,
      nextSortOrder: null,
      nextPinId: null,
      triggeredIds: [...saved.triggeredPins],
    }
  }
  if (orders === null) return { status: 'pending', message: RESUME_PENDING_MESSAGE }

  const handledOrders = [...orders].sort((a, b) => a - b)
  if (pins.length === 0) {
    return {
      status: 'resume',
      handledOrders,
      lastPassedSortOrder: handledOrders.length ? handledOrders[handledOrders.length - 1] : null,
      nextSortOrder: isOrder(saved.nextSortOrder) ? saved.nextSortOrder : null,
      nextPinId: null,
      triggeredIds: [],
    }
  }

  const known = new Set(pins.map((pin) => pin.sort_order))
  if (handledOrders.some((order) => !known.has(order))) {
    return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  }
  const progress = nextSortOrder(pins, orders)
  const ordered = [...pins].sort((a, b) => a.sort_order - b.sort_order)
  const prefix = ordered.slice(0, handledOrders.length).map((pin) => pin.sort_order)
  if (prefix.some((order, index) => order !== handledOrders[index])) {
    return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  }
  if (isOrder(saved.nextSortOrder) && saved.nextSortOrder !== progress.nextSortOrder) {
    return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  }
  if (isOrder(saved.lastPassedSortOrder) && saved.lastPassedSortOrder !== progress.lastPassedSortOrder) {
    return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
  }
  if (saved.nextPinId != null) {
    const conflictingSavedPin = pins.find((pin) => pin.id === saved.nextPinId)
    if (conflictingSavedPin && conflictingSavedPin.sort_order !== progress.nextSortOrder) {
      return { status: 'error', message: RESUME_UNRESOLVED_MESSAGE }
    }
  }

  return {
    status: 'resume',
    handledOrders,
    lastPassedSortOrder: progress.lastPassedSortOrder,
    nextSortOrder: progress.nextSortOrder,
    nextPinId: progress.nextSortOrder === null
      ? null
      : pins.find((pin) => pin.sort_order === progress.nextSortOrder)?.id ?? null,
    triggeredIds: [...pinIdsForOrders(pins, orders)],
  }
}
