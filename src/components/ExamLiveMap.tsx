import { ExamLiveMapLeaflet } from '@/components/ExamLiveMapLeaflet'
import type { PinRow, RouteWithPins } from '@/types/database'
import type { LatLng } from '@/lib/gps'

type Props = {
  route: RouteWithPins
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
}

/** Live GPS map — Leaflet + CARTO tiles, follows user while driving. */
export function ExamLiveMap(props: Props) {
  return <ExamLiveMapLeaflet {...props} />
}
