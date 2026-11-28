import { Polyline } from 'react-leaflet'
import type { PathOptions } from 'leaflet'
import type { LatLng } from '@/lib/gps'

type Variant = 'active' | 'passed' | 'preview' | 'pins' | 'navigation'

type Layer = Pick<PathOptions, 'color' | 'weight' | 'opacity' | 'className'>

const ROUND = { lineJoin: 'round' as const, lineCap: 'round' as const }

/**
 * Stacked stroke layers per variant, bottom → top. Every layer draws the SAME
 * positions; only colour / width / opacity differ (visual only).
 */
const LAYERS: Record<Variant, readonly Layer[]> = {
  preview: [
    { color: 'rgba(15, 23, 42, 0.22)', weight: 9, opacity: 1, className: 'route-line route-line--shadow' },
    { color: '#ffffff', weight: 6, opacity: 1, className: 'route-line' },
    { color: '#22c55e', weight: 4, opacity: 1, className: 'route-line' },
  ],
  active: [
    { color: 'rgba(15, 23, 42, 0.22)', weight: 8, opacity: 1, className: 'route-line route-line--shadow' },
    { color: '#ffffff', weight: 5, opacity: 1, className: 'route-line' },
    { color: '#22c55e', weight: 3.5, opacity: 1, className: 'route-line' },
  ],
  passed: [
    { color: 'rgba(15, 23, 42, 0.22)', weight: 7, opacity: 1, className: 'route-line route-line--shadow' },
    { color: '#e2e8f0', weight: 4.5, opacity: 1, className: 'route-line' },
    { color: '#94a3b8', weight: 3, opacity: 1, className: 'route-line' },
  ],
  // Route preview map: Google-Maps-style blue with white casing.
  pins: [
    { color: 'rgba(26, 58, 110, 0.18)', weight: 15, opacity: 1, className: 'route-line route-line--shadow' },
    { color: '#ffffff', weight: 10.5, opacity: 1, className: 'route-line' },
    { color: '#1a73e8', weight: 7, opacity: 1, className: 'route-line' },
  ],
  // Live drive map: glowing turquoise on dark navy — soft wide glow, thin navy
  // edge (keeps contrast on light street tiles), bright core, subtle highlight.
  navigation: [
    { color: '#22e3e0', weight: 20, opacity: 0.1, className: 'route-line route-line--glow' },
    { color: '#22e3e0', weight: 12, opacity: 0.2, className: 'route-line route-line--glow' },
    { color: '#0b2a3d', weight: 8.5, opacity: 0.75, className: 'route-line route-line--edge' },
    { color: '#2ee8e2', weight: 5.5, opacity: 1, className: 'route-line route-line--core' },
    { color: '#c9fffb', weight: 1.6, opacity: 0.85, className: 'route-line route-line--highlight' },
  ],
}

type Props = {
  positions: LatLng[]
  variant?: Variant
}

/** Route line drawn as stacked strokes (shadow / glow, casing, coloured core). */
export function RoutePolyline({ positions, variant = 'preview' }: Props) {
  if (positions.length < 2) return null

  return (
    <>
      {LAYERS[variant].map((layer, index) => (
        <Polyline
          key={index}
          positions={positions}
          interactive={false}
          // Keep every rounded-corner sample — Leaflet's default smoothFactor (1)
          // simplifies hairpin arcs back into a sharp V at navigation zoom.
          smoothFactor={0}
          noClip={true}
          pathOptions={{ ...layer, ...ROUND }}
        />
      ))}
    </>
  )
}
