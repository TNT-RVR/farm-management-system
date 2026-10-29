import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { Select } from '@/components/Select'
import { HoverTip } from '@/components/HoverTip'
import { useFarmMap } from '@/lib/geo/use-farm-map'
import { destination } from '@/lib/geo/circle'
import { haversineM } from '@/lib/geo/measure'
import { boundariesForYear, useAllBoundaries, useFields } from '@/lib/queries'
import { useCropYear } from '@/lib/crop-year'
import { NDVI_RAMP, useFieldImagery } from '@/lib/pastures'
import { FIELDNET_LEGEND, IRRIGATION_LEGEND, IRRIGATION_STATUS, LAYER_INFO, NOT_SCHEDULED_COLOUR } from '@/lib/map-layer-info'
import { SOIL_NO_DATA_COLOUR, SOIL_WATER_BANDS } from '@/lib/soil-landscape'
import { useYieldZones, yieldBands } from '@/lib/yield-zones'
import { useLatestBalance } from '@/lib/irrigation'
import { FN_STATUS_COLOR, FN_STATUS_LABEL, fnStatus, useFieldnetSystems, useFieldnetSystemsOn } from '@/lib/fieldnet'
import { asOfDay } from '@/lib/map-as-of'
import { bestPerField, colourStops, radiusStops, rampSteps, useTopoCells, useTopoSurfaces, REM_COLOURS } from '@/lib/topography'
import { colourStops as plStops } from '@/lib/profit-loss'
import { money } from '@/lib/profit-loss-lines'
import { useFarmBooks } from '@/lib/use-farm-books'
import { SoilLayer } from '@/pages/map/SoilLayer'
import { YieldZoneLayer } from '@/pages/map/YieldZoneLayer'
import { cn } from '@/lib/utils'

/**
 * Compare (Sam, 29 Oct 2026): the map split into two to four panes, to look
 * at one field through several layers at once, or at several fields through
 * the same layer. Pick the way round at the top; the panes follow.
 *
 *   One field, several layers   pick a field, tick up to four layers
 *   Several fields, one layer   pick up to four fields and one layer
 *
 * Each pane is its own small map framed on its field. The satellite, AIMM and
 * FieldNET panes follow the day picked beside the tabs, as the main map does.
 * Each pane is keyed by its field and layer, so changing either builds it new
 * and nothing of the last layer is left behind.
 */

const LAYERS = [
  ['photo', 'Satellite photo'],
  ['ndvi', 'NDVI'],
  ['ndre', 'NDRE'],
  ['aimm', 'Irrigation (AIMM)'],
  ['fieldnet', 'Pivots (FieldNET)'],
  ['yield', 'Productivity zones'],
  ['soil', 'Soil survey'],
  ['topography', 'Topography'],
  ['profit', 'Profit / Loss'],
] as const
type Layer = (typeof LAYERS)[number][0]
const LAYER_LABEL = Object.fromEntries(LAYERS) as Record<Layer, string>
const MAX_PANES = 4

type Geometry = GeoJSON.Geometry

