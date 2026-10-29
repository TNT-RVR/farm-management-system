import { useEffect, useRef } from 'react'
import maplibregl, { type MapMouseEvent } from 'maplibre-gl'
import { useFarmMap } from '@/lib/geo/use-farm-map'
import type { FuelTank } from '@/lib/fuel-data'
import type { FuelProduct } from '@/lib/fuel-supplier-invoice'

/** The colour each fuel is dyed or known by: farm diesel red, marked gas purple. */
export const FUEL_COLOUR: Record<FuelProduct, string> = {
  farm_diesel: '#dc2626',
  clear_diesel: '#ca8a04',
  gasoline: '#16a34a',
  farm_gasoline: '#9333ea',
  other: '#64748b',
}

const placed = (t: FuelTank) => t.lat != null && t.lng != null

/** A pin: a dot in the fuel's colour with the tank's name under it. */
function pinElement(t: FuelTank, draggable: boolean) {
  const el = document.createElement('div')
  el.style.cssText = `display:flex;flex-direction:column;align-items:center;cursor:${draggable ? 'grab' : 'pointer'}`
  const dot = document.createElement('div')
  dot.style.cssText = `width:18px;height:18px;border-radius:9999px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);background:${FUEL_COLOUR[t.product]}`
  const label = document.createElement('div')
  label.textContent = t.level_l == null ? t.name : `${t.name} · ${Math.round((100 * t.level_l) / t.capacity_l)}%`
  label.style.cssText =
    'margin-top:2px;padding:0 4px;border-radius:4px;background:rgba(255,255,255,.9);font:600 11px system-ui,sans-serif;color:#111;white-space:nowrap'
  el.append(dot, label)
  return el
}

/**
 * Where the fuel tanks are. A manager drags a pin to move it, or picks a tank
 * to place and clicks the map; clicking a pin opens the tank.
 */
export function FuelTankMap({
  tanks,
  isManager,
  placing,
  onPlace,
  onOpen,
}: {
  tanks: FuelTank[]
  isManager: boolean
  /** The tank waiting for a click on the map, if any. */
  placing: FuelTank | null
  onPlace: (id: string, lat: number, lng: number) => void
  onOpen: (t: FuelTank) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const framed = useRef(false)
  // Read inside map handlers, which are bound once.
  const placingRef = useRef(placing)
  const onPlaceRef = useRef(onPlace)
  const onOpenRef = useRef(onOpen)
  useEffect(() => {
    placingRef.current = placing
    onPlaceRef.current = onPlace
    onOpenRef.current = onOpen
  })

  const { mapRef, ready } = useFarmMap(box, {
    zoom: 14,
    onCreate: (map) =>
      map.on('click', (e: MapMouseEvent) => {
        const t = placingRef.current
        if (t) onPlaceRef.current(t.id, Number(e.lngLat.lat.toFixed(6)), Number(e.lngLat.lng.toFixed(6)))
      }),
  })

  useEffect(() => {
    const map = mapRef.current
    if (map) map.getCanvas().style.cursor = placing ? 'crosshair' : ''
  }, [mapRef, placing])

  // The pins, redrawn whenever a tank changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const markers = tanks.filter(placed).map((t) => {
      const el = pinElement(t, isManager)
      el.title = isManager ? `${t.name}: drag to move, click to open` : t.name
      const m = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, -9], draggable: isManager }).setLngLat([t.lng!, t.lat!]).addTo(map)
      let moved = false
      m.on('dragstart', () => (moved = true))
      m.on('dragend', () => {
        const p = m.getLngLat()
        onPlaceRef.current(t.id, Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)))
      })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        if (moved) {
          moved = false
          return
        }
        onOpenRef.current(t)
      })
      return m
    })
    return () => markers.forEach((m) => m.remove())
  }, [mapRef, tanks, ready, isManager])

  // Frame the pins once, when they first arrive.
  useEffect(() => {
    const map = mapRef.current
    const pts = tanks.filter(placed)
    if (!map || !ready || framed.current || !pts.length) return
    framed.current = true
    const b = new maplibregl.LngLatBounds()
    for (const t of pts) b.extend([t.lng!, t.lat!])
    map.fitBounds(b, { padding: 60, maxZoom: 17, duration: 0 })
  }, [mapRef, tanks, ready])

  return (
    <div className="relative overflow-hidden rounded-md border border-gray-200">
      {/* A set height, not absolute: an absolute container measures 0 high and the map never draws. */}
      <div ref={box} style={{ height: 280 }} />
      {placing && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="rounded-full bg-gray-900/80 px-3 py-1 text-xs font-medium text-white">Click the map where {placing.name} sits</span>
        </div>
      )}
    </div>
  )
}
