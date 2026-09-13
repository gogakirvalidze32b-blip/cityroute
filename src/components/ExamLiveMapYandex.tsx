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
  pinObjects?: YMaps21GeoObject[]
  user?: YMaps21GeoObject
}

type Props = {
  route: RouteWithPins
  pins: PinRow[]
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
  onFallback?: (reason: string) => void
}

export function ExamLiveMapYandex({ pins, userPos, heading: _heading, nextPin, onFallback }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<YMaps21Map | null>(null)
  const layersRef = useRef<MapLayers>({})
  const ymapsRef = useRef<NonNullable<typeof window.ymaps> | null>(null)
  const [followPaused, setFollowPaused] = useState(false)
  const [ready, setReady] = useState(false)

  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  
  // პინი იციმციმოს მხოლოდ როცა ძალიან ახლოს ხარ (trigger distance-ის ფარგლებში)
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= nextPin.trigger_distance_m

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

    // Remove old pin objects
    if (layers.pinObjects) {
      layers.pinObjects.forEach((obj) => map.geoObjects.remove(obj))
      layers.pinObjects = []
    }

    if (!pins || pins.length === 0) return

    layers.pinObjects = []

    // Render all pins with trigger zones
    pins.forEach((pin) => {
      const isNext = nextPin?.id === pin.id
      const isPulse = isNext && Boolean(nextPinPulse)

      // Trigger zone circle
      const trigger = new ymaps.Circle(
        [toYandex21Coords([pin.lat, pin.lng]), pin.trigger_distance_m],
        {},
        {
          fillColor: isNext ? 'rgba(20, 184, 166, 0.12)' : 'rgba(16, 185, 129, 0.08)',
          strokeColor: isNext ? '#14b8a6' : '#10b981',
          strokeWidth: isNext ? 2 : 1.5,
        },
      )
      map.geoObjects.add(trigger)
      layers.pinObjects.push(trigger)

      // Pin marker
      const pinMarker = new ymaps.Placemark(
        toYandex21Coords([pin.lat, pin.lng]),
        {},
        {
          iconLayout: createPinLayout(ymaps, isPulse),
          iconShape: { type: 'Circle', coordinates: [0, 0], radius: 12 },
          zIndex: isNext ? 500 : 400,
        },
      )
      map.geoObjects.add(pinMarker)
      layers.pinObjects.push(pinMarker)
    })
  }, [pins, nextPin, nextPinPulse, ready])

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
