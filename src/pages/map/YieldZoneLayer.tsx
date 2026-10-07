import { useEffect, useMemo, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import {
  midYield,
  rangeLabel,
  useYieldZones,
  yieldBands,
  yieldColour,
  type YieldZone,
} from '@/lib/yield-zones'

const SRC = 'yield-zones'
const FILL = 'yield-zones-fill'
const LINE = 'yield-zones-line'

/**
 * The agronomist's productivity zones, on the farm map.
 *
 * Drawn UNDER the field boundaries, because it is what the fields are made of
 * rather than a thing that sits on top of them — the boundary lines have to
 * stay readable over it or the map stops saying which field you are looking at.
 */
export function YieldZoneLayer({
  map,
  mapReady,
  visible,
}: {
  map: maplibregl.Map | null
  mapReady: boolean
  visible: boolean
}) {
  const { data: zones } = useYieldZones()
  const [hit, setHit] = useState<YieldZone | null>(null)

  const bands = useMemo(() => yieldBands(zones ?? []), [zones])
  const byId = useMemo(() => new Map((zones ?? []).map((z) => [z.id, z])), [zones])

  const data = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (zones ?? [])
        .filter((z) => z.geometry)
        .map<Feature>((z) => ({
          type: 'Feature',
          id: z.id,
          properties: { id: z.id, colour: yieldColour(bands, midYield(z)) },
          geometry: z.geometry,
        })),
    }),
    [zones, bands],
  )

  useEffect(() => {
    if (!map || !mapReady || !zones) return
    const existing = map.getSource(SRC) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
      return
    }
    map.addSource(SRC, { type: 'geojson', data })
    const beneath = map.getLayer('boundaries-fill') ? 'boundaries-fill' : undefined
    map.addLayer(
      {
        id: FILL,
        type: 'fill',
        source: SRC,
        layout: { visibility: 'none' },
        // Opaque enough to read as ground, not so opaque the imagery is gone —
        // the point of a productivity map is to be looked at against what is
        // actually there.
        paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.6 },
      },
      beneath,
    )
    map.addLayer(
      {
        id: LINE,
        type: 'line',
        source: SRC,
        layout: { visibility: 'none' },
        paint: { 'line-color': '#44403c', 'line-width': 0.6, 'line-opacity': 0.6 },
      },
      beneath,
    )
  }, [map, mapReady, zones, data])

  useEffect(() => {
    if (!map || !mapReady || !map.getLayer(FILL)) return
    const vis = visible ? 'visible' : 'none'
    map.setLayoutProperty(FILL, 'visibility', vis)
    map.setLayoutProperty(LINE, 'visibility', vis)
  }, [map, mapReady, visible, zones])

  useEffect(() => {
    if (!map || !mapReady || !visible) return
    const onClick = (e: MapMouseEvent) => {
      if (!map.getLayer(FILL)) return
      const f = map.queryRenderedFeatures(e.point, { layers: [FILL] })[0]
      // Looked up by id rather than read out of the feature: a map feature
      // carries only what was put in its properties, and there is no reason to
      // copy every zone's numbers into all hundred and eight of them.
      setHit(f?.properties?.id ? (byId.get(String(f.properties.id)) ?? null) : null)
    }
    map.on('click', onClick)
    return () => void map.off('click', onClick)
  }, [map, mapReady, visible, byId])

  // Derived rather than cleared in an effect: turning the layer off hides the
  // card because there is nothing to show.
  if (!visible || !hit) return null

  const fieldZones = (zones ?? []).filter((z) => z.field_id === hit.field_id)
  const best = Math.max(...fieldZones.map((z) => z.zone))

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">{hit.field_name}</p>
          <p className="text-xs text-gray-500">
            Zone {hit.zone} of {best}
            {hit.acres != null && ` · ${Math.round(hit.acres)} ac`}
            {hit.legal_desc && ` · ${hit.legal_desc}`}
          </p>
        </div>
        <button
          onClick={() => setHit(null)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <p className="mt-1.5 text-lg font-semibold tabular-nums text-gray-900">{rangeLabel(hit)}</p>
      <p className="text-xs text-gray-500">
        {hit.zone === 1
          ? 'The poorest ground in this field.'
          : hit.zone === best
            ? 'The best ground in this field.'
            : 'Middling for this field.'}{' '}
        Per cent of this field&rsquo;s own average, not bushels.
      </p>
    </div>
  )
}
