import { useEffect, useMemo, useRef, useState } from 'react'
import { useLandDeals } from '@/lib/land-deals-data'
import { useFixedAreas, useFixedPerAcre, useLandSharePerAcre } from '@/lib/farm-costs'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TriangleAlert } from 'lucide-react'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { useProductResolver } from '@/lib/products'
import { boundariesForYear, useAllBoundaries, useFields } from '@/lib/queries'
import { colourStops } from '@/lib/profit-loss'
import { money } from '@/lib/profit-loss-lines'
import { farmBooks, farmTotals, seasonsFrom, useFarmData, type FieldBooks } from '@/lib/profit-loss-farm'
import { useOperatingCostLines } from '@/lib/operating-costs'
import { useSeasonFuelOps } from '@/lib/hauling-data'
import { Legend } from '@/components/ProfitLossLines'
import { BreakevenCard } from '@/components/BreakevenCard'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { farmMapCenter } from '@/lib/farm-setup'

/** Fields with no yield yet: real costs, no revenue, so no profit colour. */
const NO_YIELD = '#9ca3af'

/**
 * The whole farm on one map: each field coloured by its net per acre, on one
 * scale, so the fields can be compared at a glance. Tapping a field opens its
 * 5 m map and its input/output tables.
 */
export function ProfitLossFarm({
  cropYear,
  priceMode,
  onPickField,
}: {
  cropYear: number
  priceMode: 'target' | 'actual'
  onPickField: (fieldId: string) => void
}) {
  const { data: fields } = useFields()
  const { data: allBoundaries } = useAllBoundaries()
  const { data, isLoading, error } = useFarmData(cropYear)
  const resolve = useProductResolver()
  const { data: deals } = useLandDeals()
  const fixed = useFixedPerAcre(cropYear)
  const fixedAreas = useFixedAreas(cropYear)
  const { data: landSharePerAcre } = useLandSharePerAcre(cropYear)
  // Fuel and trucking per field, priced the same as each field's own page.
  const { data: fuelOps } = useSeasonFuelOps(cropYear)
  const operatingLines = useOperatingCostLines(cropYear, fuelOps)

  const seasons = useMemo(() => (data ? seasonsFrom(data, priceMode) : new Map()), [data, priceMode])
  const books = useMemo(() => {
    if (!data || !fields || !resolve) return []
    return farmBooks({
      cropYear,
      fields: fields.map((f) => ({ id: f.id, name: f.name })),
      seasons,
      ops: data.ops,
      layers: data.layers,
      saved: data.saved,
      resolve,
      priceSource: priceMode,
      deals: deals ?? [],
      fixedPerAcre: fixed.perAcre,
      fixedFrom: fixed.carriedFrom,
      fixedAreas,
      landSharePerAcre: landSharePerAcre ?? null,
      extraLines: operatingLines,
    })
  }, [data, fields, resolve, cropYear, priceMode, seasons, deals, fixed.perAcre, fixed.carriedFrom, fixedAreas, landSharePerAcre, operatingLines])
  const totals = useMemo(() => farmTotals(books), [books])

  const withNet = books.filter((b) => b.netPerAcre != null).map((b) => b.netPerAcre!)
  const range: [number, number] = withNet.length ? [Math.min(...withNet), Math.max(...withNet)] : [-1, 1]
  const stops = useMemo(() => colourStops(range), [range[0], range[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [hover, setHover] = useState<FieldBooks | null>(null)
  const booksRef = useRef<FieldBooks[]>([])
  const pickRef = useRef(onPickField)
  useEffect(() => {
    booksRef.current = books
    pickRef.current = onPickField
  }, [books, onPickField])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 10,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.on('load', () => setReady(true))
    // MapLibre reports failures here and nowhere else — see TopographyPage.
    map.on('error', (e) => setMapError(e.error?.message ?? 'The map failed to draw'))
    const find = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.fieldId
      return booksRef.current.find((b) => b.fieldId === id) ?? null
    }
    map.on('click', 'pl-farm-fill', (e) => {
      const b = find(e)
      if (b) pickRef.current(b.fieldId)
    })
    map.on('mousemove', 'pl-farm-fill', (e) => {
      map.getCanvas().style.cursor = 'pointer'
      setHover(find(e))
    })
    map.on('mouseleave', 'pl-farm-fill', () => {
      map.getCanvas().style.cursor = ''
      setHover(null)
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  const framed = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !allBoundaries) return
    const byField = new Map(books.map((b) => [b.fieldId, b]))
    const shapes = boundariesForYear(allBoundaries, cropYear).filter((s) => byField.has(s.field_id))
    const data = {
      type: 'FeatureCollection' as const,
      features: shapes.map((s) => {
        const b = byField.get(s.field_id)!
        return {
          type: 'Feature' as const,
          geometry: s.geometry as unknown as GeoJSON.Geometry,
          properties: { fieldId: s.field_id, npa: b.netPerAcre ?? 0, has: b.hasYield ? 1 : 0 },
        }
      }),
    }
    const src = map.getSource('pl-farm') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(data)
    else map.addSource('pl-farm', { type: 'geojson', data })

    const colour = [
      'case',
      ['==', ['get', 'has'], 1],
      ['interpolate', ['linear'], ['get', 'npa'], ...stops.flatMap((s) => [s.value, s.colour])],
      NO_YIELD,
    ] as never
    if (!map.getLayer('pl-farm-fill')) {
      map.addLayer({ id: 'pl-farm-fill', type: 'fill', source: 'pl-farm', paint: { 'fill-color': colour, 'fill-opacity': 0.75 } })
      map.addLayer({ id: 'pl-farm-line', type: 'line', source: 'pl-farm', paint: { 'line-color': '#ffffff', 'line-width': 1.5 } })
    } else {
      map.setPaintProperty('pl-farm-fill', 'fill-color', colour)
    }

    if (!framed.current && data.features.length) {
      framed.current = true
      const bounds = new maplibregl.LngLatBounds()
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === 'number') bounds.extend(c as [number, number])
        else if (Array.isArray(c)) c.forEach(walk)
      }
      for (const f of data.features) walk((f.geometry as { coordinates?: unknown }).coordinates)
      map.fitBounds(bounds, { padding: 40, duration: 600 })
    }
  }, [ready, allBoundaries, books, stops, cropYear])

  return (
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
        {withNet.length > 0 && <Legend stops={stops} />}
        {hover && (
          <div className="pointer-events-none absolute right-3 top-3 w-56 rounded-lg bg-white/95 p-3 text-xs shadow">
            <p className="font-semibold text-gray-800">{hover.name}</p>
            <p className="text-gray-500">
              {hover.cropName ?? 'no crop'} · {hover.acres.toFixed(1)} ac
            </p>
            <p className="mt-1 text-gray-800">
              {hover.netPerAcre != null ? `Net ${money(hover.netPerAcre)}/ac` : `No yield yet · ${money(hover.costPerAcre)}/ac spent`}
            </p>
            <p className="mt-1 text-[11px] text-gray-400">Click for the 5 m map</p>
          </div>
        )}
      </div>

      <aside className="w-full shrink-0 space-y-4 overflow-y-auto border-t border-gray-200 bg-gray-50 p-4 md:w-[28rem] md:border-l md:border-t-0">
        {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{(error as Error).message}</p>}
        {isLoading && <p className="text-sm text-gray-500">Loading the farm…</p>}

        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-gray-800">
            Whole farm · {cropYear} · {priceMode} prices
          </h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600">Harvested</dt>
              <dd className="tabular-nums text-gray-800">
                {totals.harvestedFields} field{totals.harvestedFields === 1 ? '' : 's'} · {totals.harvestedAcres.toFixed(0)} ac
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600">Outputs</dt>
              <dd className="tabular-nums text-gray-800">{money(totals.revenue)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600">Inputs</dt>
              <dd className="tabular-nums text-gray-800">− {money(totals.cost)}</dd>
            </div>
            {totals.ownerShare !== 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-600">Land owners&apos; share</dt>
                <dd className="tabular-nums text-gray-800">− {money(totals.ownerShare)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-gray-100 pt-1">
              <dt className="font-semibold text-gray-800">Net</dt>
              <dd className="font-semibold tabular-nums text-gray-900">
                {money(totals.net)} ({money(totals.netPerAcre)}/ac)
              </dd>
            </div>
          </dl>
          {totals.unharvestedFields > 0 && (
            <p className="mt-2 text-xs text-gray-600">
              {totals.unharvestedFields} more field{totals.unharvestedFields === 1 ? ' has' : 's have'} no yield yet and{' '}
              {money(totals.unharvestedCost)} spent so far — grey on the map, and not counted in the net above.
            </p>
          )}
          {fixed.perAcre != null && (
            <HelpNote
              className="mt-2"
              summary={`Inputs include fixed expenses of ${money(fixed.perAcre, 2)}/ac on every field.`}
              title="Fixed expenses"
            >
              Inputs include the farm&apos;s fixed expenses, {money(fixed.perAcre, 2)}/ac on every field (Financials → Farm costs):
              land, machinery, labour and overhead, with any farm total for the year divided over the crop plan&apos;s acres. A field
              can have the row typed over or taken off.
            </HelpNote>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-gray-800">Fields, best to worst</h2>
          <ul className="mt-2 divide-y divide-gray-100 text-xs">
            {books.map((b) => (
              <li key={b.fieldId}>
                <button
                  type="button"
                  onClick={() => onPickField(b.fieldId)}
                  className="flex w-full items-center justify-between gap-2 py-1.5 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-gray-800">{b.name}</span>
                    <span className="block truncate text-[10px] text-gray-400">
                      {b.cropName ?? 'no crop'} · {b.acres.toFixed(1)} ac
                      {b.unpriced > 0 && ` · ${b.unpriced} unpriced`}
                      {b.deal && <span className="block text-[10px] text-sky-700">{b.deal}</span>}
                    </span>
                  </span>
                  <span className={cn('shrink-0 tabular-nums', b.netPerAcre == null ? 'text-gray-400' : b.netPerAcre < 0 ? 'text-red-700' : 'text-green-800')}>
                    {b.netPerAcre != null ? `${money(b.netPerAcre)}/ac` : `${money(b.costPerAcre)}/ac spent`}
                  </span>
                </button>
              </li>
            ))}
            {!books.length && !isLoading && <li className="py-2 text-gray-500">No fields with crops or passes this year.</li>}
          </ul>
          {books.some((b) => b.unpriced > 0) && (
            <p className="mt-2 flex items-start gap-1 text-[11px] leading-snug text-amber-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Some fields have inputs with no price, left out of their totals. Open the field to type the price in.
            </p>
          )}
        </section>

        <BreakevenCard books={books} seasons={seasons} />
      </aside>
    </div>
  )
}
