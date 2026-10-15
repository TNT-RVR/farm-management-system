import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Maximize2 } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MultiPolygon, Polygon } from 'geojson'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { farmMapCenter } from '@/lib/farm-setup'

/**
 * The field, at the top of its own page.
 *
 * A field page opens on a list of numbers, and the first question anybody has
 * about a field is "which one is that" — a shape answers it faster than a legal
 * land description does. Small, satellite, boundary outlined, framed to the
 * field and left there.
 *
 * Deliberately not interactive beyond a scroll-free zoom: it is a photograph,
 * not a tool. The full editor is one click away and this must not become a
 * second, worse version of it — nor steal a page scroll on a phone.
 */
export function FieldMapSnapshot({
  boundary,
  name,
  fieldId,
  className,
}: {
  boundary: Polygon | MultiPolygon | null | undefined
  name: string
  /** Clicking through opens the main map on this field. */
  fieldId: string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !boundary) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 11,
      attributionControl: false,
      // A map that eats the page scroll is a map people fight with on a phone.
      scrollZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: false,
    })
    map.dragPan.disable()
    map.doubleClickZoom.disable()
    map.keyboard.disable()

    map.on('load', () => {
      map.addSource('field', { type: 'geojson', data: boundary })
      map.addLayer({
        id: 'field-fill',
        type: 'fill',
        source: 'field',
        paint: { 'fill-color': '#facc15', 'fill-opacity': 0.12 },
      })
      map.addLayer({
        id: 'field-line',
        type: 'line',
        source: 'field',
        paint: { 'line-color': '#facc15', 'line-width': 2.5 },
      })

      // Frame the field itself rather than guessing a zoom: fields here run
      // from a few acres to a whole section.
      const bounds = new maplibregl.LngLatBounds()
      const rings =
        boundary.type === 'Polygon' ? boundary.coordinates : boundary.coordinates.flat()
      for (const ring of rings)
        for (const [lng, lat] of ring) bounds.extend([lng, lat] as [number, number])
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 24, duration: 0 })
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [boundary])

  if (!boundary)
    return (
      <div
        className={`flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-400 ${className ?? ''}`}
      >
        No boundary drawn for {name} yet.
      </div>
    )

  // The whole thing is the link. Panning is disabled above precisely so that a
  // press anywhere on it means one thing, and the full map is where you go to
  // do anything with it.
  return (
    <Link
      to={`/map?field=${fieldId}`}
      aria-label={`Open ${name} on the main map`}
      className={`group relative block h-40 w-full overflow-hidden rounded-lg border border-gray-200 sm:h-56 ${className ?? ''}`}
    >
      <div ref={containerRef} className="pointer-events-none h-full w-full" />
      <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white opacity-90 group-hover:opacity-100">
        <Maximize2 className="h-3 w-3" />
        Open on the map
      </span>
    </Link>
  )
}
