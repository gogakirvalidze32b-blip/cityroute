/**
 * PIN chainage table audit.
 *
 * The table was generated once from the LEGACY trigger reference chainage
 * (legacy-pin-chainage.ts) on the frozen geometry, with:
 *   $env:WRITE_PIN_CHAINAGE='1'; npx vitest run src/test/migration-baseline/pin-chainage-table.test.ts
 * Discrepancies are reported, never "fixed" by moving PINs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MigrationBaseline } from './capture-baseline'
import { frozenGeometry, legacyPinChainages } from './legacy-pin-chainage'
import { routeGeometryVersion } from '@/data/route-geometry'
import { pinAudioTriggerDistanceMeters } from '@/lib/pin-audio'
import type { PinRow } from '@/types/database'

const BASELINE = JSON.parse(
  readFileSync(resolve(__dirname, 'pin-route-baseline.json'), 'utf8'),
) as MigrationBaseline
const TABLE_PATH = resolve(__dirname, '../../data/pin-chainage.json')

if (process.env.WRITE_PIN_CHAINAGE === '1') {
  describe('write pin-chainage.json', () => {
    it('writes the table from the legacy trigger chainage', async () => {
      if (existsSync(TABLE_PATH)) throw new Error('pin-chainage.json exists; never regenerate it')
      const { offsetFromChainage } = await import('@/lib/pin-chainage-geometry')
      const out: Record<string, unknown> = {}
      for (const route of BASELINE.routes) {
        const pins = route.pins as unknown as PinRow[]
        const legacy = legacyPinChainages(route.slug, pins)
        const geometry = frozenGeometry(route.slug)
        out[route.slug] = {
          geometryVersion: routeGeometryVersion(route.slug),
          pins: legacy.map((row) => {
            if (row.triggerChainage == null) throw new Error(`${route.slug} #${row.sortOrder}: no chainage`)
            const pin = pins.find((item) => item.sort_order === row.sortOrder)!
            const chainage = Math.round(row.triggerChainage * 1000) / 1000
            const offset = offsetFromChainage(geometry, chainage, [pin.lat, pin.lng])!
            return {
              sort_order: row.sortOrder,
              chainage_m: chainage,
              lead_m: pinAudioTriggerDistanceMeters(route.slug, row.sortOrder),
              offset_lat_deg: offset.offset_lat_deg,
              offset_lng_deg: offset.offset_lng_deg,
              origin: 'baseline',
            }
          }),
        }
      }
      writeFileSync(TABLE_PATH, JSON.stringify(out, null, 1) + '\n', 'utf8')
    })
  })
} else {
  describe('PIN chainage table', async () => {
    const { pinChainageTable, chainagePinsForRoute, coordinateFromChainage, frozenPreparedGeometry } =
      await import('@/data/pin-chainage')

    for (const route of BASELINE.routes) {
      describe(route.slug, () => {
        const table = pinChainageTable(route.slug)!
        const pins = route.pins as unknown as PinRow[]

        it('covers every baseline PIN exactly once, same order, no extras', () => {
          expect(table.pins.map((pin) => pin.sort_order)).toEqual(pins.map((pin) => pin.sort_order))
        })

        it('is computed against the current frozen geometry version', () => {
          expect(table.geometryVersion).toBe(routeGeometryVersion(route.slug))
        })

        it('has strictly increasing chainage and validates for the trigger', () => {
          const result = chainagePinsForRoute(route.slug, pins)
          expect('reason' in result ? result.reason : 'ok').toBe('ok')
        })

        it('matches the legacy trigger reference chainage and existing lead radii', () => {
          const legacy = legacyPinChainages(route.slug, pins)
          for (const entry of table.pins.filter((item) => item.origin === 'baseline')) {
            const row = legacy.find((item) => item.sortOrder === entry.sort_order)!
            expect(entry.chainage_m, `#${entry.sort_order}`).toBeCloseTo(row.triggerChainage!, 2)
            expect(entry.lead_m).toBe(pinAudioTriggerDistanceMeters(route.slug, entry.sort_order))
          }
        })

        it('reproduces every unchanged PIN coordinate EXACTLY from its kilometre', () => {
          const geometry = frozenPreparedGeometry(route.slug)!
          for (const entry of table.pins.filter((item) => item.origin === 'baseline')) {
            const pin = pins.find((item) => item.sort_order === entry.sort_order)!
            expect(coordinateFromChainage(geometry, entry), `#${entry.sort_order}`).toEqual([pin.lat, pin.lng])
          }
        })
      })
    }
  })
}
