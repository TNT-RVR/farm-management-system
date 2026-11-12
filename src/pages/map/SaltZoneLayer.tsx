import { useEffect, useMemo, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { midYield, useYieldZones, type YieldZone } from '@/lib/yield-zones'
import { saltColour, zoneSalinity, type FieldSalt } from '@/lib/salinity'

const SRC = 'salt-zones'
const FILL = 'salt-zones-fill'
const LINE = 'salt-zones-line'

/** The estimate, per zone, for every field that has both a report and a zone map. */
function estimates(zones: YieldZone[], salt: Map<string, FieldSalt>) {
  const byField = new Map<string, YieldZone[]>()
  for (const z of zones) {
    if (!z.geometry || !salt.has(z.field_id)) continue
    byField.set(z.field_id, [...(byField.get(z.field_id) ?? []), z])
  }
  const ec = new Map<string, number>()
  for (const [fieldId, list] of byField) {
    for (const [id, v] of zoneSalinity(salt.get(fieldId)!, list)) ec.set(id, v)
  }
  return ec
}

/**
 * Salinity inside a field, not just by field.
 *
 * The lab gives a mean and a worst sample for a whole field and no
 * coordinates; the productivity zones say which ground runs below that field's
 * own average year after year. Laying the one over the other answers the
 * question a field-mean colour cannot: which corner to go and look at.
 *
 * Drawn OVER the field fill and under the boundary lines, so a field with a
 * zone map shows its zones and a field without one keeps the single colour of
 * its measured mean. That difference is the fallback, and it is honest: one
 * colour means one number is all we have.
 */
export function SaltZoneLayer({
  map,
  mapReady,
  visible,
  salt,
}: {
  map: maplibregl.Map | null
  mapReady: boolean
  visible: boolean
  salt: Map<string, FieldSalt>
}) {
  const { data: zones } = useYieldZones()
  const [hitId, setHitId] = useState<string | null>(null)

  const ecByZone = useMemo(() => estimates(zones ?? [], salt), [zones, salt])
  const byId = useMemo(() => new Map((zones ?? []).map((z) => [z.id, z])), [zones])

  const data = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (zones ?? [])
        .filter((z) => z.geometry && ecByZone.has(z.id))
        .map<Feature>((z) => ({
          type: 'Feature',
          id: z.id,
          properties: { id: z.id, colour: saltColour(ecByZone.get(z.id)) },
          geometry: z.geometry,
        })),
    }),
    [zones, ecByZone],
  )

  useEffect(() => {
    if (!map || !mapReady || !zones) return
    const existing = map.getSource(SRC) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
      return
    }
    map.addSource(SRC, { type: 'geojson', data })
    // Above the field fill it replaces, below the lines that say which field
    // this is.
    const beneath = map.getLayer('boundaries-line') ? 'boundaries-line' : undefined
    map.addLayer(
      {
        id: FILL,
        type: 'fill',
        source: SRC,
        layout: { visibility: 'none' },
        // Solid: it replaces the field's single colour outright rather than
        // blending with it, which would mute the dark end of the ramp — and a
        // wash of colour over green imagery was the thing nobody could see.
        paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 1 },
      },
      beneath,
    )
    map.addLayer(
      {
        id: LINE,
        type: 'line',
        source: SRC,
        layout: { visibility: 'none' },
        paint: { 'line-color': '#1f2937', 'line-width': 0.5, 'line-opacity': 0.45 },
      },
      beneath,
    )
  }, [map, mapReady, zones, data])

  useEffect(() => {
    if (!map || !mapReady || !map.getLayer(FILL)) return
    const vis = visible ? 'visible' : 'none'
    map.setLayoutProperty(FILL, 'visibility', vis)
    map.setLayoutProperty(LINE, 'visibility', vis)
    // Put it back above the field fill every time it is turned on.
    //
    // The boundary layers are added by the page after this one mounts, so the
    // `beneath` above has nothing to aim at and these two land underneath
    // them — and then the field's single colour, drawn at 0.85, paints over
    // every zone and the layer looks as though it never rendered. It was
    // rendering; it was buried.
    if (visible && map.getLayer('boundaries-line')) {
      map.moveLayer(FILL, 'boundaries-line')
      map.moveLayer(LINE, 'boundaries-line')
    }
  }, [map, mapReady, visible, zones])

  useEffect(() => {
    if (!map || !mapReady || !visible) return
    const onClick = (e: MapMouseEvent) => {
      if (!map.getLayer(FILL)) return
      const f = map.queryRenderedFeatures(e.point, { layers: [FILL] })[0]
      setHitId(f?.properties?.id ? String(f.properties.id) : null)
    }
    map.on('click', onClick)
    return () => void map.off('click', onClick)
  }, [map, mapReady, visible])

  // Derived rather than cleared in an effect: turning the layer off hides the
  // card because there is nothing to show.
  const hit = hitId ? (byId.get(hitId) ?? null) : null
  if (!visible || !hit) return null

  const ec = ecByZone.get(hit.id)
  const field = salt.get(hit.field_id)
  const fieldZones = (zones ?? []).filter((z) => z.field_id === hit.field_id)
  const best = Math.max(...fieldZones.map((z) => z.zone))
  const mid = midYield(hit)

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">{hit.field_name}</p>
          <p className="text-xs text-gray-500">
            Zone {hit.zone} of {best}
            {hit.acres != null && ` · ${Math.round(hit.acres)} ac`}
            {mid != null && ` · runs ${Math.round(mid)}% of this field`}
          </p>
        </div>
        <button
          onClick={() => setHitId(null)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <p className="mt-1.5 text-lg font-semibold tabular-nums text-gray-900">
        {ec == null ? '—' : `about ${ec.toFixed(1)} EC`}
      </p>
      {field && (
        <p className="text-xs leading-relaxed text-gray-500">
          Estimated, not measured: the field tested {field.ec.toFixed(1)} on average and{' '}
          {field.worst.toFixed(1)} at its worst sample ({field.year}
          {field.samples > 1 ? `, ${field.samples} samples` : ', one sample'}), spread across the
          ground the yield maps say is poorest. Dig or sample before acting on it.
        </p>
      )}
    </div>
  )
}