export function ComparePage() {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: allBoundaries } = useAllBoundaries()
  const [params] = useSearchParams()
  const asOf = asOfDay(params.get('on'), new Date().toLocaleDateString('en-CA'))

  const shapes = useMemo(() => {
    const m = new Map<string, Geometry>()
    for (const b of boundariesForYear(allBoundaries ?? [], cropYear)) m.set(b.field_id, b.geometry as unknown as Geometry)
    return m
  }, [allBoundaries, cropYear])
  const mapped = useMemo(() => (fields ?? []).filter((f) => shapes.has(f.id)), [fields, shapes])
  const nameOf = (id: string) => mapped.find((f) => f.id === id)?.name ?? 'Field'

  const [mode, setMode] = useState<'layers' | 'fields'>('layers')
  const [field, setField] = useState('')
  const [layers, setLayers] = useState<Layer[]>(['photo', 'ndvi'])
  const [pickedFields, setPickedFields] = useState<string[]>([])
  const [layer, setLayer] = useState<Layer>('ndvi')

  const oneField = field || mapped[0]?.id || ''
  const panes =
    mode === 'layers'
      ? oneField
        ? layers.map((l) => ({ fieldId: oneField, layer: l }))
        : []
      : pickedFields.map((f) => ({ fieldId: f, layer }))

  const toggleLayer = (l: Layer) =>
    setLayers((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : ls.length < MAX_PANES ? [...ls, l] : ls))

  const chip = (on: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs font-medium',
      on ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
    )

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-gray-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-gray-200 p-0.5 text-xs">
            {(
              [
                ['layers', 'One field, several layers'],
                ['fields', 'Several fields, one layer'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn('rounded px-2.5 py-1 font-medium', mode === m ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-100')}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'layers' ? (
            <Select size="sm" ariaLabel="Field" value={oneField} onChange={setField} options={mapped.map((f) => ({ value: f.id, label: f.name }))} />
          ) : (
            <HoverTip title={LAYER_INFO[layer].title} text={LAYER_INFO[layer].text}>
              <Select size="sm" ariaLabel="Layer" value={layer} onChange={(v) => setLayer(v as Layer)} options={LAYERS.map(([value, label]) => ({ value, label }))} />
            </HoverTip>
          )}
        </div>
        {mode === 'layers' ? (
          <div className="flex flex-wrap gap-1.5">
            {LAYERS.map(([l, label]) => (
              <HoverTip key={l} title={LAYER_INFO[l].title} text={LAYER_INFO[l].text}>
                <button type="button" onClick={() => toggleLayer(l)} aria-pressed={layers.includes(l)} className={chip(layers.includes(l))}>
                  {label}
                </button>
              </HoverTip>
            ))}
            <span className="self-center text-[11px] text-gray-400">up to {MAX_PANES}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {pickedFields.map((f) => (
              <span key={f} className={cn(chip(true), 'flex items-center gap-1')}>
                {nameOf(f)}
                <button type="button" aria-label={`Take ${nameOf(f)} out`} onClick={() => setPickedFields((p) => p.filter((x) => x !== f))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {pickedFields.length < MAX_PANES && (
              <Select
                size="sm"
                ariaLabel="Add a field"
                value=""
                placeholder="Add a field…"
                onChange={(v) => v && setPickedFields((p) => (p.includes(v) ? p : [...p, v]))}
                options={mapped.filter((f) => !pickedFields.includes(f.id)).map((f) => ({ value: f.id, label: f.name }))}
              />
            )}
          </div>
        )}
      </div>

      {panes.length === 0 ? (
        <p className="p-6 text-sm text-gray-500">
          {mode === 'layers' ? 'Tick a layer or two above.' : 'Add the fields to compare above.'}
        </p>
      ) : (
        <div
          className={cn(
            'grid min-h-0 flex-1 gap-1 overflow-y-auto bg-gray-200 p-1 md:auto-rows-fr',
            panes.length === 2 && 'md:grid-cols-2',
            panes.length === 3 && 'md:grid-cols-3',
            panes.length === 4 && 'md:grid-cols-2 md:grid-rows-2',
          )}
        >
          {panes.map((p) => (
            <Pane
              key={`${p.fieldId}-${p.layer}`}
              fieldId={p.fieldId}
              name={nameOf(p.fieldId)}
              layer={p.layer}
              shape={shapes.get(p.fieldId) ?? null}
              asOf={asOf}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Every [lng, lat] in a geometry, for framing it. */
function bounds(g: Geometry): maplibregl.LngLatBounds {
  const b = new maplibregl.LngLatBounds()
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') b.extend(c as [number, number])
    else if (Array.isArray(c)) c.forEach(walk)
  }
  walk((g as { coordinates?: unknown }).coordinates)
  return b
}

type DrawProps = { map: maplibregl.Map; fieldId: string; shape: Geometry; asOf: string | null }

function Pane({ fieldId, name, layer, shape, asOf }: { fieldId: string; name: string; layer: Layer; shape: Geometry | null; asOf: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const { map, ready } = useFarmMap(ref, { zoom: 13, controls: { nav: false } })

  // The field's outline, and the pane framed on it.
  useEffect(() => {
    if (!map || !ready || !shape) return
    map.addSource('cmp-field', { type: 'geojson', data: { type: 'Feature', geometry: shape, properties: {} } })
    map.addLayer({ id: 'cmp-field-line', type: 'line', source: 'cmp-field', paint: { 'line-color': '#ffffff', 'line-width': 2 } })
    const b = bounds(shape)
    if (!b.isEmpty()) map.fitBounds(b, { padding: 24, duration: 0 })
  }, [map, ready, shape])

  const draw = map && ready && shape ? { map, fieldId, shape, asOf } : null
  return (
    <div className="relative min-h-[60vw] overflow-hidden rounded bg-white md:min-h-0">
      <div ref={ref} className="h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[85%] rounded-lg border border-white/60 bg-white/80 px-2 py-1 text-xs shadow ring-1 ring-black/5 backdrop-blur-md">
        <p className="font-semibold text-gray-900">{name}</p>
        <p className="text-gray-600">{LAYER_LABEL[layer]}</p>
        {draw && <Caption layer={layer} {...draw} />}
      </div>
      {draw && <PaneLegend layer={layer} {...draw} />}
      {!shape && <p className="absolute inset-x-2 bottom-2 text-xs text-gray-500">No boundary for this field this year.</p>}
      {draw && (layer === 'photo' || layer === 'ndvi' || layer === 'ndre') && <RasterDraw layer={layer} {...draw} />}
      {draw && layer === 'aimm' && <AimmDraw {...draw} />}
      {draw && layer === 'fieldnet' && <PivotDraw {...draw} />}
      {draw && layer === 'topography' && <TopoDraw {...draw} />}
      {draw && layer === 'profit' && <ProfitDraw {...draw} />}
      <YieldZoneLayer map={map} mapReady={ready} visible={layer === 'yield'} />
      <SoilLayer map={map} mapReady={ready} visible={layer === 'soil'} />
    </div>
  )
}

/** The one-line reading under a pane's name: the image's date, the field's status, its net. */
function Caption({ layer, ...p }: DrawProps & { layer: Layer }) {
  if (layer === 'photo' || layer === 'ndvi' || layer === 'ndre') return <RasterCaption layer={layer} {...p} />
  if (layer === 'aimm') return <AimmCaption {...p} />
  if (layer === 'fieldnet') return <PivotCaption {...p} />
  if (layer === 'profit') return <ProfitCaption {...p} />
  if (layer === 'topography') return <p className="text-[11px] text-gray-500">Height against the field&rsquo;s low ground</p>
  return null
}

const KIND = { photo: 'truecolour', ndvi: 'ndvi', ndre: 'ndre' } as const

// A layer goes under the field's outline. A child's effect runs before the
// pane's own, so the outline may not be there yet; then it is added after,
// on top, and naming it here would throw and leave the layer half-added.
const under = (map: maplibregl.Map) => (map.getLayer('cmp-field-line') ? 'cmp-field-line' : undefined)

/** Fills the field's outline in one colour. */
function useFill(map: maplibregl.Map, shape: Geometry, colour: string | null, opacity = 0.6) {
  useEffect(() => {
    if (!colour) return
    if (!map.getSource('cmp-fill')) {
      map.addSource('cmp-fill', { type: 'geojson', data: { type: 'Feature', geometry: shape, properties: {} } })
      map.addLayer({ id: 'cmp-fill', type: 'fill', source: 'cmp-fill', paint: { 'fill-color': colour, 'fill-opacity': opacity } }, under(map))
    } else map.setPaintProperty('cmp-fill', 'fill-color', colour)
  }, [map, shape, colour, opacity])
}

function RasterDraw({ map, fieldId, asOf, layer }: DrawProps & { layer: 'photo' | 'ndvi' | 'ndre' }) {
  const { data } = useFieldImagery(KIND[layer], 'field', asOf)
  const img = data?.find((i) => i.subject_id === fieldId)
  useEffect(() => {
    if (!img) return
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [img.west, img.north],
      [img.east, img.north],
      [img.east, img.south],
      [img.west, img.south],
    ]
    // The link is signed for an hour and the list is reused from memory, so a
    // pane opened late can be handed a dead link and draw nothing (Sam, 29 Oct
    // 2026: NDVI blank on every pane). When fresh links arrive, swap them in.
    const src = map.getSource('cmp-img') as maplibregl.ImageSource | undefined
    if (src) {
      if (src.url !== img.url) src.updateImage({ url: img.url, coordinates })
      return
    }
    map.addSource('cmp-img', { type: 'image', url: img.url, coordinates })
    map.addLayer(
      { id: 'cmp-img', type: 'raster', source: 'cmp-img', paint: { 'raster-fade-duration': 0, 'raster-resampling': layer === 'photo' ? 'linear' : 'nearest' } },
      under(map),
    )
  }, [map, img, layer])
  return null
}
function RasterCaption({ fieldId, asOf, layer }: DrawProps & { layer: 'photo' | 'ndvi' | 'ndre' }) {
  const { data, isLoading } = useFieldImagery(KIND[layer], 'field', asOf)
  const img = data?.find((i) => i.subject_id === fieldId)
  if (isLoading) return null
  return <p className="text-[11px] text-gray-500">{img ? `Taken ${img.sensed_on}` : 'No image on file'}</p>
}

function useBalance(fieldId: string, asOf: string | null) {
  const { data } = useLatestBalance(asOf)
  return data?.find((b) => b.field_id === fieldId) ?? null
}
function AimmDraw({ map, fieldId, shape, asOf }: DrawProps) {
  const b = useBalance(fieldId, asOf)
  useFill(map, shape, b ? (IRRIGATION_STATUS[b.status ?? 'ok']?.[1] ?? NOT_SCHEDULED_COLOUR) : null)
  return null
}
function AimmCaption({ fieldId, asOf }: DrawProps) {
  const b = useBalance(fieldId, asOf)
  return <p className="text-[11px] text-gray-500">{b ? `${IRRIGATION_STATUS[b.status ?? 'ok']?.[0] ?? b.status} · ${b.date}` : 'Not scheduled'}</p>
}

function usePivot(fieldId: string, asOf: string | null) {
  const { data: live } = useFieldnetSystems()
  const then = useFieldnetSystemsOn(asOf)
  return (asOf ? then : live)?.find((s) => s.field_id === fieldId) ?? null
}
function PivotDraw({ map, fieldId, shape, asOf }: DrawProps) {
  const s = usePivot(fieldId, asOf)
  const colour = s ? FN_STATUS_COLOR[fnStatus(s)] : null
  useFill(map, shape, colour, 0.35)
  // The arm, from the pivot point at its angle, as long as the pipe.
  useEffect(() => {
    if (!s || !colour) return
    const g = s.geometry as { type?: string; coordinates?: number[][] } | null
    const raw = (s.raw && typeof s.raw === 'object' ? s.raw : {}) as Record<string, unknown>
    const line = g?.type === 'LineString' && g.coordinates && g.coordinates.length >= 2 ? g.coordinates : null
    const centre = line ? line[0] : s.latitude != null && s.longitude != null ? [Number(s.longitude), Number(s.latitude)] : null
    if (!centre) return
    const b = bounds(shape)
    const fallback = b.isEmpty() ? 400 : haversineM([b.getWest(), b.getSouth()], [b.getWest(), b.getNorth()]) / 2
    const radius = line ? haversineM(line[0], line[line.length - 1]) : fallback
    const angle = typeof raw.pivot_angle === 'number' ? raw.pivot_angle : 0
    const data: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [centre, destination(centre, angle, radius)] } }
    const src = map.getSource('cmp-arm') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(data)
    else {
      map.addSource('cmp-arm', { type: 'geojson', data })
      map.addLayer({ id: 'cmp-arm', type: 'line', source: 'cmp-arm', paint: { 'line-color': colour, 'line-width': 4 } })
    }
    map.setPaintProperty('cmp-arm', 'line-color', colour)
  }, [map, s, colour, shape])
  return null
}
function PivotCaption({ fieldId, asOf }: DrawProps) {
  const s = usePivot(fieldId, asOf)
  return <p className="text-[11px] text-gray-500">{s ? FN_STATUS_LABEL[fnStatus(s)] : 'No pivot on FieldNET'}</p>
}

/** The field's best height survey, and its colour steps (height against the low ground near it). */
function useTopo(fieldId: string) {
  const { data: all } = useTopoSurfaces()
  const surface = useMemo(() => bestPerField(all ?? []).find((s) => s.field_id === fieldId) ?? null, [all, fieldId])
  const { data: cells } = useTopoCells(surface?.id ?? null)
  const steps = useMemo(() => (cells?.length ? rampSteps(colourStops(cells, 'rem'), REM_COLOURS) : null), [cells])
  return { surface, cells, steps }
}
function TopoDraw({ map, fieldId }: DrawProps) {
  const { surface, cells, steps } = useTopo(fieldId)
  useEffect(() => {
    if (!cells?.length || !steps || map.getSource('cmp-topo')) return
    map.addSource('cmp-topo', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: cells.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { rem: c.rem_ft ?? 0 } })),
      },
    })
    map.addLayer(
      {
        id: 'cmp-topo',
        type: 'circle',
        source: 'cmp-topo',
        paint: {
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], ...radiusStops(surface?.cell_m ?? 5, cells[0]?.lat ?? 49.9)] as never,
          'circle-color': ['interpolate', ['linear'], ['get', 'rem'], ...steps.flatMap((s) => [s.value, s.colour])] as never,
          'circle-opacity': 0.85,
          'circle-blur': 0.25,
        },
      },
      under(map),
    )
  }, [map, cells, steps, surface?.cell_m])
  return null
}

function useFieldNet(fieldId: string) {
  const { cropYear } = useCropYear()
  const { books } = useFarmBooks(cropYear, 'target')
  const withNet = books.filter((b) => b.netPerAcre != null).map((b) => b.netPerAcre!)
  const book = books.find((b) => b.fieldId === fieldId) ?? null
  const range: [number, number] = withNet.length ? [Math.min(...withNet), Math.max(...withNet)] : [-1, 1]
  return { book, range }
}
function ProfitDraw({ map, fieldId, shape }: DrawProps) {
  const { book, range } = useFieldNet(fieldId)
  // Coloured on the farm's own range, the same as the Profit / Loss map.
  const colour = useMemo(() => {
    if (!book || book.netPerAcre == null) return book ? '#9ca3af' : null
    const stops = plStops(range)
    let c = stops[0]?.colour ?? '#9ca3af'
    for (const s of stops) if (book.netPerAcre >= s.value) c = s.colour
    return c
  }, [book, range])
  useFill(map, shape, colour, 0.75)
  return null
}
function ProfitCaption({ fieldId }: DrawProps) {
  const { book } = useFieldNet(fieldId)
  if (!book) return null
  return (
    <p className="text-[11px] text-gray-500">
      {book.netPerAcre != null ? `Net ${money(book.netPerAcre)}/ac (target prices)` : `No yield yet · ${money(book.costPerAcre)}/ac spent`}
    </p>
  )
}

/**
 * What the pane's colours mean, in its bottom corner (Sam, 29 Oct 2026).
 * Each reads the same data as the pane's drawing, so the two always agree:
 * the satellite indices on the scale that image was painted on, topography
 * and profit on this field's or this farm's own range.
 */
function PaneLegend({ layer, ...p }: DrawProps & { layer: Layer }) {
  if (layer === 'ndvi' || layer === 'ndre') return <IndexLegend layer={layer} {...p} />
  if (layer === 'aimm') return <LegendBox items={IRRIGATION_LEGEND} />
  if (layer === 'fieldnet') return <LegendBox items={FIELDNET_LEGEND} />
  if (layer === 'yield') return <YieldLegend />
  if (layer === 'soil')
    return (
      <LegendBox
        heading="Water the crop can reach (top metre)"
        items={[...SOIL_WATER_BANDS.map((b) => [b.label, b.colour] as const), ['No rating', SOIL_NO_DATA_COLOUR] as const]}
      />
    )
  if (layer === 'topography') return <TopoLegend {...p} />
  if (layer === 'profit') return <ProfitLegend {...p} />
  return null
}

function LegendShell({ heading, children }: { heading?: string; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[85%] rounded-lg border border-white/60 bg-white/85 px-2 py-1.5 text-[11px] text-gray-700 shadow ring-1 ring-black/5 backdrop-blur-md">
      {heading && <p className="mb-1 font-medium text-gray-900">{heading}</p>}
      {children}
    </div>
  )
}

function LegendBox({ heading, items }: { heading?: string; items: readonly (readonly [string, string])[] }) {
  return (
    <LegendShell heading={heading}>
      <ul className="space-y-0.5">
        {items.map(([label, colour]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colour }} />
            {label}
          </li>
        ))}
      </ul>
    </LegendShell>
  )
}

