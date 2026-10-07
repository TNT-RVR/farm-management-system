import { useEffect, useMemo, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { ExternalLink } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { HorizonTable, SoilTermInfo } from '@/components/SoilTerms'
import {
  AGRASID_SOURCE,
  SOIL_VIEWER,
  DRAINAGE,
  SALINITY,
  TEXTURE,
  availableWaterInches,
  soilBandColour,
  useSoilPolygons,
  type SoilPolygon,
} from '@/lib/soil-landscape'

const SRC = 'soil-survey'
const FILL = 'soil-survey-fill'
const LINE = 'soil-survey-line'

const n1 = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

function toFeatures(polys: SoilPolygon[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: polys
      .filter((p) => p.geometry)
      .map<Feature>((p) => ({
        type: 'Feature',
        id: p.id,
        properties: { id: p.id, colour: soilBandColour(availableWaterInches(p)) },
        geometry: p.geometry,
      })),
  }
}

/**
 * What this ground is, in the words a decision gets made in.
 *
 * The survey's own vocabulary is codes — "CVD~~~~~A", drainage "R", a subgroup
 * of "O.BC" — and none of that answers the question somebody clicked with. The
 * notes below turn the two figures that matter, water holding and drainage,
 * into what they mean for a set of irrigation.
 */
function soilNotes(p: SoilPolygon): string[] {
  const notes: string[] = []
  const aw = availableWaterInches(p)
  if (aw != null) {
    if (aw < 1.5) {
      notes.push(
        `Holds about ${aw}″ of usable water in the top metre — a few hot days and it is empty. Short, frequent sets; a big single application runs past the roots.`,
      )
    } else if (aw < 2.5) {
      notes.push(
        `Holds about ${aw}″ of usable water in the top metre. Middling: it will carry a crop several days but not through a hot week.`,
      )
    } else {
      notes.push(
        `Holds about ${aw}″ of usable water in the top metre — enough to carry a crop through a hot week, and worth filling before one.`,
      )
    }
  }
  if (p.drainage === 'R' || p.drainage === 'W') {
    notes.push(
      'Freely drained, so nitrate moves down with the water. Split nitrogen rather than putting it all on at once.',
    )
  }
  if (p.drainage === 'I' || p.drainage === 'P' || p.drainage === 'V') {
    notes.push('Drains slowly — the part of a field that stays wet and gets worked last.')
  }
  if (p.salinity && p.salinity !== 'N') {
    notes.push(
      `Rated ${(SALINITY[p.salinity] ?? p.salinity).toLowerCase()}. Salts concentrate where water sits and evaporates, so this shows up as a bare patch in a dry year.`,
    )
  }
  const topCarbonate = p.detail.horizons?.find((h) => (h.caco3 ?? 0) > 1 && (h.top ?? 99) < 30)
  if (topCarbonate) {
    notes.push(
      'Carbonate near the surface, which ties up phosphorus and zinc — the soil test will read them lower than the same numbers mean elsewhere.',
    )
  }
  return notes
}

function SoilDetail({ soil, onClose }: { soil: SoilPolygon; onClose: () => void }) {
  const aw = availableWaterInches(soil)
  const hz = soil.detail.horizons ?? []
  return (
    <Modal title={soil.soil_name ?? soil.munit ?? 'Soil'} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-6 shrink-0 rounded-sm ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: soilBandColour(aw) }}
          />
          <p className="text-sm text-gray-700">
            {[
              soil.texture_top ? (TEXTURE[soil.texture_top] ?? soil.texture_top) : null,
              soil.drainage ? DRAINAGE[soil.drainage] : null,
              soil.salinity ? SALINITY[soil.salinity] : null,
            ]
              .filter(Boolean)
              .join(', ') || 'no description on file'}
            <SoilTermInfo term="drainage" />
            <SoilTermInfo term="salinity" />
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-xs">
          {(
            [
              ['Available water', aw == null ? 'not rated' : `${aw}″ per metre`, 'availableWater'],
              ['Field capacity', soil.fc_pct == null ? '—' : `${soil.fc_pct}% by volume`, 'fc'],
              ['Wilting point', soil.wp_pct == null ? '—' : `${soil.wp_pct}% by volume`, 'wp'],
              ['Map unit', soil.munit ?? '—', 'munit'],
              ['Classified', soil.subgroup ?? '—', 'subgroup'],
              ['Polygon', `${n1(soil.acres)} ac`, null],
            ] as const
          ).map(([k, v, term]) => (
            <div key={k} className="rounded border border-gray-200 px-2 py-1">
              <dt className="flex items-center text-[11px] text-gray-500">
                {k}
                {term && <SoilTermInfo term={term} />}
              </dt>
              <dd className="font-medium text-gray-900">{v}</dd>
            </div>
          ))}
        </dl>

        {soilNotes(soil).length > 0 && (
          <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-gray-600">
            {soilNotes(soil).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}

        {hz.length > 0 && <HorizonTable horizons={hz} compact />}

        <p className="text-[11px] leading-relaxed text-gray-500">
          One polygon can cover a quarter section and describes the dominant soil, not every acre of
          it. Your own knowledge of the ground beats it.{' '}
          <a
            href={AGRASID_SOURCE.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-700 hover:underline"
          >
            {AGRASID_SOURCE.name}
            <ExternalLink className="h-3 w-3" />
          </a>{' '}
          <a
            href={SOIL_VIEWER.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-700 hover:underline"
          >
            {SOIL_VIEWER.name}
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    </Modal>
  )
}

/**
 * Alberta's soil survey, on the farm map.
 *
 * It lives here rather than on the manure map because it is not a manure fact:
 * the same polygons explain why one end of a field runs out of water first, why
 * a soil test reads low on phosphorus, and which ground stays wet in spring.
 */
export function SoilLayer({
  map,
  mapReady,
  visible,
}: {
  map: maplibregl.Map | null
  mapReady: boolean
  visible: boolean
}) {
  const { data: soils } = useSoilPolygons()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const byId = useMemo(() => new Map((soils ?? []).map((s) => [s.id, s])), [soils])
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null

  useEffect(() => {
    if (!map || !mapReady || !soils) return
    const data = toFeatures(soils)
    const existing = map.getSource(SRC) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
      return
    }
    map.addSource(SRC, { type: 'geojson', data })
    // Under everything else: this is context for the fields drawn on top of it,
    // not a thing to read on its own.
    const firstFieldLayer = map.getLayer('boundaries-fill') ? 'boundaries-fill' : undefined
    map.addLayer(
      {
        id: FILL,
        type: 'fill',
        source: SRC,
        layout: { visibility: 'none' },
        paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.45 },
      },
      firstFieldLayer,
    )
    map.addLayer(
      {
        id: LINE,
        type: 'line',
        source: SRC,
        layout: { visibility: 'none' },
        paint: { 'line-color': '#065f46', 'line-width': 0.8, 'line-opacity': 0.7 },
      },
      firstFieldLayer,
    )
  }, [map, mapReady, soils])

  useEffect(() => {
    if (!map || !mapReady || !map.getLayer(FILL)) return
    const vis = visible ? 'visible' : 'none'
    map.setLayoutProperty(FILL, 'visibility', vis)
    map.setLayoutProperty(LINE, 'visibility', vis)
  }, [map, mapReady, visible, soils])

  // Click to inspect. Only while the layer is on, and the polygon is looked up
  // by id rather than read out of the feature — map features carry only what
  // was put in their properties, and the horizons are not something to copy
  // into every one of two hundred and twenty-six.
  useEffect(() => {
    if (!map || !mapReady || !visible) return
    const onClick = (e: MapMouseEvent) => {
      if (!map.getLayer(FILL)) return
      const hit = map.queryRenderedFeatures(e.point, { layers: [FILL] })[0]
      if (hit?.properties?.id) setSelectedId(String(hit.properties.id))
    }
    map.on('click', onClick)
    return () => void map.off('click', onClick)
  }, [map, mapReady, visible])

  // Derived rather than cleared in an effect: turning the layer off hides the
  // panel because there is nothing to show, not because something reached in
  // and reset it on the way past.
  if (!visible || !selected) return null
  return <SoilDetail soil={selected} onClose={() => setSelectedId(null)} />
}
