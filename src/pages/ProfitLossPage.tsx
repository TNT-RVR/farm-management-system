import { useEffect, useMemo, useRef, useState } from 'react'
import { applyDeal, dealFor, isOffTheTop } from '@/lib/land-deals'
import { useLandDeals } from '@/lib/land-deals-data'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CircleDollarSign, RefreshCw, TriangleAlert, Upload, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { YieldImport } from '@/components/YieldImport'
import { supabase } from '@/lib/supabase'
import { Legend, LinesTable } from '@/components/ProfitLossLines'
import { ProfitLossFarm } from '@/pages/ProfitLossFarm'
import { Select } from '@/components/Select'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useFieldOperations } from '@/lib/fieldOps'
import { useProductResolver } from '@/lib/products'
import { boundariesForYear, useAllBoundaries, useFields } from '@/lib/queries'
import { radiusStops } from '@/lib/topography'
import { CELL_M, cellKey, cellOf, centreOf } from '@/lib/pl-grid'
import { bandBreaks, bandOf, colourAt, contourLines, imageCorners, rasterize, smooth, upsample } from '@/lib/pl-contour'
import {
  harvestedCells,
  profitCells,
  colourStops,
  losingShare,
  profitRange,
  type PlCell,
  type YieldMode,
} from '@/lib/profit-loss'
import {
  useBuildGrids,
  useCropPrices,
  useFieldLines,
  useFieldSeason,
  usePlGrids,
  useVigourImages,
  useVigourSample,
} from '@/lib/profit-loss-data'
import { autoInputs, autoOutput, fixedLines, forMap, mergeLines, money } from '@/lib/profit-loss-lines'
import { useFixedAreas, useFixedPerAcre, useLandSharePerAcre } from '@/lib/farm-costs'
import { useOperatingCostLines } from '@/lib/operating-costs'
import type { FuelOpRow } from '@/lib/hauling-data'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { farmMapCenter } from '@/lib/farm-setup'

/**
 * The Profit/Loss Map: which parts of a field made money and which lost it.
 *
 * Beside the map, the field as two tables — inputs and outputs, each a product,
 * a price, an amount and a total — filled from the machines, the price book and
 * the scale, and editable (profit-loss-lines.ts). The map is those same totals
 * laid over the ground: each machine-logged input where its passes put it,
 * everything else spread per acre, and the crop by the chosen yield spread.
 */
type PriceMode = 'target' | 'actual'

/**
 * The page: the whole farm by default, one field's 5 m map when a field is
 * picked (from the list, the farm map, or the picker).
 */
export function ProfitLossPage() {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const [view, setView] = useState<string>('farm')
  const [priceMode, setPriceMode] = useState<PriceMode>('target')

  if (view !== 'farm') {
    return (
      <ProfitLossField
        key={view}
        fieldId={view}
        onView={setView}
        priceMode={priceMode}
        setPriceMode={setPriceMode}
      />
    )
  }
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 bg-white px-4 pt-3 md:px-6">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
          <CircleDollarSign className="h-5 w-5" /> Profit / Loss
        </h1>
        <p className="mt-0.5 text-xs text-gray-500">
          Every field in {cropYear}, coloured by net $/acre. Click a field for its 5 m map and its inputs and outputs.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 pb-3">
          <Select
            value="farm"
            ariaLabel="Field"
            onChange={(v) => setView(v)}
            options={[{ value: 'farm', label: 'Whole farm' }, ...(fields ?? []).map((f) => ({ value: f.id, label: f.name }))]}
          />
          <PriceToggle value={priceMode} onChange={setPriceMode} />
        </div>
      </div>
      <ProfitLossFarm cropYear={cropYear} priceMode={priceMode} onPickField={setView} />
    </div>
  )
}

function PriceToggle({ value, onChange }: { value: PriceMode; onChange: (v: PriceMode) => void }) {
  return (
    <Toggle
      label="Price"
      value={value}
      onChange={(v) => onChange(v as PriceMode)}
      options={[
        { value: 'target', label: 'Target' },
        { value: 'actual', label: 'Actual' },
      ]}
    />
  )
}

