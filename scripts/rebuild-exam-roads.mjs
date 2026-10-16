/**
 * Rebuild route-*-road.json from consecutive exam pins.
 *
 * Root cause of map detours: OSRM pin→pin legs sometimes U-turn into side-street
 * spurs (Alazani) or climb north off Rustaveli. Fix:
 * 1) Forced vias on known main-road corridors (red paths in screenshots).
 * 2) Look-ahead: if intermediate pins lie within ROAD_MATCH of osrm(a,c),
 *    draw a→c and skip spur visits (pins stay for GPS; line stays on the avenue).
 *
 * Run: node scripts/rebuild-exam-roads.mjs [1] [2] ...
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import o1 from '../src/data/route-1-official.json' with { type: 'json' }
import fixture from '../src/data/audio-audit-pins.fixture.json' with { type: 'json' }

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dirname, '../src/data')
const ROAD_MATCH_M = 40

function haversine(a, b) {
  const R = 6371000
  const toR = (d) => (d * Math.PI) / 180
  const dLat = toR(b[0] - a[0])
  const dLng = toR(b[1] - a[1])
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

function distSeg(p, s, e) {
  const lat = (s[0] * Math.PI) / 180
  const bx = (e[1] - s[1]) * Math.cos(lat) * 111320
  const by = (e[0] - s[0]) * 110540
  const px = (p[1] - s[1]) * Math.cos(lat) * 111320
  const py = (p[0] - s[0]) * 110540
  const l2 = bx * bx + by * by
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / l2))
  return Math.hypot(px - bx * t, py - by * t)
}

function maxOffsetFromLine(points, line) {
  let worst = 0
  for (const p of points) {
    let nearest = Infinity
    for (let i = 1; i < line.length; i++) {
      nearest = Math.min(nearest, distSeg(p, line[i - 1], line[i]))
    }
    worst = Math.max(worst, nearest)
  }
  return worst
}

function pathLength(line) {
  let n = 0
  for (let i = 1; i < line.length; i++) n += haversine(line[i - 1], line[i])
  return n
}

function simplify(coords, minDistM = 6) {
  if (coords.length <= 2) return coords
  const out = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    if (haversine(out[out.length - 1], coords[i]) >= minDistM) out.push(coords[i])
  }
  const last = coords[coords.length - 1]
  if (haversine(out[out.length - 1], last) > 1) out.push(last)
  return out
}

function roundPt(pt) {
  return [Math.round(pt[0] * 1e6) / 1e6, Math.round(pt[1] * 1e6) / 1e6]
}

async function osrmLeg(points) {
  const coord = points.map(([lat, lng]) => `${lng},${lat}`).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${coord}?overview=full&geometries=geojson`
  const res = await fetch(url)
  const data = await res.json()
  if (data.code !== 'Ok') throw new Error(data.message || data.code || 'OSRM failed')
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => roundPt([lat, lng]))
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function pinsForRoute(routeNumber) {
  if (routeNumber === 1) {
    return o1.manoeuvres.map((m) => /** @type {[number, number]} */ ([m.lat, m.lng]))
  }
  return fixture
    .filter((p) => p.route === routeNumber)
    .sort((a, b) => a.pin - b.pin)
    .map((p) => /** @type {[number, number]} */ ([p.lat, p.lng]))
}

/**
 * Forced vias only when direct OSRM misses the intended corridor.
 * - Roundabout east of #22/#23: direct 23→24 reverses before the circle;
 *   via the ring so the blue line enters, turns, and comes back west.
 * Do NOT revive the old 41.91735/45.479 vias (Amirejibi south U-turn).
 */
const VIA = {
  '1:23-24': [[41.91902, 45.48565]],
}

async function legWithOptionalVias(routeNumber, fromPin, toPin, a, b) {
  const key = `${routeNumber}:${fromPin}-${toPin}`
  const vias = VIA[key] ?? []
  return osrmLeg([a, ...vias, b])
}

async function buildRoad(routeNumber) {
  const pins = pinsForRoute(routeNumber)
  /** @type {[number, number][]} */
  const line = []
  let i = 0
  while (i < pins.length - 1) {
    const fromPin = i + 1
    const toPin = i + 2
    let leg = await legWithOptionalVias(routeNumber, fromPin, toPin, pins[i], pins[i + 1])
    await sleep(100)

    const straight = haversine(pins[i], pins[i + 1])
    let path = pathLength(leg)
    let used = VIA[`${routeNumber}:${fromPin}-${toPin}`] ? 'vias' : 'direct'
    let end = i + 1

    // Only skip the next pin when this leg is a clear U-turn/spur and the pin
    // already sits on the shorter corridor to the following pin (Alazani hook).
    if (
      path > straight * 1.8 &&
      i + 2 < pins.length &&
      !VIA[`${routeNumber}:${fromPin}-${toPin}`] &&
      !VIA[`${routeNumber}:${toPin}-${toPin + 1}`]
    ) {
      try {
        const corridor = await osrmLeg([pins[i], pins[i + 2]])
        await sleep(80)
        // Compare against this spur + the next spur (often a matching U-turn pair).
        let nextSpur = 0
        try {
          const nextLeg = await osrmLeg([pins[i + 1], pins[i + 2]])
          await sleep(80)
          nextSpur = pathLength(nextLeg)
        } catch {
          nextSpur = 0
        }
        const spurPair = path + nextSpur
        if (
          maxOffsetFromLine([pins[i + 1]], corridor) <= ROAD_MATCH_M &&
          pathLength(corridor) < Math.min(path * 0.95, spurPair * 0.7)
        ) {
          leg = corridor
          end = i + 2
          path = pathLength(leg)
          used = 'corridor-skip-spur'
          console.log(
            `R${routeNumber} skip spur #${toPin} on #${fromPin}→#${end + 1}`,
            `path ${Math.round(path)}m`,
          )
        }
      } catch {
        // keep direct leg
      }
    }

    const start = line.length ? 1 : 0
    for (let k = start; k < leg.length; k++) line.push(leg[k])
    console.log(
      `R${routeNumber} #${fromPin}→#${end + 1}`,
      used,
      `straight ${Math.round(haversine(pins[i], pins[end]))}m path ${Math.round(path)}m`,
    )
    i = end
  }
  return simplify(line, 6)
}

const targets = process.argv.slice(2).map(Number).filter(Boolean)
const routes = targets.length ? targets : [1, 2]

for (const r of routes) {
  console.log(`\n=== Building route-${r}-road.json ===`)
  const road = await buildRoad(r)
  const out = join(DATA, `route-${r}-road.json`)
  writeFileSync(out, JSON.stringify(road, null, 2) + '\n')
  console.log('Wrote', out, 'points', road.length)

  const pins = pinsForRoute(r)
  const off = maxOffsetFromLine(pins, road)
  console.log(`max pin offset from new road: ${Math.round(off)}m (limit ${ROAD_MATCH_M})`)
  if (off > ROAD_MATCH_M) {
    console.warn('WARNING: pins exceed ROAD_MATCH — examRouteLine may fall back to pin chords')
  }
}
