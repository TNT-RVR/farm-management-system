import { useEffect, useMemo, useRef, useState } from 'react'
import { cropColour } from '@/lib/crop-colour'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import type { MultiPolygon } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Pencil, Scissors, Trash2, X } from 'lucide-react'
import { Select } from '@/components/Select'
import { useCrops } from '@/lib/queries'
import { useCropZoneMutations, useFieldCropZones } from '@/lib/cropZones'
import { boundsOf, multiPolygonAcres } from '@/lib/geo/area'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { PolygonDraw, type DrawState } from '@/lib/geo/polygon-draw'

const EMPTY_DRAW: DrawState = { count: 0, acres: 0, mode: 'draw', selected: null, closed: false }
import { type Cut, cutEndpoints, cutFromPoints, splitByLine } from '@/lib/geo/split-line'
import { cn } from '@/lib/utils'
import { farmMapCenter } from '@/lib/farm-setup'

const a2 = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

export function CropSplitEditor({
  field,
  boundary,
  cropYear,
  onClose,
}: {
  field: { id: string; name: string }
  boundary: MultiPolygon
  cropYear: number
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const drawRef = useRef<PolygonDraw | null>(null)
  const [ready, setReady] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [draw, setDraw] = useState<DrawState>(EMPTY_DRAW)
  const [cropId, setCropId] = useState('')
  // 'draw' traces a shape freehand; 'cut' slices the whole field with one
  // straight line at the planting angle. Both write the same crop zones.
  const [mode, setMode] = useState<'draw' | 'cut'>('draw')
  const [cut, setCut] = useState<Cut>({ bearingDeg: 0, offsetM: 0 })
  const [cutCropRight, setCutCropRight] = useState('')
  const [cutCropLeft, setCutCropLeft] = useState('')
  // First click of a drag-to-set; the second completes the line.
  const [dragFrom, setDragFrom] = useState<[number, number] | null>(null)

  const { data: crops } = useCrops()
  const { data: zones } = useFieldCropZones(field.id, cropYear)
  const { add, update, remove } = useCropZoneMutations()

  const fieldAcres = useMemo(() => multiPolygonAcres(boundary), [boundary])
  const split = useMemo(() => splitByLine(boundary, cut), [boundary, cut])
  const rightAcres = split.right ? multiPolygonAcres(split.right) : 0
  const leftAcres = split.left ? multiPolygonAcres(split.left) : 0
  // A line that misses the field leaves one side empty; saving that would
  // create a zone covering the whole field and a second covering nothing.
  const cutDivides = Boolean(split.right && split.left && rightAcres > 0.1 && leftAcres > 0.1)
  const cropMap = useMemo(() => new Map((crops ?? []).map((c) => [c.id, c])), [crops])
  const cropOptions = (crops ?? [])
    .filter((c) => c.active)
    .map((c) => ({ value: c.id, label: c.name }))
  const assigned = (zones ?? []).reduce((s, z) => s + Number(z.acres ?? 0), 0)
  const remaining = fieldAcres - assigned

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 12,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map
    map.on('load', () => {
      map.addSource('field-boundary', {
        type: 'geojson',
        data: { type: 'Feature', geometry: boundary, properties: {} },
      })
      map.addLayer({
        id: 'field-line',
        type: 'line',
        source: 'field-boundary',
        paint: { 'line-color': '#ffffff', 'line-width': 2.5 },
      })
      map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.45 },
      })
      map.addLayer({
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
      })
      map.addSource('cut-preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'cut-fill',
        type: 'fill',
        source: 'cut-preview',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 },
      })
      map.addSource('cut-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'cut-line-layer',
        type: 'line',
        source: 'cut-line',
        paint: { 'line-color': '#fbbf24', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
      })
      const b = boundsOf(boundary)
      if (b) map.fitBounds(b, { padding: 40, duration: 0 })
      setReady(true)
    })
    return () => {
      drawRef.current?.destroy()
      map.remove()
      mapRef.current = null
    }
  }, [boundary])

  // Repaint zone overlays when zones change.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const fc = {
      type: 'FeatureCollection' as const,
      features: (zones ?? [])
        .filter((z) => z.geojson)
        .map((z) => ({
          type: 'Feature' as const,
          geometry: z.geojson as unknown as MultiPolygon,
          properties: { color: cropColour(cropMap.get(z.crop_id)) },
        })),
    }
    const src = mapRef.current.getSource('zones') as GeoJSONSource | undefined
    src?.setData(fc)
  }, [zones, ready, cropMap])

  // Repaint the two halves and the cut line whenever the cut changes.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    const show = mode === 'cut'
    const feats = !show
      ? []
      : [
          split.right && {
            type: 'Feature' as const,
            geometry: split.right,
            properties: { color: cropColour(cropMap.get(cutCropRight)) },
          },
          split.left && {
            type: 'Feature' as const,
            geometry: split.left,
            properties: { color: cropColour(cropMap.get(cutCropLeft)) },
          },
        ].filter(Boolean)
    ;(map.getSource('cut-preview') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: feats as never[],
    })
    const [a, b] = cutEndpoints(cut, boundary)
    ;(map.getSource('cut-line') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: show
        ? [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: [a, b] },
              properties: {},
            },
          ]
        : [],
    })
  }, [ready, mode, cut, split, boundary, cropMap, cutCropRight, cutCropLeft])

  // Two clicks set the line: the bearing and offset are read back off it, so
  // dragging and typing are two handles on one value rather than two features.
  useEffect(() => {
    if (!ready || !mapRef.current || mode !== 'cut') return
    const map = mapRef.current
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      setDragFrom((from) => {
        if (!from) return pt
        setCut(cutFromPoints(from, pt, boundary))
        return null
      })
    }
    map.on('click', onClick)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', onClick)
      map.getCanvas().style.cursor = ''
    }
  }, [ready, mode, boundary])

  const saveCut = () => {
    if (!cutDivides || !split.right || !split.left) return
    if (cutCropRight) {
      add.mutate({
        field_id: field.id,
        crop_year: cropYear,
        crop_id: cutCropRight,
        acres: Math.round(rightAcres * 100) / 100,
        geojson: split.right,
        source: 'drawn',
      })
    }
    if (cutCropLeft) {
      add.mutate({
        field_id: field.id,
        crop_year: cropYear,
        crop_id: cutCropLeft,
        acres: Math.round(leftAcres * 100) / 100,
        geojson: split.left,
        source: 'drawn',
      })
    }
    setMode('draw')
    setDragFrom(null)
  }

  const startDraw = () => {
    if (!cropId || !mapRef.current) return
    const d = new PolygonDraw(mapRef.current, {
      color: cropColour(cropMap.get(cropId)),
      onChange: setDraw,
    })
    d.start()
    drawRef.current = d
    setDrawing(true)
    setDraw(EMPTY_DRAW)
  }
  const finishDraw = () => {
    const geom = drawRef.current?.finish() ?? null
    if (geom && cropId) {
      const acres = Math.round(multiPolygonAcres(geom) * 100) / 100
      add.mutate({
        field_id: field.id,
        crop_year: cropYear,
        crop_id: cropId,
        acres,
        geojson: geom,
        source: 'drawn',
      })
    }
    drawRef.current?.destroy()
    drawRef.current = null
    setDrawing(false)
    setDraw(EMPTY_DRAW)
  }
  const cancelDraw = () => {
    drawRef.current?.destroy()
    drawRef.current = null
    setDrawing(false)
    setDraw(EMPTY_DRAW)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40 sm:flex-row">
      {/* Map */}
      <div className="relative min-h-0 flex-1">
        {/* h-full, not absolute inset-0: maplibre-gl.css makes the map position: relative, and the inset then gives it no height. */}
        <div ref={containerRef} className="h-full w-full" />
        {mode === 'cut' && (
          <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
            {dragFrom
              ? 'Click the far end of the line'
              : 'Click two points to lay the line, or type the angle below'}
          </div>
        )}
        {drawing && (
          <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
            Click the map to trace {cropMap.get(cropId)?.name ?? 'the crop'} — {draw.count} point
            {draw.count === 1 ? '' : 's'}
            {draw.closed
              ? ' · drag the corners to adjust'
              : draw.count >= 3
                ? ' · click the first point to close'
                : ' (need 3+)'}
            {draw.acres > 0 && (
              <span className="ml-1.5 font-semibold tabular-nums">
                {draw.acres < 1 ? draw.acres.toFixed(2) : draw.acres.toFixed(1)} ac
              </span>
            )}
          </div>
        )}
      </div>

      {/* Panel */}
      <div className="flex w-full shrink-0 flex-col bg-white sm:w-80">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Crop split · {field.name}</h2>
            <p className="text-xs text-gray-500">
              {cropYear} · field {a2(fieldAcres)} ac
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Acres summary */}
          <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md bg-gray-50 p-2">
              <p className="text-gray-500">Field</p>
              <p className="font-bold tabular-nums text-gray-900">{a2(fieldAcres)}</p>
            </div>
            <div className="rounded-md bg-gray-50 p-2">
              <p className="text-gray-500">Assigned</p>
              <p className="font-bold tabular-nums text-gray-900">{a2(assigned)}</p>
            </div>
            <div className={cn('rounded-md p-2', remaining < -1 ? 'bg-red-50' : 'bg-gray-50')}>
              <p className="text-gray-500">Left</p>
              <p
                className={cn(
                  'font-bold tabular-nums',
                  remaining < -1 ? 'text-red-700' : 'text-gray-900',
                )}
              >
                {a2(remaining)}
              </p>
            </div>
          </div>

          {/* Zone list */}
          <div className="space-y-1.5">
            {(zones ?? []).map((z) => (
              <div
                key={z.id}
                className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-sm"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: cropColour(cropMap.get(z.crop_id)) }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {cropMap.get(z.crop_id)?.name ?? 'Crop'}
                </span>
                {!z.geojson && <span className="text-[10px] text-gray-400">acres only</span>}
                <input
                  type="number"
                  step="0.1"
                  defaultValue={z.acres ?? 0}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== Number(z.acres)) update.mutate({ id: z.id, patch: { acres: v } })
                  }}
                  className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right text-xs tabular-nums"
                />
                <span className="text-xs text-gray-400">ac</span>
                <button
                  onClick={() => remove.mutate(z.id)}
                  className="text-gray-300 hover:text-red-600"
                  aria-label="Delete zone"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {(zones ?? []).length === 0 && (
              <p className="py-4 text-center text-xs text-gray-400">
                No crop zones yet. Add one below.
              </p>
            )}
          </div>
        </div>

        {/* Add-zone controls */}
        <div className="border-t border-gray-200 p-4">
          {mode === 'cut' ? (
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <label className="flex-1 text-[11px] font-medium text-gray-500">
                  Angle (&deg;)
                  <input
                    type="number"
                    value={cut.bearingDeg}
                    onChange={(e) => setCut((c) => ({ ...c, bearingDeg: Number(e.target.value) }))}
                    className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums"
                  />
                </label>
                <label className="flex-1 text-[11px] font-medium text-gray-500">
                  Offset (m)
                  <input
                    type="number"
                    step="10"
                    value={cut.offsetM}
                    onChange={(e) => setCut((c) => ({ ...c, offsetM: Number(e.target.value) }))}
                    className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums"
                  />
                </label>
              </div>
              <p className="text-[11px] text-gray-400">
                Angle is the planting bearing; offset slides the line sideways from the middle of
                the field. Zero cuts through the centre.
              </p>

              <div className="space-y-1.5 rounded-md bg-gray-50 p-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full bg-sky-400" />
                  <Select
                    value={cutCropRight}
                    onChange={setCutCropRight}
                    ariaLabel="Crop on one side"
                    placeholder="Crop&hellip;"
                    size="sm"
                    className="flex-1"
                    options={cropOptions}
                  />
                  <span className="w-16 text-right text-xs tabular-nums text-gray-600">
                    {a2(rightAcres)} ac
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full bg-violet-400" />
                  <Select
                    value={cutCropLeft}
                    onChange={setCutCropLeft}
                    ariaLabel="Crop on the other side"
                    placeholder="Crop&hellip;"
                    size="sm"
                    className="flex-1"
                    options={cropOptions}
                  />
                  <span className="w-16 text-right text-xs tabular-nums text-gray-600">
                    {a2(leftAcres)} ac
                  </span>
                </div>
              </div>

              {!cutDivides && (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  This line misses the field, so there is only one side. Move the offset until both
                  sides show acres.
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={saveCut}
                  disabled={!cutDivides || (!cutCropRight && !cutCropLeft)}
                  className="flex-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
                >
                  Save {cutCropRight && cutCropLeft ? 'both zones' : 'zone'}
                </button>
                <button
                  onClick={() => {
                    setMode('draw')
                    setDragFrom(null)
                  }}
                  className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : drawing ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => (draw.closed ? finishDraw() : drawRef.current?.close())}
                  disabled={draw.count < 3}
                  className="flex-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
                >
                  {draw.closed ? 'Save zone' : 'Close shape'}
                </button>
                {draw.closed ? (
                  <button
                    onClick={() => drawRef.current?.deleteSelected()}
                    disabled={draw.selected == null || draw.count <= 3}
                    className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
                  >
                    Del pt
                  </button>
                ) : (
                  <button
                    onClick={() => drawRef.current?.undoLast()}
                    className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Undo pt
                  </button>
                )}
                <button
                  onClick={cancelDraw}
                  className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Select
                value={cropId}
                onChange={setCropId}
                ariaLabel="Crop to draw"
                placeholder="Pick a crop…"
                className="flex-1"
                options={cropOptions}
              />
              <button
                onClick={startDraw}
                disabled={!cropId}
                className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
              >
                <Pencil className="h-3.5 w-3.5" /> Draw
              </button>
              <button
                onClick={() => setMode('cut')}
                title="Split the whole field with one straight line at the planting angle"
                className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Scissors className="h-3.5 w-3.5" /> Cut
              </button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-400">
            <b>Draw</b> traces one crop&rsquo;s area freehand. <b>Cut</b> slices the whole field
            with a straight line at the planting angle, which is how most splits here are actually
            made. Acres are measured from the shape; edit the number to fine-tune. Zones feed the
            rotation&rsquo;s acres-by-crop totals and give each side its own water balance.
          </p>
        </div>
      </div>
    </div>
  )
}
