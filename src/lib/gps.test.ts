import { afterEach, describe, expect, it, vi } from 'vitest'
import { GPS_HARD_TIMEOUT_MS, requestGpsOnce } from '@/lib/gps'

describe('requestGpsOnce', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejects when the browser never calls back (hard timeout)', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn(),
      },
    })
    vi.useFakeTimers()

    const pending = requestGpsOnce()
    const assertion = expect(pending).rejects.toThrow(/GPS-ის მიღება შეფერხდა/)
    await vi.advanceTimersByTimeAsync(GPS_HARD_TIMEOUT_MS)
    await assertion
  })

  it('resolves a successful fix before the hard timeout', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn((ok: PositionCallback) => {
          ok({
            coords: {
              latitude: 41.93,
              longitude: 45.47,
              accuracy: 8,
              heading: null,
              speed: null,
              altitude: null,
              altitudeAccuracy: null,
            },
            timestamp: 1,
          } as GeolocationPosition)
        }),
      },
    })

    await expect(requestGpsOnce()).resolves.toMatchObject({ lat: 41.93, lng: 45.47, accuracy: 8 })
  })
})
