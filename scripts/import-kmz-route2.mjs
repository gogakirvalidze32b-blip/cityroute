import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KML = join(__dirname, '../.tmp-kmz-r2/doc.kml')
const OUT = join(__dirname, '../src/data/route-2-official.json')

const xml = readFileSync(KML, 'utf8')
const block = xml.match(/<coordinates>([\s\S]*?)<\/coordinates>/)
if (!block) throw new Error('No coordinates in KML')

const coords = block[1]
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .map((line) => {
    const [lng, lat] = line.split(',').map(Number)
    return { lat, lng }
  })

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const t = (d) => (d * Math.PI) / 180
  const a =
    Math.sin(t(lat2 - lat1) / 2) ** 2 +
    Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(t(lng2 - lng1) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

let dist = 0
const full_path = coords.map((p, i) => {
  if (i > 0) dist += haversine(coords[i - 1].lat, coords[i - 1].lng, p.lat, p.lng)
  return {
    lat: Math.round(p.lat * 1e6) / 1e6,
    lng: Math.round(p.lng * 1e6) / 1e6,
    distance_from_start_m: Math.round(dist * 10) / 10,
  }
})

const data = {
  route_name: 'თელავი, საგამოცდო მარშრუტი №2¹',
  source: 'Untitled layer(3).kmz',
  total_distance_m: Math.round(dist * 10) / 10,
  total_points: full_path.length,
  full_path,
  manoeuvres: [],
}

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n')
console.log('Wrote', OUT)
console.log('points:', full_path.length, 'distance_m:', data.total_distance_m)
