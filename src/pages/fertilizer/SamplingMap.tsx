import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson'
import { MapPin, Trash2, X } from 'lucide-react'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { Select } from '@/components/Select'
import { ConfirmDialog } from '@/components/Modal'
import { cn } from '@/lib/utils'
import { boundariesForYear, useAllBoundaries, useFields } from '@/lib/queries'
import { useRxMapsForYear } from '@/lib/fertility-rx'
import { useFieldSoilReports } from '@/lib/soilTests'
import { RATE_RAMP, rateColour } from './RxZoneMap'
import {
  nextCode,
  sitesForYear,
  useSampleSiteMutations,
  useSampleSites,
  type SampleSite,
} from '@/lib/soil-sites'
import { farmMapCenter } from '@/lib/farm-setup'

const ZONES = 'rx-zone'
const BOUNDS = 'field-bounds'
const SITES = 'sample-sites'

const n1 = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

/**
 * Where the cores were pulled, over the ground the prescription was written for.
 *
 * Two things on one map because they only mean anything together: a zone map
 * says the north end wants more phosphate, and the sample points say which core
 * that conclusion came from. Either alone leaves somebody guessing — which core
 * was the knoll, or why this zone is rated the way it is.
 *
 * Sites are marked by clicking. They are durable: the point of writing down
 * where a core was pulled is to pull the next one from the same place, so a
 * site with no year set shows up every season.
 */
