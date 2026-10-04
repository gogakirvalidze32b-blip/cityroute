/** Yandex Maps JavaScript API 2.1 (loaded from CDN). */
declare global {
  interface Window {
    ymaps?: YMaps21Api
  }
}

export type YMaps21GeoObject = {
  geometry?: { setCoordinates: (coords: number[]) => void }
}

export type YMaps21Map = {
  geoObjects: {
    add: (obj: unknown) => void
    remove: (obj: unknown) => void
  }
  setCenter: (center: number[], zoom?: number, options?: { duration?: number }) => void
  events: {
    add: (event: string, handler: (event: { get: (key: string) => unknown }) => void) => void
  }
  destroy: () => void
}

export type YMaps21Api = {
  ready: (callback: () => void) => void
  Map: new (
    element: HTMLElement,
    state: { center: number[]; zoom: number; controls?: string[] },
    options?: Record<string, unknown>,
  ) => YMaps21Map
  Polyline: new (
    geometry: number[][],
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => YMaps21GeoObject
  Circle: new (
    geometry: [number[], number],
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => YMaps21GeoObject
  Placemark: new (
    geometry: number[],
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => YMaps21GeoObject
  templateLayoutFactory: {
    createClass: (html: string) => unknown
  }
}

export {}
