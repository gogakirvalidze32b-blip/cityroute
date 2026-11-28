import { ExamLiveMapLeaflet } from '@/components/ExamLiveMapLeaflet'
import type { VehicleMotion } from '@/lib/vehicle-motion'
import { ExamLiveMapLibre } from '@/components/ExamLiveMapLibre'
import type { PinRow, RouteWithPins } from '@/types/database'
import type { LatLng } from '@/lib/gps'

type Props = {
  route: RouteWithPins
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
  hasGpsFix?: boolean
  offlineMaps?: boolean
  /** Display-only route progress + speed for per-frame arrow prediction (Leaflet only). */
  vehicleMotion?: VehicleMotion | null
}

// Toggle between Leaflet (optimized) and MapLibre+Mapbox
const USE_MAPLIBRE = false // ← Back to Leaflet - properly optimized for Android tablets

/** Live GPS map — MapLibre/Leaflet, follows user while driving. */
export function ExamLiveMap(props: Props) {
  if (USE_MAPLIBRE && !props.offlineMaps) {
    const { vehicleMotion: _vehicleMotion, ...rest } = props
    return <ExamLiveMapLibre {...rest} />
  }
  return <ExamLiveMapLeaflet {...props} />
}
