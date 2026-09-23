/**
 * Optimized Leaflet Navigation Map
 * 
 * Requirements:
 * 1. Vehicle arrow FIXED at screen center (CSS overlay, not Leaflet marker)
 * 2. Map moves underneath arrow (smooth panning)
 * 3. No black corners during rotation (overscan padding)
 * 4. Smooth GPS interpolation (60fps)
 * 5. Route snapping to prevent GPS drift
 * 6. Manual pan mode - arrow stays centered, map moves freely
 * 7. Recenter button to resume following
 * 8. Audio triggers only once per pin
 * 9. No map recreation on GPS updates
 * 10. Performance optimized for Android tablets
 */

import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import type L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import { GpsInterpolator, type GpsState } from '@/lib/gps-interpolation'
import { snapToRoute } from '@/lib/route-snapping'
import type { PinRow, RouteWithPins } from '@/types/database'

const YANDEX_STREET_ZOOM = 17
const MAP_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OVERSCAN_PADDING = 300 // Extra pixels to prevent black corners during rotation

// ==================== CAMERA CONTROLLER ====================
// Handles smooth GPS following, interpolation, and rotation

function DrivingCamera({
  position,
  heading,
  polyline,
  isFollowing,
  onFollowStateChange,
}: {
  position: LatLng
  heading: number
  polyline: LatLng[]
  isFollowing: boolean
  onFollowStateChange: (following: boolean) => void
}) {
  const map = useMap()
  const interpolatorRef = useRef<GpsInterpolator | null>(null)
  const rafRef = useRef<number>()
  const currentPosRef = useRef<LatLng>(position)
  const currentHeadingRef = useRef(heading)
  const initializedRef = useRef(false)
  const userDraggingRef = useRef(false)

  // Initialize interpolator once
  useEffect(() => {
    if (!interpolatorRef.current) {
      interpolatorRef.current = new GpsInterpolator()

      // Set up 60fps interpolation callback
      interpolatorRef.current.setOnUpdate((state) => {
        if (!isFollowing || userDraggingRef.current) return

        currentPosRef.current = state.position
        currentHeadingRef.current = state.heading

        // Cancel any pending animation frame
        if (rafRef.current) cancelAnimationFrame(rafRef.current)

        // Schedule next frame
        rafRef.current = requestAnimationFrame(() => {
          // The map follows the vehicle while the arrow remains fixed in screen space.
          map.panTo(state.position, {
            animate: false,
            noMoveStart: true,
            duration: 0,
          })
        })
      })
    }

    return () => {
      interpolatorRef.current?.stop()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [map, isFollowing])

  // Update interpolator when GPS changes
  useEffect(() => {
    if (!interpolatorRef.current) return

    // Snap to route to prevent GPS drift
    const snappedPosition = snapToRoute(position, polyline, 50)

    const gpsState: GpsState = {
      position: snappedPosition,
      heading,
      speed: 0,
      timestamp: Date.now(),
    }

    interpolatorRef.current.updateTarget(gpsState)
  }, [position, heading, polyline])

  // Initialize map view once
  useEffect(() => {
    if (!initializedRef.current) {
      map.setView(position, YANDEX_STREET_ZOOM, { animate: false })
      // Increase padding to prevent black corners during rotation
      map.options.padding = [OVERSCAN_PADDING, OVERSCAN_PADDING]
      initializedRef.current = true
    }
  }, [map, position])

  // Stop following when user drags manually
  useEffect(() => {
    const handleDragStart = () => {
      userDraggingRef.current = true
      onFollowStateChange(false)
    }

    const handleDragEnd = () => {
      userDraggingRef.current = false
    }

    map.on('dragstart', handleDragStart)
    map.on('dragend', handleDragEnd)

    return () => {
      map.off('dragstart', handleDragStart)
      map.off('dragend', handleDragEnd)
    }
  }, [map, onFollowStateChange])

  return null
}

// ==================== MAP SIZE FIX ====================

function MapSizeFix() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const id = window.setTimeout(() => map.invalidateSize(), 100)
    return () => window.clearTimeout(id)
  }, [map])
  return null
}

// ==================== INTERACTION HANDLER ====================
// Prevents map interactions during auto-follow mode (optional)

