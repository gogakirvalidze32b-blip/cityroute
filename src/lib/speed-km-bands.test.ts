import { describe, expect, it } from 'vitest'
import { SPEED_KM_BANDS } from '@/data/speed-km-bands'
import { resolveSpeedLimitByKm, resolveSpeedLimitByOdometerMeters } from '@/lib/speed-limit'

/** Final speed-zone tables, transcribed independently of the data file. 'END' = open-ended. */
type Row = [number, number | 'END', number]
const FINAL: Record<string, Row[]> = {
  'route-1': [
    [0.0, 0.1, 20], [0.1, 1.85, 50], [1.85, 2.2, 40], [2.2, 3.05, 50],
    [3.05, 6.8, 40], [6.8, 8.35, 50], [8.35, 'END', 20],
  ],
  'route-2': [
    [0.7, 3.1, 40], [3.1, 4.35, 60], [4.35, 5.0, 50], [5.0, 5.1, 30], [5.1, 5.5, 50],
    [5.5, 5.6, 30], [5.6, 7.6, 40], [7.6, 9.05, 50], [9.05, 'END', 20],
  ],
  'route-3': [
    [2.1, 2.2, 30], [2.2, 2.85, 40], [2.85, 5.6, 50], [5.6, 5.7, 30], [5.7, 6.1, 50],
    [6.1, 6.25, 30], [6.25, 6.8, 50], [6.8, 7.1, 40], [7.1, 8.95, 50],
    [8.95, 9.1, 20], [9.1, 'END', 20],
  ],
  'route-4': [
    [0.1, 2.1, 50], [2.1, 2.2, 30], [2.2, 2.7, 50], [2.7, 2.9, 30], [2.9, 4.2, 50],
    [4.2, 4.35, 30], [4.35, 4.7, 50], [4.7, 4.85, 30], [4.85, 5.1, 40], [5.1, 5.3, 30],
    [5.3, 5.7, 40], [5.7, 5.8, 30], [5.8, 6.55, 40], [6.55, 8.05, 50], [8.05, 'END', 20],
  ],
}
/** Intervals before the first specified row that the update did not cover (existing values kept). */
const UNSPECIFIED_PREFIX: Record<string, { km: number; limit: number }[]> = {
  'route-1': [],
  'route-2': [{ km: 0.0, limit: 20 }, { km: 0.059, limit: 20 }, { km: 0.06, limit: 50 }, { km: 0.69, limit: 50 }],
  'route-3': [{ km: 0.0, limit: 50 }, { km: 1.0, limit: 50 }, { km: 2.09, limit: 50 }],
  'route-4': [{ km: 0.0, limit: 20 }, { km: 0.059, limit: 20 }, { km: 0.06, limit: 50 }, { km: 0.099, limit: 50 }],
}
const EPS = 1e-6

describe('speed-zone update: R1–R4 final data', () => {
  for (const [slug, rows] of Object.entries(FINAL)) {
    describe(slug, () => {
      const bands = SPEED_KM_BANDS[slug]!

      it('contains every specified zone exactly (start, end, speed)', () => {
        rows.forEach(([from, to, limit], idx) => {
          const band = bands.find((b) => b.fromKm === from)
          expect(band, `${slug} band starting ${from}`).toBeDefined()
          expect(band!.limitKmh).toBe(limit)
          if (to === 'END') {
            expect(band).toBe(bands[bands.length - 1])
          } else {
            expect(band!.toKm).toBe(to)
          }
          // the next specified row starts exactly where this one ends
          const next = rows[idx + 1]
          if (next && to !== 'END') expect(next[0]).toBe(to)
        })
      })

      it('has no gaps and no overlaps between consecutive bands', () => {
        expect(bands[0]!.fromKm).toBe(0)
        for (let i = 1; i < bands.length; i += 1) {
          expect(bands[i]!.fromKm).toBe(bands[i - 1]!.toKm)
          expect(bands[i]!.toKm).toBeGreaterThan(bands[i]!.fromKm)
        }
      })

      it('switches exactly at each boundary (just before / at / just after)', () => {
        for (const [from, , limit] of rows) {
          expect(resolveSpeedLimitByKm(slug, from)).toBe(limit)
          expect(resolveSpeedLimitByKm(slug, from + EPS)).toBe(limit)
          expect(resolveSpeedLimitByOdometerMeters(slug, Math.round(from * 1000))).toBe(limit)
        }
        rows.forEach(([, to, limit], idx) => {
          if (to === 'END') return
          expect(resolveSpeedLimitByKm(slug, to - EPS)).toBe(limit)
          const next = rows[idx + 1]
          if (next) expect(resolveSpeedLimitByKm(slug, to)).toBe(next[2])
          // odometer 1 m before the boundary is still this zone
          expect(resolveSpeedLimitByOdometerMeters(slug, Math.round(to * 1000) - 1)).toBe(limit)
        })
      })

      it('keeps the pre-existing limits where the update specified nothing', () => {
        for (const p of UNSPECIFIED_PREFIX[slug]!) expect(resolveSpeedLimitByKm(slug, p.km)).toBe(p.limit)
      })

      it('applies the final speed until the route ends', () => {
        const last = rows[rows.length - 1]!
        for (const km of [last[0] + 0.01, 9.5, 12, 50]) {
          if (km < last[0]) continue
          expect(resolveSpeedLimitByKm(slug, km)).toBe(last[2])
        }
      })
    })
  }

  it('every END zone is open-ended (no invented route length)', () => {
    for (const slug of ['route-1', 'route-2', 'route-4']) {
      const last = SPEED_KM_BANDS[slug]!.at(-1)!
      expect(last.toKm).toBe(99)
      expect(last.limitKmh).toBe(20)
    }
  })

  it('the correct route table is used when switching routes at the same km', () => {
    expect(resolveSpeedLimitByKm('route-1', 3.2)).toBe(40)
    expect(resolveSpeedLimitByKm('route-2', 3.2)).toBe(60)
    expect(resolveSpeedLimitByKm('route-3', 3.2)).toBe(50)
    expect(resolveSpeedLimitByKm('route-4', 3.2)).toBe(50)
    expect(resolveSpeedLimitByKm('route-1', 8.4)).toBe(20)
    expect(resolveSpeedLimitByKm('route-2', 8.4)).toBe(50)
    expect(resolveSpeedLimitByKm('route-3', 8.4)).toBe(50)
    expect(resolveSpeedLimitByKm('route-4', 8.4)).toBe(20)
    expect(resolveSpeedLimitByKm('route-9', 3.2)).toBeNull()
  })
})
