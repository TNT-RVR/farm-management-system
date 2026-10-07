import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection } from 'geojson'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { PillTabs } from '@/components/PillTabs'
import type { RxMapPolygon } from '@/lib/fertility-rx'
import { farmMapCenter } from '@/lib/farm-setup'

const SRC = 'rx-zones'
const FILL = 'rx-zone-fill'
const LINE = 'rx-zone-line'

/**
 * Rate to colour, pale through dark.
 *
 * Scaled to the range in THIS prescription rather than to a fixed scale: the
 * rates run 109–175 on one field and 50–250 on another, and a shared scale
 * would flatten the first to one shade — which is the exact thing somebody is
 * looking at this map to see.
 */
export const RATE_RAMP = [
  '#fef3c7',
  '#fde68a',
  '#fbbf24',
  '#f59e0b',
  '#d97706',
  '#b45309',
  '#92400e',
]

export function rateColour(rate: number | null, min: number, max: number): string {
  if (rate == null) return '#9ca3af'
  if (max <= min) return RATE_RAMP[Math.floor(RATE_RAMP.length / 2)]
  const t = (rate - min) / (max - min)
  return RATE_RAMP[
    Math.min(RATE_RAMP.length - 1, Math.max(0, Math.round(t * (RATE_RAMP.length - 1))))
  ]
}

function toFeatures(polys: RxMapPolygon[], min: number, max: number): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: polys.map<Feature>((p) => ({
      type: 'Feature',
      id: p.id,
      properties: {
        rate: p.target_rate,
        acres: p.acres,
        colour: rateColour(p.target_rate, min, max),
      },
      geometry: p.geometry,
    })),
  }
}

/** The bounding box of everything drawn, for the initial fit. */
function boundsOf(polys: RxMapPolygon[]): maplibregl.LngLatBounds | null {
  const b = new maplibregl.LngLatBounds()
  let any = false
  for (const p of polys) {
    for (const poly of p.geometry.coordinates) {
      for (const ring of poly) {
        for (const [lng, lat] of ring) {
          b.extend([lng, lat])
          any = true
        }
      }
    }
  }
  return any ? b : null
}

/**
 * The prescription drawn on the ground it was written for.
 *
 * This is the half the PDF cannot give: it lists each zone's acres and rate but
 * never where the zone is. The applicator file does, so where one has been
 * imported the zones are real shapes over the satellite image, shaded by rate.
 */
export function RxZoneMap({ polygons: all }: { polygons: RxMapPolygon[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [hover, setHover] = useState<{ rate: number | null; acres: number | null } | null>(null)

  // One field can carry several prescriptions in a season — Ray Daltons was
  // written urea, phosphate and durum blend for 2025, over the same ground at
  // different rates. Drawn together they would simply cover each other up, so
  // one is shown at a time and the rate ramp belongs to that one.
  const products = useMemo(() => [...new Set(all.map((p) => p.product ?? 'Prescription'))], [all])
  const [product, setProduct] = useState<string | null>(null)
  const shown = product && products.includes(product) ? product : products[0]
  const polygons = useMemo(
    () => all.filter((p) => (p.product ?? 'Prescription') === shown),
    [all, shown],
  )

  const rates = useMemo(
    () => polygons.map((p) => p.target_rate).filter((r): r is number => r != null),
    [polygons],
  )
  const min = rates.length ? Math.min(...rates) : 0
  const max = rates.length ? Math.max(...rates) : 0
  const data = useMemo(() => toFeatures(polygons, min, max), [polygons, min, max])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 12,
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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const existing = map.getSource(SRC) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
    } else {
      map.addSource(SRC, { type: 'geojson', data })
      map.addLayer({
        id: FILL,
        type: 'fill',
        source: SRC,
        paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.75 },
      })
      map.addLayer({
        id: LINE,
        type: 'line',
        source: SRC,
        paint: { 'line-color': '#78350f', 'line-width': 0.6, 'line-opacity': 0.8 },
      })
      map.on('mousemove', FILL, (e) => {
        const f = e.features?.[0]
        setHover(
          f
            ? {
                rate: (f.properties?.rate as number) ?? null,
                acres: (f.properties?.acres as number) ?? null,
              }
            : null,
        )
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', FILL, () => {
        setHover(null)
        map.getCanvas().style.cursor = ''
      })
    }
    const bounds = boundsOf(polygons)
    if (bounds) map.fitBounds(bounds, { padding: 24, duration: 0 })
  }, [ready, data, polygons])

  if (all.length === 0) return null

  const acres = polygons.reduce((a, p) => a + (p.acres ?? 0), 0)

  return (
    <div className="space-y-2">
      {products.length > 1 && (
        <PillTabs
          tabs={products.map((p) => ({ key: p, label: p }))}
          value={shown}
          onChange={setProduct}
          className="border-b-0 pb-0"
        />
      )}
      <div className="relative overflow-hidden rounded-lg border border-gray-200">
        <div ref={containerRef} className="h-72 w-full" />
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-xs text-gray-700 shadow">
          {hover ? (
            <span className="font-medium">
              {hover.rate == null ? 'no rate' : `${hover.rate} lbs/ac`}
              {hover.acres != null && ` · ${hover.acres} ac`}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span>{min}</span>
              {RATE_RAMP.map((c) => (
                <span key={c} className="inline-block h-2 w-4" style={{ backgroundColor: c }} />
              ))}
              <span>{max} lbs/ac</span>
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500">
        {shown} — {polygons.length} polygons,{' '}
        {acres.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac, shaded by target rate.
      </p>
    </div>
  )
}
