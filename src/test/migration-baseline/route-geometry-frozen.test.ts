/**
 * Frozen route geometry must be byte-identical to the pre-migration runtime
 * geometry recorded in pin-route-baseline.json, and must not depend on PINs.
 *
 * Files were exported once from the baseline with:
 *   $env:WRITE_FROZEN_GEOMETRY='1'; npx vitest run src/test/migration-baseline/route-geometry-frozen.test.ts
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MigrationBaseline } from './capture-baseline'

const BASELINE = JSON.parse(
  readFileSync(resolve(__dirname, 'pin-route-baseline.json'), 'utf8'),
) as MigrationBaseline
const GEOMETRY_DIR = resolve(__dirname, '../../data/route-geometry')

function versionOf(line: unknown): string {
  return 'g1-' + createHash('sha256').update(JSON.stringify(line)).digest('hex').slice(0, 16)
}

if (process.env.WRITE_FROZEN_GEOMETRY === '1') {
  describe('export frozen geometry', () => {
    it('writes route-N.geometry.json from the pre-migration baseline', () => {
      mkdirSync(GEOMETRY_DIR, { recursive: true })
      for (const route of BASELINE.routes) {
        const path = resolve(GEOMETRY_DIR, `${route.slug}.geometry.json`)
        if (existsSync(path)) throw new Error(`${path} exists; frozen geometry is never regenerated`)
        const matchLine = route.examRouteLine.coordinates
        writeFileSync(
          path,
          JSON.stringify({
            routeId: route.slug,
            version: versionOf(matchLine),
            source: 'examRouteLine/examMapRouteLines built from bundled PINs before the chainage migration (2026-11-27)',
            matchLine,
            mapLines: route.examMapRouteLines.coordinates,
          }) + '\n',
          'utf8',
        )
      }
    })
  })
} else {
  describe('frozen route geometry', async () => {
    const { frozenRouteGeometry } = await import('@/data/route-geometry')
    const { examRouteLine, examMapRouteLines } = await import('@/lib/pin-route-line')

    it('route line does not change when a PIN is moved (geometry is PIN-independent)', () => {
      for (const route of BASELINE.routes) {
        const pins = route.pins.map((pin) => ({ lat: pin.lat, lng: pin.lng, sort_order: pin.sort_order }))
        const moved = pins.map((pin, index) =>
          index === Math.floor(pins.length / 2) ? { ...pin, lat: pin.lat + 0.003, lng: pin.lng - 0.002 } : pin,
        )
        expect(examRouteLine(route.slug, moved), route.slug).toEqual(route.examRouteLine.coordinates)
        expect(examMapRouteLines(route.slug, moved), route.slug).toEqual(route.examMapRouteLines.coordinates)
        expect(examRouteLine(route.slug, []), route.slug).toEqual(route.examRouteLine.coordinates)
      }
    })
    for (const route of BASELINE.routes) {
      it(`${route.slug}: identical to the pre-migration geometry (points, coordinates, length)`, () => {
        const frozen = frozenRouteGeometry(route.slug)!
        expect(frozen).not.toBeNull()
        expect(frozen.matchLine).toEqual(route.examRouteLine.coordinates)
        expect(frozen.mapLines).toEqual(route.examMapRouteLines.coordinates)
        expect(frozen.version).toBe(versionOf(route.examRouteLine.coordinates))
      })
    }
  })
}
