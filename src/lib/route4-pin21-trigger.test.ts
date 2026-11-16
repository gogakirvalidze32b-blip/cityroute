import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import { prepareRouteGeometry, projectPointToRoute } from '@/lib/pure-route-geometry'
import { AUDIO_TRIGGER_DISTANCE_M, pinAudioTriggerDistanceMeters } from '@/lib/pin-audio'

describe('route-4 PIN 21 on-line hitability', () => {
  it('stays inside the ordinary audio trigger from the route centerline', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-4')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const pin = pins.find((item) => item.sort_order === 21)!
    const projection = projectPointToRoute(
      prepareRouteGeometry('route-4', examRouteLine('route-4', pins)),
      [pin.lat, pin.lng],
    )
    expect(projection).toBeTruthy()
    expect(projection!.crossTrackMeters).toBeLessThanOrEqual(
      pinAudioTriggerDistanceMeters('route-4', 21),
    )
    expect(AUDIO_TRIGGER_DISTANCE_M).toBeGreaterThanOrEqual(18)
  })
})
