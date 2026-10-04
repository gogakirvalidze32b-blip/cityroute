/** Sync route-2-osrm.json from official path (exact coordinates, no OSRM). */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OFFICIAL = join(__dirname, '../src/data/route-2-official.json')
const OUT = join(__dirname, '../src/data/route-2-osrm.json')

const { full_path, total_points, total_distance_m } = JSON.parse(readFileSync(OFFICIAL, 'utf8'))
const line = full_path.map((p) => [p.lng, p.lat])
writeFileSync(OUT, JSON.stringify(line, null, 2) + '\n')
console.log('Synced', OUT, '→', total_points, 'official pts,', total_distance_m, 'm')
