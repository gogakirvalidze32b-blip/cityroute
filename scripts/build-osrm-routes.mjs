/**

 * Build Telavi exam route polylines via OSRM.

 * Waypoints match user's numbered screenshot maps (NOT PDF page order).

 * Agency: Alazani Ave 95 — 41.931047, 45.475468

 *

 * Run: npm run build-routes

 */

import { writeFileSync } from 'node:fs'

import { fileURLToPath } from 'node:url'

import { dirname, join } from 'node:path'



const __dirname = dirname(fileURLToPath(import.meta.url))

const OUT = join(__dirname, '../src/data/route-polylines.generated.json')



/** lng,lat waypoints per screenshot route */

const ROUTES = {

  /** №1 — Agency loop → Alazani W/E → Erekle → Tbilisi Hwy → Agency */
  'route-1':
    '45.4758,41.9311;45.4759,41.9321;45.4748,41.9286;45.4723,41.9279;45.4748,41.9286;45.473478,41.927409;45.479412,41.917053;45.47199,41.918894;45.479412,41.917053;45.482917,41.926773;45.502931,41.918771;45.499217,41.919246;45.4758,41.9311',

  /** №2¹ — Vardisubani → Saakadze → Tbilisi Hwy → Alazani → Erekle → Rustaveli → Vardisubani */

  'route-2':

    '45.475468,41.931047;45.4753,41.9298;45.4665,41.9245;45.4675,41.9262;45.5025,41.9188;45.4992,41.9193;45.4758,41.9322;45.4720,41.9189;45.4798,41.9172;45.4665,41.9245;45.475468,41.931047',

  /** №3 — Tbilisi Hwy E → W loop → Erekle II N/U-turn → back E */

  'route-3':

    '45.5025,41.9188;45.4992,41.9193;45.4620,41.9289;45.4682,41.9278;45.4992,41.9193;45.4778,41.9182;45.4720,41.9189;45.5025,41.9188',

  /** №2³ — Sekhniashvili → Kavkasioni → Saakadze → Erekle → Rustaveli → Tbilisi Hwy → Alazani → Sekhniashvili */

  'route-4':

    '45.4742,41.9308;45.4740,41.9295;45.4699,41.9268;45.4675,41.9262;45.4720,41.9189;45.4798,41.9172;45.5025,41.9188;45.4992,41.9193;45.4758,41.9322;45.4742,41.9308',

  /** №2² — Alazani NW → Kurdgelauri → Tbilisi St → Tbilisi Hwy/Erekle → Saakadze → Agency */

  'route-5':

    '45.475468,41.931047;45.4745,41.9325;45.4870,41.9206;45.4653,41.9225;45.4992,41.9193;45.4720,41.9189;45.4675,41.9262;45.475468,41.931047',

}



function simplify(coords, minDistM = 8) {

  if (coords.length <= 2) return coords

  const out = [coords[0]]

  for (let i = 1; i < coords.length; i++) {

    const [lat1, lng1] = out[out.length - 1]

    const [lat2, lng2] = coords[i]

    const d = haversine(lat1, lng1, lat2, lng2)

    if (d >= minDistM) out.push(coords[i])

  }

  const last = coords[coords.length - 1]

  const [la, ln] = out[out.length - 1]

  if (haversine(la, ln, last[0], last[1]) > 1) out.push(last)

  return out

}



function haversine(lat1, lng1, lat2, lng2) {

  const R = 6371000

  const toR = (d) => (d * Math.PI) / 180

  const dLat = toR(lat2 - lat1)

  const dLng = toR(lng2 - lng1)

  const a =

    Math.sin(dLat / 2) ** 2 +

    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2

  return 2 * R * Math.asin(Math.sqrt(a))

}



async function fetchRoute(coords) {

  const url = `http://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`

  const res = await fetch(url)

  const data = await res.json()

  if (data.code !== 'Ok') throw new Error(data.message || 'OSRM failed')

  const line = data.routes[0].geometry.coordinates.map(([lng, lat]) => [

    Math.round(lat * 1e6) / 1e6,

    Math.round(lng * 1e6) / 1e6,

  ])

  return simplify(line, 6)

}



const result = {}

for (const [slug, coords] of Object.entries(ROUTES)) {

  console.log('Fetching', slug, '...')

  result[slug] = await fetchRoute(coords)

  console.log(' ', slug, '→', result[slug].length, 'points')

}



writeFileSync(OUT, JSON.stringify(result, null, 2))

console.log('Wrote', OUT)

