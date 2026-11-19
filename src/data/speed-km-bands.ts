/**
 * Exact kilometre speed bands for the HUD (same 0.1 კმ digits as the distance label).
 * Half-open [fromKm, toKm): the limit changes the instant the displayed tenth equals fromKm.
 * The last band on each route is closed on the right so the finish stays posted.
 */
export type SpeedKmBand = {
  fromKm: number
  toKm: number
  limitKmh: number
}

export const SPEED_KM_BANDS: Readonly<Record<string, readonly SpeedKmBand[]>> = {
  'route-1': [
    { fromKm: 0, toKm: 1.8, limitKmh: 50 },
    { fromKm: 1.8, toKm: 2.2, limitKmh: 40 },
    { fromKm: 2.2, toKm: 3.1, limitKmh: 50 },
    { fromKm: 3.1, toKm: 6.8, limitKmh: 40 },
    { fromKm: 6.8, toKm: 99, limitKmh: 50 },
  ],
  'route-2': [
    { fromKm: 0, toKm: 0.7, limitKmh: 50 },
    { fromKm: 0.7, toKm: 3.1, limitKmh: 40 },
    { fromKm: 3.1, toKm: 4.4, limitKmh: 60 },
    { fromKm: 4.4, toKm: 5.0, limitKmh: 50 },
    { fromKm: 5.0, toKm: 5.1, limitKmh: 30 },
    { fromKm: 5.1, toKm: 5.6, limitKmh: 50 },
    { fromKm: 5.6, toKm: 6.7, limitKmh: 40 },
    { fromKm: 6.7, toKm: 7.1, limitKmh: 50 },
    { fromKm: 7.1, toKm: 7.2, limitKmh: 30 },
    { fromKm: 7.2, toKm: 99, limitKmh: 50 },
  ],
  'route-3': [
    { fromKm: 0, toKm: 2.1, limitKmh: 50 },
    { fromKm: 2.1, toKm: 2.2, limitKmh: 30 },
    { fromKm: 2.2, toKm: 2.7, limitKmh: 50 },
    { fromKm: 2.7, toKm: 3.2, limitKmh: 30 },
    { fromKm: 3.2, toKm: 3.6, limitKmh: 50 },
    { fromKm: 3.6, toKm: 3.9, limitKmh: 40 },
    { fromKm: 3.9, toKm: 5.5, limitKmh: 50 },
    { fromKm: 5.5, toKm: 5.6, limitKmh: 30 },
    { fromKm: 5.6, toKm: 6.2, limitKmh: 40 },
    { fromKm: 6.2, toKm: 6.3, limitKmh: 30 },
    { fromKm: 6.3, toKm: 6.8, limitKmh: 50 },
    { fromKm: 6.8, toKm: 7.1, limitKmh: 40 },
    // 7.1 → finish = 50 (Agmashenebeli / remainder — no 30 after 7.1)
    { fromKm: 7.1, toKm: 99, limitKmh: 50 },
  ],
  'route-4': [
    { fromKm: 0, toKm: 2.2, limitKmh: 50 },
    { fromKm: 2.2, toKm: 2.3, limitKmh: 30 },
    { fromKm: 2.3, toKm: 2.7, limitKmh: 50 },
    { fromKm: 2.7, toKm: 2.9, limitKmh: 30 },
    { fromKm: 2.9, toKm: 4.8, limitKmh: 50 },
    { fromKm: 4.8, toKm: 4.9, limitKmh: 30 },
    { fromKm: 4.9, toKm: 5.2, limitKmh: 50 },
    { fromKm: 5.2, toKm: 5.8, limitKmh: 40 },
    { fromKm: 5.8, toKm: 5.9, limitKmh: 30 },
    { fromKm: 5.9, toKm: 6.6, limitKmh: 40 },
    { fromKm: 6.6, toKm: 99, limitKmh: 50 },
  ],
}
