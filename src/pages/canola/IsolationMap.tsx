import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { GeoJSONSource } from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { useFarmMap } from '@/lib/geo/use-farm-map'
import { bboxOf } from '@/lib/canola-isolation-core'

export type MapQuarter = {
  parcel: string
  /** "SW 35-39-28" over "Canola" — what is printed in the quarter. */
  label: string
  ring: [number, number][]
  kind: 'canola' | 'labelled' | 'ours' | 'pasture' | 'blank'
}

export type IsolationMapHandle = {
  /** The map as it is drawn now, as a PNG, for the report. */
  capture: () => Promise<{ dataUrl: string; width: number; height: number } | null>
}

const FILL: Record<MapQuarter['kind'], string> = { canola: '#facc15', labelled: '#38bdf8', ours: '#22c55e', pasture: '#bef264', blank: '#9ca3af' }

/**
 * The isolation map: satellite under the seed canola field (white), the mile
 * around it (dashed), and every quarter it reaches, coloured by what is on it
 * — canola yellow, our own green, pasture lime, a neighbour labelled blue,
 * unlabelled grey —
 * with its legal land and crop printed in it. A quarter is picked by clicking.
 */
export const IsolationMap = forwardRef<IsolationMapHandle, {
  field: Geometry | null
  area: Geometry | null
  quarters: MapQuarter[]
  selected: string | null
  onSelect: (parcel: string) => void
  className?: string
}>(function IsolationMap({ field, area, quarters, selected, onSelect, className }, ref) {
  const el = useRef<HTMLDivElement>(null)
  const pick = useRef(onSelect)
  useEffect(() => {
    pick.current = onSelect
  }, [onSelect])

  const { mapRef: map, ready } = useFarmMap(el, {
    center: [-113.55, 52.4],
    zoom: 11,
    attribution: 'compact',
    preserveDrawingBuffer: true,
    onReady: (m) => {
      const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
      m.addSource('quarters', { type: 'geojson', data: empty })
      m.addSource('area', { type: 'geojson', data: empty })
      m.addSource('field', { type: 'geojson', data: empty })
      m.addLayer({ id: 'q-fill', type: 'fill', source: 'quarters', paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': ['case', ['==', ['get', 'kind'], 'blank'], 0.08, 0.32] } })
      m.addLayer({ id: 'q-line', type: 'line', source: 'quarters', paint: { 'line-color': ['case', ['get', 'selected'], '#f97316', '#ffffff'], 'line-width': ['case', ['get', 'selected'], 3, 1], 'line-opacity': 0.85 } })
      m.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [3, 2] } })
      m.addLayer({ id: 'field-fill', type: 'fill', source: 'field', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.15 } })
      m.addLayer({ id: 'field-line', type: 'line', source: 'field', paint: { 'line-color': '#ef4444', 'line-width': 3 } })
      m.addLayer({
        id: 'q-label',
        type: 'symbol',
        source: 'quarters',
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 9, 'text-allow-overlap': false },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 1.4 },
      })
      m.on('click', 'q-fill', (e) => {
        const p = e.features?.[0]?.properties?.parcel
        if (typeof p === 'string') pick.current(p)
      })
      m.on('mouseenter', 'q-fill', () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', 'q-fill', () => (m.getCanvas().style.cursor = ''))
    },
  })

  useImperativeHandle(ref, () => ({
    capture: () =>
      new Promise((resolve) => {
        const m = map.current
        if (!m) return resolve(null)
        // Read the canvas inside a render, while the frame is still in it.
        m.once('render', () => {
          try {
            const c = m.getCanvas()
            resolve({ dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height })
          } catch {
            resolve(null)
          }
        })
        m.triggerRepaint()
      }),
  }))

  // The data, whenever it changes (and once the style has loaded).
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })
    ;(m.getSource('quarters') as GeoJSONSource | undefined)?.setData(
      fc(
        quarters.map((q) => ({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [q.ring] },
          properties: { parcel: q.parcel, label: q.label, kind: q.kind, fill: FILL[q.kind], selected: q.parcel === selected },
        })),
      ),
    )
    ;(m.getSource('area') as GeoJSONSource | undefined)?.setData(fc(area ? [{ type: 'Feature', geometry: area, properties: {} }] : []))
    ;(m.getSource('field') as GeoJSONSource | undefined)?.setData(fc(field ? [{ type: 'Feature', geometry: field, properties: {} }] : []))
  }, [map, ready, quarters, area, field, selected])

  // Fit the mile when a new field is chosen.
  useEffect(() => {
    const m = map.current
    const b = area ? bboxOf(area) : null
    if (!m || !ready || !b) return
    m.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 24, duration: 0 })
  }, [map, ready, area])

  return <div ref={el} className={className} />
})
