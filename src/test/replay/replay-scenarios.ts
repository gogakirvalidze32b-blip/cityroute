/**
 * Deterministic replay scenarios shared by the legacy baseline and the
 * kilometre-crossing trigger tests. Scenarios run the REAL ExamDriveSession
 * pipeline (GPS filter → matchGpsPosition → PIN trigger → audio queue).
 */
import type { ActiveRouteId } from '@/lib/pure-route-geometry'
import type { TraceOptions } from './route-replay'

export type ReplayScenario = {
  readonly id: string
  readonly description: string
  readonly trace: Omit<TraceOptions, 'startTimestampMs' | 'outages'> & {
    /** Outages placed around a PIN: [sortOrder, metres before, metres after]. */
    readonly outageAroundPins?: readonly (readonly [number, number, number])[]
  }
}

export const REPLAY_ROUTES: readonly ActiveRouteId[] = ['route-1', 'route-2', 'route-3', 'route-4']

export const REPLAY_SCENARIOS: readonly ReplayScenario[] = [
  {
    id: 'clean-1hz-40kmh',
    description: 'Centreline, 1 fix/s, 40 km/h',
    trace: { speedMps: 11.1, intervalMs: 1000 },
  },
  {
    id: 'sparse-2s-60kmh',
    description: 'Centreline, 1 fix/2 s, 60 km/h (33 m between fixes)',
    trace: { speedMps: 16.7, intervalMs: 2000 },
  },
  {
    id: 'jitter-6m-1hz-40kmh',
    description: '6 m (1σ) positional jitter, 1 fix/s, 40 km/h',
    trace: { speedMps: 11.1, intervalMs: 1000, jitterMeters: 6, seed: 7, accuracyMeters: 8 },
  },
  {
    id: 'outage-pin10-1hz-40kmh',
    description: 'GPS lost from 60 m before to 60 m after PIN 10, 1 fix/s, 40 km/h',
    trace: { speedMps: 11.1, intervalMs: 1000, outageAroundPins: [[10, 60, 60]] },
  },
  {
    id: 'very-sparse-5s-50kmh',
    description: 'Centreline, 1 fix/5 s, 50 km/h (69 m between fixes)',
    trace: { speedMps: 13.9, intervalMs: 5000 },
  },
  {
    id: 'dwell-sparse-2s-60kmh',
    description: 'Idles 5 fixes at the start, then 1 fix/2 s at 60 km/h',
    trace: { speedMps: 16.7, intervalMs: 2000, startDwellFixes: 5 },
  },
  {
    id: 'dwell-very-sparse-5s-50kmh',
    description: 'Idles 5 fixes at the start, then 1 fix/5 s at 50 km/h',
    trace: { speedMps: 13.9, intervalMs: 5000, startDwellFixes: 5 },
  },
  {
    id: 'dwell-jitter-6m-1hz-40kmh',
    description: 'Idles 5 fixes at the start, 6 m jitter, 1 fix/s, 40 km/h',
    trace: { speedMps: 11.1, intervalMs: 1000, jitterMeters: 6, seed: 11, accuracyMeters: 8, startDwellFixes: 5 },
  },
  {
    id: 'slowstart-sparse-2s-60kmh',
    description: 'First 60 m at 4 m/s (1 Hz), then 1 fix/2 s at 60 km/h',
    trace: { speedMps: 16.7, intervalMs: 2000, slowStartMeters: 60 },
  },
  {
    id: 'slowstart-very-sparse-5s-50kmh',
    description: 'First 60 m at 4 m/s (1 Hz), then 1 fix/5 s at 50 km/h',
    trace: { speedMps: 13.9, intervalMs: 5000, slowStartMeters: 60 },
  },
  {
    id: 'slowstart-outage-pin15-1hz-40kmh',
    description: 'GPS lost 80 m before → 80 m after PIN 15, 1 fix/s, 40 km/h',
    trace: { speedMps: 11.1, intervalMs: 1000, slowStartMeters: 60, outageAroundPins: [[15, 80, 80]] },
  },
]
