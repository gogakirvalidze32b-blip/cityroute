import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from './telavi-routes'
import { resolvePinAudioUrl } from './route-audio'
import {
  COMMON_FINISH_INSTRUCTIONS,
  finishSectionStartIndex,
} from './route-finish'
import { decidePinAudio } from '@/lib/pin-audio'

describe('shared finish sequence', () => {
  it('uses one ordered finish instruction sequence for all four routes', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const finishPins = route.pins.slice(-COMMON_FINISH_INSTRUCTIONS.length)

      expect(finishPins.map((pin) => pin.instruction_ka)).toEqual(COMMON_FINISH_INSTRUCTIONS)
      for (const pin of finishPins) {
        expect(resolvePinAudioUrl(slug, pin)).not.toBeNull()
      }
    }
  })

  it('keeps finish-section gating shared and applies it to each route size', () => {
    expect(
      [35, 29, 31, 32].map((pinCount) => finishSectionStartIndex(pinCount)),
    ).toEqual([32, 26, 28, 29])
  })

  it('keeps Route 2 #3 and #25 as separate, sequential audio PINs', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')!
    const pin3 = route.pins.find((pin) => pin.sort_order === 3)!
    const pin25 = route.pins.find((pin) => pin.sort_order === 25)!
    expect([pin3.lat, pin3.lng]).toEqual([41.931738, 45.476857])
    expect([pin25.lat, pin25.lng]).toEqual([41.933312, 45.477867])
    expect([pin3.lat, pin3.lng]).not.toEqual([pin25.lat, pin25.lng])
    expect(resolvePinAudioUrl('route-2', pin3)).not.toBeNull()
    expect(resolvePinAudioUrl('route-2', pin25)).not.toBeNull()

    const pinIds = route.pins.map((pin) => pin.id)
    const firstTriggered = new Set(pinIds.slice(0, 2))
    const firstDecision = decidePinAudio({
      pinIds,
      triggered: firstTriggered,
      distanceTo: (index) => (index === 2 ? 10 : 500),
      headingOkAt: () => true,
      minDist: new Map(),
    })
    expect(firstDecision?.index).toBe(2)

    const lateTriggered = new Set(pinIds.slice(0, 24))
    const lateDecision = decidePinAudio({
      pinIds,
      triggered: lateTriggered,
      distanceTo: (index) => (index === 24 ? 10 : 500),
      headingOkAt: () => true,
      minDist: new Map(),
    })
    expect(lateDecision?.index).toBe(24)
  })

  it('maps Route 1 #23 exact requested text to an existing audio file', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
    const pin23 = route.pins.find((pin) => pin.sort_order === 23)!
    expect(pin23.instruction_ka).toBe('შემდეგ მინიშნებამდე იმოძრავეთ პირდაპირ')
    expect(decodeURIComponent(resolvePinAudioUrl('route-1', pin23)!))
      .toBe('/audio/points/გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ.wav')
  })
})
