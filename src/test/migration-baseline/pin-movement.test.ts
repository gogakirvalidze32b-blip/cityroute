/**
 * Moving a PIN by route kilometre moves its coordinate AND its trigger point;
 * instruction text and audio stay bound to the PIN. Runs in memory — the real
 * pin-chainage.json is never modified (the move tool is only dry-run here).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coordinateFromChainage, frozenPreparedGeometry, pinChainageTable } from '@/data/pin-chainage'
import { enrichPinsWithLocalAudio } from '@/data/route-audio'
import { decideChainageTrigger, INITIAL_CHAINAGE_TRIGGER_STATE, type ChainagePin } from '@/lib/pin-chainage-trigger'
import { positionAtChainageMeters } from '@/lib/pure-route-geometry'
import { currentProductionRoutes } from './capture-baseline'

const ROOT = resolve(__dirname, '../../..')
const TABLE_PATH = resolve(ROOT, 'src/data/pin-chainage.json')
const hashTable = () => createHash('sha256').update(readFileSync(TABLE_PATH)).digest('hex')

describe('moving a PIN by kilometre (route-2 PIN 9: 3.114 km → 3.200 km)', () => {
  const slug = 'route-2'
  const table = pinChainageTable(slug)!
  const geometry = frozenPreparedGeometry(slug)!
  const original = table.pins.find((entry) => entry.sort_order === 9)!
  const moved = { ...original, chainage_m: 3200, offset_lat_deg: 0, offset_lng_deg: 0, origin: 'edited' as const }

  it('derives the new coordinate from the route geometry at 3.200 km', () => {
    const coordinate = coordinateFromChainage(geometry, moved)!
    const onLine = positionAtChainageMeters(geometry, 3200)!
    expect(coordinate[0]).toBeCloseTo(onLine[0], 9)
    expect(coordinate[1]).toBeCloseTo(onLine[1], 9)
    expect(coordinate).not.toEqual(coordinateFromChainage(geometry, original))
  })

  it('moves the audio trigger point with it (fires at 3.190 km, no longer at 3.104 km)', () => {
    const route = currentProductionRoutes().find((item) => item.slug === slug)!
    const pins: ChainagePin[] = table.pins.map((entry) => {
      const source = entry.sort_order === 9 ? moved : entry
      const [lat, lng] = coordinateFromChainage(geometry, source)!
      return { sortOrder: entry.sort_order, chainageMeters: source.chainage_m, leadMeters: source.lead_m, lat, lng }
    })
    const done = new Set(table.pins.filter((entry) => entry.sort_order < 9).map((entry) => entry.sort_order))
    const at = (meters: number) => positionAtChainageMeters(geometry, meters)!
    const decide = (progress: number) =>
      decideChainageTrigger({
        pins,
        done,
        progressAccepted: true,
        progressMeters: progress,
        crossTrackMeters: 2,
        gpsPosition: at(progress),
        state: INITIAL_CHAINAGE_TRIGGER_STATE,
      })
    expect(decide(original.chainage_m - original.lead_m).play).toBeNull()
    expect(decide(3189).play).toBeNull()
    expect(decide(3190).play).toBe(9)
    // Instruction text / audio are bound to the PIN, not to its position.
    const pin9 = route.pins.find((pin) => pin.sort_order === 9)!
    const [audio] = enrichPinsWithLocalAudio(slug, [{ ...pin9, lat: pins[8]!.lat, lng: pins[8]!.lng }])
    expect(audio!.instruction_ka).toBe(pin9.instruction_ka)
    expect(audio!.audio_url).toBe(enrichPinsWithLocalAudio(slug, [pin9])[0]!.audio_url)
  })

  it('the move tool (dry run) computes the same coordinate as the app and writes nothing', () => {
    const before = hashTable()
    const output = execFileSync(
      process.execPath,
      ['scripts/move-pin-chainage.mts', '--route', slug, '--pin', '9', '--km', '3.2'],
      { cwd: ROOT, encoding: 'utf8' },
    )
    expect(hashTable()).toBe(before)
    const match = /new coordinate \(derived\): ([\d.]+), ([\d.]+)/.exec(output)!
    const app = coordinateFromChainage(geometry, moved)!
    expect(Number(match[1])).toBeCloseTo(app[0], 6)
    expect(Number(match[2])).toBeCloseTo(app[1], 6)
    expect(output).toMatch(/3\.114 km → 3\.200 km/)
    expect(output).toMatch(/speaks from: 3\.190 km/)
  })

  it('the move tool refuses a kilometre that would break PIN order', () => {
    const before = hashTable()
    expect(() =>
      execFileSync(process.execPath, ['scripts/move-pin-chainage.mts', '--route', slug, '--pin', '9', '--km', '4.5', '--write'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow(/Refused/)
    expect(hashTable()).toBe(before)
  })
})
