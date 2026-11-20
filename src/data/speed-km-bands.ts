/**
 * Merged HUD 0.1 კმ bands:
 * - Base = old map SPEED_ZONES (e332575) converted to road km — early stretches kept
 * - Plus = verified new edges overlaid (short 30s / late refinements)
 * Half-open [fromKm, toKm); last band closed on the right. No EPS / no gaps.
 */
export type SpeedKmBand = {
  fromKm: number
  toKm: number
  limitKmh: number
}

export const SPEED_KM_BANDS: Readonly<Record<string, readonly SpeedKmBand[]>> = {
  // Early kept; 3.1–6.8=40 · 6.8→end=50
  'route-1': [
    { fromKm: 0, toKm: 1.8, limitKmh: 50 },
    { fromKm: 1.8, toKm: 2.2, limitKmh: 40 },
    { fromKm: 2.2, toKm: 3.1, limitKmh: 50 },
    { fromKm: 3.1, toKm: 6.8, limitKmh: 40 },
    { fromKm: 6.8, toKm: 99, limitKmh: 50 },
  ],
  // Alazani 50 through right turn; 40 after turn (~0.8, past PIN 5); PIN 9→60; rest kept
  'route-2': [
    { fromKm: 0, toKm: 0.8, limitKmh: 50 },
    { fromKm: 0.8, toKm: 3.2, limitKmh: 40 }, // until ~3.17 (past PIN 9); 60 starts as 3.2 settles
    { fromKm: 3.2, toKm: 4.4, limitKmh: 60 }, // from ~3.17/3.2 near PIN 9 — not at 3.1 start
    { fromKm: 4.4, toKm: 5.0, limitKmh: 50 },
    { fromKm: 5.0, toKm: 5.1, limitKmh: 30 },
    { fromKm: 5.1, toKm: 5.6, limitKmh: 50 },
    { fromKm: 5.6, toKm: 6.7, limitKmh: 40 },
    { fromKm: 6.7, toKm: 7.1, limitKmh: 50 },
    { fromKm: 7.1, toKm: 7.2, limitKmh: 30 },
    { fromKm: 7.2, toKm: 99, limitKmh: 50 },
  ],
  // OLD mid stretches kept; + NEW 2.1–2.2=30 and late short bands
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
  // 0–2.2=50, 2.2–2.3=30, 2.3–2.7=50, 2.7–2.9=30; rest kept
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
