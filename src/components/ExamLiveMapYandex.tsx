import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createNavArrowLayout,
  createPinLayout,
  getYandexMapsApiKey,
  loadYandexMaps,
  toYandex21Coords,
  YANDEX_STREET_ZOOM,
} from '@/lib/yandex-maps'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import type { YMaps21GeoObject, YMaps21Map } from '@/types/yandex-maps-21-global'
import type { PinRow, RouteWithPins } from '@/types/database'

type MapLayers = {
  trigger?: YMaps21GeoObject
  pin?: YMaps21GeoObject
  user?: YMaps21GeoObject
}

type Props = {
  route: RouteWithPins
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
  onFallback?: (reason: string) => void
}

export function ExamLiveMapYandex({ userPos, heading: _heading, nextPin, onFallback }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<YMaps21Map | null>(null)
  const layersRef = useRef<MapLayers>({})
  const ymapsRef = useRef<NonNullable<typeof window.ymaps> | null>(null)
  const [followPaused, setFollowPaused] = useState(false)
  const [ready, setReady] = useState(false)

  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  const nextPinPulse = nextPin != null

  useEffect(() => {
    const apiKey = getYandexMapsApiKey()
    const container = containerRef.current
    if (!apiKey || !container) return

    let cancelled = false

    loadYandexMaps(apiKey)
      .then((ymaps) => {
        if (cancelled || !containerRef.current) return

        ymapsRef.current = ymaps
        const map = new ymaps.Map(
          containerRef.current,
          {
            center: toYandex21Coords(userPos),
            zoom: YANDEX_STREET_ZOOM,
            controls: [],
          },
          {
            suppressMapOpenBlock: true,
            yandexMapDisablePoiInteractivity: true,
          },
        )

        map.events.add('actionbegin', (event) => {
          const action = event.get('action')
          if (action === 'drag' || action === 'scrollZoom') setFollowPaused(true)
        })

        const userMarker = new ymaps.Placemark(
          toYandex21Coords(userPos),
          {},
          {
            iconLayout: createNavArrowLayout(ymaps),
            iconShape: { type: 'Circle', coordinates: [0, 0], radius: 18 },
            zIndex: 1000,
          },
        )
        map.geoObjects.add(userMarker)

        mapRef.current = map
        layersRef.current = { user: userMarker }
        setReady(true)
      })
      .catch((error: Error) => {
        onFallback?.(error.message || 'Yandex load failed')
      })

    return () => {
      cancelled = true
      setReady(false)
      mapRef.current?.destroy()
      mapRef.current = null
      ymapsRef.current = null
      layersRef.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map init once per mount
  }, [onFallback])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || followPaused) return
    map.setCenter(toYandex21Coords(userPos), YANDEX_STREET_ZOOM, { duration: 200 })
  }, [userPos, followPaused, ready])

  useEffect(() => {
    const map = mapRef.current
    const ymaps = ymapsRef.current
    if (!map || !ymaps || !ready) return

    const layers = layersRef.current

    if (layers.trigger) map.geoObjects.remove(layers.trigger)
    if (layers.pin) map.geoObjects.remove(layers.pin)

    if (!nextPin) {
      layers.trigger = undefined
      layers.pin = undefined
      return
    }

    layers.trigger = new ymaps.Circle(
      [toYandex21Coords([nextPin.lat, nextPin.lng]), nextPin.trigger_distance_m],
      {},
      {
        fillColor: 'rgba(20, 184, 166, 0.12)',
        strokeColor: '#14b8a6',
        strokeWidth: 2,
      },
    )
    map.geoObjects.add(layers.trigger)

    layers.pin = new ymaps.Placemark(
      toYandex21Coords([nextPin.lat, nextPin.lng]),
      {},
      {
        iconLayout: createPinLayout(ymaps, Boolean(nextPinPulse)),
        iconShape: { type: 'Circle', coordinates: [0, 0], radius: 12 },
        zIndex: 500,
      },
    )
    map.geoObjects.add(layers.pin)
  }, [nextPin, nextPinPulse, ready])

  useEffect(() => {
    layersRef.current.user?.geometry?.setCoordinates(toYandex21Coords(userPos))
  }, [userPos])

  return (
    <div className="exam-live-map">
      <span className="exam-live-map__badge">Yandex</span>
      {followPaused && (
        <button type="button" className="map-recenter-btn exam-live-map__recenter" onClick={() => setFollowPaused(false)}>
          ⊕ ცენტრში
        </button>
      )}

      {nextPin && (
        <div className="exam-live-map__hud">
          <small>შემდეგი · {nextPinDist} მ</small>
          <strong>{nextPin.instruction_ka}</strong>
        </div>
      )}

      <div ref={containerRef} className="exam-live-map__canvas exam-live-map__canvas--yandex" />
    </div>
  )
}
