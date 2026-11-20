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
   * Route 1 continuous posted limits (user map):
   * 50 (agency + east approach + Vaziani top) → 40 (west vertical) →
   * 50 (Chavchavadze) → 40 (Rustaveli out+back) → 50 (east return to finish).
   * from/to abut so the sign never drops to "—".
   */
  'route-1': [
    {
      id: 'r1-1', limitKmh: 50, from: 0, to: 51.99, maxOffsetM: NEAR,
      anchors: [[41.931548, 45.474995], [41.926979, 45.461239]], pins: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      source: 'R1 map Vaziani/top + east approach 50',
    },
    {
      id: 'r1-2', limitKmh: 40, from: 52.0, to: 61.5, maxOffsetM: NEAR,
      anchors: [[41.926979, 45.461239], [41.923761, 45.460417]], pins: [10, 11],
      source: 'R1 map west vertical 40',
    },
    {
      id: 'r1-3', limitKmh: 50, from: 61.51, to: 97.5, maxOffsetM: NEAR,
      anchors: [[41.923607, 45.460752], [41.919652, 45.469894]], pins: [12, 13, 14, 15],
      source: 'R1 map Chavchavadze 50',
    },
    {
      id: 'r1-4', limitKmh: 40, from: 97.51, to: 218.0, maxOffsetM: NEAR,
      anchors: [[41.919551, 45.469897], [41.919938, 45.470166]], pins: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
      source: 'R1 map Rustaveli out+back 40',
    },
    {
      id: 'r1-5', limitKmh: 50, from: 218.01, to: 270, maxOffsetM: NEAR,
      anchors: [[41.919938, 45.470166], [41.93154, 45.475194]], pins: [28, 29, 30, 31, 32, 33, 34, 35],
      source: 'R1 map east return to finish 50',
    },
  ],
  /**
   * Route 2 continuous posted limits:
   * 50 → 40 (0.7–PIN 9) → 60 from PIN 9 → 50 at #13 turn → 30 → 50 →
   * 40 (bottom + upper to red bar past #22) → 50 (pink finish to agency).
   * from/to abut so the sign never drops to "—".
   */
  'route-2': [
    {
      id: 'r2-1', limitKmh: 50, from: 0, to: 25.11, maxOffsetM: NEAR,
      anchors: [[41.931477, 45.475406], [41.934633, 45.479195]], pins: [2, 3, 4, 5],
      source: 'R2 Alazani 50 through right turn (to past PIN 5)',
    },
    {
      id: 'r2-2', limitKmh: 40, from: 25.12, to: 74.50, maxOffsetM: NEAR,
      anchors: [[41.93424, 45.48142], [41.929758, 45.506632]], pins: [6, 7, 8, 9],
      source: 'R2 40 until ~3.17 კმ (just past PIN 9)',
    },
    {
      id: 'r2-3', limitKmh: 60, from: 74.51, to: 111.33, maxOffsetM: NEAR,
      anchors: [[41.929758, 45.506632], [41.91984, 45.50022]], pins: [10, 11, 12],
      source: 'R2 60 from ~3.17 კმ (after PIN 9) until #13 turn',
    },
    {
      id: 'r2-4', limitKmh: 50, from: 111.334, to: 125.5, maxOffsetM: NEAR,
      anchors: [[41.919592, 45.499799], [41.918722, 45.493076]], pins: [13],
      source: 'R2 50 until 5.0 კმ',
    },
    {
      id: 'r2-5', limitKmh: 30, from: 125.51, to: 128.52, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.918722, 45.493076], [41.918678, 45.491885]], pins: [14],
      source: 'R2 30 from 5.0 კმ until before 5.1',
    },
    {
      id: 'r2-6', limitKmh: 50, from: 128.55, to: 141.18, maxOffsetM: NEAR,
      anchors: [[41.918678, 45.49187], [41.918924, 45.486064]], pins: [15, 16],
      source: 'R2 50 from 5.1 კმ',
    },
    {
      id: 'r2-7', limitKmh: 40, from: 141.19, to: 207.99, maxOffsetM: NEAR,
      anchors: [[41.918942, 45.485366], [41.922261, 45.470464]], pins: [17, 18, 19, 20, 21, 22],
      source: 'R2 map 40 through #19–#22 to red bar',
    },
    {
      id: 'r2-8', limitKmh: 50, from: 208.0, to: 252, maxOffsetM: NEAR,
      anchors: [[41.922261, 45.470464], [41.93154, 45.475194]], pins: [23, 24, 25, 26, 27, 28, 29],
      source: 'R2 map pink finish 50',
    },
  ],
  /**
   * Route 3 continuous posted limits (user map + arrows, no gaps):
   * 50 (agency→Alazani→Agmashenebeli) → 30 (west connector, arrow up) →
   * 50 (Chavchavadze west) → 40 (short north jog) → 50 (Chavchavadze east) →
   * 40 (Rustaveli out+back) → 50 (return north to finish).
   */
  'route-3': [
    {
      id: 'r3-1', limitKmh: 50, from: 0, to: 100.56, maxOffsetM: NEAR,
      anchors: [[41.931477, 45.475406], [41.925162, 45.456368]], pins: [1, 2, 3, 4, 5, 16, 17, 18, 19],
      source: 'R3 map outbound Alazani+Agmashenebeli 50',
    },
    {
      id: 'r3-2', limitKmh: 30, from: 100.57, to: 112.29, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.925127, 45.456699], [41.923391, 45.461265]], pins: [20],
      source: 'R3 map west connector arrow 30',
    },
    {
      id: 'r3-3', limitKmh: 50, from: 112.3, to: 127.29, maxOffsetM: NEAR,
      anchors: [[41.923253, 45.461673], [41.923404, 45.466203]], pins: [21],
      source: 'R3 map Chavchavadze west 50',
    },
    {
      id: 'r3-4', limitKmh: 40, from: 127.3, to: 133.0, maxOffsetM: NEAR,
      anchors: [[41.92354, 45.466294], [41.9255, 45.467381]], pins: [22],
      source: 'R3 map short north jog 40',
    },
    {
      id: 'r3-5', limitKmh: 50, from: 133.01, to: 185.99, maxOffsetM: NEAR,
      anchors: [[41.9255, 45.467381], [41.92147, 45.48318]], pins: [6, 7, 15, 23, 24],
      source: 'R3 map Chavchavadze east 50',
    },
    {
      id: 'r3-6', limitKmh: 40, from: 186.0, to: 276.99, maxOffsetM: NEAR,
      anchors: [[41.92147, 45.48318], [41.919246, 45.485402]], pins: [8, 9, 10, 11, 13, 14],
      source: 'R3 map Rustaveli out+back 40',
    },
    {
      id: 'r3-7', limitKmh: 50, from: 277.0, to: 355, maxOffsetM: NEAR,
      anchors: [[41.919246, 45.485402], [41.93154, 45.475194]], pins: [25, 26, 27, 28, 29, 30, 31],
      source: 'R3 map return to agency 50',
    },
  ],
  /**
   * Route 4 continuous posted limits:
   * 50 until 2.2 → 30 (2.2–2.3) → 50 (2.3–2.7) → 30 (2.7–2.9) → 50 (east loop) →
   * 30 → 50 → 40 (Agmashenebeli return only) → 50 (N–S return to finish).
   * Shared R2 stretches keep the same anchors; from/to abut so the sign never drops to "—".
   */
  'route-4': [
    {
      id: 'r4-1', limitKmh: 50, from: 0, to: 65.57, maxOffsetM: NEAR,
      anchors: [[41.931477, 45.475406], [41.919123, 45.485642]], pins: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      source: 'R4 50 until 2.2 კმ',
    },
    {
      id: 'r4-2', limitKmh: 30, from: 65.58, to: 71.06, maxOffsetM: NEAR,
      anchors: [[41.919123, 45.485642], [41.91896, 45.48556]], pins: [],
      source: 'R4 30 from 2.2–2.3 კმ',
    },
    {
      id: 'r4-2b', limitKmh: 50, from: 71.07, to: 82.20, maxOffsetM: NEAR,
      anchors: [[41.91896, 45.48556], [41.91868, 45.48969]], pins: [10],
      source: 'R4 50 from 2.3–2.7 კმ',
    },
    {
      id: 'r4-4b', limitKmh: 30, from: 82.21, to: 85.90, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.918722, 45.493076], [41.918678, 45.491885]], pins: [16],
      source: 'R4 30 from 2.7–2.9 კმ',
    },
    {
      id: 'r4-3', limitKmh: 50, from: 85.91, to: 130.5, maxOffsetM: NEAR,
      anchors: [[41.919592, 45.499799], [41.918722, 45.493076]], pins: [11, 12, 13, 14, 15],
      source: 'R4 map east loop / highway 50',
    },
    {
      id: 'r4-4a', limitKmh: 30, from: 130.51, to: 133.52, maxOffsetM: BOTH_DIRECTIONS,
      anchors: [[41.918722, 45.493076], [41.918678, 45.491885]], pins: [16],
      source: 'R4 return 30 = same street as R2 r2-5',
    },
    {
      id: 'r4-5', limitKmh: 50, from: 133.53, to: 150.5, maxOffsetM: NEAR,
      anchors: [[41.918678, 45.49187], [41.918924, 45.486064]], pins: [17, 18, 19],
      source: 'R4 map after return 30 = 50',
    },
    {
      id: 'r4-6', limitKmh: 40, from: 150.51, to: 193.5, maxOffsetM: NEAR,
      anchors: [[41.91891, 45.48517], [41.922156, 45.470399]], pins: [20, 21, 22, 23, 24],
      source: 'R4 map Agmashenebeli return 40 only',
    },
    {
      id: 'r4-7', limitKmh: 50, from: 193.51, to: 235, maxOffsetM: NEAR,
      anchors: [[41.922261, 45.470464], [41.93154, 45.475194]], pins: [25, 26, 27, 28, 29, 30, 31, 32],
      source: 'R4 map N–S return to agency 50',
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
