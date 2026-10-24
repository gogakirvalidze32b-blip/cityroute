import type { PinRow, RouteWithPins } from '@/types/database'
import tbilisiTestRoad from '@/data/test-route-tbilisi-road.json'

/**
 * Standalone GPS test city, enabled only in local development and Vercel Preview.
 * It is not an exam-agency route and is never stored in Supabase.
 */
const ROUTE_ID = 'local-test-tbilisi'

const TEST_PINS: readonly { lat: number; lng: number; instruction: string }[] = [
  { lat: 41.6789378, lng: 44.9788424, instruction: 'გთხოვთ, მოუხვიოთ მარჯვნივ' },
  { lat: 41.6792766, lng: 44.9781393, instruction: 'გთხოვთ, იმოძრაოთ პირდაპირ' },
  { lat: 41.6798062, lng: 44.9783244, instruction: 'გთხოვთ, 300 მეტრში მოუხვიოთ მარჯვნივ' },
  { lat: 41.6811228, lng: 44.979409, instruction: 'გთხოვთ, მოუხვიოთ მარჯვნივ' },
  { lat: 41.6811569, lng: 44.9808128, instruction: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
]

const pins: PinRow[] = TEST_PINS.map((pin, index) => ({
  id: `${ROUTE_ID}-${index + 1}`,
  route_id: ROUTE_ID,
  lat: pin.lat,
  lng: pin.lng,
  radius_m: 25,
  trigger_distance_m: 50,
  instruction_ka: pin.instruction,
  // Resolved via exact instruction→WAV map in enrichPinsWithLocalAudio (no hardcoded path / TTS).
  audio_url: null,
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
  polyline: tbilisiTestRoad as [number, number][],
  pins,
}

export function applyLocalTbilisiTestPin(
  routes: RouteWithPins[],
  enabled = true,
): RouteWithPins[] {
  const officialRoutes = routes.filter((route) => route.slug !== LOCAL_TBILISI_TEST_ROUTE.slug)
  return enabled ? [...officialRoutes, LOCAL_TBILISI_TEST_ROUTE] : officialRoutes
}
