/**
 * Exact kilometre speed bands (route chainage / odometer km).
 * Half-open [fromKm, toKm); last band closed on the right.
 * Boundaries keep full decimal precision — never rounded to 0.1.
 *
 * Adjacent bands share their boundary exactly (toKm === next fromKm), so the
 * limit changes at precisely that kilometre marker with no gap and no overlap.
 * Zones marked "END" use the existing open-ended sentinel (99): the last band's
 * limit also applies to any km beyond it (see resolveSpeedLimitByKm), so no
 * route length is hard-coded.
 */
export type SpeedKmBand = {
  fromKm: number
  toKm: number
  limitKmh: number
}

export const SPEED_KM_BANDS: Readonly<Record<string, readonly SpeedKmBand[]>> = {
  'route-1': [
    { fromKm: 0.0, toKm: 0.1, limitKmh: 20 },
    { fromKm: 0.1, toKm: 1.85, limitKmh: 50 },
    { fromKm: 1.85, toKm: 2.2, limitKmh: 40 },
    { fromKm: 2.2, toKm: 3.05, limitKmh: 50 },
    { fromKm: 3.05, toKm: 6.8, limitKmh: 40 },
    { fromKm: 6.8, toKm: 8.35, limitKmh: 50 },
    { fromKm: 8.35, toKm: 99, limitKmh: 20 }, // END
  ],
  'route-2': [
    { fromKm: 0.0, toKm: 0.06, limitKmh: 20 },
    { fromKm: 0.06, toKm: 0.7, limitKmh: 50 },
    { fromKm: 0.7, toKm: 3.1, limitKmh: 40 },
    { fromKm: 3.1, toKm: 4.35, limitKmh: 60 },
    { fromKm: 4.35, toKm: 5.0, limitKmh: 50 },
    { fromKm: 5.0, toKm: 5.1, limitKmh: 30 },
    { fromKm: 5.1, toKm: 5.5, limitKmh: 50 },
    { fromKm: 5.5, toKm: 5.6, limitKmh: 30 },
    { fromKm: 5.6, toKm: 7.6, limitKmh: 40 },
    { fromKm: 7.6, toKm: 9.05, limitKmh: 50 },
    { fromKm: 9.05, toKm: 99, limitKmh: 20 }, // END
  ],
  'route-3': [
    { fromKm: 0.0, toKm: 2.1, limitKmh: 50 },
    { fromKm: 2.1, toKm: 2.2, limitKmh: 30 },
    { fromKm: 2.2, toKm: 2.85, limitKmh: 40 },
    { fromKm: 2.85, toKm: 5.6, limitKmh: 50 },
    { fromKm: 5.6, toKm: 5.7, limitKmh: 30 },
    { fromKm: 5.7, toKm: 6.1, limitKmh: 50 },
    { fromKm: 6.1, toKm: 6.25, limitKmh: 30 },
    { fromKm: 6.25, toKm: 6.8, limitKmh: 50 },
    { fromKm: 6.8, toKm: 7.1, limitKmh: 40 },
    { fromKm: 7.1, toKm: 8.95, limitKmh: 50 },
    { fromKm: 8.95, toKm: 9.1, limitKmh: 20 },
    { fromKm: 9.1, toKm: 99, limitKmh: 20 },
  ],
  'route-4': [
    { fromKm: 0.0, toKm: 0.06, limitKmh: 20 },
    { fromKm: 0.06, toKm: 0.1, limitKmh: 50 },
    { fromKm: 0.1, toKm: 2.1, limitKmh: 50 },
    { fromKm: 2.1, toKm: 2.2, limitKmh: 30 },
    { fromKm: 2.2, toKm: 2.7, limitKmh: 50 },
    { fromKm: 2.7, toKm: 2.9, limitKmh: 30 },
    { fromKm: 2.9, toKm: 4.2, limitKmh: 50 },
    { fromKm: 4.2, toKm: 4.35, limitKmh: 30 },
    { fromKm: 4.35, toKm: 4.7, limitKmh: 50 },
    { fromKm: 4.7, toKm: 4.85, limitKmh: 30 },
    { fromKm: 4.85, toKm: 5.1, limitKmh: 40 },
    { fromKm: 5.1, toKm: 5.3, limitKmh: 30 },
    { fromKm: 5.3, toKm: 5.7, limitKmh: 40 },
    { fromKm: 5.7, toKm: 5.8, limitKmh: 30 },
    { fromKm: 5.8, toKm: 6.55, limitKmh: 40 },
    { fromKm: 6.55, toKm: 8.05, limitKmh: 50 },
    { fromKm: 8.05, toKm: 99, limitKmh: 20 }, // END
  ],
}
