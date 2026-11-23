import type { LatLng } from '@/lib/gps'

export type RoundRouteCornersOptions = {
  /**
   * Minimum absolute bearing change (degrees) to fillet.
   * Default 120 — only true hairpins / U-tips. Ordinary ~90° street T-junctions
   * (agency start on all four Telavi routes) stay as straight polyline corners.
   */
  readonly minTurnDegrees?: number
  /** Max inset from the tip along each leg (meters) for ordinary sharp turns. Default 28. */
  readonly maxInsetMeters?: number
  /** Leave at least this much of each adjacent segment beyond the fillet. Default 3.5. */
  readonly minRemainingLegMeters?: number
  /** Interior samples on each corner curve (excluding endpoints). Default 18. */
  readonly curveInteriorPoints?: number
  /**
   * Do not fillet vertices whose along-route chainage is below this (meters).
   * Protects the agency start T-junction on R1–R4. Default 200.
   */
  readonly protectStartMeters?: number
}

const EARTH_RADIUS_M = 6_371_000
const DEG = Math.PI / 180

type Vec2 = { readonly x: number; readonly y: number }

function toLocal(origin: LatLng, point: LatLng): Vec2 {
  const meanLat = ((origin[0] + point[0]) / 2) * DEG
  return {
    x: (point[1] - origin[1]) * DEG * EARTH_RADIUS_M * Math.cos(meanLat),
    y: (point[0] - origin[0]) * DEG * EARTH_RADIUS_M,
  }
}

function fromLocal(origin: LatLng, local: Vec2): LatLng {
  const latRad = origin[0] * DEG
  return [
    origin[0] + (local.y / EARTH_RADIUS_M) / DEG,
    origin[1] + (local.x / (EARTH_RADIUS_M * Math.cos(latRad))) / DEG,
  ]
}

function hypot(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s }
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

function normalize(v: Vec2): Vec2 | null {
  const len = hypot(v)
  if (len < 1e-6) return null
  return scale(v, 1 / len)
}

function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = from[0] * DEG
  const lat2 = to[0] * DEG
  const dLng = (to[1] - from[1]) * DEG
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) / DEG) + 360) % 360
}

function shortestTurnDegrees(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180
}

function distanceMeters(a: LatLng, b: LatLng): number {
  return hypot(toLocal(a, b))
}

function quadraticPoint(p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

/**
 * Walk backward from `tipIdx` along the polyline and return the point that sits
 * `targetMeters` before the tip, plus the lowest vertex index still covered by
 * the walk (exclusive — vertices at/after this index up to tip are replaced).
 */
function pointAlongPathBack(
  coordinates: readonly LatLng[],
  tipIdx: number,
  targetMeters: number,
): { point: LatLng; consumeFrom: number } | null {
  let remaining = targetMeters
  for (let i = tipIdx; i > 0; i--) {
    const a = coordinates[i - 1]!
    const b = coordinates[i]!
    const seg = distanceMeters(a, b)
    if (seg >= remaining) {
      const t = remaining / seg
      // From b toward a by `remaining`
      const point: LatLng = [
        b[0] + (a[0] - b[0]) * t,
        b[1] + (a[1] - b[1]) * t,
      ]
      // Vertices strictly after consumeFrom through tipIdx-1 are interior to the fillet.
      return { point, consumeFrom: i - 1 }
    }
    remaining -= seg
  }
  return null
}

/** Walk forward from `tipIdx`; returns point and first index after the fillet. */
function pointAlongPathForward(
  coordinates: readonly LatLng[],
  tipIdx: number,
  targetMeters: number,
): { point: LatLng; consumeUntil: number } | null {
  let remaining = targetMeters
  for (let i = tipIdx; i < coordinates.length - 1; i++) {
    const a = coordinates[i]!
    const b = coordinates[i + 1]!
    const seg = distanceMeters(a, b)
    if (seg >= remaining) {
      const t = remaining / seg
      const point: LatLng = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ]
      // Vertices tipIdx+1 .. consumeUntil-1 are interior to the fillet.
      return { point, consumeUntil: i + 1 }
    }
    remaining -= seg
  }
  return null
}

