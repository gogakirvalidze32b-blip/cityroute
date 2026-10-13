import { Polyline } from 'react-leaflet'
import type { LatLng } from '@/lib/gps'

type Variant = 'active' | 'passed' | 'preview' | 'pins'

const COLORS: Record<Variant, { fill: string; casing: string }> = {
  preview: { fill: '#22c55e', casing: '#ffffff' },
  active: { fill: '#22c55e', casing: '#ffffff' },
  passed: { fill: '#94a3b8', casing: '#e2e8f0' },
  pins: { fill: '#1a73e8', casing: '#ffffff' },
}

const WEIGHTS: Record<Variant, { shadow: number; casing: number; fill: number }> = {
  preview: { shadow: 9, casing: 6, fill: 4 },
  active: { shadow: 8, casing: 5, fill: 3.5 },
  passed: { shadow: 7, casing: 4.5, fill: 3 },
  pins: { shadow: 12, casing: 9, fill: 6 },
}

const ROUND = { lineJoin: 'round' as const, lineCap: 'round' as const }

type Props = {
  positions: LatLng[]
  variant?: Variant
}

/** Yandex-style route line: soft shadow, white casing, colored fill. */
export function RoutePolyline({ positions, variant = 'preview' }: Props) {
  if (positions.length < 2) return null

  const { fill, casing } = COLORS[variant]
  const w = WEIGHTS[variant]

  return (
    <>
      <Polyline
        positions={positions}
        interactive={false}
        pathOptions={{ color: 'rgba(15, 23, 42, 0.22)', weight: w.shadow, opacity: 1, ...ROUND }}
      />
      <Polyline
        positions={positions}
        interactive={false}
        pathOptions={{ color: casing, weight: w.casing, opacity: 0.98, ...ROUND }}
      />
      <Polyline
        positions={positions}
        interactive={false}
        pathOptions={{ color: fill, weight: w.fill, opacity: 0.98, ...ROUND }}
      />
    </>
  )
}
