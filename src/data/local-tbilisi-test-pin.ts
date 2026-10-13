import type { PinRow, RouteWithPins } from '@/types/database'

/**
 * Standalone GPS test city, local only. Not an exam-agency route and not stored in Supabase:
 * no agency start/finish point, no road trace, no Telavi data.
 */
const ROUTE_ID = 'local-test-tbilisi'

const TEST_PINS: readonly { lat: number; lng: number; instruction: string }[] = [
  { lat: 41.6786037, lng: 44.9795425, instruction: 'გთხოვთ, მოუხვიოთ მარჯვნივ' },
  { lat: 41.6792766, lng: 44.9781393, instruction: 'გთხოვთ, იმოძრაოთ პირდაპირ' },
  { lat: 41.6798062, lng: 44.9783244, instruction: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
]

const pins: PinRow[] = TEST_PINS.map((pin, index) => ({
  id: `${ROUTE_ID}-${index + 1}`,
  route_id: ROUTE_ID,
  lat: pin.lat,
  lng: pin.lng,
  radius_m: 25,
  trigger_distance_m: 50,
  instruction_ka: pin.instruction,
  audio_url: encodeURI(`/audio/points/${pin.instruction}.wav`),
  sort_order: index + 1,
  active: true,
}))

export const LOCAL_TBILISI_TEST_ROUTE: RouteWithPins = {
  id: ROUTE_ID,
  city_id: 'test-tbilisi',
  slug: 'test-route-tbilisi',
  name_ka: 'ტესტი — თბილისი',
  official_label: null,
  license_category: 'B',
  sort_order: 99,
  active: true,
  polyline: TEST_PINS.map((pin) => [pin.lat, pin.lng]),
  pins,
}

export function applyLocalTbilisiTestPin(routes: RouteWithPins[]): RouteWithPins[] {
  return [
    ...routes.filter((route) => route.slug !== LOCAL_TBILISI_TEST_ROUTE.slug),
    LOCAL_TBILISI_TEST_ROUTE,
  ]
}