function insetBudgetForTurn(turn: number, maxInset: number): { inset: number; ctrlPull: number; interior: number } {
  // Hairpins need a large visible arc under thick map stroke; ordinary corners less so.
  if (turn >= 150) {
    return { inset: Math.max(maxInset, 58), ctrlPull: 0.82, interior: 24 }
  }
  if (turn >= 120) {
    return { inset: Math.max(maxInset, 48), ctrlPull: 0.72, interior: 20 }
  }
  if (turn >= 90) {
    return { inset: Math.max(maxInset, 34), ctrlPull: 0.58, interior: 16 }
  }
  return { inset: maxInset, ctrlPull: 0.48, interior: 14 }
}

/**
 * Replace sharp V / hairpin polyline vertices with constrained quadratic Bézier
 * curves so the blue exam route visibly rounds instead of pointing to a tip.
 *
 * Insets walk along the path (multi-segment), not just the adjacent edge, so
 * hairpins with short tip segments still get a large visible fillet.
 * Each corner stays inside the triangle (entry-inset, tip, exit-inset) — no loops,
 * no shortcuts across other roads. Start/end coordinates are preserved.
 */
export function roundSharpRouteCorners(
  coordinates: readonly LatLng[],
  options: RoundRouteCornersOptions = {},
): LatLng[] {
  if (coordinates.length < 3) return coordinates.map((p) => [p[0], p[1]] as LatLng)

  const minTurn = options.minTurnDegrees ?? 120
  const maxInset = options.maxInsetMeters ?? 28
  const minRemain = options.minRemainingLegMeters ?? 3.5
  const interiorDefault = Math.max(3, options.curveInteriorPoints ?? 18)
  const protectStartM = options.protectStartMeters ?? 200

  // Along-route chainage at each vertex (for start-zone protection).
  const vertexChainageM: number[] = [0]
  for (let i = 1; i < coordinates.length; i++) {
    vertexChainageM.push(
      vertexChainageM[i - 1]! + distanceMeters(coordinates[i - 1]!, coordinates[i]!),
    )
  }

  // Pre-compute which interior indices are sharp corners worth filleting.
  type Corner = {
    index: number
    turn: number
    inset: number
    ctrlPull: number
    interior: number
  }
  const corners: Corner[] = []
  for (let i = 1; i < coordinates.length - 1; i++) {
    const prev = coordinates[i - 1]!
    const vertex = coordinates[i]!
    const next = coordinates[i + 1]!
    const entryLen = distanceMeters(prev, vertex)
    const exitLen = distanceMeters(vertex, next)
    const turn = Math.abs(
      shortestTurnDegrees(bearingDegrees(prev, vertex), bearingDegrees(vertex, next)),
    )
    if (turn < minTurn) continue
    // Agency start T-junction (~97° at ~76–111 m) must stay as straight street lines.
    if (vertexChainageM[i]! < protectStartM) continue
    // Need enough path length on both sides — checked when walking.
    if (entryLen < 1.5 || exitLen < 1.5) continue
    const budget = insetBudgetForTurn(turn, maxInset)
    corners.push({
      index: i,
      turn,
      inset: budget.inset,
      ctrlPull: budget.ctrlPull,
      interior: Math.max(interiorDefault, budget.interior),
    })
  }

  if (corners.length === 0) {
    return coordinates.map((p) => [p[0], p[1]] as LatLng)
  }

  // Cluster consecutive sharp tips that sit on a short zig-zag / spike so one
  // fillet spans the whole noise burst instead of each tip blocking the next.
  const CLUSTER_GAP_M = 45
  type Cluster = { corners: Corner[]; firstIdx: number; lastIdx: number }
  const clusters: Cluster[] = []
  for (const corner of corners) {
    const prev = clusters[clusters.length - 1]
    if (!prev) {
      clusters.push({ corners: [corner], firstIdx: corner.index, lastIdx: corner.index })
      continue
    }
    let gap = 0
    for (let i = prev.lastIdx; i < corner.index; i++) {
      gap += distanceMeters(coordinates[i]!, coordinates[i + 1]!)
    }
    if (gap <= CLUSTER_GAP_M) {
      prev.corners.push(corner)
      prev.lastIdx = corner.index
    } else {
      clusters.push({ corners: [corner], firstIdx: corner.index, lastIdx: corner.index })
    }
  }

  const out: LatLng[] = []
  let cursor = 0 // next raw index to copy

  for (let c = 0; c < clusters.length; c++) {
    const cluster = clusters[c]!
    const tipCorner = cluster.corners.reduce((best, cur) =>
      cur.turn > best.turn ? cur : best,
    )
    const tipIdx = tipCorner.index
    if (tipIdx < cursor) continue

    let maxBack = 0
    for (let i = cluster.firstIdx; i > cursor; i--) {
      maxBack += distanceMeters(coordinates[i - 1]!, coordinates[i]!)
    }
    maxBack = Math.max(0, maxBack - minRemain)

    let maxFwd = 0
    const nextCluster = clusters[c + 1]
    const fwdLimitIdx = nextCluster ? nextCluster.firstIdx : coordinates.length - 1
    for (let i = cluster.lastIdx; i < fwdLimitIdx; i++) {
      maxFwd += distanceMeters(coordinates[i]!, coordinates[i + 1]!)
    }
    maxFwd = Math.max(0, maxFwd - minRemain)

    const inset = Math.min(tipCorner.inset, maxBack, maxFwd)
    if (inset < 8) continue

    const back = pointAlongPathBack(coordinates, cluster.firstIdx, inset)
    const fwd = pointAlongPathForward(coordinates, cluster.lastIdx, inset)
    if (!back || !fwd) continue

    while (cursor <= back.consumeFrom) {
      out.push([coordinates[cursor]![0], coordinates[cursor]![1]])
      cursor++
    }

    const tip = coordinates[tipIdx]!
    const p1 = back.point
    const p2 = fwd.point
    const origin = tip
    const backDir = normalize(toLocal(origin, p1))
    const fwdDir = normalize(toLocal(origin, p2))
    if (!backDir || !fwdDir) {
      while (cursor <= cluster.lastIdx) {
        out.push([coordinates[cursor]![0], coordinates[cursor]![1]])
        cursor++
      }
      continue
    }

    const p1Local = toLocal(origin, p1)
    const p2Local = toLocal(origin, p2)
    // Control on the inside angle bisector (not at the tip). Pulling inside
    // yields a true round; tip control would still pass through the V apex.
    const bisect = normalize(add(backDir, fwdDir))
    const ctrlLocal = bisect ? scale(bisect, inset * tipCorner.ctrlPull) : { x: 0, y: 0 }

    const last = out[out.length - 1]
    if (!last || distanceMeters(last, p1) >= 0.3) {
      out.push([p1[0], p1[1]])
    }
    for (let s = 1; s <= tipCorner.interior; s++) {
      const t = s / (tipCorner.interior + 1)
      out.push(fromLocal(origin, quadraticPoint(p1Local, ctrlLocal, p2Local, t)))
    }
    out.push([p2[0], p2[1]])

    cursor = fwd.consumeUntil
  }

  while (cursor < coordinates.length) {
    out.push([coordinates[cursor]![0], coordinates[cursor]![1]])
    cursor++
  }

  const deduped: LatLng[] = []
  for (const point of out) {
    const prevPt = deduped[deduped.length - 1]
    if (!prevPt || distanceMeters(prevPt, point) >= 0.3) {
      deduped.push(point)
    }
  }
  return deduped.length >= 2 ? deduped : coordinates.map((p) => [p[0], p[1]] as LatLng)
}

/** Absolute bearing turn at each interior vertex (for tests / audits). */
export function measureSharpCorners(
  coordinates: readonly LatLng[],
  minTurnDegrees = 65,
): Array<{ index: number; turnDegrees: number; lat: number; lng: number }> {
  const found: Array<{ index: number; turnDegrees: number; lat: number; lng: number }> = []
  for (let i = 1; i < coordinates.length - 1; i++) {
    const turn = Math.abs(
      shortestTurnDegrees(
        bearingDegrees(coordinates[i - 1]!, coordinates[i]!),
        bearingDegrees(coordinates[i]!, coordinates[i + 1]!),
      ),
    )
    if (turn >= minTurnDegrees) {
      found.push({
        index: i,
        turnDegrees: turn,
        lat: coordinates[i]![0],
        lng: coordinates[i]![1],
      })
    }
  }
  return found
}
