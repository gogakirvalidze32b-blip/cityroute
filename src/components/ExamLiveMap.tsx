import { ExamLiveMapLeaflet } from '@/components/ExamLiveMapLeaflet'
import { ExamLiveMapLibre } from '@/components/ExamLiveMapLibre'
import type { PinRow, RouteWithPins } from '@/types/database'
import type { LatLng } from '@/lib/gps'

type Props = {
  route: RouteWithPins
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
  speedKmh?: number
}

// Toggle between Leaflet (optimized) and MapLibre+Mapbox
const USE_MAPLIBRE = false // ← ACTIVE: ExamLiveMapLeaflet (CSS overlay arrow - FIXED center)

/** 
 * Live GPS map — MapLibre/Leaflet, follows user while driving.
 * 
 * Current active implementation: ExamLiveMapLeaflet
 * - Vehicle arrow is CSS overlay (position: absolute, center)
 * - Arrow NEVER moves from screen center
 * - Map moves underneath fixed arrow
 * - No Leaflet markers for vehicle arrow
 */
export function ExamLiveMap(props: Props) {
  if (USE_MAPLIBRE) {
    return <ExamLiveMapLibre {...props} />
  }
  return <ExamLiveMapLeaflet {...props} />
}
