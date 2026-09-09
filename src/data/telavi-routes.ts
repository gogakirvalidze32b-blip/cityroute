import type { RouteWithPins } from '@/types/database'
import { ROUTE_POLYLINES } from './route-polylines'
import route1Official from './route-1-official.json'
import route2Official from './route-2-official.json'
import { L, TELAVI_CENTER } from './telavi-landmarks'

export { TELAVI_CENTER }

function pin(
  id: string,
  routeId: string,
  pt: [number, number],
  instruction: string,
  order: number,
  triggerM = 50,
) {
  return {
    id,
    route_id: routeId,
    lat: pt[0],
    lng: pt[1],
    radius_m: 25,
    trigger_distance_m: triggerM,
    instruction_ka: instruction,
    audio_url: null,
    sort_order: order,
    active: true,
  }
}

function route1Pins(routeId: string) {
  return pinsFromOfficial(routeId, route1Official, 'p1')
}

function route2Pins(routeId: string) {
  return pinsFromOfficial(routeId, route2Official, 'p2')
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
    ),
  )
}

/** Set true when ready to enable voice/turn pins from official JSON manoeuvres */
export const ROUTE1_PINS_ENABLED = true
export const ROUTE2_PINS_ENABLED = true

/** Street zoom — readable labels, not too close (Yandex-like mid range) */
export const YANDEX_STREET_ZOOM = 16

function line(slug: string, fallback: [number, number][]): [number, number][] {
  const osrm = ROUTE_POLYLINES[slug]
  return osrm?.length >= 2 ? osrm : fallback
}

const route1Fallback: [number, number][] = route1Official.full_path.map((p) => [p.lat, p.lng])
const route2Fallback: [number, number][] = route2Official.full_path.map((p) => [p.lat, p.lng])
const route3Fallback: [number, number][] = [L.tbilisi_hwy_far, L.archil_ii, L.erekle_n, L.tbilisi_hwy_far]
const route4Fallback: [number, number][] = [L.sekhniashvili_agency, L.kavkasioni_s, L.saakadze, L.tbilisi_hwy_far, L.alazani_n, L.agency]
const route5Fallback: [number, number][] = [L.agency, L.kurdgelauri, L.tbilisi_st, L.tbilisi_hwy, L.saakadze, L.agency]

export const TELAVI_ROUTES_FALLBACK: RouteWithPins[] = [
  {
    id: 'local-route-1',
    city_id: 'telavi',
    slug: 'route-1',
    name_ka: 'მარშრუტი 1',
    official_label: null,
    sort_order: 1,
    active: true,
    polyline: line('route-1', route1Fallback),
    pins: ROUTE1_PINS_ENABLED ? route1Pins('local-route-1') : [],
  },
  {
    id: 'local-route-2',
    city_id: 'telavi',
    slug: 'route-2',
    name_ka: 'მარშრუტი 2',
    official_label: null,
    sort_order: 2,
    active: true,
    polyline: line('route-2', route2Fallback),
    pins: ROUTE2_PINS_ENABLED ? route2Pins('local-route-2') : [],
  },
  {
    id: 'local-route-3',
    city_id: 'telavi',
    slug: 'route-3',
    name_ka: 'მარშრუტი 3',
    official_label: null,
    sort_order: 3,
    active: true,
    polyline: line('route-3', route3Fallback),
    pins: [
      pin('p3-1', 'local-route-3', L.tbilisi_hwy_far, 'დაწყება — თბილისის გზატკეცილი', 1),
      pin('p3-2', 'local-route-3', L.archil_ii, 'დასავლით — საცხოვრებელი ლუპი', 2),
      pin('p3-3', 'local-route-3', L.erekle_n, 'ერეკლე II-ის გამზირით ჩრდილოვნით', 3),
      pin('p3-4', 'local-route-3', L.erekle_w, 'U-turn — ერეკლე II-ზე შებრუნება', 4),
      pin('p3-5', 'local-route-3', L.tbilisi_hwy_far, 'დასრულება — საწყისი წერტილი', 5),
    ],
  },
  {
    id: 'local-route-4',
    city_id: 'telavi',
    slug: 'route-4',
    name_ka: 'მარშრუტი 4',
    official_label: null,
    sort_order: 4,
    active: true,
    polyline: line('route-4', route4Fallback),
    pins: [
      pin('p4-1', 'local-route-4', L.sekhniashvili_agency, 'დაწყება — სეხნიაშვილის ქუჩა, სააგენტო', 1),
      pin('p4-2', 'local-route-4', L.kavkasioni_s, 'კავკასიონის ქუჩაზე', 2),
      pin('p4-3', 'local-route-4', L.saakadze, 'სააკაძის ქუჩაზე', 3),
      pin('p4-4', 'local-route-4', L.tbilisi_hwy_far, 'თბილისის გზატკეცილზე — U-turn', 4),
      pin('p4-5', 'local-route-4', L.alazani_n, 'ალაზნის გამზირით ჩრდილოვნით', 5),
      pin('p4-6', 'local-route-4', L.sekhniashvili, 'სეხნიაშვილის ქუჩაზე დაბრუნება', 6),
      pin('p4-7', 'local-route-4', L.agency, 'დასრულება — სააგენტო', 7),
    ],
  },
  {
    id: 'local-route-5',
    city_id: 'telavi',
    slug: 'route-5',
    name_ka: 'მარშრუტი 5',
    official_label: null,
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
