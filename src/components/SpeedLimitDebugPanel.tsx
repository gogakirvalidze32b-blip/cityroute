import { useEffect, useMemo, useState } from 'react'
import { SPEED_ZONES, type SpeedZone } from '@/data/speed-limits'
import type { GpsPosition, LatLng } from '@/lib/gps'
import { distanceToSpanM, resolveSpeedZone, zoneContainsU } from '@/lib/speed-limit'

export type GpsRejectionInfo = {
  /** Reason of the latest rejected reading; null once a later reading was accepted. */
  reason: string | null
  count: number
  accuracyM: number
}

type Props = {
  routeSlug: string
  routeId: string
  gpsStarted: boolean
  gpsError: string | null
  rawPos: GpsPosition | null
  userPos: LatLng | null
  road: readonly LatLng[] | null
  roadU: number | null
  /** The value actually shown on the scoreboard. */
  speedLimitKmh: number | null
  rejection: GpsRejectionInfo | null
}

const UNAVAILABLE = 'UNAVAILABLE'
const STALE_AFTER_S = 10

/** Why no limit is shown, derived from the same inputs and resolver the scoreboard uses. */
function explainNoLimit(
  routeSlug: string,
  userPos: LatLng | null,
  road: readonly LatLng[] | null,
  roadU: number | null,
  rejection: GpsRejectionInfo | null,
  gpsError: string | null,
): string {
  if (!userPos) {
    if (rejection?.reason) return `GPS rejected: ${rejection.reason}`
    if (gpsError) return `GPS error: ${gpsError}`
    return 'No GPS fix yet'
  }
  if (!road || road.length < 2) return 'roadU unavailable: no road trace for this route'
  if (roadU === null || !Number.isFinite(roadU)) return 'roadU unavailable: not computed yet'
  const zones = (SPEED_ZONES[routeSlug] ?? []).filter((z) => z.to <= road.length - 1)
  if (zones.length === 0) return 'Route has no speed zones'
  const covering = zones.filter((z) => zoneContainsU(z, roadU))
  if (covering.length === 0) return `Outside zone: roadU ${roadU.toFixed(2)} is not inside any zone`
  const spans = covering.map((zone) => ({ zone, ...distanceToSpanM(userPos, road, zone.from, zone.to) }))
  const within = spans.filter((s) => s.d <= s.zone.maxOffsetM)
  if (within.length === 0) {
    const s = spans.reduce((a, b) => (b.d < a.d ? b : a))
    return `Outside zone: ${s.d.toFixed(0)} m from ${s.zone.id} (max ${s.zone.maxOffsetM} m)`
  }
  const past = within.find((s) => s.beyondEnd)
  if (past) return `Past zone end: ${past.zone.id} (${past.d.toFixed(0)} m beyond the clipped end)`
  return 'Ambiguous zone: two different limits fit equally well'
}

function nearestZone(userPos: LatLng | null, road: readonly LatLng[] | null, slug: string, roadU: number | null) {
  if (!userPos || !road || road.length < 2) return null
  let best: { zone: SpeedZone; d: number } | null = null
  for (const zone of SPEED_ZONES[slug] ?? []) {
    if (zone.to > road.length - 1) continue
    const { d } = distanceToSpanM(userPos, road, zone.from, zone.to)
    if (!best || d < best.d) best = { zone, d }
  }
  return best ? { ...best, containsU: roadU !== null && zoneContainsU(best.zone, roadU) } : null
}

