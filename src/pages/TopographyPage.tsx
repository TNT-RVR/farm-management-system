import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Mountain, TriangleAlert } from 'lucide-react'
import { Select } from '@/components/Select'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import {
  bestPerField,
  colourStops,
  radiusStops,
  rampSteps,
  useTopoCells,
  useTopoSurfaces,
  ELEVATION_COLOURS,
  REM_COLOURS,
  type TopoMode,
} from '@/lib/topography'
import { farmMapCenter } from '@/lib/farm-setup'
import { ImportHint } from '@/components/ImportHint'

/**
 * The lay of the land, built from what the machines already logged.
 *
 * Every John Deere pass records a height at every point. Gridded, that is a
 * surface good to a hundredth of a foot — against the six colour bands, about
 * 3.7 ft apart, that Operations Center draws from the same data. A wet spot
 * that ponds is six inches low: visible here, invisible there.
 *
 * TWO LAYERS, AND THE SECOND IS THE USEFUL ONE. Elevation says where the hill
 * is, which anybody who farms it already knows. The Relative Elevation Model
 * says how far each spot sits above or below the ground immediately around it,
 * which is where water goes — and it survives having no LiDAR, because a
 * constant offset and a tilt both cancel out of a difference.
 *
 * NOT TIED TO SEA LEVEL, and the page says so where somebody might act on it.
 * No LiDAR covers this farm and the RTK base station changes between passes, so
 * the heights are consistent within a field and mean nothing between one field
 * and the next. Nobody should price a scraper job off this.
 */
