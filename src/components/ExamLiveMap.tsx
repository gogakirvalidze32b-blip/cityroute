import { ExamLiveMapLeaflet } from '@/components/ExamLiveMapLeaflet'
import { ExamLiveMapLibre } from '@/components/ExamLiveMapLibre'
import type { PinRow, RouteWithPins } from '@/types/database'
import type { LatLng } from '@/lib/gps'

type Props = {
  route: RouteWithPins
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
  hasGpsFix?: boolean
}

// Toggle between Leaflet (optimized) and MapLibre+Mapbox
const USE_MAPLIBRE = false // ← Back to Leaflet - properly optimized for Android tablets

/** Live GPS map — MapLibre/Leaflet, follows user while driving. */
export function ExamLiveMap(props: Props) {
  if (USE_MAPLIBRE) {
    return <ExamLiveMapLibre {...props} />
  }
  return <ExamLiveMapLeaflet {...props} />
}
