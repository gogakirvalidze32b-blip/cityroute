import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCAL_TBILISI_TEST_ROUTE } from './local-tbilisi-test-pin'
import { resolvePinAudioUrl } from './route-audio'
import { applyLocalTbilisiTestPin } from './local-tbilisi-test-pin'
import { TELAVI_ROUTES_FALLBACK } from './telavi-routes'
import type { RouteWithPins } from '@/types/database'

const AUDIO_DIR = join(process.cwd(), 'public', 'audio')
const decodePath = (url: string) => decodeURIComponent(url)

describe('Tbilisi route audio source audit', () => {
  const routes: RouteWithPins[] = applyLocalTbilisiTestPin(TELAVI_ROUTES_FALLBACK)
    .filter((route) => route.city_id === 'test-tbilisi')

  it('contains the one bundled Tbilisi test route and its five source PINs', () => {
    expect(routes).toEqual([LOCAL_TBILISI_TEST_ROUTE])
    expect(routes.flatMap((route) => route.pins)).toHaveLength(5)
    expect([...LOCAL_TBILISI_TEST_ROUTE.pins]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((pin) => pin.sort_order)).toEqual([1, 2, 3, 4, 5])
  })

  it('resolves every mapped PIN to an existing WAV and records the source unmapped PIN', () => {
    const sortedPins = [...LOCAL_TBILISI_TEST_ROUTE.pins]
      .sort((left, right) => left.sort_order - right.sort_order)
    const missingAudioOrders: number[] = []

    for (const pin of sortedPins) {
      const url = resolvePinAudioUrl(LOCAL_TBILISI_TEST_ROUTE.slug, pin)
      if (url === null) {
        missingAudioOrders.push(pin.sort_order)
        continue
      }

      expect(decodePath(url)).toMatch(/^\/audio\/.+\.wav$/)
      expect(existsSync(join(AUDIO_DIR, decodePath(url).replace(/^\/audio\//, '')))).toBe(true)
    }

    expect(missingAudioOrders).toEqual([3])
  })

  it('preserves the actual repeated-instruction mapping without inventing a separate recording', () => {
    const first = LOCAL_TBILISI_TEST_ROUTE.pins.find((pin) => pin.sort_order === 1)!
    const fourth = LOCAL_TBILISI_TEST_ROUTE.pins.find((pin) => pin.sort_order === 4)!

    expect(first.instruction_ka).toBe(fourth.instruction_ka)
    expect(resolvePinAudioUrl(LOCAL_TBILISI_TEST_ROUTE.slug, first)).toBe(
      resolvePinAudioUrl(LOCAL_TBILISI_TEST_ROUTE.slug, fourth),
    )
  })
})