/** A strip of colour steps with words under each end. */
function RampLegend({ heading, colours, low, high }: { heading: string; colours: string[]; low: string; high: string }) {
  return (
    <LegendShell heading={heading}>
      <div className="flex h-2.5 w-44 overflow-hidden rounded-sm">
        {colours.map((c, i) => (
          <span key={i} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="mt-0.5 flex w-44 justify-between gap-2 text-[10px] text-gray-500">
        <span>{low}</span>
        <span className="text-right">{high}</span>
      </div>
    </LegendShell>
  )
}

// The scale each index is painted on when its image carries none of its own
// (netlify/shared/sat-imagery.ts).
const INDEX_FALLBACK = { ndvi: { lo: 0.2, hi: 0.9 }, ndre: { lo: 0.1, hi: 0.6 } }

function IndexLegend({ fieldId, asOf, layer }: DrawProps & { layer: 'ndvi' | 'ndre' }) {
  const { data } = useFieldImagery(KIND[layer], 'field', asOf)
  const img = data?.find((i) => i.subject_id === fieldId)
  if (!img) return null
  // The image is painted across this scale, lowest colour to highest.
  const lo = img.stretch_min ?? INDEX_FALLBACK[layer].lo
  const hi = img.stretch_max ?? INDEX_FALLBACK[layer].hi
  return (
    <RampLegend
      heading={layer === 'ndre' ? 'NDRE (red edge)' : 'NDVI (crop greenness)'}
      colours={NDVI_RAMP.map(([, c]) => c)}
      low={`${lo.toFixed(2)} thin or bare`}
      high={`${hi.toFixed(2)} heavy growth`}
    />
  )
}

function YieldLegend() {
  const { data } = useYieldZones()
  const bands = yieldBands(data ?? [])
  if (!bands.length) return null
  return <LegendBox heading="% of the field’s own average" items={bands.map((b) => [`${b.from}–${b.to}`, b.colour] as const)} />
}

const ft = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} ft`

function TopoLegend({ fieldId }: DrawProps) {
  const { steps } = useTopo(fieldId)
  if (!steps) return null
  return (
    <RampLegend
      heading="Height against the low ground near it"
      colours={steps.map((s) => s.colour)}
      low={`${ft(steps[0].value)} lower, holds water`}
      high={`${ft(steps[steps.length - 1].value)} higher`}
    />
  )
}

function ProfitLegend({ fieldId }: DrawProps) {
  const { range } = useFieldNet(fieldId)
  const stops = plStops(range)
  return (
    <RampLegend
      heading="Net per acre, target prices (farm range)"
      colours={stops.map((s) => s.colour)}
      low={`${money(stops[0].value)}/ac`}
      high={`${money(stops[stops.length - 1].value)}/ac`}
    />
  )
}
