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
  /**
   * Route 2 continuous posted limits (photo + user confirm):
   * 50 → 40 (top) → 60 (entire right) → 50 → 30 → 50 →
   * 40 (entire bottom Kurdghelauri) → 60 (entire Mshvidobis after the turn)
   * from/to abut so the sign never drops to "—".
   */
  'route-2': [
    {
      id: 'r2-1', limitKmh: 50, from: 0, to: 23.84, maxOffsetM: NEAR,
      anchors: [[41.931477, 45.475406], [41.934655, 45.479115]], pins: [2, 3, 4], source: 'R2 #1 start',
    },
    {
      id: 'r2-2', limitKmh: 40, from: 23.85, to: 67.64, maxOffsetM: NEAR,
      anchors: [[41.9346285, 45.4791052], [41.93015, 45.506383]], pins: [5, 6, 7, 8], source: 'R2 #5–#8 entire 40',
    },
    {
      id: 'r2-3', limitKmh: 60, from: 67.65, to: 111.33, maxOffsetM: NEAR,
      anchors: [[41.92992, 45.50671], [41.91984, 45.50022]], pins: [9, 10, 11, 12], source: 'R2 entire right 60',
    },
    {
      id: 'r2-4', limitKmh: 50, from: 111.334, to: 118.06, maxOffsetM: NEAR,
      anchors: [[41.919592, 45.499799], [41.919263, 45.497462]], pins: [13], source: 'R2 #4 after 60 = 50',
    },
    {
      id: 'r2-5', limitKmh: 30, from: 118.0658, to: 126.38, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.919246, 45.497309], [41.918732, 45.492608]], pins: [14], source: 'R2 #5 = 30',
    },
    {
      id: 'r2-6', limitKmh: 50, from: 126.39, to: 141.18, maxOffsetM: NEAR,
      anchors: [[41.918708, 45.492201], [41.918924, 45.486064]], pins: [15, 16], source: 'R2 #6 = 50',
    },
    {
      id: 'r2-7', limitKmh: 40, from: 141.19, to: 196.08, maxOffsetM: NEAR,
      anchors: [[41.918942, 45.485366], [41.919442, 45.471276]], pins: [17, 18, 19, 20], source: 'R2 entire bottom Kurdghelauri 40',
    },
    {
      id: 'r2-8', limitKmh: 60, from: 196.09, to: 252, maxOffsetM: NEAR,
      anchors: [[41.919519, 45.471065], [41.93154, 45.475194]], pins: [21, 22, 23, 24, 26, 27, 28], source: 'R2 entire Mshvidobis 60',
    },
  ],
  /**
   * Route 3 continuous posted limits (photo colors, no gaps):
   * black Alazani 50 → red Agmashenebeli 50 → green 30 → blue 50 →
   * purple 40 → yellow 40 → red 50 from yellow join all the way to finish
   */
  'route-3': [
    {
      id: 'r3-black-out', limitKmh: 50, from: 0, to: 39.99, maxOffsetM: NEAR,
      anchors: [[41.931477, 45.475406], [41.925618, 45.466848]], pins: [1, 2, 3, 4, 5, 15], source: 'R3 photo black Alazani outbound 50',
    },
    {
      id: 'r3-1', limitKmh: 50, from: 40.0, to: 100.56, maxOffsetM: NEAR,
      anchors: [[41.925618, 45.466848], [41.925162, 45.456368]], pins: [16, 17, 18, 19], source: 'R3 photo red Agmashenebeli 50',
    },
    {
      id: 'r3-2', limitKmh: 30, from: 100.57, to: 112.29, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.925127, 45.456699], [41.923391, 45.461265]], pins: [20], source: 'R3 photo green 30',
    },
    {
      id: 'r3-3', limitKmh: 50, from: 112.30, to: 127.29, maxOffsetM: NEAR,
      anchors: [[41.923253, 45.461673], [41.923404, 45.466203]], pins: [21], source: 'R3 photo blue 50',
    },
    {
      id: 'r3-4', limitKmh: 40, from: 127.30, to: 185.99, maxOffsetM: NEAR,
      anchors: [[41.923522, 45.466371], [41.921470, 45.483180]], pins: [6, 22, 23, 24], source: 'R3 photo purple 40',
    },
    {
      id: 'r3-yellow', limitKmh: 40, from: 186.0, to: 276.99, maxOffsetM: NEAR,
      anchors: [[41.921470, 45.483180], [41.919232, 45.485426]], pins: [8, 9, 10, 11, 13, 14], source: 'R3 photo yellow 40',
    },
    {
      id: 'r3-red-to-end', limitKmh: 50, from: 277.0, to: 355, maxOffsetM: NEAR,
      anchors: [[41.919803, 45.484837], [41.93154, 45.475194]], pins: [7, 25, 26, 27, 28, 29, 30], source: 'R3 photo red 50 after yellow join to finish',
    },
  ],
  /**
   * Route 4 continuous posted limits (photo + full exam loop):
   * 50 → 40 → 50 → 30 → 50 → 30 → 50 → 40 → 50
   * Agmashenebeli 40 is marked twice on the map (outbound + return). Shared R2 stretches
   * keep the same anchors; from/to abut so the sign never drops to "—".
   */
  'route-4': [
    {
      id: 'r4-1', limitKmh: 50, from: 0, to: 24.2, maxOffsetM: NEAR,
      anchors: [[41.931477, 45.475406], [41.924755, 45.472723]], pins: [2, 3, 4, 5, 6], source: 'R4 #1 start',
    },
    {
      id: 'r4-2', limitKmh: 40, from: 24.21, to: 68.7, maxOffsetM: NEAR,
      anchors: [[41.924755, 45.472723], [41.919123, 45.485642]], pins: [7, 8, 9], source: 'R4 #2 Agmashenebeli outbound',
    },
    {
      id: 'r4-2b', limitKmh: 50, from: 68.71, to: 85.29, maxOffsetM: NEAR,
      anchors: [[41.91896, 45.48556], [41.91868, 45.48969]], pins: [19], source: 'R4 photo 50 after 40',
    },
    {
      id: 'r4-4b', limitKmh: 30, from: 85.3011, to: 96.0964, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.919246, 45.497309], [41.918732, 45.492608]], pins: [11], source: 'R4 #4, outbound pass',
    },
    {
      id: 'r4-3', limitKmh: 50, from: 96.11, to: 123.06, maxOffsetM: NEAR,
      anchors: [[41.919592, 45.499799], [41.919263, 45.497462]], pins: [12, 13, 14, 15], source: 'R4 #3 = R2 #4',
    },
    {
      id: 'r4-4a', limitKmh: 30, from: 123.0658, to: 131.38, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.919246, 45.497309], [41.918732, 45.492608]], pins: [16], source: 'R4 #4 = R2 #5, return pass',
    },
    {
      id: 'r4-5', limitKmh: 50, from: 131.39, to: 150.5, maxOffsetM: NEAR,
      anchors: [[41.918708, 45.492201], [41.918924, 45.486064]], pins: [10, 17, 18], source: 'R4 #5 = R2 #6',
    },
    {
      id: 'r4-6', limitKmh: 40, from: 150.51, to: 214.5, maxOffsetM: NEAR,
      anchors: [[41.91891, 45.48517], [41.92665, 45.47349]], pins: [20, 21, 22, 23, 24, 25, 26], source: 'R4 Agmashenebeli return 40',
    },
    {
      id: 'r4-7', limitKmh: 50, from: 214.51, to: 235, maxOffsetM: NEAR,
      anchors: [[41.929124, 45.475086], [41.93154, 45.475194]], pins: [27, 28, 29, 30, 31], source: 'R4 finish approach',
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
  { route: 'route-4', section: 'circle', reason: 'circle points 2 and 3 are not on the R4 road line' },
]
