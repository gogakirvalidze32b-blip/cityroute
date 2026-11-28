/**
 * Move an exam PIN by ROUTE KILOMETRE.
 *
 *   node scripts/move-pin-chainage.mts --route route-2 --pin 9 --km 3.7
 *   node scripts/move-pin-chainage.mts --route route-2 --pin 9 --km 3.7 --write
 *
 * Only src/data/pin-chainage.json changes (chainage_m, origin: 'edited'). The
 * app derives the PIN's map marker / coordinate from the frozen route geometry
 * at that kilometre, and the kilometre trigger uses the same value, so the
 * marker, the audio trigger point and the instruction audio (bound to the
 * instruction text) all move together. Nothing else is edited.
 *
 * By default the moved PIN is placed ON the route line (offset reset to 0).
 * Pass --keep-offset to keep its previous sideways offset from the line.
 * Without --write it is a dry run that only prints what would change.
 * The move is refused if it would break the PIN order along the route.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type LatLng = [number, number]
type Entry = {
  sort_order: number
  chainage_m: number
  lead_m: number
  offset_lat_deg: number
  offset_lng_deg: number
  origin: 'baseline' | 'edited'
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tablePath = resolve(root, 'src/data/pin-chainage.json')

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const slug = arg('route')
const order = Number(arg('pin'))
const km = Number(arg('km'))
const write = process.argv.includes('--write')
const keepOffset = process.argv.includes('--keep-offset')
if (!slug || !Number.isInteger(order) || !Number.isFinite(km) || km < 0) {
  console.error('Usage: node scripts/move-pin-chainage.mts --route route-N --pin <sort_order> --km <km> [--keep-offset] [--write]')
  process.exit(2)
}

const geometry = JSON.parse(readFileSync(resolve(root, `src/data/route-geometry/${slug}.geometry.json`), 'utf8')) as {
  version: string
  matchLine: LatLng[]
}
const table = JSON.parse(readFileSync(tablePath, 'utf8')) as Record<string, { geometryVersion: string; pins: Entry[] }>
const routeTable = table[slug]
if (!routeTable) throw new Error(`No chainage table for ${slug}`)
if (routeTable.geometryVersion !== geometry.version) {
  throw new Error(`Geometry version mismatch: table ${routeTable.geometryVersion} vs geometry ${geometry.version}`)
}

// Same haversine / linear interpolation as prepareRouteGeometry + positionAtChainageMeters.
const toRad = Math.PI / 180
function meters(a: LatLng, b: LatLng): number {
  const dLat = (b[0] - a[0]) * toRad
  const dLng = (b[1] - a[1]) * toRad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_008.8 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)))
}
const cumulative = [0]
for (let i = 1; i < geometry.matchLine.length; i += 1) {
  cumulative.push(cumulative[i - 1]! + meters(geometry.matchLine[i - 1]!, geometry.matchLine[i]!))
}
const total = cumulative.at(-1)!
function pointAt(chainage: number): LatLng {
  let i = 0
  while (i < cumulative.length - 2 && cumulative[i + 1]! < chainage) i += 1
  const span = cumulative[i + 1]! - cumulative[i]!
  const f = span > 0 ? (chainage - cumulative[i]!) / span : 0
  const a = geometry.matchLine[i]!
  const b = geometry.matchLine[i + 1]!
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

const index = routeTable.pins.findIndex((entry) => entry.sort_order === order)
if (index < 0) throw new Error(`${slug} has no PIN with sort_order ${order}`)
const entry = routeTable.pins[index]!
const newChainage = Math.round(km * 1000 * 1000) / 1000
if (newChainage > total) throw new Error(`${km} km is beyond the route end (${(total / 1000).toFixed(3)} km)`)
const previous = routeTable.pins[index - 1]
const next = routeTable.pins[index + 1]
if ((previous && newChainage <= previous.chainage_m) || (next && newChainage >= next.chainage_m)) {
  throw new Error(
    `Refused: PIN #${order} must stay between #${previous?.sort_order ?? 'start'} (${previous ? (previous.chainage_m / 1000).toFixed(3) : '0.000'} km) ` +
      `and #${next?.sort_order ?? 'end'} (${next ? (next.chainage_m / 1000).toFixed(3) : (total / 1000).toFixed(3)} km) to keep PIN order.`,
  )
}

const updated: Entry = {
  ...entry,
  chainage_m: newChainage,
  offset_lat_deg: keepOffset ? entry.offset_lat_deg : 0,
  offset_lng_deg: keepOffset ? entry.offset_lng_deg : 0,
  origin: 'edited',
}
const base = pointAt(newChainage)
const coordinate: LatLng = [base[0] + updated.offset_lat_deg, base[1] + updated.offset_lng_deg]
console.log(`${slug} PIN #${order}: ${(entry.chainage_m / 1000).toFixed(3)} km → ${(newChainage / 1000).toFixed(3)} km`)
console.log(`  new coordinate (derived): ${coordinate[0].toFixed(7)}, ${coordinate[1].toFixed(7)}`)
console.log(`  speaks from: ${((newChainage - updated.lead_m) / 1000).toFixed(3)} km (lead ${updated.lead_m} m)`)
if (!write) {
  console.log('Dry run — pass --write to save src/data/pin-chainage.json')
} else {
  routeTable.pins[index] = updated
  writeFileSync(tablePath, JSON.stringify(table, null, 1) + '\n', 'utf8')
  console.log('Saved src/data/pin-chainage.json')
}