export function TopographyPage() {
  const { data: all, isLoading } = useTopoSurfaces()
  // One per field, the best-covered. See bestPerField for why the puller's
  // choice is not the final one.
  const surfaces = useMemo(() => bestPerField(all ?? []), [all])
  const [surfaceId, setSurfaceId] = useState<string | null>(null)
  const [mode, setMode] = useState<TopoMode>('rem')

  const surface = useMemo(
    () => surfaces.find((s) => s.id === surfaceId) ?? surfaces[0] ?? null,
    [surfaces, surfaceId],
  )
  const { data: cells, isFetching } = useTopoCells(surface?.id ?? null)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)

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

    // MapLibre reports its failures HERE and nowhere else, and then carries on
    // drawing an empty map. That is how every symbol layer in this app was
    // invisible for months over a missing glyphs URL: the library said so on
    // this channel every time and nothing was listening. A map that fails
    // silently looks exactly like a map with nothing on it.
    map.on('error', (e) => setMapError(e.error?.message ?? 'The map failed to draw'))

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  const stops = useMemo(() => colourStops(cells ?? [], mode), [cells, mode])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !cells?.length) return

    const data = {
      type: 'FeatureCollection' as const,
      features: cells.map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [c.lon, c.lat] },
        properties: { elev: c.elev_ft, rem: c.rem_ft ?? 0, n: c.n_points },
      })),
    }

    const src = map.getSource('topo') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(data)
    else map.addSource('topo', { type: 'geojson', data })

    const radius = radiusStops(surface?.cell_m ?? 5, cells[0]?.lat ?? 49.9)
    const steps = rampSteps(stops, mode === 'rem' ? REM_COLOURS : ELEVATION_COLOURS)
    const colour: maplibregl.DataDrivenPropertyValueSpecification<string> = [
      'interpolate',
      ['linear'],
      ['get', mode === 'rem' ? 'rem' : 'elev'],
      ...steps.flatMap((s) => [s.value, s.colour]),
    ] as never

    if (!map.getLayer('topo-cells')) {
      map.addLayer({
        id: 'topo-cells',
        type: 'circle',
        source: 'topo',
        paint: {
          // Sized from the cell's real extent on the ground — see radiusStops.
          // Hand-picked pixel values were wrong at both ends; at zoom 12 a 5 m
          // cell is four tenths of a pixel across.
          // `zoom` has to be the direct input of a top-level interpolate;
          // MapLibre rejects it nested inside anything, `max` included. The
          // floor is baked into each stop instead — see radiusStops.
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], ...radius] as never,
          'circle-color': colour,
          'circle-opacity': 0.85,
          'circle-blur': 0.25,
        },
      })
    } else {
      map.setPaintProperty('topo-cells', 'circle-color', colour)
    }

    // Frame the field the first time its cells arrive.
    const lons = cells.map((c) => c.lon)
    const lats = cells.map((c) => c.lat)
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 40, duration: 600 },
    )
  }, [cells, ready, mode, stops, surface?.cell_m])

  const legend = rampSteps(stops, mode === 'rem' ? REM_COLOURS : ELEVATION_COLOURS)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 bg-white px-4 pt-4 md:px-6">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
          <Mountain className="h-5 w-5" /> Topography
        </h1>
        <p className="mt-0.5 text-xs text-gray-500">
          Built from the elevation John Deere logs on every pass. Heights are consistent within a
          field and are <strong>not</strong> tied to sea level — good for finding water, not for
          pricing a scraper job.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 pb-3">
          <Select
            value={surface?.id ?? ''}
            ariaLabel="Field"
            onChange={(v) => setSurfaceId(v)}
            options={surfaces.map((s) => ({
              value: s.id,
              label: `${s.field_name} — ${s.relief_ft} ft`,
            }))}
          />
          <Select
            value={mode}
            ariaLabel="Layer"
            onChange={(v) => setMode(v as TopoMode)}
            options={[
              { value: 'rem', label: 'Relative height (where water goes)' },
              { value: 'elevation', label: 'Elevation' },
            ]}
            size="sm"
          />
          {isFetching && <span className="text-xs text-gray-400">Loading cells…</span>}
        </div>
      </div>

      {/* The container is mounted UNCONDITIONALLY, and the states sit on top of
          it. It was inside the loading branch, which meant that on the first
          paint — while the surfaces were still being fetched — there was no
          element for the map to attach to. The init effect ran once, found a
          null ref, returned, and never ran again, so MapLibre was never
          constructed at all: field picker, layer picker and legend all drew
          correctly over a blank white rectangle. MapPage does it this way and
          does not have the problem. */}
      <div className="relative flex-1">
        {/* h-full, NOT `absolute inset-0`.
            MapLibre's own stylesheet carries `.maplibregl-map { position:
            relative }`, and it is emitted after Tailwind's utilities, so with
            equal specificity it wins over `.absolute`. The moment the map was
            constructed the container lost `position: absolute`, `inset-0` had
            nothing left to stretch, and it collapsed to height:auto — which is
            zero, because the canvas inside is itself absolutely positioned and
            contributes no height. The map was built, the canvas existed, the
            legend drew: 1712 px wide and 0 px tall.
            Measured in the live page: forcing position back to absolute gave it
            674 px at once. An explicit size does not depend on the position
            property at all, which is why MapPage has never had this. */}
        <div ref={containerRef} className="h-full w-full" />

        {mapError && (
          <p
            className="absolute inset-x-3 top-3 z-10 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 shadow"
            title={mapError}
          >
            The map couldn&rsquo;t load. Try reloading the page.
          </p>
        )}

        {isLoading ? (
          <p className="absolute inset-x-0 top-6 text-center text-sm text-gray-500">Loading…</p>
        ) : !surfaces.length ? (
          <div className="absolute inset-x-4 top-4 rounded-md bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
            No elevation maps yet.
            <ImportHint what="elevation maps from John Deere field data" script="scripts/topo-load.mjs" screen="Map → Topography">
              <span className="mt-1 block text-xs text-gray-400">
                Pull the John Deere exports and run the gridder — see docs/TOPOGRAPHY-COVERAGE-AUDIT.md.
              </span>
            </ImportHint>
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute bottom-6 left-3 rounded-lg bg-white/95 p-3 text-xs shadow">
              <p className="mb-1 font-semibold text-gray-700">
                {mode === 'rem' ? 'Feet above local ground' : 'Elevation (ft)'}
              </p>
              <div className="flex h-3 w-44 overflow-hidden rounded">
                {legend.map((s) => (
                  <div key={s.value} className="flex-1" style={{ background: s.colour }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between tabular-nums text-gray-500">
                <span>
                  {mode === 'rem' ? '' : ''}
                  {legend[0].value.toFixed(mode === 'rem' ? 1 : 0)}
                </span>
                <span>{legend[legend.length - 1].value.toFixed(mode === 'rem' ? 1 : 0)}</span>
              </div>
              {mode === 'rem' && (
                <p className="mt-1.5 max-w-44 text-[11px] leading-snug text-gray-500">
                  Blue sits lower than the ground around it — that is where water collects.
                </p>
              )}
            </div>

            {surface && (
              <div className="absolute right-3 top-3 max-w-64 rounded-lg bg-white/95 p-3 text-xs shadow">
                <p className="font-semibold text-gray-800">{surface.field_name}</p>
                <p className="mt-0.5 text-gray-500">
                  {surface.operation_type} · {surface.operation_date}
                </p>
                <dl className="mt-2 space-y-0.5 text-gray-600">
                  <div className="flex justify-between gap-3">
                    <dt>Relief</dt>
                    <dd className="tabular-nums">{surface.relief_ft} ft</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Cells</dt>
                    <dd className="tabular-nums">
                      {surface.cell_count.toLocaleString('en-CA')} at {surface.cell_m} m
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>From</dt>
                    <dd className="tabular-nums">
                      {surface.point_count.toLocaleString('en-CA')} points
                    </dd>
                  </div>
                </dl>
                {!surface.antenna_corrected && (
                  <p className="mt-2 flex items-start gap-1 text-[11px] leading-snug text-amber-700">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Antenna height not subtracted — a machine on this pass has never been measured.
                    The shape is right; every height is high by one mast.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
