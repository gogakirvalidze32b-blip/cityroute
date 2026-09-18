/**
 * Route Snapping Library
 * 
 * Snaps GPS positions to the nearest point on the route polyline
 * to prevent jitter and keep the arrow on the road.
 */

import nearestPointOnLine from '@turf/nearest-point-on-line'
import { lineString, point } from '@turf/helpers'
import type { LatLng } from './gps'

/**
 * Snap a GPS position to the nearest point on the route
 * 
 * @param position - Current GPS position [lat, lng]
 * @param route - Route polyline [[lat, lng], ...]
 * @param maxDistanceMeters - Maximum distance to snap (default: 50m)
 * @returns Snapped position or original if too far from route
 */
export function snapToRoute(
  position: LatLng,
  route: LatLng[],
  maxDistanceMeters = 50
): LatLng {
  if (!route || route.length < 2) {
    return position
  }

  try {
    // Convert route to GeoJSON LineString (turf expects [lng, lat] format)
    const line = lineString(route.map(([lat, lng]) => [lng, lat]))
    
    // Convert position to GeoJSON Point
    const pt = point([position[1], position[0]])
    
    // Find nearest point on line
    const snapped = nearestPointOnLine(line, pt, { units: 'meters' })
    
    // Check if within max distance
    const distanceKm = snapped.properties.dist ?? 0
    const distanceMeters = distanceKm * 1000
    
    if (distanceMeters <= maxDistanceMeters) {
      // Return snapped position [lat, lng]
      const [lng, lat] = snapped.geometry.coordinates
      return [lat, lng]
    }
    
    // Too far from route, return original position
    return position
  } catch (error) {
    console.warn('Route snapping failed:', error)
    return position
  }
}

/**
 * Calculate distance from position to route in meters
 */
export function distanceToRoute(position: LatLng, route: LatLng[]): number {
  if (!route || route.length < 2) {
    return Infinity
  }

  try {
    const line = lineString(route.map(([lat, lng]) => [lng, lat]))
    const pt = point([position[1], position[0]])
    const snapped = nearestPointOnLine(line, pt, { units: 'meters' })
    const distanceKm = snapped.properties.dist ?? 0
    return distanceKm * 1000
  } catch (error) {
    console.warn('Distance calculation failed:', error)
    return Infinity
  }
}

/**
 * Check if position is on route (within threshold)
 */
export function isOnRoute(
  position: LatLng,
  route: LatLng[],
  thresholdMeters = 50
): boolean {
  const distance = distanceToRoute(position, route)
  return distance <= thresholdMeters
}
