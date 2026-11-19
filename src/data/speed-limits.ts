import type { LatLng } from '@/lib/gps'

/**
 * Posted speed limits for the exam routes (R1–R4).
 *
 * A zone is a stretch of a route's own road line (`route-N-road.json`, the line the exam map draws),
 * given as positions `u = vertexIndex + fraction towards the next vertex`. A vehicle is "in" the zone
 * when its real position is within `maxOffsetM` of that stretch of line — it is never decided by how
 * close the vehicle is to a PIN, and zones are never joined by straight lines between two points.
 *
 * Only stretches that could be located on the road line unambiguously are listed here. Everything in
 * {@link SPEED_LIMIT_UNRESOLVED} is deliberately NOT given a limit: the sign shows "—" there.
 *
 * If a road line file is regenerated, the `u` values must be regenerated too — `speed-limit.test.ts`
 * fails when a zone no longer sits on the coordinates it was built from.
 */
export type SpeedZone = {
  id: string
  limitKmh: number
  /** Start of the stretch on the route's road line (index + fraction). */
  from: number
  /** End of the stretch on the route's road line (index + fraction). */
  to: number
  /**
   * Largest distance (m) from the stretch at which a vehicle still counts as inside it.
   * 30 km/h zones apply in both directions, so they also cover the opposite carriageway of a dual road.
   */
  maxOffsetM: number
  /**
   * The two boundary coordinates supplied for this section (internal speed-zone refs —
   * not voice/map pins; do not render as map markers).
   */
  anchors: readonly [LatLng, LatLng]
  /** PINs whose position falls on this stretch, in route order. */
  pins: readonly number[]
  source: string
}

const NEAR = 15
const BOTH_DIRECTIONS = 30