function ProfitLossField({
  fieldId,
  onView,
  priceMode,
  setPriceMode,
}: {
  fieldId: string
  onView: (v: string) => void
  priceMode: PriceMode
  setPriceMode: (v: PriceMode) => void
}) {
  const { cropYear } = useCropYear()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: fields } = useFields()
  const field = useMemo(() => fields?.find((f) => f.id === fieldId) ?? null, [fields, fieldId])

  const { data: season } = useFieldSeason(field?.id ?? null, cropYear)
  const { data: grids, isFetching: gridsLoading, refetch: refetchGrids } = usePlGrids(field?.id ?? null, cropYear)
  const { data: ops } = useFieldOperations(field?.id ?? null)
  const resolve = useProductResolver()
  const { data: prices } = useCropPrices(season?.cropId ?? null, cropYear)
  const { data: saved } = useFieldLines(field?.id ?? null, cropYear)
  const fixed = useFixedPerAcre(cropYear)
  const fixedAreas = useFixedAreas(cropYear)
  const { data: landSharePerAcre } = useLandSharePerAcre(cropYear)
  const { data: images } = useVigourImages(field?.id ?? null, cropYear)
  const build = useBuildGrids()

  const hasYieldFile = Boolean(grids?.some((g) => g.kind === 'yield'))
  const [spread, setSpread] = useState<YieldMode>('vigour')
  const mode: YieldMode = hasYieldFile ? 'file' : spread
  const [imagePath, setImagePath] = useState<string | null>(null)
  const image = images?.find((i) => i.storage_path === imagePath) ?? images?.[0] ?? null

  const footprint = useMemo(() => harvestedCells(grids ?? []), [grids])
  const { data: vigour } = useVigourSample(mode === 'vigour' ? image : null, footprint)

  const acres = season?.acres ?? 0
  const autoPrice = priceMode === 'actual' ? (prices?.actual ?? null) : (prices?.target ?? null)
  // Fuel (in the field and on the road) and trucking, from Travel & trucking.
  const operatingLines = useOperatingCostLines(cropYear, ops as unknown as FuelOpRow[] | undefined)
  const lines = useMemo(() => {
    if (!resolve) return []
    const auto = [
      ...autoInputs((ops ?? []) as never, grids ?? [], cropYear, acres, resolve),
      ...fixedLines({
        perAcre: fixed.perAcre,
        carriedFrom: fixed.carriedFrom,
        landSharePerAcre: landSharePerAcre ?? null,
        acres,
        fixedApplies: season?.fixedApplies !== false,
        areas: field ? fixedAreas.get(field.id) : null,
      }),
      ...(field ? operatingLines(field.id, season) : []),
      autoOutput({ name: season?.cropName ?? null, unit: season?.yieldUnit ?? null, total: season?.yieldTotal ?? null }, autoPrice, priceMode),
    ].filter((l): l is NonNullable<typeof l> => l != null)
    return mergeLines(auto, saved ?? [])
  }, [ops, grids, cropYear, acres, resolve, season, autoPrice, priceMode, saved, fixed.perAcre, fixed.carriedFrom, fixedAreas, landSharePerAcre, field, operatingLines])

  // The crop the map spreads by yield. Other outputs go on evenly.
  const main = lines.find((l) => l.side === 'output' && !l.isManual) ?? null
  // An empty marker (a pass Deere logged nothing usable for) has nowhere to put
  // dollars, so its pass is spread per acre like any pass not on the map.
  const gridded = useMemo(
    () => new Set((grids ?? []).filter((g) => g.cell_count > 0).map((g) => g.operation_id).filter((v): v is string => Boolean(v))),
    [grids],
  )
  const money4map = useMemo(() => forMap(lines, acres, gridded, main?.key ?? null), [lines, acres, gridded, main?.key])

  const inputs = useMemo(
    () => ({
      grids: grids ?? [],
      placed: money4map.placed,
      mode,
      scaleYieldPerAcre: main?.amount != null && acres > 0 ? main.amount / acres : null,
      price: main?.price ?? null,
      flatPerAcre: money4map.flatPerAcre,
      otherRevenuePerAcre: money4map.otherRevenuePerAcre,
      vigour,
    }),
    [grids, money4map, mode, main?.amount, main?.price, acres, vigour],
  )
  const cells = useMemo(() => profitCells(inputs), [inputs])
  const { data: deals } = useLandDeals()
  const deal = field ? dealFor(deals ?? [], field.id, cropYear, season?.cropId) : null
  const dealResult = applyDeal(deal, { id: field?.id ?? '', acres }, { revenue: money4map.revenue, cost: money4map.cost, hasYield: money4map.revenue > 0, offTheTop: lines.filter((l) => l.side === 'input' && isOffTheTop(l.label) && l.total != null).reduce((s, l) => s + Number(l.total), 0) }, (id) => (id === field?.id ? acres : 0))
  const net = money4map.revenue + (dealResult.rentReceived ?? 0) - money4map.cost - dealResult.rent - dealResult.ownerShare

  // Keyed to the field and year, so a square picked on one field is not shown over another.
  const pickKey = `${field?.id}-${cropYear}`
  const [pickedAt, setPickedAt] = useState<{ key: string; cell: PlCell } | null>(null)
  const picked = pickedAt?.key === pickKey ? pickedAt.cell : null
  const pickKeyRef = useRef(pickKey)
  const setPicked = (cell: PlCell | null) => setPickedAt(cell ? { key: pickKeyRef.current, cell } : null)

  // The map, built once; layers follow the data.
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const cellsRef = useRef<PlCell[]>([])
  useEffect(() => {
    cellsRef.current = cells
    pickKeyRef.current = pickKey
  }, [cells, pickKey])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 11,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.on('load', () => setReady(true))
    // MapLibre reports failures here and nowhere else — see TopographyPage.
    map.on('error', (e) => setMapError(e.error?.message ?? 'The map failed to draw'))
    map.on('click', (e) => {
      const [gx, gy] = cellOf(e.lngLat.lng, e.lngLat.lat)
      const k = cellKey(gx, gy)
      setPicked(cellsRef.current.find((c) => cellKey(c.gx, c.gy) === k) ?? null)
    })
    map.on('mouseenter', 'pl-cells', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'pl-cells', () => (map.getCanvas().style.cursor = ''))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  const range = useMemo(() => profitRange(cells), [cells])
  const stops = useMemo(() => colourStops(range), [range])
  const [look, setLook] = useState<'smooth' | 'squares'>('smooth')
  // Off unless asked for: the hatching was found too busy to leave on (30 Sep 2026).
  const [showUnread, setShowUnread] = useState(false)

  /**
   * The contoured picture: smoothed $/ac in round-number bands, as an image
   * clipped to the field, plus lines at the band edges. Built only for the
   * look; the numbers shown on tap and in the totals stay unsmoothed.
   */
  const contour = useMemo(() => {
    const r = rasterize(cells.map((c) => ({ gx: c.gx, gy: c.gy, value: c.profit })))
    if (!r) return null
    const sm = smooth(r)
    const scale = 4
    const img = upsample(sm, scale)
    const breaks = bandBreaks(range)
    // Each band is one flat colour, taken at its middle.
    const bandColour = (b: number) => {
      const lo = b === 0 ? range[0] : breaks[b - 1]
      const hi = b === breaks.length ? range[1] : breaks[b]
      return colourAt(stops, (lo + hi) / 2)
    }
    const canvas = document.createElement('canvas')
    canvas.width = img.w
    canvas.height = img.h
    const ctx = canvas.getContext('2d')!
    const out = ctx.createImageData(img.w, img.h)
    for (let i = 0; i < img.v.length; i++) {
      const v = img.v[i]
      if (Number.isNaN(v)) continue
      const [R, G, B] = bandColour(bandOf(v, breaks))
      out.data[i * 4] = R
      out.data[i * 4 + 1] = G
      out.data[i * 4 + 2] = B
      out.data[i * 4 + 3] = 235
    }
    ctx.putImageData(out, 0, 0)

    const est = new Set(cells.filter((c) => c.estimated).map((c) => cellKey(c.gx, c.gy)))
    let hatchUrl: string | null = null
    if (est.size) {
      const hc = document.createElement('canvas')
      hc.width = img.w
      hc.height = img.h
      const hctx = hc.getContext('2d')!
      const hd = hctx.createImageData(img.w, img.h)
      for (let py = 0; py < img.h; py++) {
        const gy = sm.gy0 + (sm.h - 1 - Math.floor(py / scale))
        for (let px = 0; px < img.w; px++) {
          const i = py * img.w + px
          if (Number.isNaN(img.v[i])) continue
          // Lines 2 px wide every 8 px, running up to the right.
          if ((px + py) % 8 > 1) continue
          if (!est.has(cellKey(sm.gx0 + Math.floor(px / scale), gy))) continue
          hd.data[i * 4] = 255
          hd.data[i * 4 + 1] = 255
          hd.data[i * 4 + 2] = 255
          hd.data[i * 4 + 3] = 170
        }
      }
      hctx.putImageData(hd, 0, 0)
      hatchUrl = hc.toDataURL('image/png')
    }
    const corners = imageCorners(sm)
    const lines = contourLines(img, breaks, corners)
    return {
      url: canvas.toDataURL('image/png'),
      hatchUrl,
      estimatedShare: est.size / cells.length,
      corners,
      lines: {
        type: 'FeatureCollection' as const,
        features: lines.map((l) => ({
          type: 'Feature' as const,
          geometry: { type: 'MultiLineString' as const, coordinates: l.segments },
          properties: { v: l.value, zero: l.value === 0 ? 1 : 0 },
        })),
      },
    }
  }, [cells, range, stops])

  const framed = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const data = {
      type: 'FeatureCollection' as const,
      features: cells.map((c, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: centreOf(c.gx, c.gy) },
        properties: { p: c.profit, i },
      })),
    }
    const src = map.getSource('pl') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(data)
    else map.addSource('pl', { type: 'geojson', data })

    const colour = ['interpolate', ['linear'], ['get', 'p'], ...stops.flatMap((s) => [s.value, s.colour])] as never
    if (!map.getLayer('pl-cells')) {
      map.addLayer({
        id: 'pl-cells',
        type: 'circle',
        source: 'pl',
        paint: {
          // Sized to the ground each cell stands for — see radiusStops.
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], ...radiusStops(CELL_M, 49.85)] as never,
          'circle-color': colour,
          'circle-opacity': 0.9,
        },
      })
    } else {
      map.setPaintProperty('pl-cells', 'circle-color', colour)
    }

    if (contour) {
      const img = map.getSource('pl-img') as maplibregl.ImageSource | undefined
      if (img) img.updateImage({ url: contour.url, coordinates: contour.corners })
      else {
        map.addSource('pl-img', { type: 'image', url: contour.url, coordinates: contour.corners })
        map.addLayer({ id: 'pl-bands', type: 'raster', source: 'pl-img', paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 0 } })
      }
      const ln = map.getSource('pl-lines') as maplibregl.GeoJSONSource | undefined
      if (ln) ln.setData(contour.lines)
      else {
        map.addSource('pl-lines', { type: 'geojson', data: contour.lines })
        map.addLayer({
          id: 'pl-contours',
          type: 'line',
          source: 'pl-lines',
          paint: {
            // Break-even drawn heavier: it is the line the whole map is about.
            'line-color': ['case', ['==', ['get', 'zero'], 1], '#111827', '#1f2937'] as never,
            'line-width': ['case', ['==', ['get', 'zero'], 1], 2, 0.8] as never,
            'line-opacity': ['case', ['==', ['get', 'zero'], 1], 0.9, 0.45] as never,
          },
        })
      }
    }
    if (contour) {
      const hs = map.getSource('pl-hatch-img') as maplibregl.ImageSource | undefined
      // An empty pixel stands in when nothing is hatched, so the layer can stay put.
      const url = contour.hatchUrl ?? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=='
      if (hs) hs.updateImage({ url, coordinates: contour.corners })
      else {
        map.addSource('pl-hatch-img', { type: 'image', url, coordinates: contour.corners })
        map.addLayer(
          { id: 'pl-hatch', type: 'raster', source: 'pl-hatch-img', paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } },
          map.getLayer('pl-contours') ? 'pl-contours' : undefined,
        )
      }
    }
    const smoothOn = look === 'smooth' && Boolean(contour)
    for (const id of ['pl-bands', 'pl-contours']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', smoothOn ? 'visible' : 'none')
    map.setLayoutProperty('pl-cells', 'visibility', smoothOn ? 'none' : 'visible')
    if (map.getLayer('pl-hatch')) map.setLayoutProperty('pl-hatch', 'visibility', showUnread ? 'visible' : 'none')

    // Frame a field the first time its cells arrive, not on every re-price.
    const key = `${field?.id}-${cropYear}`
    if (cells.length && framed.current !== key) {
      framed.current = key
      const pts = cells.map((c) => centreOf(c.gx, c.gy))
      map.fitBounds(
        [
          [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))],
          [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
        ],
        { padding: 40, duration: 600 },
      )
    }
  }, [cells, ready, stops, field?.id, cropYear, contour, look, showUnread])

  const ungridded = (ops ?? []).filter(
    (o) =>
      o.crop_season === cropYear &&
      ['seeding', 'application', 'harvest'].includes(o.operation_type ?? '') &&
      !(grids ?? []).some((g) => g.operation_id === o.id),
  ).length

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 bg-white px-4 pt-3 md:px-6">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
          <CircleDollarSign className="h-5 w-5" /> Profit / Loss
        </h1>
        <HelpNote className="mt-0.5 text-xs" summary={`What each 5 m square made or lost in ${cropYear}.`} title="How each square is worked out">
          What each 5 m square made or lost in {cropYear}: yield × price, less the seed, fertilizer and spray the
          machines put on that square, less the per-acre costs below.
        </HelpNote>
        <div className="mt-2 flex flex-wrap items-center gap-2 pb-3">
          <Select
            value={field?.id ?? ''}
            ariaLabel="Field"
            onChange={(v) => onView(v)}
            options={[{ value: 'farm', label: 'Whole farm' }, ...(fields ?? []).map((f) => ({ value: f.id, label: f.name }))]}
          />
          <Toggle
            label="Price"
            value={priceMode}
            onChange={(v) => setPriceMode(v as PriceMode)}
            options={[
              { value: 'target', label: 'Target' },
              { value: 'actual', label: 'Actual', disabled: prices?.actual == null, hint: 'No contracts entered for this crop yet' },
            ]}
          />
          {!hasYieldFile && (
            <Toggle
              label="Yield"
              value={spread}
              onChange={(v) => setSpread(v as YieldMode)}
              options={[
                { value: 'vigour', label: 'By satellite vigour', disabled: !images?.length, hint: 'No satellite images this season' },
                { value: 'even', label: 'Spread evenly' },
              ]}
            />
          )}
          {mode === 'vigour' && (images?.length ?? 0) > 1 && (
            <Select
              size="sm"
              value={image?.storage_path ?? ''}
              ariaLabel="Satellite date"
              onChange={(v) => setImagePath(v)}
              options={(images ?? []).map((i) => ({ value: i.storage_path, label: `Vigour ${i.sensed_on}` }))}
            />
          )}
          <Toggle
            label="Look"
            value={look}
            onChange={(v) => setLook(v as 'smooth' | 'squares')}
            options={[
              { value: 'smooth', label: 'Smooth' },
              { value: 'squares', label: '5 m squares' },
            ]}
          />
          {gridsLoading && <span className="text-xs text-gray-400">Loading…</span>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-[55vh] flex-1 md:min-h-0">
          {/* h-full, not absolute inset-0 — see the note in TopographyPage. */}
          <div ref={containerRef} className="h-full w-full" />
          {mapError && (
            <p
              className="absolute inset-x-3 top-3 z-10 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 shadow"
              title={mapError}
            >
              The map couldn&rsquo;t load. Try reloading the page.
            </p>
          )}
          {!cells.length && !gridsLoading && (
            <div className="absolute inset-x-4 top-4 rounded-md bg-white/95 px-3 py-4 text-center text-sm text-gray-600 shadow">
              No machine data gridded for this field in {cropYear} yet.
              {ungridded > 0 && ' Passes are pulled from Deere automatically after each hourly sync, a few at a time.'}
            </div>
          )}
          {cells.length > 0 && <Legend stops={stops} />}
          {picked && <CellCard cell={picked} unit={season?.yieldUnit ?? ''} onClose={() => setPicked(null)} />}
        </div>

        <aside className="w-full shrink-0 space-y-4 overflow-y-auto border-t border-gray-200 bg-gray-50 p-4 md:w-[28rem] md:border-l md:border-t-0">
          <section className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-800">
                {field?.name} · {season?.cropName ?? 'no crop recorded'}
              </h2>
              <span className="text-xs text-gray-500">{acres ? `${acres.toFixed(2)} ac` : 'no acres'}</span>
            </div>
            <dl className="mt-2 space-y-1 text-sm">
              <Row label="Outputs" value={money(money4map.revenue)} />
              <Row label="Inputs" value={`− ${money(money4map.cost)}`} />
              {dealResult.rent > 0 && <Row label={dealResult.label} value={`− ${money(dealResult.rent)}`} />}
              {deal && dealResult.ownerShare !== 0 && <Row label={`Land owner's share — ${dealResult.label}`} value={`${dealResult.ownerShare > 0 ? '− ' : '+ '}${money(Math.abs(dealResult.ownerShare))}`} />}
              {deal && dealResult.rent === 0 && dealResult.ownerShare === 0 && <Row label={dealResult.label} value="split at harvest" />}
              <div className="border-t border-gray-100 pt-1">
                <Row label="Net" strong value={`${money(net)}  (${money(acres ? net / acres : null)}/ac)`} />
              </div>
            </dl>
            {cells.length > 0 && (
              <p className="mt-2 text-xs text-gray-600">
                {Math.round(losingShare(cells) * 100)}% of the harvested ground lost money at these numbers.
              </p>
            )}
            {mode === 'vigour' && (
              <p className="mt-2 text-[11px] leading-snug text-amber-700">
                Estimated yield: the scale total, spread by satellite vigour on {image?.sensed_on}. The field total is
                exact; where it came from within the field is an estimate.
              </p>
            )}
            {mode === 'file' && (contour?.estimatedShare ?? 0) > 0 && (
              <div className="mt-2 text-[11px] leading-snug text-gray-600">
                <p>
                  {Math.round((contour?.estimatedShare ?? 0) * 100)}% of the field had no yield reading, so it carries the
                  field average. Treat it as unknown, not as average ground.
                </p>
                <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 text-gray-700">
                  <input type="checkbox" checked={showUnread} onChange={(e) => setShowUnread(e.target.checked)} />
                  Show unread areas on the map
                </label>
              </div>
            )}
            {mode === 'even' && (
              <p className="mt-2 text-[11px] leading-snug text-gray-500">
                Yield spread evenly, so the differences on the map are all cost.
              </p>
            )}
            {money4map.unpriced > 0 && (
              <p className="mt-2 flex items-start gap-1 text-[11px] leading-snug text-amber-700">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {money4map.unpriced} row{money4map.unpriced === 1 ? ' is' : 's are'} missing a cost or amount and left
                out of the totals. Click the dash to type one in.
              </p>
            )}
          </section>

          {field && (
            <>
              <LinesTable
                title="Inputs"
                side="input"
                lines={lines.filter((l) => l.side === 'input')}
                fieldId={field.id}
                cropYear={cropYear}
                acres={acres}
                canEdit={isManager}
              />
              <LinesTable
                title="Outputs"
                side="output"
                lines={lines.filter((l) => l.side === 'output')}
                fieldId={field.id}
                cropYear={cropYear}
                acres={acres}
                canEdit={isManager}
              />
            </>
          )}

          {field && (
            <YieldFileSection
              fieldId={field.id}
              fieldName={field.name}
              cropYear={cropYear}
              canEdit={isManager}
              imported={(grids ?? []).find((g) => g.source === 'farmtrx' && g.kind === 'yield') ?? null}
              hasScaleTotal={season?.yieldTotal != null}
            />
          )}

          {isManager && field && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500">
              <span>
                {ungridded > 0
                  ? `${ungridded} Deere pass${ungridded === 1 ? '' : 'es'} not on the map yet — pulled automatically each hour.`
                  : 'Every Deere pass this season is on the map.'}
              </span>
              <button
                type="button"
                disabled={build.isPending}
                onClick={() =>
                  build.mutate(
                    { fieldId: field.id, cropYear, force: ungridded === 0 },
                    { onSuccess: () => setTimeout(() => void refetchGrids(), 60_000) },
                  )
                }
                className="flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', build.isPending && 'animate-spin')} />
                {ungridded === 0 ? 'Rebuild' : 'Pull now'}
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function CellCard({ cell, unit, onClose }: { cell: PlCell; unit: string; onClose: () => void }) {
  return (
    <div className="absolute right-3 top-3 w-60 rounded-lg bg-white/95 p-3 text-xs shadow">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-gray-800">This square, per acre</p>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
          ×
        </button>
      </div>
      <dl className="mt-2 space-y-0.5">
        <Row label="Yield" value={`${Math.round(cell.yield).toLocaleString('en-CA')} ${unit}`} />
        <Row label="Revenue" value={money(cell.revenue)} />
        <Row label="Inputs placed here" value={`− ${money(cell.mapped)}`} />
        <Row label="Inputs spread per acre" value={`− ${money(cell.flat)}`} />
        <div className="border-t border-gray-100 pt-0.5">
          <Row label="Net" value={money(cell.profit)} strong />
        </div>
      </dl>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-600">{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'font-semibold text-gray-900' : 'text-gray-800')}>{value}</dd>
    </div>
  )
}

function Toggle({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; disabled?: boolean; hint?: string }[]
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-gray-500">{label}</span>
      <div className="flex overflow-hidden rounded-md border border-gray-300">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            title={o.disabled ? o.hint : undefined}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'px-2 py-1',
              value === o.value ? 'bg-brand-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50',
              o.disabled && 'cursor-not-allowed opacity-40 hover:bg-white',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The yield monitor's file for this field and year: import one, see which is
 * in, or take it off. With one in, the map uses its pattern for yield.
 */
function YieldFileSection({
  fieldId,
  fieldName,
  cropYear,
  canEdit,
  imported,
  hasScaleTotal,
}: {
  fieldId: string
  fieldName: string
  cropYear: number
  canEdit: boolean
  imported: { id: string; product_name: string | null; point_count: number; note: string | null; built_at: string } | null
  hasScaleTotal: boolean
}) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const { data: allBoundaries } = useAllBoundaries()
  const bbox = useMemo((): [number, number, number, number] | null => {
    const b = allBoundaries ? boundariesForYear(allBoundaries, cropYear).find((x) => x.field_id === fieldId) : null
    if (!b) return null
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') {
        w = Math.min(w, c[0] as number)
        e = Math.max(e, c[0] as number)
        s = Math.min(s, c[1] as number)
        n = Math.max(n, c[1] as number)
      } else if (Array.isArray(c)) c.forEach(walk)
    }
    walk((b.geometry as { coordinates?: unknown } | null)?.coordinates)
    return Number.isFinite(w) ? [w, s, e, n] : null
  }, [allBoundaries, cropYear, fieldId])

  const remove = useMutation({
    mutationFn: async () => {
      // The yield and its footprint go together.
      const { error } = await supabase
        .from('pl_op_grids')
        .delete()
        .eq('field_id', fieldId)
        .eq('crop_year', cropYear)
        .eq('source', 'farmtrx')
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pl_op_grids', fieldId, cropYear] })
      void qc.invalidateQueries({ queryKey: ['pl-farm', cropYear] })
    },
  })

  if (!canEdit && !imported) return null
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">Yield file</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            <Upload className="h-3.5 w-3.5" /> {imported ? 'Replace' : 'Import yield file (FarmTRX)'}
          </button>
        )}
      </div>
      {imported ? (
        <div className="mt-1.5 flex items-start justify-between gap-2 text-xs">
          <div className="min-w-0">
            <p className="truncate text-gray-800">{imported.product_name}</p>
            <p className="text-[10px] text-gray-500">
              Imported {imported.built_at.slice(0, 10)} · the map uses its pattern, scaled to the scale total
            </p>
            {imported.note && <p className="mt-0.5 text-[10px] leading-snug text-gray-600">{imported.note}</p>}
          </div>
          {canEdit && (
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="text-gray-300 hover:text-red-600"
              aria-label="Remove the yield file"
              title="Remove"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-gray-500">
          None. Without one, yield is the scale total spread by satellite vigour or evenly.
        </p>
      )}
      {open && (
        <YieldImport
          fieldId={fieldId}
          fieldName={fieldName}
          cropYear={cropYear}
          hasScaleTotal={hasScaleTotal}
          fieldBbox={bbox}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  )
}
