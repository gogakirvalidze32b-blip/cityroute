/**
 * Chainage-migration baseline capture (test-only).
 *
 * Captures everything the driver experiences that the kilometre-based PIN
 * migration must NOT change: PIN positions (after the production
 * applyRelocatedPin remap), order, instruction text, audio mapping, trigger
 * radii, route geometry and speed-limit bands.
 *
 * The committed snapshot `pin-route-baseline.json` was generated from the code
 * as it was BEFORE the migration started (2026-11-27). Never regenerate it to
 * make a test pass — a difference means behaviour changed.
 */
import { createHash } from 'node:crypto'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyRelocatedPin } from '@/hooks/useRoutes'
import {
  enrichPinsWithLocalAudio,
  EXAM_FINISH_AUDIO,
  EXAM_START_AUDIO,
  EXAM_SUCCESS_AUDIO,
} from '@/data/route-audio'
import { examMapRouteLines, examRoadTrace, examRouteLine } from '@/lib/pin-route-line'
import { pinAudioTriggerDistanceMeters, pinVoicePlaybackRate } from '@/lib/pin-audio'
import { SPEED_KM_BANDS } from '@/data/speed-km-bands'
import { prepareRouteGeometry, type ActiveRouteId } from '@/lib/pure-route-geometry'

export const BASELINE_ROUTES = ['route-1', 'route-2', 'route-3', 'route-4'] as const

type Line = readonly (readonly [number, number])[]

export function lineHash(line: Line): string {
  return createHash('sha256').update(JSON.stringify(line)).digest('hex').slice(0, 16)
}

export type BaselinePin = {
  id: string
  sort_order: number
  lat: number
  lng: number
  instruction_ka: string
  audio_url: string | null
  trigger_distance_m: number
  radius_m: number
  audio_trigger_distance_m: number
  playback_rate: number
}

export type BaselineRoute = {
  slug: string
  pinCount: number
  pins: BaselinePin[]
  /** route.polyline (official / hard-coded coarse path). */
  polyline: { hash: string; points: number }
  /** examRouteLine — matching / chainage / HUD km geometry. */
  examRouteLine: { hash: string; points: number; lengthMeters: number; coordinates: Line }
  /** examMapRouteLines — what the live map draws. */
  examMapRouteLines: { hash: string; lines: number; coordinates: Line[] }
  /** examRoadTrace — bundled street road (null when a PIN is >40 m off it). */
  examRoadTrace: { hash: string | null; points: number }
  speedKmBands: unknown
}

export type MigrationBaseline = {
  sessionAudio: { start: string; finish: string; success: string }
  routes: BaselineRoute[]
}

export function currentProductionRoutes() {
  // Production path: useRoutes() → applyRelocatedPin(TELAVI_ROUTES_FALLBACK); local pins win.
  return applyRelocatedPin(TELAVI_ROUTES_FALLBACK)
}

export function captureBaseline(): MigrationBaseline {
  const routes = currentProductionRoutes()
  return {
    sessionAudio: { start: EXAM_START_AUDIO, finish: EXAM_FINISH_AUDIO, success: EXAM_SUCCESS_AUDIO },
    routes: BASELINE_ROUTES.map((slug) => {
      const route = routes.find((item) => item.slug === slug)!
      const sorted = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const voice = enrichPinsWithLocalAudio(slug, sorted)
      const matchLine = examRouteLine(slug, sorted) as unknown as Line
      const mapLines = examMapRouteLines(slug, sorted) as unknown as Line[]
      const road = examRoadTrace(slug, sorted) as unknown as Line | null
      const geometry = prepareRouteGeometry(slug as ActiveRouteId, matchLine)
      return {
        slug,
        pinCount: voice.length,
        pins: voice.map((pin) => ({
          id: pin.id,
          sort_order: pin.sort_order,
          lat: pin.lat,
          lng: pin.lng,
          instruction_ka: pin.instruction_ka,
          audio_url: pin.audio_url,
          trigger_distance_m: pin.trigger_distance_m,
          radius_m: pin.radius_m,
          audio_trigger_distance_m: pinAudioTriggerDistanceMeters(slug, pin.sort_order),
          playback_rate: pinVoicePlaybackRate(slug, pin.sort_order),
        })),
        polyline: { hash: lineHash(route.polyline as Line), points: route.polyline.length },
        examRouteLine: {
          hash: lineHash(matchLine),
          points: matchLine.length,
          lengthMeters: geometry.totalLengthMeters,
          coordinates: matchLine.map(([lat, lng]) => [lat, lng] as const),
        },
        examMapRouteLines: {
          hash: lineHash(mapLines.flat()),
          lines: mapLines.length,
          coordinates: mapLines.map((line) => line.map(([lat, lng]) => [lat, lng] as const)),
        },
        examRoadTrace: { hash: road ? lineHash(road) : null, points: road?.length ?? 0 },
        speedKmBands: SPEED_KM_BANDS[slug],
      }
    }),
  }
}
