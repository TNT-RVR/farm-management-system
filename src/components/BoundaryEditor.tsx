import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, MultiPolygon, Position } from 'geojson'
import { X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { largestRing } from '@/lib/geo/rings'
import { PolygonDraw, type DrawState } from '@/lib/geo/polygon-draw'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { farmMapCenter } from '@/lib/farm-setup'

const SRC = 'boundary-others'
const LINE = 'boundary-others-line'

const EMPTY: DrawState = { count: 0, acres: 0, mode: 'draw', selected: null, closed: false }

function boundsOfRing(ring: Position[]): maplibregl.LngLatBounds | null {
  if (!ring.length) return null
  const b = new maplibregl.LngLatBounds()
  for (const p of ring) b.extend([p[0], p[1]])
  return b
}

/**
 * Draw or redraw one field's boundary on the satellite image.
 *
 * Not the shared Modal, which is a form width. A boundary is drawn by eye
 * against field edges and a road, and doing that in a 28rem box means panning
 * instead of looking.
 *
 * Saving goes through replace_boundary, which supersedes the old boundary
 * rather than overwriting it: the acres of past years stay attached to the
 * shape those years were actually farmed on.
 */
export function BoundaryEditor({
  fieldId,
  fieldName,
  existing,
  centre,
  others,
  onClose,
}: {
  fieldId: string
  fieldName: string
  existing: MultiPolygon | null
  /** Where to open when the field has no boundary yet — [lng, lat]. */
  centre: [number, number] | null
  /** Neighbouring boundaries, drawn faintly so edges can be matched to them. */
  others?: MultiPolygon[]
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const drawRef = useRef<PolygonDraw | null>(null)
  const [ready, setReady] = useState(false)
  const [draw, setDraw] = useState<DrawState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  /**
   * Frozen at open, deliberately.
   *
   * Saving invalidates the boundary queries, the page re-renders with the new
   * boundary, and `existing` and `centre` change under a dialog that is still
   * mounted. That re-ran the effect that owns the map — tearing down the map
   * while the draw tool still held a reference to it, which is what crashed the
   * screen after a successful save. Nothing about an editing session should
   * depend on data that arrives during it.
   */
  const [frozen] = useState(() => ({ existing, centre }))
  const startRing = useMemo(() => largestRing(frozen.existing), [frozen])
  const openCentre = frozen.centre

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const start = startRing ? boundsOfRing(startRing) : null
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: openCentre ?? farmMapCenter(),
      // Close enough that field edges are visible without hunting for them.
      zoom: openCentre || start ? 15 : 11,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      if (start) map.fitBounds(start, { padding: 60, duration: 0 })
      setReady(true)
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [openCentre, startRing])

  // The neighbours, so an edge can be matched to the one beside it rather than
  // guessed at from the imagery alone.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !others?.length) return
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: others.map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
    }
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    if (src) {
      src.setData(data)
      return
    }
    map.addSource(SRC, { type: 'geojson', data })
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SRC,
      paint: {
        'line-color': '#38bdf8',
        'line-width': 1.5,
        'line-opacity': 0.7,
        'line-dasharray': [2, 2],
      },
    })
  }, [ready, others])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const d = new PolygonDraw(map, { color: '#facc15', onChange: setDraw })
    d.start(startRing ?? undefined)
    drawRef.current = d
    return () => {
      d.destroy()
      drawRef.current = null
    }
  }, [ready, startRing])

  const save = async () => {
    const mp = drawRef.current?.finish()
    if (!mp) {
      setError('A boundary needs at least three corners.')
      return
    }
    setSaving(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('replace_boundary', {
      p_field_id: fieldId,
      p_geojson: mp as unknown as Json,
      p_source: 'drawn',
    })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    // Close FIRST, then refetch. The other way round re-renders the page under
    // a dialog that is still open, and the refreshed boundary lands on the
    // component that drew it.
    onClose()
    // Acres are generated in the database, and half the app reads them through
    // one boundary query or another.
    void queryClient.invalidateQueries({ queryKey: ['boundaries'] })
    void queryClient.invalidateQueries({ queryKey: ['fields'] })
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/50 p-2 md:p-4">
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {existing ? 'Edit boundary' : 'Draw boundary'} — {fieldName}
            </h2>
            <p className="text-xs text-gray-500">
              {existing
                ? 'Drag a corner to move it, drag a hollow midpoint to add one, tap a corner to select and delete it. Saving replaces the current boundary; the old one is kept against the years it applied to.'
                : 'Click each corner. Click the first corner again to close the shape, then adjust it.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={containerRef} className="h-full w-full" />
          {/* The acreage as it is drawn. "Is that about a quarter" is the
              question being asked while drawing it, and it cannot be answered
              from a shape on a screen. */}
          <div className="absolute bottom-3 left-1/2 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-md border border-yellow-300 bg-white px-2.5 py-2 text-xs shadow-lg">
            <span className="text-gray-700">
              {!draw.closed
                ? draw.count < 3
                  ? `Click the corners (${draw.count}/3)`
                  : `${draw.count} corners · click the first to close`
                : `${draw.count} corners`}
            </span>
            <span className="font-medium tabular-nums text-gray-900">
              {draw.acres > 0 ? `${draw.acres.toFixed(1)} ac` : '—'}
            </span>
            <button
              onClick={() => drawRef.current?.undoLast()}
              disabled={draw.count === 0}
              className="rounded px-2 py-1 text-gray-600 disabled:opacity-40"
            >
              Undo
            </button>
            <button
              onClick={() => drawRef.current?.deleteSelected()}
              disabled={draw.selected == null || draw.count <= 3}
              className="rounded px-2 py-1 text-gray-600 disabled:opacity-40"
              title={
                draw.selected == null
                  ? 'Tap a corner to select it'
                  : draw.count <= 3
                    ? 'Three corners is the fewest a shape can have'
                    : 'Delete the selected corner'
              }
            >
              Delete corner
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-2.5">
          {error && <span className="text-xs text-red-700">{error}</span>}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || draw.count < 3}
              className={cn(
                'rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white',
                'hover:bg-brand-800 disabled:opacity-50',
              )}
            >
              {saving
                ? 'Saving…'
                : `Save boundary${draw.acres > 0 ? ` (${draw.acres.toFixed(1)} ac)` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
