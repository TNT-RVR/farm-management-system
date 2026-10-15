import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, LineString } from 'geojson'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { farmMapCenter } from '@/lib/farm-setup'
import type { PlaceGeometry } from '@/lib/checklist-map'

/**
 * The map behind a map checklist: pins and pipelines in the colour of their
 * kind of job (pump out, blow out, drains itself…), with how far along each
 * is drawn over it — a dark outline not started, amber started, faded with a
 * white outline done — so the job colour never changes. Tap one to open it. The template editor uses the same
 * map with drawing turned on — click to drop a pin, click along a pipeline and
 * double-click (or Finish) to end it.
 */
export type MapPlace = { id: string; name: string; geojson: PlaceGeometry; colour: string; status?: 'done' | 'partial' | 'todo' }
export type DrawMode = 'none' | 'pin' | 'line'

const SRC = 'ck-places'
const DRAFT = 'ck-draft'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

function toFc(places: MapPlace[], selected: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: places.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: p.geojson,
      properties: { id: p.id, name: p.name, colour: p.colour, status: p.status ?? 'none', selected: p.id === selected ? 1 : 0 },
    })),
  }
}

export function ChecklistPlacesMap({
  places,
  selected,
  onSelect,
  draw = 'none',
  onAddPin,
  onFinishLine,
  className,
}: {
  places: MapPlace[]
  selected: string | null
  onSelect: (id: string | null) => void
  draw?: DrawMode
  onAddPin?: (lngLat: [number, number]) => void
  onFinishLine?: (line: LineString) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  // The line being drawn belongs to the mode it was started in, so leaving
  // line mode (or coming back to it) never shows a half-drawn leftover.
  const [drafting, setDrafting] = useState<{ mode: DrawMode; pts: [number, number][] }>({ mode: 'none', pts: [] })
  const draft = useMemo(() => (drafting.mode === draw && draw === 'line' ? drafting.pts : []), [drafting, draw])
  const setDraft = (f: (pts: [number, number][]) => [number, number][]) =>
    setDrafting((d) => ({ mode: live.current.draw, pts: f(d.mode === live.current.draw ? d.pts : []) }))
  const fitted = useRef(false)
  // Handlers are bound once; they read the current values through this.
  const live = useRef({ draw, onSelect, onAddPin, onFinishLine, draft, finish: () => {} })
  useEffect(() => {
    live.current = {
      draw,
      onSelect,
      onAddPin,
      onFinishLine,
      draft,
      finish: () => {
        if (draft.length >= 2) onFinishLine?.({ type: 'LineString', coordinates: draft })
        setDrafting({ mode: 'none', pts: [] })
      },
    }
  })

  useEffect(() => {
    if (!ref.current) return
    const map = new maplibregl.Map({ container: ref.current, style: SATELLITE_STYLE, center: farmMapCenter(), zoom: 12, attributionControl: false })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right')
    map.doubleClickZoom.disable()
    map.on('load', () => {
      map.addSource(SRC, { type: 'geojson', data: EMPTY })
      map.addSource(DRAFT, { type: 'geojson', data: EMPTY })
      // The outline says how far along it is; the line itself keeps its job colour.
      const outline: maplibregl.ExpressionSpecification = [
        'case',
        ['==', ['get', 'selected'], 1], '#facc15',
        ['==', ['get', 'status'], 'done'], '#ffffff',
        ['==', ['get', 'status'], 'partial'], '#f59e0b',
        '#111827',
      ]
      const faded: maplibregl.ExpressionSpecification = ['case', ['==', ['get', 'status'], 'done'], 0.4, 1]
      map.addLayer({ id: 'ck-line-case', type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': outline, 'line-width': ['case', ['==', ['get', 'selected'], 1], 10, 7], 'line-opacity': ['case', ['==', ['get', 'status'], 'done'], 0.9, 0.75] } })
      map.addLayer({ id: 'ck-line', type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': ['get', 'colour'], 'line-width': ['case', ['==', ['get', 'selected'], 1], 5, 3.5], 'line-opacity': faded } })
      map.addLayer({
        id: 'ck-pin',
        type: 'circle',
        source: SRC,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': ['get', 'colour'],
          'circle-opacity': faded,
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 11, 8],
          'circle-stroke-color': ['case', ['==', ['get', 'status'], 'none'], ['case', ['==', ['get', 'selected'], 1], '#facc15', '#ffffff'], outline],
          'circle-stroke-width': 3,
        },
      })
      map.addLayer({
        id: 'ck-label',
        type: 'symbol',
        source: SRC,
        layout: {
          // Plain words, not a tick: the map's font has no ✓ glyph.
          'text-field': ['case', ['==', ['get', 'status'], 'done'], ['concat', ['get', 'name'], ' (done)'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'symbol-placement': 'point',
          'text-optional': true,
        },
        minzoom: 13,
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 1.5 },
      })
      map.addLayer({ id: 'ck-draft-line', type: 'line', source: DRAFT, paint: { 'line-color': '#38bdf8', 'line-width': 4, 'line-dasharray': [2, 1] } })
      map.addLayer({ id: 'ck-draft-pts', type: 'circle', source: DRAFT, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#38bdf8', 'circle-radius': 4 } })

      const pick = (e: MapLayerMouseEvent) => {
        if (live.current.draw !== 'none') return
        const id = e.features?.[0]?.properties?.id as string | undefined
        if (id) live.current.onSelect(id)
      }
      for (const layer of ['ck-pin', 'ck-line']) {
        map.on('click', layer, pick)
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }
      map.on('click', (e: MapMouseEvent) => {
        const { draw: mode } = live.current
        const at: [number, number] = [e.lngLat.lng, e.lngLat.lat]
        if (mode === 'pin') live.current.onAddPin?.(at)
        else if (mode === 'line') setDraft((d) => [...d, at])
        else if (!map.queryRenderedFeatures(e.point, { layers: ['ck-pin', 'ck-line'] }).length) live.current.onSelect(null)
      })
      map.on('dblclick', () => {
        if (live.current.draw === 'line') live.current.finish()
      })
      setReady(true)
    })
    mapRef.current = map
    return () => map.remove()
  }, [])

  // Places, and the first time there are any, fit the view to them.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource(SRC) as GeoJSONSource).setData(toFc(places, selected))
    if (!fitted.current && places.length) {
      const b = new maplibregl.LngLatBounds()
      for (const p of places) {
        if (p.geojson.type === 'Point') b.extend(p.geojson.coordinates as [number, number])
        else for (const c of p.geojson.coordinates) b.extend(c as [number, number])
      }
      map.fitBounds(b, { padding: 50, maxZoom: 16, duration: 0 })
      fitted.current = true
    }
  }, [places, selected, ready])

  // Fly to a place picked from the list.
  useEffect(() => {
    const map = mapRef.current
    const p = places.find((x) => x.id === selected)
    if (!map || !ready || !p) return
    const c = p.geojson.type === 'Point' ? p.geojson.coordinates : p.geojson.coordinates[Math.floor((p.geojson.coordinates.length - 1) / 2)]
    if (!map.getBounds().contains(c as [number, number])) map.easeTo({ center: c as [number, number], duration: 400 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        ...(draft.length >= 2 ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: draft }, properties: {} }] : []),
        ...draft.map((c) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c }, properties: {} })),
      ],
    }
    ;(map.getSource(DRAFT) as GeoJSONSource).setData(fc)
    map.getCanvas().style.cursor = draw === 'none' ? '' : 'crosshair'
  }, [draft, draw, ready])

  return (
    <div className={className ?? 'relative h-[60vh] min-h-[360px] w-full overflow-hidden rounded-lg border border-gray-200'}>
      {/* h-full, not absolute inset-0: maplibre's own CSS makes its container position:relative, which would collapse it to no height. */}
      <div ref={ref} className="h-full w-full" />
      {draw === 'line' && (
        <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-white/95 px-2 py-1.5 text-xs shadow">
          <span className="text-gray-700">{draft.length < 2 ? 'Click along the pipeline…' : `${draft.length} points`}</span>
          <button onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length} className="rounded border border-gray-300 px-2 py-0.5 disabled:opacity-40">
            Undo
          </button>
          <button onClick={() => live.current.finish()} disabled={draft.length < 2} className="rounded bg-brand-700 px-2 py-0.5 font-semibold text-white disabled:opacity-40">
            Finish
          </button>
        </div>
      )}
      {draw === 'pin' && <div className="absolute bottom-2 left-2 rounded-md bg-white/95 px-2 py-1.5 text-xs text-gray-700 shadow">Click the map to drop the pin.</div>}
    </div>
  )
}
