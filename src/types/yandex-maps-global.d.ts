/** Minimal Yandex Maps JS API 3 globals (loaded from CDN). */
declare global {
  interface Window {
    ymaps3?: YMaps3Api
  }
}

export type YMapsLocation = {
  center: [number, number]
  zoom: number
  rotation?: number
}

export type YMapsEntity = {
  update?(props: Record<string, unknown>): void
  destroy?(): void
}

export type YMaps3Api = {
  ready: Promise<void>
  YMap: new (
    container: HTMLElement,
    props: { location: YMapsLocation; showScaleInCopyrights?: boolean },
    children?: unknown[],
  ) => YMapsEntity & {
    addChild(child: unknown): void
    removeChild(child: unknown): void
    update(props: { location?: YMapsLocation }, opts?: { duration?: number }): void
  }
  YMapDefaultSchemeLayer: new (props?: Record<string, unknown>) => unknown
  YMapDefaultFeaturesLayer: new (props?: Record<string, unknown>) => unknown
  YMapFeature: new (props: {
    geometry:
      | { type: 'LineString'; coordinates: [number, number][] }
      | { type: 'Polygon'; coordinates: [number, number][][] }
    style?: {
      stroke?: Array<{ color: string; width: number }>
      fill?: string
    }
  }) => YMapsEntity
  YMapMarker: new (
    props: { coordinates: [number, number]; zIndex?: number },
    element: HTMLElement,
  ) => YMapsEntity & { update?(props: { coordinates: [number, number] }): void }
}

export {}
