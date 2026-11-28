/**
 * Guard: the chainage migration must not change PIN positions, order,
 * instruction text, audio mapping, trigger radii, route geometry or speed bands.
 *
 * Baseline written once, before the migration, with:
 *   $env:WRITE_MIGRATION_BASELINE='1'; npx vitest run src/test/migration-baseline
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureBaseline, type MigrationBaseline } from './capture-baseline'

const BASELINE_PATH = resolve(__dirname, 'pin-route-baseline.json')

describe('chainage migration baseline (PINs, audio, geometry, speed bands)', () => {
  const current = captureBaseline()

  if (process.env.WRITE_MIGRATION_BASELINE === '1') {
    it('writes the pre-migration baseline', () => {
      if (existsSync(BASELINE_PATH)) {
        throw new Error('Baseline already exists; it must never be regenerated.')
      }
      writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 1) + '\n', 'utf8')
    })
    return
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as MigrationBaseline

  it('keeps session audio files identical', () => {
    expect(current.sessionAudio).toEqual(baseline.sessionAudio)
  })

  for (const expected of baseline.routes) {
    describe(expected.slug, () => {
      const actual = current.routes.find((route) => route.slug === expected.slug)!

      it('keeps the same PIN count, order, ids, positions, text, audio and radii', () => {
        expect(actual.pinCount).toBe(expected.pinCount)
        expect(actual.pins.map((pin) => pin.sort_order)).toEqual(expected.pins.map((pin) => pin.sort_order))
        for (const [index, pin] of expected.pins.entries()) {
          expect(actual.pins[index], `${expected.slug} #${pin.sort_order}`).toEqual(pin)
        }
      })

      it('keeps route geometry identical (match line, map lines, polyline, road trace)', () => {
        expect(actual.examRouteLine.hash).toBe(expected.examRouteLine.hash)
        expect(actual.examRouteLine.lengthMeters).toBeCloseTo(expected.examRouteLine.lengthMeters, 6)
        expect(actual.examMapRouteLines.hash).toBe(expected.examMapRouteLines.hash)
        expect(actual.polyline).toEqual(expected.polyline)
        expect(actual.examRoadTrace).toEqual(expected.examRoadTrace)
      })

      it('keeps speed-limit kilometre bands identical', () => {
        expect(actual.speedKmBands).toEqual(expected.speedKmBands)
      })
    })
  }
})