export const SPEED_ZONES: Readonly<Record<string, readonly SpeedZone[]>> = {
  /**
   * Route 1: unchanged early map → 40 from 3.1 კმ to 6.8 კმ → 50 from 6.8 კმ to finish.
   */
  'route-1': [
    {
      id: 'r1-1', limitKmh: 50, from: 0, to: 51.99, maxOffsetM: NEAR,
      anchors: [[41.931548, 45.474995], [41.926976, 45.46125]], pins: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      source: 'R1 map Vaziani/top + east approach 50',
    },
    {
      id: 'r1-2', limitKmh: 40, from: 52, to: 61.5, maxOffsetM: NEAR,
      anchors: [[41.926979, 45.461239], [41.923761, 45.460417]], pins: [10, 11],
      source: 'R1 map west vertical 40',
    },
    {
      id: 'r1-3', limitKmh: 50, from: 61.51, to: 91.354, maxOffsetM: NEAR,
      anchors: [[41.923683, 45.460586], [41.921889, 45.469912]], pins: [12, 13],
      source: 'R1 Chavchavadze 50 until 3.1 კმ',
    },
    {
      id: 'r1-4', limitKmh: 40, from: 91.355, to: 235.704, maxOffsetM: NEAR,
      anchors: [[41.921889, 45.469912], [41.924576, 45.472121]], pins: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28],
      source: 'R1 40 from 3.1 კმ to 6.8 კმ',
    },
    {
      id: 'r1-5', limitKmh: 50, from: 235.71, to: 270, maxOffsetM: NEAR,
      anchors: [[41.92458, 45.472124], [41.93154, 45.475194]], pins: [29, 30, 31, 32, 33, 34, 35],
      source: 'R1 50 from 6.8 კმ to finish',
    },
  ],
  /**
   * Route 2: unchanged until 5.6 კმ → 40 → 50 → 30 → 50 to finish.
   */
  'route-2': [
    {
      id: 'r2-1', limitKmh: 50, from: 0, to: 23.84, maxOffsetM: NEAR,
      anchors: [[41.931477, 45.475406], [41.934655, 45.479115]], pins: [2, 3, 4],
      source: 'R2 #1 start',
    },
    {
      id: 'r2-2', limitKmh: 40, from: 23.85, to: 72.279, maxOffsetM: NEAR,
      anchors: [[41.934653, 45.479121], [41.929877, 45.506688]], pins: [5, 6, 7, 8],
      source: 'R2 40 from 0.7 კმ to 3.1 კმ turn',
    },
    {
      id: 'r2-3', limitKmh: 60, from: 72.28, to: 111.33, maxOffsetM: NEAR,
      anchors: [[41.929877, 45.506688], [41.919524, 45.499824]], pins: [9, 10, 11, 12],
      source: 'R2 60 immediately after 3.1 კმ',
    },
    {
      id: 'r2-4', limitKmh: 50, from: 111.334, to: 125.5, maxOffsetM: NEAR,
      anchors: [[41.919524, 45.499822], [41.918722, 45.49308]], pins: [13],
      source: 'R2 50 until 5.0 კმ',
    },
    {
      id: 'r2-5', limitKmh: 30, from: 125.51, to: 128.52, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.918722, 45.493076], [41.918678, 45.491885]], pins: [14],
      source: 'R2 30 from 5.0 კმ until before 5.1',
    },
    {
      id: 'r2-6', limitKmh: 50, from: 128.55, to: 145.317, maxOffsetM: NEAR,
      anchors: [[41.918678, 45.491868], [41.919019, 45.485427]], pins: [15, 16],
      source: 'R2 50 from 5.1 კმ to 5.6 კმ',
    },
    {
      id: 'r2-7', limitKmh: 40, from: 145.318, to: 188.391, maxOffsetM: NEAR,
      anchors: [[41.919019, 45.485427], [41.918336, 45.473033]], pins: [17, 18, 19, 20],
      source: 'R2 40 from 5.6 კმ to 6.7 კმ',
    },
    {
      id: 'r2-8', limitKmh: 50, from: 188.392, to: 204.494, maxOffsetM: NEAR,
      anchors: [[41.918336, 45.473033], [41.920851, 45.470181]], pins: [21, 22],
      source: 'R2 50 from 6.7 კმ to 7.1 კმ',
    },
    {
      id: 'r2-9', limitKmh: 30, from: 204.495, to: 205.638, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.920851, 45.470181], [41.921746, 45.470291]], pins: [],
      source: 'R2 30 from 7.1 კმ to 7.2 კმ',
    },
    {
      id: 'r2-10', limitKmh: 50, from: 205.639, to: 252, maxOffsetM: NEAR,
      anchors: [[41.921746, 45.470291], [41.93154, 45.475194]], pins: [23, 24, 26, 27, 28, 29],
      source: 'R2 50 from 7.2 კმ to finish',
    },
  ],
  /**
   * Route 3: insert only the written km bands; leave unmarked stretches as before.
   * Road line ends ~9.3 კმ — bands after 9.3 have no remaining length.
   */
  'route-3': [
    {
      id: 'r3-1a', limitKmh: 50, from: 0, to: 68.251, maxOffsetM: NEAR,
      anchors: [[41.931477, 45.475406], [41.927772, 45.457873]], pins: [1, 2, 3, 4, 5, 16],
      source: 'R3 50 until 2.1 კმ',
    },
    {
      id: 'r3-1b', limitKmh: 30, from: 68.252, to: 72.057, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.927772, 45.457873], [41.927335, 45.45682]], pins: [17],
      source: 'R3 30 from 2.1 კმ to 2.2 კმ',
    },
    {
      id: 'r3-1c', limitKmh: 50, from: 72.058, to: 100.56, maxOffsetM: NEAR,
      anchors: [[41.927335, 45.456819], [41.925167, 45.456699]], pins: [18, 19],
      source: 'R3 50 after 2.2 კმ (unchanged middle)',
    },
    {
      id: 'r3-2', limitKmh: 30, from: 100.57, to: 112.29, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.925127, 45.456699], [41.923391, 45.461265]], pins: [20],
      source: 'R3 map west connector arrow 30',
    },
    {
      id: 'r3-3', limitKmh: 50, from: 112.3, to: 127.29, maxOffsetM: NEAR,
      anchors: [[41.923245, 45.461672], [41.923536, 45.466293]], pins: [21],
      source: 'R3 map Chavchavadze west 50',
    },
    {
      id: 'r3-4', limitKmh: 40, from: 127.3, to: 133, maxOffsetM: NEAR,
      anchors: [[41.92354, 45.466294], [41.9255, 45.467381]], pins: [22],
      source: 'R3 map short north jog 40',
    },
    {
      id: 'r3-5', limitKmh: 50, from: 133.01, to: 194.839, maxOffsetM: NEAR,
      anchors: [[41.9255, 45.467381], [41.919712, 45.484929]], pins: [6, 7, 8, 9],
      source: 'R3 50 until 5.5 კმ (unchanged middle)',
    },
    {
      id: 'r3-5b', limitKmh: 30, from: 194.84, to: 202.015, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.919711, 45.484929], [41.918963, 45.485278]], pins: [10],
      source: 'R3 30 from 5.5 კმ to 5.6 კმ',
    },
    {
      id: 'r3-6', limitKmh: 40, from: 202.016, to: 259.148, maxOffsetM: NEAR,
      anchors: [[41.918963, 45.485278], [41.918723, 45.484424]], pins: [11, 13],
      source: 'R3 40 from 5.6 კმ to 6.2 კმ',
    },
    {
      id: 'r3-6b', limitKmh: 30, from: 259.149, to: 265.77, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.918724, 45.484425], [41.918961, 45.485584]], pins: [10],
      source: 'R3 30 from 6.2 კმ to 6.3 კმ',
    },
    {
      id: 'r3-7a', limitKmh: 50, from: 265.771, to: 294.296, maxOffsetM: NEAR,
      anchors: [[41.918961, 45.485584], [41.922236, 45.481749]], pins: [14],
      source: 'R3 50 from 6.3 კმ to 6.8 კმ',
    },
    {
      id: 'r3-7b', limitKmh: 40, from: 294.297, to: 305.643, maxOffsetM: NEAR,
      anchors: [[41.922237, 45.481749], [41.923351, 45.478458]], pins: [7],
      source: 'R3 40 from 6.8 კმ to 7.1 კმ',
    },
    {
      id: 'r3-7c', limitKmh: 50, from: 305.644, to: 355, maxOffsetM: NEAR,
      anchors: [[41.923352, 45.478457], [41.93154, 45.475194]], pins: [15, 25, 26, 27, 28, 29, 31],
      source: 'R3 50 from 7.1 კმ to finish (Agmashenebeli / remainder)',
    },
  ],
  /**
   * Route 4: unchanged before 2.2 კმ; then only the written bands.
   * 5.2–5.3 unmarked → stays 40 (previous return stretch).
   */
  'route-4': [
    {
      id: 'r4-1', limitKmh: 50, from: 0, to: 65.582, maxOffsetM: NEAR,
      anchors: [[41.931477, 45.475406], [41.919083, 45.485387]], pins: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      source: 'R4 50 until 2.2 კმ',
    },
    {
      id: 'r4-2a', limitKmh: 30, from: 65.583, to: 71.075, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.919083, 45.485387], [41.918923, 45.486049]], pins: [19],
      source: 'R4 30 from 2.2 კმ to 2.3 კმ',
    },
    {
      id: 'r4-2b', limitKmh: 50, from: 71.076, to: 82.212, maxOffsetM: NEAR,
      anchors: [[41.918923, 45.48605], [41.918681, 45.490845]], pins: [18],
      source: 'R4 50 from 2.3 კმ to 2.7 კმ',
    },
    {
      id: 'r4-4b', limitKmh: 30, from: 82.213, to: 85.914, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.918722, 45.493076], [41.918678, 45.491885]], pins: [16],
      source: 'R4 30 from 2.7 კმ to 2.9 კმ (Section B street)',
    },
    {
      id: 'r4-3', limitKmh: 50, from: 85.915, to: 144.184, maxOffsetM: NEAR,
      anchors: [[41.918729, 45.493262], [41.918764, 45.486963]], pins: [11, 12, 13, 14, 15, 17],
      source: 'R4 50 from 2.9 კმ to 4.8 კმ',
    },
    {
      id: 'r4-4a', limitKmh: 30, from: 144.185, to: 146.633, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.918764, 45.486963], [41.919015, 45.485808]], pins: [10],
      source: 'R4 30 from 4.8 კმ to 4.9 კმ',
    },
    {
      id: 'r4-5', limitKmh: 50, from: 146.634, to: 159.249, maxOffsetM: NEAR,
      anchors: [[41.919015, 45.485808], [41.918244, 45.482416]], pins: [19, 20],
      source: 'R4 50 from 4.9 კმ to 5.2 კმ',
    },
    {
      id: 'r4-6a', limitKmh: 40, from: 159.25, to: 178.371, maxOffsetM: NEAR,
      anchors: [[41.918244, 45.482416], [41.920979, 45.476417]], pins: [21],
      source: 'R4 40 from 5.2/5.3 კმ to 5.8 კმ',
    },
    {
      id: 'r4-6b', limitKmh: 30, from: 178.372, to: 181.547, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.920979, 45.476416], [41.921153, 45.475232]], pins: [22],
      source: 'R4 30 from 5.8 კმ to 5.9 კმ',
    },
    {
      id: 'r4-6c', limitKmh: 40, from: 181.548, to: 203.387, maxOffsetM: NEAR,
      anchors: [[41.921153, 45.475232], [41.924381, 45.471954]], pins: [23, 24, 25],
      source: 'R4 40 from 5.9 კმ to 6.6 კმ',
    },
    {
      id: 'r4-7', limitKmh: 50, from: 203.388, to: 235, maxOffsetM: NEAR,
      anchors: [[41.924382, 45.471955], [41.93154, 45.475194]], pins: [26, 27, 28, 29, 30, 31, 32],
      source: 'R4 50 from 6.6 კმ to finish',
    },
  ],
}

/**
 * Sections that were requested but could NOT be placed unambiguously on the existing road lines.
 * They are documentation only — no limit is produced for them.
 */
export const SPEED_LIMIT_UNRESOLVED: readonly { route: string; section: string; reason: string }[] = [
  { route: 'route-4', section: 'circle', reason: 'circle points 2 and 3 are not on the R4 road line' },
]
