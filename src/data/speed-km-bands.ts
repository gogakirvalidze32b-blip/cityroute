/**
 * Exact kilometre speed bands (route chainage / odometer km).
 * Half-open [fromKm, toKm); last band closed on the right.
 * Boundaries keep full decimal precision — never rounded to 0.1.
 */
export type SpeedKmBand = {
  fromKm: number
  toKm: number
  limitKmh: number
}

export const SPEED_KM_BANDS: Readonly<Record<string, readonly SpeedKmBand[]>> = {
  'route-1': [
    { fromKm: 0.0, toKm: 0.06, limitKmh: 20 },
    { fromKm: 0.06, toKm: 1.85, limitKmh: 50 },
    { fromKm: 1.85, toKm: 2.25, limitKmh: 40 },
    { fromKm: 2.25, toKm: 3.1, limitKmh: 50 },
    { fromKm: 3.1, toKm: 6.85, limitKmh: 40 },
    { fromKm: 6.85, toKm: 8.4, limitKmh: 50 },
    { fromKm: 8.4, toKm: 99, limitKmh: 20 },
  ],
  // 4.40→5.00 kept at existing 50 (user left that interval unspecified; prior bands already used 50).
  'route-2': [
    { fromKm: 0.0, toKm: 0.06, limitKmh: 20 },
    { fromKm: 0.06, toKm: 0.7, limitKmh: 50 },
    { fromKm: 0.7, toKm: 3.15, limitKmh: 40 },
    { fromKm: 3.15, toKm: 4.4, limitKmh: 60 },
    { fromKm: 4.4, toKm: 5.0, limitKmh: 50 },
    { fromKm: 5.0, toKm: 5.1, limitKmh: 30 },
    { fromKm: 5.1, toKm: 5.5, limitKmh: 50 },
    { fromKm: 5.5, toKm: 5.6, limitKmh: 30 },
    { fromKm: 5.6, toKm: 7.6, limitKmh: 40 },
    { fromKm: 7.6, toKm: 9.1, limitKmh: 50 },
    { fromKm: 9.1, toKm: 99, limitKmh: 20 },
  ],
  // Unchanged — Route 3 not part of this update.
  'route-3': [
    { fromKm: 0, toKm: 2.1, limitKmh: 50 },
    { fromKm: 2.1, toKm: 2.2, limitKmh: 30 },
    { fromKm: 2.2, toKm: 2.7, limitKmh: 50 },
    { fromKm: 2.7, toKm: 3.2, limitKmh: 30 },
    { fromKm: 3.2, toKm: 3.6, limitKmh: 50 },
    { fromKm: 3.6, toKm: 3.9, limitKmh: 40 },
    { fromKm: 3.9, toKm: 5.3, limitKmh: 50 },
    { fromKm: 5.3, toKm: 5.5, limitKmh: 40 },
    { fromKm: 5.5, toKm: 5.6, limitKmh: 30 },
    { fromKm: 5.6, toKm: 6.2, limitKmh: 40 },
    { fromKm: 6.2, toKm: 6.3, limitKmh: 30 },
    { fromKm: 6.3, toKm: 6.8, limitKmh: 50 },
    { fromKm: 6.8, toKm: 7.1, limitKmh: 40 },
    { fromKm: 7.1, toKm: 99, limitKmh: 50 },
  ],
  'route-4': [
    { fromKm: 0.0, toKm: 0.06, limitKmh: 20 },
    { fromKm: 0.06, toKm: 2.2, limitKmh: 50 },
    { fromKm: 2.2, toKm: 2.3, limitKmh: 30 },
    { fromKm: 2.3, toKm: 2.75, limitKmh: 50 },
    { fromKm: 2.75, toKm: 2.9, limitKmh: 30 },
    { fromKm: 2.9, toKm: 4.3, limitKmh: 50 },
    { fromKm: 4.3, toKm: 4.45, limitKmh: 30 },
    { fromKm: 4.45, toKm: 4.8, limitKmh: 50 },
    { fromKm: 4.8, toKm: 4.95, limitKmh: 30 },
    { fromKm: 4.95, toKm: 5.2, limitKmh: 40 },
    { fromKm: 5.2, toKm: 5.4, limitKmh: 30 },
    { fromKm: 5.4, toKm: 5.9, limitKmh: 40 },
    { fromKm: 5.9, toKm: 6.0, limitKmh: 30 },
    { fromKm: 6.0, toKm: 6.7, limitKmh: 40 },
    { fromKm: 6.7, toKm: 8.2, limitKmh: 50 },
    { fromKm: 8.2, toKm: 99, limitKmh: 20 },
  ],
}
