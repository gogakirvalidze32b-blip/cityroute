import type { GpsPosition } from './gps'

export interface PreviewGpsSource {
  getCurrentPosition(): Promise<GpsPosition>
  watchPosition(
    onUpdate: (position: GpsPosition) => void,
    onError?: (error: GeolocationPositionError) => void,
  ): () => void
  publish(position: GpsPosition): void
  clear(): void
}

export function createPreviewGpsSource(): PreviewGpsSource {
  let currentPosition: GpsPosition | null = null
  let nextWatchId = 0
  const watchers = new Map<number, (position: GpsPosition) => void>()

  return {
    async getCurrentPosition() {
      if (!currentPosition) throw new Error('DEMO GPS has no starting fix')
      return currentPosition
    },
    watchPosition(onUpdate) {
      const id = ++nextWatchId
      watchers.set(id, onUpdate)
      return () => {
        watchers.delete(id)
      }
    },
    publish(position) {
      currentPosition = position
      watchers.forEach((onUpdate) => onUpdate(position))
    },
    clear() {
      currentPosition = null
    },
  }
}
