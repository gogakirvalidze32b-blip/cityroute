import { useCallback, useEffect, useRef, useState } from 'react'
import type { RouteOfficialPreviewMap } from '@/data/route-preview-maps'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const DEFAULT_ZOOM = 1
const ZOOM_STEP = 0.25

type Pan = { x: number; y: number }

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function touchDistance(a: React.Touch, b: React.Touch) {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.hypot(dx, dy)
}

type Props = {
  map: RouteOfficialPreviewMap
}

export function OfficialRoutePreviewZoom({ map }: Props) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null)
  const lastTapRef = useRef(0)

  const applyZoom = useCallback((next: number | ((current: number) => number)) => {
    setZoom((current) => {
      const value = clampZoom(typeof next === 'function' ? next(current) : next)
      if (value <= MIN_ZOOM) {
        setPan({ x: 0, y: 0 })
      }
      return value
    })
  }, [])

  const resetView = useCallback(() => {
    setZoom(DEFAULT_ZOOM)
    setPan({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      applyZoom((current) => current + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' && event.isPrimary === false) return
    if (zoom <= MIN_ZOOM) return
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    setPan({
      x: drag.panX + event.clientX - drag.startX,
      y: drag.panY + event.clientY - drag.startY,
    })
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      dragRef.current = null
      setDragging(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }
  }

  function onTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length === 2) {
      pinchRef.current = {
        distance: touchDistance(event.touches[0], event.touches[1]),
        zoom,
      }
    }
  }

  function onTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2 || !pinchRef.current) return
    event.preventDefault()
    const distance = touchDistance(event.touches[0], event.touches[1])
    const ratio = distance / pinchRef.current.distance
    applyZoom(pinchRef.current.zoom * ratio)
  }

  function onTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length < 2) {
      pinchRef.current = null
    }

    if (event.touches.length > 0 || event.changedTouches.length !== 1) return

    const now = Date.now()
    if (now - lastTapRef.current < 280) {
      applyZoom((current) => (current > MIN_ZOOM + 0.05 ? MIN_ZOOM : 2))
      lastTapRef.current = 0
      return
    }
    lastTapRef.current = now
  }

  return (
    <div className="exam-preview__map exam-preview__map--official" aria-label={map.alt}>
      <div
        ref={viewportRef}
        className={`exam-preview__official-viewport${dragging ? ' exam-preview__official-viewport--dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="exam-preview__official-backdrop" aria-hidden="true">
          <img
            className="exam-preview__official-backdrop-img"
            src={map.src}
            alt=""
            width={map.width}
            height={map.height}
            loading="eager"
            decoding="async"
            draggable={false}
          />
        </div>
        <div
          className="exam-preview__official-stage"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <img
            className="exam-preview__official-img"
            src={map.src}
            alt={map.alt}
            width={map.width}
            height={map.height}
            loading="eager"
            decoding="async"
            draggable={false}
          />
        </div>

        <div className="exam-preview__zoom-controls" aria-label="რუკის ზუმი">
          <button
            type="button"
            className="exam-preview__zoom-btn"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => applyZoom((z) => z + ZOOM_STEP)}
            aria-label="გადიდება"
          >
            +
          </button>
          <button
            type="button"
            className="exam-preview__zoom-btn"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => applyZoom((z) => z - ZOOM_STEP)}
            aria-label="დაპატარავება"
          >
            −
          </button>
          <button
            type="button"
            className="exam-preview__zoom-btn exam-preview__zoom-btn--reset"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={resetView}
            aria-label="საწყისი ზომა"
          >
            ⟲
          </button>
        </div>

        <p className="exam-preview__zoom-hint">ორი თითი · +/- · ორჯერ შეხება</p>
      </div>
    </div>
  )
}
