import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRoadTrace, examRouteLine } from '@/lib/pin-route-line'
import { prepareRouteGeometry, projectPointToRoute } from '@/lib/pure-route-geometry'
import {
  AUDIO_RELIABLE_TRIGGER_DISTANCE_M,
  pinAudioTriggerDistanceMeters,
} from '@/lib/pin-audio'

describe('route-4 PIN 21 on-line hitability', () => {
  it('remains hitable on the PIN 13-rounded route line', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-4')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const pin = pins.find((item) => item.sort_order === 21)!
    const rawProjection = projectPointToRoute(
      prepareRouteGeometry('route-4', examRoadTrace('route-4', pins)!),
      [pin.lat, pin.lng],
    )
    const projection = projectPointToRoute(
      prepareRouteGeometry('route-4', examRouteLine('route-4', pins)),
      [pin.lat, pin.lng],
    )
    expect(rawProjection?.crossTrackMeters).toBeLessThan(1)
    expect(projection?.crossTrackMeters).toBeLessThan(1)
    expect(pinAudioTriggerDistanceMeters('route-4', 21)).toBe(
      AUDIO_RELIABLE_TRIGGER_DISTANCE_M,
    )
    expect(projection!.crossTrackMeters).toBeLessThanOrEqual(
      pinAudioTriggerDistanceMeters('route-4', 21),
    )
  })
})
