import type { RouteWithPins } from '@/types/database'
import { ROUTE_POLYLINES } from './route-polylines'
import route1Official from './route-1-official.json'
import route2Official from './route-2-official.json'
import auditedPins from './audio-audit-pins.fixture.json'
import { L, TELAVI_CENTER } from './telavi-landmarks'
import { applyCommonFinishInstructions } from './route-finish'
import { coordinateFromChainage, frozenPreparedGeometry, pinChainageTable } from './pin-chainage'
import { routeGeometryVersion } from './route-geometry'

/**
 * PIN position = its route kilometre (src/data/pin-chainage.json) on the frozen
 * route geometry + the stored exact offset. Unchanged PINs reproduce their
 * original coordinates bit-for-bit (guarded by src/test/migration-baseline);
 * a PIN moved by kilometre (scripts/move-pin-chainage.mts) gets its new
 * coordinate here automatically. Fails safe: if the table does not cover this
 * exact PIN list or the geometry version differs, the bundled coordinates are kept.
 */
function withChainageCoordinates<T extends { sort_order: number; lat: number; lng: number }>(
  slug: string,
  pins: T[],
): T[] {
  const table = pinChainageTable(slug)
  const geometry = frozenPreparedGeometry(slug)
  if (!table || !geometry || table.geometryVersion !== routeGeometryVersion(slug)) return pins
  const byOrder = new Map(table.pins.map((entry) => [entry.sort_order, entry]))
  if (byOrder.size !== pins.length || pins.some((pin) => !byOrder.has(pin.sort_order))) return pins
  return pins.map((pin) => {
    const coordinate = coordinateFromChainage(geometry, byOrder.get(pin.sort_order)!)
    return coordinate ? { ...pin, lat: coordinate[0], lng: coordinate[1] } : pin
  })
}

export { TELAVI_CENTER }

function pin(
  id: string,
  routeId: string,
  pt: [number, number],
  instruction: string,
  order: number,
  triggerM = 50,
  radiusM = 25,
) {
  return {
    id,
    route_id: routeId,
    lat: pt[0],
    lng: pt[1],
    radius_m: radiusM,
    trigger_distance_m: triggerM,
    instruction_ka: instruction,
    audio_url: null,
    // CRITICAL: sort_order determines STRICT SEQUENTIAL trigger order
    // PIN with sort_order=1 must trigger before sort_order=2, etc.
    // Navigation logic enforces this sequence across all routes
    sort_order: order,
    active: true,
  }
}

function route1Pins(routeId: string) {
  return pinsFromOfficial(routeId, route1Official, 'p1')
}

type AuditPin = { route: number; pin: number; lat: number; lng: number; instruction: string }

/** Same coordinates, order, and texts as the live exam. Bundled pins are preferred over stale Supabase rows. */
function pinsFromAudit(routeNumber: number, routeId: string, idPrefix: string) {
  const rows = (auditedPins as AuditPin[])
    .filter((item) => item.route === routeNumber)
    .sort((a, b) => a.pin - b.pin)
  return rows.map((item, index) =>
    pin(
      `${idPrefix}-${item.pin}`,
      routeId,
      [item.lat, item.lng],
      item.instruction,
      item.pin,
      index === 0 || index === rows.length - 1 ? 40 : 50,
      item.pin === 2 && (routeNumber === 3 || routeNumber === 4) ? 15 : 25,
    ),
  )
}

function pinsFromOfficial(
  routeId: string,
  official: typeof route1Official,
  idPrefix: string,
) {
  return official.manoeuvres.map((m, i) =>
    pin(
      `${idPrefix}-${i + 1}`,
      routeId,
      [m.lat, m.lng],
      m.instruction,
      i + 1,
      m.type === 'start' || m.type === 'finish' ? 40 : 50,
      i + 1 === 2 ? 15 : 25,
    ),
  )
}

