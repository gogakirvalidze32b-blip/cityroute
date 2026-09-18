import { ExamLiveMapLeaflet } from '@/components/ExamLiveMapLeaflet'
import { ExamLiveMapLibre } from '@/components/ExamLiveMapLibre'
import type { PinRow, RouteWithPins } from '@/types/database'
import type { LatLng } from '@/lib/gps'

type Props = {
  route: RouteWithPins
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
}

// Toggle between Leaflet (old) and MapLibre (new)
const USE_MAPTILER = true // ← MapTiler enabled with debug logs

/** Live GPS map — MapLibre/Leaflet, follows user while driving. */
export function ExamLiveMap(props: Props) {
  if (USE_MAPTILER) {
    return <ExamLiveMapLibre {...props} />
  }
  return <ExamLiveMapLeaflet {...props} />
}
