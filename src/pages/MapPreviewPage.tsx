import { useMemo, useState } from 'react'
import { ExamLiveMapLeaflet } from '@/components/ExamLiveMapLeaflet'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyRelocatedPin } from '@/hooks/useRoutes'
import { examRoadTrace, examRouteLine } from '@/lib/pin-route-line'
import { advanceRoadProgressU, resolveSpeedLimit } from '@/lib/speed-limit'
import type { LatLng } from '@/lib/gps'

const SLUGS = ['route-1', 'route-2', 'route-3', 'route-4']

function bearing(from: LatLng, to: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLng = rad(to[1] - from[1])
  const y = Math.sin(dLng) * Math.cos(rad(to[0]))
  const x =
    Math.cos(rad(from[0])) * Math.sin(rad(to[0])) -
    Math.sin(rad(from[0])) * Math.cos(rad(to[0])) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const barStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 2000,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  background: 'rgba(15, 23, 42, 0.92)',
  color: '#fff',
  fontSize: 14,
}

export function MapPreviewPage() {
  const routes = useMemo(
    () => applyRelocatedPin(TELAVI_ROUTES_FALLBACK).filter((r) => SLUGS.includes(r.slug)),
    [],
  )
  const [slug, setSlug] = useState('route-2')
  const [index, setIndex] = useState(0)

  const route = routes.find((r) => r.slug === slug) ?? routes[0]
  const pins = useMemo(() => [...route.pins].sort((a, b) => a.sort_order - b.sort_order), [route])
  const sortedRoute = useMemo(() => ({ ...route, pins }), [route, pins])
  const lineLength = useMemo(() => examRouteLine(route.slug, pins).length, [route.slug, pins])

  const safeIndex = Math.min(index, pins.length - 1)
  const pin = pins[safeIndex]
  const nextPin = pins[safeIndex + 1] ?? null
  const userPos: LatLng = [pin.lat, pin.lng]
  const road = useMemo(() => examRoadTrace(route.slug, pins), [route.slug, pins])
  // Preview steps pins in route order — accumulate u so revisited streets pick the right pass.
  const speedRoadU = useMemo(() => {
    if (!road) return null
    let u: number | null = null
    for (let i = 0; i <= safeIndex; i += 1) {
      u = advanceRoadProgressU([pins[i].lat, pins[i].lng], road, u)
    }
    return u
  }, [road, pins, safeIndex])
  const speedLimit = resolveSpeedLimit(route.slug, userPos, road, speedRoadU)
  const heading = nextPin
    ? bearing(userPos, [nextPin.lat, nextPin.lng])
    : safeIndex > 0
      ? bearing([pins[safeIndex - 1].lat, pins[safeIndex - 1].lng], userPos)
      : 0

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <ExamLiveMapLeaflet
        key={route.slug}
        route={sortedRoute}
        userPos={userPos}
        heading={heading}
        nextPin={nextPin}
        hasGpsFix
        mapBadge={`${route.name_ka} · PIN ${pin.sort_order}`}
      />
      <div style={barStyle}>
        {SLUGS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSlug(s)
              setIndex(0)
            }}
            style={{ fontWeight: s === route.slug ? 700 : 400 }}
          >
            R{i + 1}
          </button>
        ))}
        <button type="button" onClick={() => setIndex(Math.max(0, safeIndex - 1))} disabled={safeIndex === 0}>
          ← წინა PIN
        </button>
        <button
          type="button"
          onClick={() => setIndex(Math.min(pins.length - 1, safeIndex + 1))}
          disabled={safeIndex >= pins.length - 1}
        >
          შემდეგი PIN →
        </button>
        <input
          type="range"
          min={0}
          max={pins.length - 1}
          value={safeIndex}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label="PIN"
        />
        <span>
          PIN {pin.sort_order} / {pins.length} · ხაზი: {lineLength} წერტილი · ლიმიტი:{' '}
          <strong>{speedLimit === null ? '—' : `${speedLimit} კმ/სთ`}</strong>
        </span>
      </div>
    </div>
  )
}
