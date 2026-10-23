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
  'route-1': [
    {
      id: 'r1-5', limitKmh: 50, from: 64.4581, to: 86.7952, maxOffsetM: NEAR,
      anchors: [[41.923221, 45.462001], [41.922398, 45.469718]], pins: [12, 13], source: 'R1 #5',
    },
  ],
  'route-2': [
    {
      id: 'r2-2', limitKmh: 40, from: 23.845, to: 67.6447, maxOffsetM: NEAR,
      anchors: [[41.9346285, 45.4791052], [41.93015, 45.506383]], pins: [5, 6, 7, 8], source: 'R2 #2',
    },
    {
      id: 'r2-3', limitKmh: 60, from: 89.0831, to: 108.5136, maxOffsetM: NEAR,
      anchors: [[41.922835, 45.50226], [41.9198, 45.500105]], pins: [12], source: 'R2 #3',
    },
    {
      id: 'r2-4', limitKmh: 50, from: 111.334, to: 118.0054, maxOffsetM: NEAR,
      anchors: [[41.919592, 45.499799], [41.919263, 45.497462]], pins: [13], source: 'R2 #4 = R4 #3',
    },
    {
      id: 'r2-5', limitKmh: 30, from: 118.0658, to: 126.3815, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.919246, 45.497309], [41.918732, 45.492608]], pins: [14], source: 'R2 #5 = R4 #4',
    },
    {
      id: 'r2-6', limitKmh: 50, from: 127.8391, to: 141.1881, maxOffsetM: NEAR,
      anchors: [[41.918708, 45.492201], [41.918924, 45.486064]], pins: [15, 16], source: 'R2 #6 = R4 #5',
    },
    {
      id: 'r2-7', limitKmh: 40, from: 145.7355, to: 217.9461, maxOffsetM: NEAR,
      anchors: [[41.918942, 45.485366], [41.924764, 45.47216]], pins: [17, 18, 19, 20, 21, 22], source: 'R2 #7',
    },
  ],
  'route-3': [
    {
      id: 'r3-1', limitKmh: 50, from: 91.8281, to: 99.6615, maxOffsetM: NEAR,
      anchors: [[41.9259, 45.454509], [41.925162, 45.456368]], pins: [19], source: 'R3 #1 = R1 #3',
    },
    {
      id: 'r3-2', limitKmh: 30, from: 100.5687, to: 109.9697, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.925127, 45.456699], [41.923391, 45.461265]], pins: [20], source: 'R3 #2 = R1 #4',
    },
    {
      id: 'r3-3', limitKmh: 50, from: 112.3033, to: 126.9525, maxOffsetM: NEAR,
      anchors: [[41.923253, 45.461673], [41.923404, 45.466203]], pins: [21], source: 'R3 #3',
    },
    {
      id: 'r3-4', limitKmh: 40, from: 127.2951, to: 131.6465, maxOffsetM: NEAR,
      anchors: [[41.923522, 45.466371], [41.925393, 45.466902]], pins: [22], source: 'R3 #4',
    },
  ],
  'route-4': [
    {
      id: 'r4-2', limitKmh: 40, from: 24.2119, to: 70.1345, maxOffsetM: NEAR,
      anchors: [[41.924755, 45.472723], [41.919123, 45.485642]], pins: [7, 8, 9], source: 'R4 #2',
    },
    {
      id: 'r4-4b', limitKmh: 30, from: 85.3011, to: 96.0964, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.919246, 45.497309], [41.918732, 45.492608]], pins: [11], source: 'R4 #4, outbound pass',
    },
    {
      id: 'r4-3', limitKmh: 50, from: 116.334, to: 123.0054, maxOffsetM: NEAR,
      anchors: [[41.919592, 45.499799], [41.919263, 45.497462]], pins: [15], source: 'R4 #3 = R2 #4',
    },
    {
      id: 'r4-4a', limitKmh: 30, from: 123.0658, to: 131.3815, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.919246, 45.497309], [41.918732, 45.492608]], pins: [16], source: 'R4 #4 = R2 #5, return pass',
    },
    {
      id: 'r4-5', limitKmh: 50, from: 132.8391, to: 146.0358, maxOffsetM: NEAR,
      anchors: [[41.918708, 45.492201], [41.918924, 45.486064]], pins: [17, 18], source: 'R4 #5 = R2 #6',
    },
  ],
}

/**
 * Sections that were requested but could NOT be placed unambiguously on the existing road lines.
 * They are documentation only — no limit is produced for them.
 */
export const SPEED_LIMIT_UNRESOLVED: readonly { route: string; section: string; reason: string }[] = [
  { route: 'route-1', section: '#1', reason: '3 m long and 9–28 m away from the road line' },
  { route: 'route-1', section: '#2', reason: 'only the start lies on the R1 line; the end (45.4550) is 489 m beyond the line' },
  { route: 'route-1', section: '#3', reason: 'not on the R1 line (nearest vertex 337–508 m away)' },
  { route: 'route-1', section: '#4', reason: 'start is 310 m away from the R1 line; only the last part is on it' },
  { route: 'route-1', section: '#6', reason: 'two valid matches: 88–143 (1428 m) and 88–177 (2075 m, includes the roundabout loop)' },
  { route: 'route-2', section: '#1', reason: '3 m long and 25–28 m away from the road line' },
  { route: 'route-3', section: '#5', reason: 'the stretch is passed twice (both directions) and gives three matches' },
  { route: 'route-4', section: '#1', reason: '3 m long and 9–28 m away from the road line' },
  { route: 'route-4', section: '#3/#5 outbound', reason: 'direction of the reverse pass is not specified' },
  { route: 'route-4', section: 'circle', reason: 'circle points 2 and 3 are not on the R4 road line' },
  { route: 'all', section: 'Aghmashenebeli 50', reason: 'overlaps the 30 and 40 sections and runs over several differently named streets' },
]
