export type MapTileLayer = {
  url: string
  subdomains?: string
  maxNativeZoom?: number
  maxZoom?: number
  opacity?: number
}

export type MapTilesDefinition = {
  layers: MapTileLayer[]
  attribution: string
  maxNativeZoom: number
  maxZoom: number
  keepBuffer?: number
}

/** OpenStreetMap standard tiles — no API key required. */
export const MAP_TILES: MapTilesDefinition = {
  layers: [
    {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      subdomains: 'abc',
    },
  ],
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxNativeZoom: 20,
  maxZoom: 20,
  keepBuffer: 8,
}

export const MAP_TILE_HOSTS = [
  'https://a.tile.openstreetmap.org',
  'https://b.tile.openstreetmap.org',
  'https://c.tile.openstreetmap.org',
] as const