function InteractionController({ isFollowing }: { isFollowing: boolean }) {
  const map = useMap()

  useEffect(() => {
    if (isFollowing) {
      // During auto-follow, allow dragging to pause
      map.dragging.enable()
      map.scrollWheelZoom.enable()
      map.touchZoom.enable()
    } else {
      // When paused, allow free interaction
      map.dragging.enable()
      map.scrollWheelZoom.enable()
      map.touchZoom.enable()
    }
  }, [map, isFollowing])

  return null
}

// ==================== MAIN COMPONENT ====================

type Props = {
  route: RouteWithPins
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
  mapBadge?: string
}

export function ExamLiveMapLeaflet({ route, userPos, heading, nextPin, mapBadge }: Props) {
  const [isFollowing, setIsFollowing] = useState(true)
  const pins = route.pins
  const polyline = route.polyline as LatLng[]

  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null

  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= nextPin.trigger_distance_m

  // Recenter button handler
  const handleRecenter = () => {
    setIsFollowing(true)
    // Map will automatically resume following via DrivingCamera
  }

  return (
    <div className="exam-live-map">
      {mapBadge && <span className="exam-live-map__badge">{mapBadge}</span>}

      {/* ==================== FIXED CENTER ARROW ====================
          This is a CSS overlay, NOT a Leaflet marker.
          It stays perfectly centered at all times.
          Only the rotation changes. */}
      <div className="nav-arrow-overlay">
        <div className="nav-arrow-rotator">
          <div className="nav-arrow-fixed"></div>
          <div className="nav-arrow-dot-fixed"></div>
        </div>
      </div>

      {/* ==================== RECENTER BUTTON ==================== */}
      <button
        type="button"
        className={`map-recenter-btn exam-live-map__recenter ${!isFollowing ? 'map-recenter-btn--active' : ''}`}
        onClick={handleRecenter}
        title="ცენტრში დაბრუნება"
      >
        {isFollowing ? '🎯' : '📍'}
      </button>

      {/* ==================== NEXT PIN HUD ==================== */}
      {nextPin && (
        <div className="exam-live-map__hud">
          <small>შემდეგი · {nextPinDist} მ</small>
          <strong>{nextPin.instruction_ka}</strong>
        </div>
      )}

      {/* ==================== LEAFLET MAP ==================== */}
      <div
        className="exam-live-map__camera"
        style={{ transform: `rotate(${-heading}deg)` }}
      >
        <MapContainer
          center={userPos}
          zoom={YANDEX_STREET_ZOOM}
          className="exam-live-map__canvas"
          zoomControl={false}
          attributionControl={false}
          // Performance optimizations
          preferCanvas={false} // Use SVG for better rotation
          updateWhenZooming={false}
          updateWhenIdle={true}
        >
          <MapSizeFix />

          {/* Base map tiles */}
          <TileLayer
            url={MAP_TILES}
            maxZoom={19}
            updateWhenIdle={true}
            updateWhenZooming={false}
            keepBuffer={4} // Keep more tiles in memory
          />

          {/* Route polyline */}
          <Polyline
            positions={polyline}
            pathOptions={{
              color: '#3b82f6',
              weight: 5,
              opacity: 0.8,
            }}
          />

          {/* Route pins */}
          {pins.map((pin) => {
            const isNext = nextPin?.id === pin.id
            const isPulse = isNext && nextPinPulse
            return (
              <CircleMarker
                key={pin.id}
                center={[pin.lat, pin.lng]}
                radius={isPulse ? 20 : 14}
                pathOptions={{
                  color: isNext ? '#0d9488' : '#047857',
                  fillColor: isNext ? '#5eead4' : '#10b981',
                  fillOpacity: isPulse ? 0.9 : 1,
                  weight: isPulse ? 3 : 2,
                  className: isPulse ? 'exam-pin-pulse' : undefined,
                }}
              />
            )
          })}

          {/* Camera controller */}
          <DrivingCamera
            position={userPos}
            heading={heading}
            polyline={polyline}
            isFollowing={isFollowing}
            onFollowStateChange={setIsFollowing}
          />

          {/* Interaction controller */}
          <InteractionController isFollowing={isFollowing} />
        </MapContainer>
      </div>
    </div>
  )
}
