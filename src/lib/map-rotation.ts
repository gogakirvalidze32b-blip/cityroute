/**
 * Heading-up map rotation convention (single source of truth).
 *
 * Heading / GPS course: degrees CLOCKWISE from North (0=N, 90=E, 180=S, 270=W).
 * CSS rotate(θ): positive = CLOCKWISE on screen.
 *
 * To put the direction of travel at the TOP of the screen the map must turn the opposite way
 * to the vehicle: rotate(-heading). Check: heading 90 (East): the east side of the map is on the
 * right; turning the map 90° counter-clockwise carries it to the top.
 *
 * The vehicle arrow is NOT rotated — it always points up (screen forward).
 */
export function normalizeHeading(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  return ((deg % 360) + 360) % 360
}

/** CSS rotation (degrees, clockwise-positive) to apply to the map "world" element. */
export function mapRotationCssDeg(headingDeg: number): number {
  return -normalizeHeading(headingDeg)
}

/**
 * Where does a ground direction (compass bearing, clockwise from North) appear on screen when the
 * map is heading-up for `headingDeg`? Returns clockwise degrees from screen-UP (0 = ahead,
 * 90 = to the right, 270 = to the left).
 */
export function screenAngleOfBearing(bearingDeg: number, headingDeg: number): number {
  return normalizeHeading(bearingDeg - headingDeg)
}