/** Set true when ready to enable voice/turn pins from official JSON manoeuvres */
export const ROUTE1_PINS_ENABLED = true

/** Street zoom — one level closer while keeping enough road ahead in view. */
export const YANDEX_STREET_ZOOM = 17

function line(slug: string, fallback: [number, number][]): [number, number][] {
  const osrm = ROUTE_POLYLINES[slug]
  return osrm?.length >= 2 ? osrm : fallback
}

const route1Fallback: [number, number][] = route1Official.full_path.map((p) => [p.lat, p.lng])
const route2Fallback: [number, number][] = route2Official.full_path.map((p) => [p.lat, p.lng])
const route3Fallback: [number, number][] = route2Fallback // Route 3 uses same geometry for now
const route4Fallback: [number, number][] = route2Fallback // Route 4 uses same geometry for now
const route5Fallback: [number, number][] = [L.agency, L.kurdgelauri, L.tbilisi_st, L.tbilisi_hwy, L.saakadze, L.agency]

export const TELAVI_ROUTES_FALLBACK: RouteWithPins[] = [
  {
    id: 'local-route-1',
    city_id: 'telavi',
    slug: 'route-1',
    name_ka: 'მარშრუტი 1',
    official_label: null,
    license_category: 'B',
    sort_order: 1,
    active: true,
    polyline: line('route-1', route1Fallback),
    pins: ROUTE1_PINS_ENABLED
      ? withChainageCoordinates('route-1', applyCommonFinishInstructions(route1Pins('local-route-1')))
      : [],
  },
  {
    id: 'local-route-2',
    city_id: 'telavi',
    slug: 'route-2',
    name_ka: 'მარშრუტი 2',
    official_label: null,
    license_category: 'B',
    sort_order: 2,
    active: true,
    polyline: line('route-2', route2Fallback),
    pins: withChainageCoordinates('route-2', applyCommonFinishInstructions(pinsFromAudit(2, 'local-route-2', 'p2'))),
  },
  {
    id: 'local-route-3',
    city_id: 'telavi',
    slug: 'route-3',
    name_ka: 'მარშრუტი 3',
    official_label: null,
    license_category: 'B',
    sort_order: 3,
    active: true,
    polyline: line('route-3', route3Fallback),
    pins: withChainageCoordinates('route-3', applyCommonFinishInstructions(pinsFromAudit(3, 'local-route-3', 'p3'))),
  },
  {
    id: 'local-route-4',
    city_id: 'telavi',
    slug: 'route-4',
    name_ka: 'მარშრუტი 4',
    official_label: null,
    license_category: 'B',
    sort_order: 4,
    active: true,
    polyline: line('route-4', route4Fallback),
    pins: withChainageCoordinates('route-4', applyCommonFinishInstructions(pinsFromAudit(4, 'local-route-4', 'p4'))),
  },
  {
    id: 'local-route-5',
    city_id: 'telavi',
    slug: 'route-5',
    name_ka: 'C, D კატეგორია',
    official_label: null,
    license_category: 'C,D',
    sort_order: 5,
    active: true,
    polyline: line('route-5', route5Fallback),
    pins: [
      pin('p5-1', 'local-route-5', L.agency, 'დაწყება — სააგენტო', 1),
      pin('p5-2', 'local-route-5', L.kurdgelauri, 'მარჯვნივ კურდღელაურის ქუჩაზე', 2),
      pin('p5-3', 'local-route-5', L.tbilisi_st, 'თბილისის ქუჩით სამხრევით', 3),
      pin('p5-4', 'local-route-5', L.tbilisi_hwy, 'თბილისის გზატკეცილი — დასავლით', 4),
      pin('p5-5', 'local-route-5', L.saakadze, 'სააკაძის ქუჩით ჩრდილოვნით', 5),
      pin('p5-6', 'local-route-5', L.agency, 'დასრულება — სააგენტო', 6),
    ],
  },
]