export function SpeedLimitDebugPanel({
  routeSlug,
  routeId,
  gpsStarted,
  gpsError,
  rawPos,
  userPos,
  road,
  roadU,
  speedLimitKmh,
  rejection,
}: Props) {
  const [open, setOpen] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const zoneInfo = useMemo(() => nearestZone(userPos, road, routeSlug, roadU), [userPos, road, routeSlug, roadU])
  const roadDistanceM = useMemo(
    () => (userPos && road && road.length >= 2 ? distanceToSpanM(userPos, road, 0, road.length - 1).d : null),
    [userPos, road],
  )
  const match = useMemo(
    () => (roadU !== null ? resolveSpeedZone(routeSlug, userPos, road, roadU) : null),
    [routeSlug, userPos, road, roadU],
  )
  const reason =
    speedLimitKmh === null ? explainNoLimit(routeSlug, userPos, road, roadU, rejection, gpsError) : null

  const fixAgeS = rawPos ? Math.max(0, Math.round((now - rawPos.timestamp) / 1000)) : null
  let gpsStatus: string
  if (gpsError) gpsStatus = `ERROR: ${gpsError}`
  else if (!gpsStarted) gpsStatus = 'NOT STARTED'
  else if (!rawPos) gpsStatus = 'WAITING FOR FIX'
  else if (rejection?.reason) gpsStatus = `LAST READING REJECTED: ${rejection.reason}`
  else if (fixAgeS !== null && fixAgeS > STALE_AFTER_S) gpsStatus = `STALE (${fixAgeS}s old)`
  else gpsStatus = 'OK'
  const gpsBad = gpsStatus !== 'OK'

  const row = (label: string, value: string, warn = false) => (
    <div className="sl-debug__row">
      <span>{label}</span>
      <strong style={warn ? { color: '#fca5a5' } : undefined}>{value}</strong>
    </div>
  )

  return (
    <aside className="sl-debug" data-testid="speed-limit-debug" aria-label="Speed limit debug">
      <button type="button" className="sl-debug__head" onClick={() => setOpen((v) => !v)}>
        <span>SPEED LIMIT DEBUG</span>
        <span className="sl-debug__limit">{speedLimitKmh === null ? 'NONE' : `${speedLimitKmh} km/h`}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="sl-debug__body">
          {row('GPS status', gpsStatus, gpsBad)}
          {row('GPS accuracy', rawPos ? `${rawPos.accuracy.toFixed(1)} m` : UNAVAILABLE)}
          {row(
            'Rejected readings',
            rejection
              ? `${rejection.count}${rejection.reason ? ` (last raw ${rejection.accuracyM.toFixed(0)} m)` : ''}`
              : '0',
          )}
          {row('Lat / Lng', userPos ? `${userPos[0].toFixed(6)}, ${userPos[1].toFixed(6)}` : UNAVAILABLE)}
          {row(
            'Last GPS fix',
            rawPos ? `${new Date(rawPos.timestamp).toLocaleTimeString()} (${fixAgeS}s ago)` : UNAVAILABLE,
          )}
          {row('Route', `${routeSlug} · ${routeId}`)}
          {row('road points', road ? String(road.length) : UNAVAILABLE)}
          {row('roadU', roadU !== null ? roadU.toFixed(3) : UNAVAILABLE)}
          {row('Dist. to road line', roadDistanceM !== null ? `${roadDistanceM.toFixed(1)} m` : UNAVAILABLE)}
          {row(
            'Nearest zone',
            zoneInfo
              ? `${zoneInfo.zone.id} [${zoneInfo.zone.limitKmh}] u ${zoneInfo.zone.from.toFixed(2)}–${zoneInfo.zone.to.toFixed(2)}`
              : UNAVAILABLE,
          )}
          {row(
            'Zone distance',
            zoneInfo ? `${zoneInfo.d.toFixed(1)} m (max ${zoneInfo.zone.maxOffsetM}) · roadU ${zoneInfo.containsU ? 'inside' : 'outside'}` : UNAVAILABLE,
          )}
          {row('Matched zone', match ? `${match.zone.id} (${match.offsetM.toFixed(1)} m)` : 'NONE')}
          {row('Final limit', speedLimitKmh === null ? 'NONE' : `${speedLimitKmh} km/h`)}
          {reason && <div className="sl-debug__reason">WHY NONE: {reason}</div>}
        </div>
      )}
    </aside>
  )
}
