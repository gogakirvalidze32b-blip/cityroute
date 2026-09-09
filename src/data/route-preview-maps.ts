/** Official MIA-style static route maps (yellow band) for exam preview. */
export type RouteOfficialPreviewMap = {
  src: string
  alt: string
  width: number
  height: number
}

export const ROUTE_OFFICIAL_PREVIEW_MAPS: Partial<Record<string, RouteOfficialPreviewMap>> = {
  'route-1': {
    src: '/routes/route-1-official-map.png',
    alt: 'მარშრუტი 1 — ოფიციალური საგამოცდო რუკა, ყვითელი ზოლი',
    width: 1209,
    height: 672,
  },
  'route-2': {
    src: '/routes/route-2-official-map.png',
    alt: 'მარშრუტი 2 — ოფიციალური საგამოცდო რუკა, ყვითელი ზოლი',
    width: 1206,
    height: 670,
  },
  'route-3': {
    src: '/routes/route-3-official-map.png',
    alt: 'მარშრუტი 3 — ოფიციალური საგამოცდო რუკა, ყვითელი ზოლი',
    width: 1213,
    height: 673,
  },
  'route-4': {
    src: '/routes/route-4-official-map.png',
    alt: 'მარშრუტი 4 — ოფიციალური საგამოცდო რუკა, ყვითელი ზოლი',
    width: 1210,
    height: 674,
  },
  'route-5': {
    src: '/routes/route-5-official-map.png',
    alt: 'მარშრუტი 5 — ოფიციალური საგამოცდო რუკა, ყვითელი ზოლი',
    width: 1209,
    height: 672,
  },
}

export function getRouteOfficialPreviewMap(slug: string): RouteOfficialPreviewMap | null {
  return ROUTE_OFFICIAL_PREVIEW_MAPS[slug] ?? null
}