export function SamplingMap({
  fieldId,
  setFieldId,
  cropYear,
  canEdit,
}: {
  fieldId: string | null
  setFieldId: (id: string | null) => void
  cropYear: number
  canEdit: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SampleSite | null>(null)
  const [showZones, setShowZones] = useState(true)
  const [product, setProduct] = useState<string | null>(null)

  const { data: fields } = useFields()
  const { data: boundaries } = useAllBoundaries()
  const { data: allSites } = useSampleSites()
  const { data: rxByField } = useRxMapsForYear(cropYear)
  const { data: reports } = useFieldSoilReports(fieldId)
  const mut = useSampleSiteMutations()

  // The listener is attached once, so it cannot close over state that changes.
  const droppingRef = useRef(false)
  useEffect(() => {
    droppingRef.current = dropping
  }, [dropping])
  const fieldRef = useRef<string | null>(null)
  useEffect(() => {
    fieldRef.current = fieldId
  }, [fieldId])

  const sites = useMemo(() => {
    const forYear = sitesForYear(allSites ?? [], cropYear)
    return fieldId ? forYear.filter((s) => s.field_id === fieldId) : forYear
  }, [allSites, cropYear, fieldId])

  const addRef = useRef<(lng: number, lat: number) => void>(() => {})
  useEffect(() => {
    addRef.current = (lng, lat) => {
      const f = fieldRef.current
      if (!f) return
      const mine = (allSites ?? []).filter((s) => s.field_id === f)
      mut.add.mutate({
        field_id: f,
        code: nextCode(mine.map((s) => s.code)),
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        // Marked against the year being looked at. A site that should stand
        // every year is cleared to "every year" from the list beside the map,
        // rather than being guessed at here.
        crop_year: cropYear,
      })
    }
  }, [allSites, cropYear, mut.add])

  const rx = useMemo(() => {
    const all = fieldId ? (rxByField?.get(fieldId) ?? []) : [...(rxByField?.values() ?? [])].flat()
    return all
  }, [rxByField, fieldId])

  const products = useMemo(() => [...new Set(rx.map((p) => p.product ?? 'Prescription'))], [rx])
  const shownProduct = product && products.includes(product) ? product : products[0]
  const zonePolys = useMemo(
    () => rx.filter((p) => (p.product ?? 'Prescription') === shownProduct),
    [rx, shownProduct],
  )
  const rates = zonePolys.map((p) => p.target_rate).filter((r): r is number => r != null)
  const min = rates.length ? Math.min(...rates) : 0
  const max = rates.length ? Math.max(...rates) : 0

  const fieldBounds = useMemo(() => {
    const forYear = boundaries ? boundariesForYear(boundaries, cropYear) : []
    return fieldId ? forYear.filter((b) => b.field_id === fieldId) : forYear
  }, [boundaries, cropYear, fieldId])

  /** The lab numbers behind a site, matched on the code the report used. */
  const resultFor = (site: SampleSite) => {
    for (const r of reports ?? []) {
      if (r.crop_year !== (site.crop_year ?? r.crop_year)) continue
      const hit = r.samples.find((s) => s.sample_code?.trim() === site.code.trim())
      if (hit) return { report: r, sample: hit }
    }
    return null
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 11,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => setReady(true))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Zones underneath, boundaries over them, pins on top — otherwise a filled
  // zone hides the pins that explain it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: showZones
        ? zonePolys.map<Feature>((p) => ({
            type: 'Feature',
            id: p.id,
            properties: {
              rate: p.target_rate,
              acres: p.acres,
              colour: rateColour(p.target_rate, min, max),
            },
            geometry: p.geometry,
          }))
        : [],
    }
    const src = map.getSource(ZONES) as GeoJSONSource | undefined
    if (src) {
      src.setData(data)
      return
    }
    map.addSource(ZONES, { type: 'geojson', data })
    map.addLayer({
      id: `${ZONES}-fill`,
      type: 'fill',
      source: ZONES,
      paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.55 },
    })
    map.addLayer({
      id: `${ZONES}-line`,
      type: 'line',
      source: ZONES,
      paint: { 'line-color': '#78350f', 'line-width': 0.6, 'line-opacity': 0.7 },
    })
  }, [ready, zonePolys, showZones, min, max])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: fieldBounds
        .filter((b) => b.geometry)
        .map<Feature>((b) => ({
          type: 'Feature',
          id: b.id,
          properties: {},
          geometry: b.geometry as unknown as MultiPolygon,
        })),
    }
    const src = map.getSource(BOUNDS) as GeoJSONSource | undefined
    if (src) {
      src.setData(data)
      return
    }
    map.addSource(BOUNDS, { type: 'geojson', data })
    map.addLayer({
      id: `${BOUNDS}-line`,
      type: 'line',
      source: BOUNDS,
      paint: { 'line-color': '#fff', 'line-width': 1.5, 'line-opacity': 0.9 },
    })
  }, [ready, fieldBounds])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: sites.map<Feature>((s) => ({
        type: 'Feature',
        id: s.id,
        properties: { id: s.id, code: s.code, benchmark: s.crop_year == null },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    }
    const src = map.getSource(SITES) as GeoJSONSource | undefined
    if (src) {
      src.setData(data)
      return
    }
    map.addSource(SITES, { type: 'geojson', data })
    map.addLayer({
      id: `${SITES}-dot`,
      type: 'circle',
      source: SITES,
      paint: {
        'circle-radius': 9,
        // A benchmark site is a different kind of thing from this year's grid,
        // and which is which decides whether you go back to it next year.
        'circle-color': ['case', ['get', 'benchmark'], '#0ea5e9', '#111827'],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: `${SITES}-label`,
      type: 'symbol',
      source: SITES,
      layout: {
        'text-field': ['get', 'code'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#fff' },
    })
  }, [ready, sites])

  // Fit to the field when one is picked, or to the sites when it is all fields.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const b = new maplibregl.LngLatBounds()
    let any = false
    for (const fb of fieldBounds) {
      const g = fb.geometry as unknown as MultiPolygon | null
      for (const poly of g?.coordinates ?? [])
        for (const ring of poly)
          for (const c of ring) {
            b.extend([c[0], c[1]])
            any = true
          }
    }
    if (!any) {
      for (const s of sites) {
        b.extend([s.lng, s.lat])
        any = true
      }
    }
    if (any) map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 400 })
  }, [ready, fieldId, fieldBounds, sites])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const onClick = (e: MapMouseEvent) => {
      if (!droppingRef.current) return
      addRef.current(e.lngLat.lng, e.lngLat.lat)
    }
    const onPin = (e: MapMouseEvent & { features?: Feature[] }) => {
      if (droppingRef.current) return
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') setSelected(id)
    }
    map.on('click', onClick)
    map.on('click', `${SITES}-dot`, onPin)
    return () => {
      map.off('click', onClick)
      map.off('click', `${SITES}-dot`, onPin)
    }
  }, [ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.getCanvas().style.cursor = dropping ? 'crosshair' : ''
  }, [ready, dropping])

  const fieldName = (id: string) => fields?.find((f) => f.id === id)?.name ?? 'Unknown field'
  const chosen = sites.find((s) => s.id === selected) ?? null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={fieldId ?? ''}
          ariaLabel="Field"
          className="w-56"
          onChange={(v) => setFieldId(v || null)}
          options={[
            { value: '', label: 'All fields' },
            ...(fields ?? []).filter((f) => f.active).map((f) => ({ value: f.id, label: f.name })),
          ]}
        />

        {products.length > 0 && (
          <>
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={showZones}
                onChange={(e) => setShowZones(e.target.checked)}
              />
              Fertilizer zones
            </label>
            {products.length > 1 && showZones && (
              <Select
                value={shownProduct ?? ''}
                ariaLabel="Which prescription"
                size="sm"
                className="w-44"
                onChange={setProduct}
                options={products.map((p) => ({ value: p, label: p }))}
              />
            )}
          </>
        )}

        {canEdit && (
          <button
            onClick={() => setDropping((d) => !d)}
            disabled={!fieldId}
            title={fieldId ? undefined : 'Pick a field first — a site belongs to one'}
            className={cn(
              'ml-auto flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40',
              dropping
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-brand-700 text-white hover:bg-brand-800',
            )}
          >
            <MapPin className="h-3.5 w-3.5" />
            {dropping ? 'Click the map · done' : 'Drop sample points'}
          </button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <div className="relative overflow-hidden rounded-lg border border-gray-200">
          <div ref={containerRef} className="h-[30rem] w-full" />
          {dropping && (
            <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm shadow-lg">
              <MapPin className="h-4 w-4 text-amber-600" />
              <span>
                Click each spot in <strong>{fieldId ? fieldName(fieldId) : ''}</strong> — they
                number themselves
              </span>
              <button
                onClick={() => setDropping(false)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100"
                aria-label="Stop dropping points"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {showZones && zonePolys.length > 0 && (
            <div className="absolute bottom-3 left-3 rounded-md border border-gray-200 bg-white/95 px-2.5 py-2 text-[11px] shadow">
              <p className="mb-1 font-medium text-gray-700">{shownProduct} — target rate</p>
              <div className="flex items-center gap-1">
                <span className="tabular-nums text-gray-500">{n1(min)}</span>
                {RATE_RAMP.map((c) => (
                  <span key={c} className="h-3 w-4" style={{ background: c }} />
                ))}
                <span className="tabular-nums text-gray-500">{n1(max)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <h3 className="border-b border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">
            {sites.length} sample {sites.length === 1 ? 'site' : 'sites'}
            {fieldId ? '' : ' · all fields'}
          </h3>
          {sites.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500">
              {fieldId
                ? 'None marked. Drop points where the cores were pulled — the value is going back to the same spot next year.'
                : 'Pick a field to start marking sites.'}
            </p>
          ) : (
            <ul className="max-h-[26rem] divide-y divide-gray-100 overflow-y-auto">
              {sites.map((s) => {
                const hit = resultFor(s)
                return (
                  <li
                    key={s.id}
                    className={cn('px-3 py-2 text-sm', selected === s.id && 'bg-amber-50')}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setSelected(s.id)
                          mapRef.current?.flyTo({ center: [s.lng, s.lat], zoom: 16 })
                        }}
                        className="flex items-center gap-1.5 font-medium text-gray-900 hover:underline"
                      >
                        <span
                          className="inline-block h-3 w-3 rounded-full border border-white ring-1 ring-black/20"
                          style={{ background: s.crop_year == null ? '#0ea5e9' : '#111827' }}
                        />
                        {s.code}
                      </button>
                      {!fieldId && (
                        <span className="truncate text-xs text-gray-500">
                          {fieldName(s.field_id)}
                        </span>
                      )}
                      {canEdit && (
                        <span className="ml-auto flex items-center gap-1">
                          <button
                            onClick={() =>
                              mut.update.mutate({
                                id: s.id,
                                patch: { crop_year: s.crop_year == null ? cropYear : null },
                              })
                            }
                            className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100"
                            title={
                              s.crop_year == null
                                ? 'Currently a benchmark — shown every year'
                                : `Currently ${s.crop_year} only`
                            }
                          >
                            {s.crop_year == null ? 'every year' : String(s.crop_year)}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(s)}
                            className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Delete site ${s.code}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                    </div>

                    {hit ? (
                      <p className="mt-0.5 text-xs text-gray-600">
                        {hit.sample.depth_label ?? ''} · {n1(hit.sample.no3n_lb_ac)} lb N ·{' '}
                        {n1(hit.sample.p_bicarb_ppm)} P · {n1(hit.sample.k_ppm)} K ·{' '}
                        {n1(hit.sample.so4s_ppm)} S · pH {n1(hit.sample.ph)}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-gray-400">
                        No lab result matching code “{s.code}”{fieldId ? '' : ' in this field'}.
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {(mut.add.error || mut.update.error) && (
            <p className="border-t border-gray-100 px-3 py-2 text-xs text-red-700">
              {((mut.add.error ?? mut.update.error) as Error).message}
            </p>
          )}
        </div>
      </div>

      {chosen && (
        <p className="text-xs text-gray-500">
          Site {chosen.code} · {chosen.lat.toFixed(5)}, {chosen.lng.toFixed(5)} — take these to the
          GPS to pull next year&rsquo;s core from the same spot.
        </p>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete site ${confirmDelete.code}?`}
          message="The pin goes. Lab results already filed against that code stay where they are — they are the report's, not the pin's."
          onConfirm={() => {
            mut.remove.mutate(confirmDelete.id)
            if (selected === confirmDelete.id) setSelected(null)
            setConfirmDelete(null)
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
