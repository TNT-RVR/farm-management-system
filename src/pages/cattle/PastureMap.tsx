import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import { addPinImages, PIN_ICON_EXPR, withPins } from '@/lib/map-pins'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { ChevronDown, Satellite } from 'lucide-react'
import { AdminOnly } from '@/components/TechnicalDetails'
import { HelpNote } from '@/components/HelpNote'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { raiseToTop } from '@/lib/geo/layer-order'
import { pastureLabel } from '@/lib/pastureLabel'
import {
  freshness,
  ndviColour,
  useFieldImagery,
  usePastures,
  NDVI_RAMP,
  NO_DATA_COLOUR,
  type Pasture,
} from '@/lib/pastures'
import { useCattleLayerSettings, LAYER_PALETTE, type PastureFill } from '@/lib/cattle-layers'
import { WeedsLayer } from '@/pages/map/WeedsLayer'
import { WEEDS } from '@/lib/weeds'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { splitLayers, useMyMapGeo, useMyMapUrl } from '@/lib/mymaps'
import { mobsNow, useActivations } from '@/lib/eshepherd'
import { herdOnMap } from '@/lib/herd-map'
import {
  classifyWaterName,
  newPinsFrom,
  useCattleWater,
  useSetRiverAccess,
  useWaterMutations,
  useWaterReach,
  WATER_REACH_LAYERS,
  type RiverAccess,
} from '@/lib/cattle-water'
import { WaterLayer } from '@/pages/cattle/WaterLayer'
import {
  LIGHT_COLOUR,
  LIGHT_LABEL,
  trafficLight,
  useGrazedThisSeason,
  useReadinessNow,
  type Light,
} from '@/lib/pasture-light'
import { cn } from '@/lib/utils'
import {
  featureKey,
  featureName,
  isHiddenFeature,
  isLeaseLayer,
  layerOf,
  useHiddenFeatureMutations,
  useHiddenFeatures,
} from '@/lib/mymap-hidden'
import { farmMapCenter } from '@/lib/farm-setup'

const SRC = 'pastures'
const FILL = 'pasture-fill'
const LINE = 'pasture-line'
const LABEL = 'pasture-label'
const OCCUPIED = 'pasture-occupied'
const HERD_SRC = 'herd'
const HERD_LABEL = 'herd-label'

/**
 * Everything that is not imagery, in the order it stacks, bottom to top.
 *
 * NDVI and the photograph are inserted under the fence lines, and everything
 * here is raised above them after any style change — so switching to Photo
 * never buries the gates, the water, the weeds or the herd.
 */
const OVERLAY_ORDER = [
  'cattle-mm-hatch',
  'cattle-mm-line',
  'cattle-mm-point',
  'cattle-mm-pin',
  'weed-fill',
  'weed-line',
  ...WATER_REACH_LAYERS,
  'trough-ring',
  LINE,
  OCCUPIED,
  LABEL,
  HERD_LABEL,
]

/**
 * Put the fence lines and the letters back on top.
 *
 * MapLibre appends a new layer above everything already on the map, so every
 * NDVI tile, photograph, water point and My Map line added after the paddocks
 * landed ON the paddock letters. Switching to NDVI or Photo therefore buried
 * the one thing the map is read by — "the cows are in E" — under the very
 * imagery somebody turned on to look at E.
 *
 * Called at the end of every effect that adds a layer, and from a style
 * listener for the ones added elsewhere, because the fix is not one insertion
 * point: it is the rule that the letters are always last.
 */
const raiseLabels = (map: maplibregl.Map) => raiseToTop(map, OVERLAY_ORDER)

function toFeatures(
  pastures: Pasture[],
  lights: Map<string, { light: Light; why: string }>,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pastures
      .filter((p) => p.geojson)
      .map<Feature>((p) => ({
        type: 'Feature',
        id: p.id,
        properties: {
          id: p.id,
          name: p.name,
          // The letter everybody calls the paddock by. Null on the farm outer
          // boundary, which is in this table too and would otherwise be
          // labelled across the middle of every other paddock.
          ...(pastureLabel(p.name) ? { label: pastureLabel(p.name)!.text } : {}),
          colour: ndviColour(p.ndvi),
          // Red, yellow, green: can the cows go on it. Grey until there is a look.
          light: LIGHT_COLOUR[lights.get(p.id)?.light ?? 'grey'],
          // A paddock with no reading is drawn faint as well as grey, so it
          // cannot be mistaken for a measured one that happens to be poor.
          opacity: p.ndvi == null ? 0.22 : 0.55,
        },
        geometry: p.geojson,
      })),
  }
}

/**
 * The pastures, shaded by the satellite view of them.
 *
 * Until ingestion runs every paddock is grey and says so. That is the point:
 * this module must never imply it has imagery it does not have, and a green
 * paddock with no observation behind it is exactly that lie.
 */
export function PastureMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  // The map itself in state, not read off the ref during render: a ref does not
  // re-render the child that needs it, and passing one only works by luck of a
  // state flip happening at the same moment.
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  // Weeds live here rather than on the crop map: what gets marked on this farm
  // is rangeland — sagebrush and the like — and the person who finds a patch is
  // out looking at grass, not at a pivot.
  const [showWeeds, setShowWeeds] = useState(() => localStorage.getItem('cattle_showWeeds') !== '0')
  const [drawingWeed, setDrawingWeed] = useState(false)
  const { profile } = useAuth()
  const { data: pastures, isLoading } = usePastures()

  // Water is its own table now: pins dragged and named on this map. The My
  // Map's Water layer was brought over once and can be re-synced for new pins.
  const isManager = hasManagerAccess(profile?.role)
  const { data: waterSources } = useCattleWater()
  const water = useWaterMutations()
  const [showWater, setShowWater] = useState(() => localStorage.getItem('cattle_showWater') !== '0')
  const [showReach, setShowReach] = useState(() => localStorage.getItem('cattle_showReach') === '1')
  const [addingTrough, setAddingTrough] = useState(false)
  const addingRef = useRef(false)
  useEffect(() => {
    addingRef.current = addingTrough
  }, [addingTrough])
  const { data: reachRows } = useWaterReach(showReach || !!selectedId)
  const setRiverAccess = useSetRiverAccess()
  const selectedReach = (reachRows ?? []).find((r) => r.pasture_id === selectedId) ?? null
  const beyondTotal = (reachRows ?? [])
    .filter((r) => pastureLabel(r.name))
    .reduce((s, r) => s + r.beyond_acres, 0)
  const [synced, setSynced] = useState<number | null>(null)

  // Where the herds are, from the collars, drawn on their paddocks.
  const { data: activations } = useActivations()
  const herd = useMemo(
    () =>
      herdOnMap(
        (pastures ?? []).map((p) => ({ id: p.id, geojson: p.geojson })),
        mobsNow(activations ?? []),
      ),
    [pastures, activations],
  )

  // Per-pixel NDVI, the same as the crop map. A paddock is where a field mean
  // hides the most — cattle graze selectively, so the useful question is which
  // PART of it is bare.
  const [fillMode, setFillMode] = useState<PastureFill>('ndvi')
  // Same two jobs as the crop map: one ramp across every paddock so they can
  // be ranked against each other, or each paddock stretched to its own range so
  // the bare knoll inside it is visible. Cattle graze selectively, so the
  // second question is the one that decides where to put a fence.
  const [ndviScale, setNdviScale] = useState<'shared' | 'field'>(
    () => (localStorage.getItem('pasture_ndviScale') as 'shared' | 'field') || 'shared',
  )
  const { data: ndviRasters } = useFieldImagery(
    ndviScale === 'field' ? 'ndvi_field' : 'ndvi',
    'pasture',
  )
  const { data: photoRasters } = useFieldImagery('truecolour', 'pasture')

  // Gates, fences and water, from the Google My Map. They used to sit on the
  // crop map where they were only clutter; this is the map they describe.
  const { data: farmMap } = useMyMapUrl()
  const { data: myMapGeo } = useMyMapGeo(farmMap?.mymaps_url ?? null, true)
  // The My Map's own pasture layer is the paddocks this map already draws,
  // white line and letter, always. Listing it again was one more switch.
  const cattleLayerNames = useMemo(
    () => (myMapGeo ? splitLayers(myMapGeo.layers).cattle.filter((n) => !/pasture|fence/i.test(n)) : []),
    [myMapGeo],
  )
  // What the person has hidden or shown, feature by feature.
  const { data: hiddenOverrides } = useHiddenFeatures()
  const hiddenMut = useHiddenFeatureMutations()
  const [editingLayer, setEditingLayer] = useState<string | null>(null)
  const { settings: layerSettings, setLayer } = useCattleLayerSettings(cattleLayerNames)

  const cattleOverlay = useMemo(() => {
    if (!myMapGeo || !cattleLayerNames.length) return null
    const visible = new Set(cattleLayerNames.filter((n) => layerSettings[n]?.visible !== false))
    // Pin icons are worked out here, at draw time (see withPins).
    return withPins({
      type: 'FeatureCollection' as const,
      features: myMapGeo.fc.features
        .filter((f) => visible.has(String((f.properties as Record<string, unknown>)?._layer ?? '')))
        .filter((f) => !isHiddenFeature(f, hiddenOverrides))
        // The chosen colour rides on the feature, so one paint expression can
        // serve every layer without a filter per layer.
        .map((f) => {
          const layer = String((f.properties as Record<string, unknown>)?._layer ?? '')
          return {
            ...f,
            properties: {
              ...(f.properties ?? {}),
              _colour: layerSettings[layer]?.colour ?? LAYER_PALETTE[0],
              // Lease land is drawn thin and hatched rather than outlined bold.
              _lease: isLeaseLayer(layer),
            },
          }
        }),
    })
  }, [myMapGeo, cattleLayerNames, layerSettings, hiddenOverrides])

  useEffect(() => void localStorage.setItem('pasture_ndviScale', ndviScale), [ndviScale])

  // The traffic light per paddock, from readiness, rest and this season's grazing.
  const { data: readiness } = useReadinessNow()
  const { data: grazed } = useGrazedThisSeason()
  const lights = useMemo(() => {
    const m = new Map<string, { light: Light; why: string }>()
    for (const p of pastures ?? []) {
      const row = readiness?.find((r) => r.pasture_id === p.id)
      m.set(p.id, trafficLight(row, grazed?.has(p.id) ?? false))
    }
    return m
  }, [pastures, readiness, grazed])
  const features = useMemo(() => toFeatures(pastures ?? [], lights), [pastures, lights])
  const selected = (pastures ?? []).find((p) => p.id === selectedId) ?? null
  const withImagery = (pastures ?? []).filter((p) => p.ndvi != null).length

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 10,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    mapRef.current = map
    map.on('load', () => {
      setMapInstance(map)
      setReady(true)
    })
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const existing = map.getSource(SRC) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(features)
      return
    }
    map.addSource(SRC, { type: 'geojson', data: features })
    map.addLayer({
      id: FILL,
      type: 'fill',
      source: SRC,
      paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': ['get', 'opacity'] },
    })
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SRC,
      paint: { 'line-color': '#ffffff', 'line-width': 1.4, 'line-opacity': 0.8 },
    })
    // The letter, in the middle of the paddock.
    //
    // Over satellite imagery, so it carries a halo — white text alone
    // disappears against stubble and dark text disappears against shadow.
    // allow-overlap is off on purpose: where two paddocks are too small to
    // label at this zoom, dropping one is better than printing them on top of
    // each other, and zooming in brings it back.
    map.addLayer({
      id: LABEL,
      type: 'symbol',
      source: SRC,
      filter: ['has', 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 20],
        'text-line-height': 1.1,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#1f2937',
        'text-halo-width': 1.6,
      },
    })
    map.on('mouseenter', FILL, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', FILL, () => (map.getCanvas().style.cursor = ''))
  }, [ready, features])

  /**
   * The cattle-side My Map layers, drawn above the paddock shading.
   *
   * Three layers because the KML mixes geometry types: a gate is a point, a
   * fence a line, a corral a polygon, and one layer type cannot draw all
   * three. Colours come from the KML where it sets them, so the map keeps
   * looking the way it does in My Maps.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const ids = ['cattle-mm-hatch', 'cattle-mm-line', 'cattle-mm-point', 'cattle-mm-pin']
    if (!cattleOverlay) {
      for (const id of ids) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource('cattle-mm')) map.removeSource('cattle-mm')
      return
    }
    const src = map.getSource('cattle-mm') as GeoJSONSource | undefined
    if (src) {
      src.setData(cattleOverlay)
      return
    }
    map.addSource('cattle-mm', { type: 'geojson', data: cattleOverlay })
    // Lease land gets a light cross-hatch so it reads at a glance without a
    // solid tint over the imagery. The pattern is drawn once, 12 px, black at
    // a little over half strength.
    if (!map.hasImage('lease-hatch')) {
      const c = document.createElement('canvas')
      c.width = 12
      c.height = 12
      const ctx = c.getContext('2d')
      if (ctx) {
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, 12)
        ctx.lineTo(12, 0)
        ctx.moveTo(-3, 3)
        ctx.lineTo(3, -3)
        ctx.moveTo(9, 15)
        ctx.lineTo(15, 9)
        ctx.stroke()
        map.addImage('lease-hatch', ctx.getImageData(0, 0, 12, 12), { pixelRatio: 1 })
      }
    }
    map.addLayer({
      id: 'cattle-mm-hatch',
      type: 'fill',
      source: 'cattle-mm',
      filter: ['all', ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false], ['==', ['get', '_lease'], true]],
      paint: { 'fill-pattern': 'lease-hatch', 'fill-opacity': 0.8 },
    })
    // Outline only for the rest. A tinted interior shifts the colour of the
    // paddock shading and the imagery underneath it, which is the thing being
    // looked at; the line is what marks where the fence runs.
    map.addLayer({
      id: 'cattle-mm-line',
      type: 'line',
      source: 'cattle-mm',
      filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], true, false],
      paint: {
        'line-color': ['coalesce', ['get', '_colour'], '#1a73e8'],
        'line-width': ['case', ['==', ['get', '_lease'], true], 1, ['coalesce', ['get', 'stroke-width'], 2]],
        'line-opacity': ['case', ['==', ['get', '_lease'], true], 0.8, 1],
      },
    })
    map.addLayer({
      id: 'cattle-mm-point',
      type: 'circle',
      source: 'cattle-mm',
      // Points with a chosen pin icon get the icon instead (map-pins.ts).
      filter: ['all', ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false], ['!', ['has', '_pin']]],
      paint: {
        'circle-radius': 5,
        'circle-color': ['coalesce', ['get', '_colour'], '#1a73e8'],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.5,
      },
    })
    map.addLayer({
      id: 'cattle-mm-pin',
      type: 'symbol',
      source: 'cattle-mm',
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', '_pin']],
      layout: { 'icon-image': PIN_ICON_EXPR as unknown as maplibregl.ExpressionSpecification, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    })
    void addPinImages(map)
    raiseLabels(map)
  }, [ready, cattleOverlay])

  /**
   * The rule, rather than a list of places that have to remember it.
   *
   * Paddock layers are added from half a dozen effects here and from the weeds
   * layer, which is its own component — and every one of them appends above the
   * letters. Watching the style means a layer added anywhere, now or later,
   * ends up underneath them without its author having to know that.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const onStyle = () => raiseLabels(map)
    map.on('styledata', onStyle)
    raiseLabels(map)
    return () => {
      map.off('styledata', onStyle)
    }
  }, [ready])

  // Read through refs so the map's click handler — registered once — always
  // sees the current mode without the layer effect having to re-run.
  /**
   * What a click means depends on the mode, so the handler is registered per
   * mode rather than once with a ref read inside it. Re-registering is cheap
   * and keeps the current mode a plain closure variable.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const onClick = (e: MapMouseEvent) => {
      if (addingRef.current) return
      const hit = map.queryRenderedFeatures(e.point, { layers: [FILL] })[0]
      setSelectedId(hit?.properties?.id ? String(hit.properties.id) : null)
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [ready])

  /**
   * The herd on its paddock.
   *
   * A thicker amber outline on every occupied paddock and, under the letter,
   * who is there and how many: "290 head · Home Ranch Herd". From the collar
   * history, so it is as current as the last import.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !map.getSource(SRC)) return
    if (!map.getLayer(OCCUPIED)) {
      map.addLayer({
        id: OCCUPIED,
        type: 'line',
        source: SRC,
        filter: ['in', ['get', 'id'], ['literal', []]],
        paint: { 'line-color': '#f59e0b', 'line-width': 3.5, 'line-opacity': 0.95 },
      })
    }
    map.setFilter(OCCUPIED, ['in', ['get', 'id'], ['literal', herd.occupied]])
    const src = map.getSource(HERD_SRC) as GeoJSONSource | undefined
    if (src) src.setData(herd.fc)
    else {
      map.addSource(HERD_SRC, { type: 'geojson', data: herd.fc })
      map.addLayer({
        id: HERD_LABEL,
        type: 'symbol',
        source: HERD_SRC,
        layout: {
          'text-field': ['get', 'text'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 13],
          'text-offset': [0, 2.4],
          'text-anchor': 'top',
          'text-line-height': 1.2,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#fde68a', 'text-halo-color': '#78350f', 'text-halo-width': 1.4 },
      })
    }
    raiseLabels(map)
  }, [ready, features, herd])

  /**
   * Per-pixel rasters over the paddocks.
   *
   * NDVI is drawn with nearest-neighbour so the 10 m pixels stay visible: this
   * is a measurement, and blending it would show intermediate values nobody
   * took. The photograph is smoothed, because there the smoothing is cosmetic.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const live = new Set<string>()
    const sets = [
      { rows: ndviRasters, prefix: `past-ndvi-${ndviScale}-`, on: fillMode === 'ndvi', smooth: false },
      { rows: photoRasters, prefix: 'past-photo-', on: fillMode === 'photo', smooth: true },
    ]
    for (const set of sets)
      for (const img of set.rows ?? []) {
        const id = `${set.prefix}${img.subject_id}`
        live.add(id)
        if (!map.getSource(id)) {
          map.addSource(id, {
            type: 'image',
            url: img.url,
            coordinates: [
              [img.west, img.north],
              [img.east, img.north],
              [img.east, img.south],
              [img.west, img.south],
            ],
          })
          map.addLayer(
            {
              id,
              type: 'raster',
              source: id,
              layout: { visibility: 'none' },
              paint: {
                'raster-opacity': 1,
                'raster-fade-duration': 0,
                'raster-resampling': set.smooth ? 'linear' : 'nearest',
              },
            },
            // Under the fence lines, over the flat shading. The shading is the
            // fallback for a paddock with no raster yet and drops away beneath
            // one that has; the lines and the letter stay above both.
            map.getLayer(LINE) ? LINE : undefined,
          )
        }
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', set.on ? 'visible' : 'none')
      }
    for (const layer of map.getStyle().layers ?? []) {
      if (
        (layer.id.startsWith('past-ndvi-') || layer.id.startsWith('past-photo-')) &&
        !live.has(layer.id)
      ) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id)
        if (map.getSource(layer.id)) map.removeSource(layer.id)
      }
    }
    // The flat paddock shading is the fallback for paddocks with no raster yet,
    // so it drops right back when a raster is on top of it.
    if (map.getLayer(FILL)) {
      map.setPaintProperty(
        FILL,
        'fill-opacity',
        fillMode === 'off' ? 0 : fillMode === 'photo' ? 0 : fillMode === 'readiness' ? 0.55 : ['*', ['get', 'opacity'], 0.45],
      )
      map.setPaintProperty(FILL, 'fill-color', fillMode === 'readiness' ? ['get', 'light'] : ['get', 'colour'])
    }
    // Whatever went on above, the letters end up on top of it.
    raiseLabels(map)
  }, [ready, ndviRasters, photoRasters, fillMode, ndviScale])

  // Frame every paddock once we know where they are.
  const framed = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || framed.current || features.features.length === 0) return
    const b = new maplibregl.LngLatBounds()
    for (const f of features.features) {
      const geom = f.geometry
      if (geom.type !== 'MultiPolygon') continue
      for (const poly of geom.coordinates)
        for (const ring of poly) for (const c of ring) b.extend(c as [number, number])
    }
    if (!b.isEmpty()) map.fitBounds(b, { padding: 40, duration: 0 })
    framed.current = true
  }, [ready, features])

  // Any pin on the My Map's Water layer that is not here yet, classified by
  // its name. Adds only: the pins here are the record now, and a pin deleted
  // here on purpose must not come back because it is still on the My Map.
  const syncFromMyMap = () => {
    if (!myMapGeo) return
    const pins = myMapGeo.fc.features
      .filter(
        (f) =>
          f.geometry?.type === 'Point' &&
          /water/i.test(String((f.properties as Record<string, unknown>)?._layer ?? '')),
      )
      .map((f) => {
        const [lon, lat] = (f.geometry as Point).coordinates
        const name = String((f.properties as Record<string, unknown>)?.name ?? '').trim() || null
        return { lon, lat, name, ...classifyWaterName(name) }
      })
    water.addMany.mutate(newPinsFrom(pins, waterSources ?? []), { onSuccess: (n) => setSynced(n) })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Satellite className="h-4 w-4 text-gray-400" /> Pastures
        </h3>
        <span className="text-xs text-gray-500">
          {(pastures ?? []).length} paddocks ·{' '}
          {Math.round((pastures ?? []).reduce((s, p) => s + (p.area_acres ?? 0), 0)).toLocaleString(
            'en-CA',
          )}{' '}
          ac
        </span>
      </div>

      {!isLoading && withImagery === 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No satellite imagery yet — paddocks are drawn grey until the first clear pass.
          <AdminOnly>
            {' '}
            Shading turns on once the Sentinel-2 ingestion runs, which needs the Copernicus
            credentials set.
          </AdminOnly>
        </p>
      )}

      <div className="relative overflow-hidden rounded-lg border border-gray-200">
        <div ref={containerRef} className="h-[70vh] min-h-[420px] w-full" />
        {/* Floating rather than stacked above the map: the controls are read
            occasionally and the map is read constantly, so the map gets the
            space. Collapsible because on a phone even this tile is a lot of a
            small screen. */}
        <div className="absolute right-3 top-3 z-10 w-56 rounded-lg border border-gray-200 bg-white/95 shadow-lg backdrop-blur">
          <button
            onClick={() => setPanelOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-gray-800"
          >
            Layers
            <ChevronDown
              className={cn('h-4 w-4 text-gray-400 transition-transform', panelOpen && 'rotate-180')}
            />
          </button>
          {panelOpen && (
          <div className="max-h-[60vh] overflow-y-auto border-t border-gray-100 p-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Paddock shading
          </p>
          <div className="mt-1 flex gap-1">
            {(
              [
                ['readiness', 'Graze?'],
                ['ndvi', 'NDVI'],
                ['photo', 'Photo'],
                ['off', 'Off'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFillMode(val)}
                title={val === 'ndvi' ? 'NDVI — how green the satellite sees the paddock' : undefined}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs font-medium',
                  fillMode === val
                    ? 'border-brand-700 bg-brand-50 text-brand-800'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {fillMode === 'ndvi' && (
            <div className="mt-2 flex gap-1">
              {(
                [
                  ['shared', 'Compare'],
                  ['field', 'Inspect'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setNdviScale(val)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11px] font-medium',
                    ndviScale === val
                      ? 'bg-brand-700 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {fillMode === 'ndvi' && (
            <p className="mt-1 text-[11px] text-gray-500">
              {ndviScale === 'shared'
                ? 'One ramp across every paddock — colours compare between them.'
                : 'Each paddock on its own range — shows variation inside one, not between.'}
            </p>
          )}
          {fillMode === 'readiness' && (
            <ul className="mt-2 space-y-0.5">
              {(['green', 'yellow', 'red', 'grey'] as Light[]).map((l) => (
                <li key={l} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LIGHT_COLOUR[l] }} />
                  {LIGHT_LABEL[l]}
                </li>
              ))}
              <li className="pt-1">
                <HelpNote summary="Tap a paddock for the reason." title="How “Graze?” is decided">
                  <p>
                    Forage from the satellite, rest since the last move-out against the paddock's
                    minimum, cattle on it now, and whether it has been grazed this season. Tap a
                    paddock for the reason.
                  </p>
                </HelpNote>
              </li>
            </ul>
          )}
          {fillMode === 'ndvi' && ndviScale === 'shared' && (
            <ul className="mt-2 space-y-0.5">
              {([['Never imaged', NO_DATA_COLOUR]] as [string, string][])
                .concat(NDVI_RAMP.map(([l, c]) => [`NDVI ≤ ${l}`, c]))
                .map(([label, colour]) => (
                  <li key={label} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: colour }}
                    />
                    {label}
                  </li>
                ))}
              <li className="text-[11px] text-gray-400">NDVI — bare ground through heavy canopy</li>
            </ul>
          )}
        </div>

        <div className="min-w-[10rem]">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Weeds</p>
          <label className="mt-1 flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={showWeeds}
              onChange={(e) => {
                setShowWeeds(e.target.checked)
                localStorage.setItem('cattle_showWeeds', e.target.checked ? '1' : '0')
              }}
              className="h-3.5 w-3.5"
            />
            Show patches
          </label>
          {showWeeds && (
            <>
              <ul className="mt-1 space-y-0.5">
                {WEEDS.map((w) => (
                  <li key={w.slug} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <span
                      className="h-2.5 w-4 shrink-0 rounded-sm"
                      style={{ background: w.color }}
                    />
                    <span className="truncate">{w.name}</span>
                  </li>
                ))}
              </ul>
              {hasManagerAccess(profile?.role) && (
                <button
                  onClick={() => setDrawingWeed(true)}
                  disabled={drawingWeed}
                  className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Mark a patch
                </button>
              )}
            </>
          )}
        </div>

        <div className="min-w-[10rem]">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Water</p>
          <label className="mt-1 flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={showWater}
              onChange={(e) => {
                setShowWater(e.target.checked)
                localStorage.setItem('cattle_showWater', e.target.checked ? '1' : '0')
              }}
              className="h-3.5 w-3.5"
            />
            Water sources
          </label>
          <label className="mt-1 flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={showReach}
              onChange={(e) => {
                setShowReach(e.target.checked)
                localStorage.setItem('cattle_showReach', e.target.checked ? '1' : '0')
              }}
              className="h-3.5 w-3.5"
            />
            800 m from water
          </label>
          {showReach && (
            <p className="mt-1 text-[11px] text-gray-500">
              Red is ground more than 800 m from a drink inside its own fence —{' '}
              {Math.round(beyondTotal).toLocaleString('en-CA')} ac in all. Blue is within reach.
            </p>
          )}
          {isManager && (
            <div className="mt-1.5 flex flex-col gap-1">
              <button
                onClick={() => setAddingTrough((v) => !v)}
                className={cn(
                  'w-full rounded-md border px-2 py-1 text-[11px] font-medium',
                  addingTrough
                    ? 'border-orange-500 bg-orange-50 text-orange-800'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                {addingTrough ? 'Tap the map to place it…' : 'Drop a trough'}
              </button>
              <button
                onClick={syncFromMyMap}
                disabled={!myMapGeo || water.addMany.isPending}
                title="Adds any pin on the My Map's Water layer that is not here yet. Never removes one."
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {water.addMany.isPending ? 'Syncing…' : 'Sync new pins from My Map'}
              </button>
              {synced != null && (
                <p className="text-[11px] text-gray-500">
                  {synced === 0 ? 'Nothing new on the My Map.' : `${synced} new pin${synced === 1 ? '' : 's'} added.`}
                </p>
              )}
            </div>
          )}
        </div>

        {cattleLayerNames.length > 0 && (
          <div className="min-w-[12rem]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Map layers
            </p>
            <ul className="mt-1 space-y-1">
              {cattleLayerNames.map((name) => {
                const set = layerSettings[name]
                return (
                  <li key={name} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={set?.visible !== false}
                      onChange={(e) => setLayer(name, { visible: e.target.checked })}
                      className="h-3.5 w-3.5"
                    />
                    {/* A colour well rather than a palette: the layers come from
                        a map Sam controls, so the choice should be his too. */}
                    <input
                      type="color"
                      value={set?.colour ?? LAYER_PALETTE[0]}
                      onChange={(e) => setLayer(name, { colour: e.target.value })}
                      className="h-4 w-6 cursor-pointer rounded border border-gray-300 bg-white p-0"
                      aria-label={`Colour for ${name}`}
                    />
                    <span className="truncate text-gray-700">{name}</span>
                    {isManager && (
                      <button
                        onClick={() => setEditingLayer(editingLayer === name ? null : name)}
                        className="ml-auto text-[11px] text-gray-400 underline hover:text-gray-700"
                      >
                        {editingLayer === name ? 'done' : 'edit'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {editingLayer && myMapGeo && (
              <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2">
                <p className="text-[11px] text-gray-500">
                  Tick what this map should draw from “{editingLayer}”. Pipes, pumps, pivots and the
                  irrigated fields start hidden; the My Map itself is not changed.
                </p>
                {(() => {
                  const feats = myMapGeo.fc.features.filter((f) => layerOf(f) === editingLayer)
                  const shownCount = feats.filter((f) => !isHiddenFeature(f, hiddenOverrides)).length
                  return (
                    <>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <button
                          onClick={() => hiddenMut.set.mutate({ features: feats, hidden: true })}
                          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-700"
                        >
                          hide all
                        </button>
                        <button
                          onClick={() => hiddenMut.set.mutate({ features: feats, hidden: false })}
                          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-700"
                        >
                          show all
                        </button>
                        <span className="self-center text-[11px] text-gray-500">
                          {shownCount} of {feats.length} drawn
                        </span>
                      </div>
                      <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                        {feats
                          .map((f) => ({ f, key: featureKey(f), name: featureName(f) || '(unnamed)', kind: f.geometry?.type ?? '' }))
                          .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
                          .map(({ f, key, name: fname, kind }) => (
                            <li key={key} className="flex items-center gap-1.5 text-[11px] text-gray-700">
                              <input
                                type="checkbox"
                                checked={!isHiddenFeature(f, hiddenOverrides)}
                                onChange={(e) => hiddenMut.set.mutate({ features: [f], hidden: !e.target.checked })}
                                className="h-3 w-3"
                              />
                              <span className="truncate">{fname}</span>
                              <span className="text-gray-400">
                                {/Line/.test(kind) ? 'line' : /Poly/.test(kind) ? 'area' : 'pin'}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}
      </div>
          )}
        </div>


        {selected && (
          <div className="absolute bottom-3 left-3 right-3 max-w-sm rounded-lg border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur md:right-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{selected.name}</p>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">
                  {selected.ranch}
                  {selected.area_acres != null && ` · ${selected.area_acres.toFixed(0)} ac`}
                </p>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt
                  className="text-[11px] uppercase tracking-wide text-gray-500"
                  title="NDVI — how green the satellite sees the paddock, from bare ground (near 0) to heavy canopy (near 1)"
                >
                  Greenness (NDVI)
                </dt>
                <dd className="font-semibold tabular-nums text-gray-900">
                  {selected.ndvi != null ? selected.ndvi.toFixed(2) : <span className="text-gray-300">—</span>}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-gray-500">Last look</dt>
                <dd
                  className={cn(
                    'font-semibold',
                    freshness(selected.days_since_observation).tone === 'good'
                      ? 'text-green-700'
                      : freshness(selected.days_since_observation).tone === 'fair'
                        ? 'text-amber-700'
                        : 'text-gray-500',
                  )}
                >
                  {freshness(selected.days_since_observation).label}
                </dd>
              </div>
            </dl>

            {(() => {
              const l = lights.get(selected.id)
              if (!l) return null
              return (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-700">
                  <span
                    className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: LIGHT_COLOUR[l.light] }}
                  />
                  <span>
                    <span className="font-medium">{LIGHT_LABEL[l.light]}.</span> {l.why}
                  </span>
                </p>
              )
            })()}

            {isManager && (
              <div className="mt-2 text-xs">
                <p className="text-[11px] uppercase tracking-wide text-gray-500">River frontage</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <select
                    value={selectedReach?.river_access ?? 'none'}
                    onChange={(e) =>
                      setRiverAccess.mutate({
                        pasture_id: selected.id,
                        river_access: e.target.value as RiverAccess,
                        river_access_ref: selectedReach?.river_access_ref ?? null,
                      })
                    }
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="none">No river access</option>
                    <option value="all">Whole river edge</option>
                    <option value="north_of">Only north of…</option>
                  </select>
                  {selectedReach?.river_access === 'north_of' && (
                    <select
                      value={selectedReach.river_access_ref ?? ''}
                      onChange={(e) =>
                        setRiverAccess.mutate({
                          pasture_id: selected.id,
                          river_access: 'north_of',
                          river_access_ref: e.target.value || null,
                        })
                      }
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    >
                      <option value="">the north edge of…</option>
                      {(pastures ?? [])
                        .filter((p) => p.id !== selected.id && pastureLabel(p.name))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                {selectedReach && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    {Math.round(selectedReach.reach_acres).toLocaleString('en-CA')} ac within 800 m of water ·{' '}
                    {Math.round(selectedReach.beyond_acres).toLocaleString('en-CA')} ac beyond.
                  </p>
                )}
              </div>
            )}

            {selected.biomass_kg_dm_ha == null && selected.ndvi != null && (
              <p className="mt-1.5 text-[11px] text-gray-500">
                Biomass in kg/ha needs local calibration first. Until then this ranks and trends
                rather than measuring.
              </p>
            )}
          </div>
        )}
      </div>

      <WaterLayer
        map={mapInstance}
        mapReady={ready}
        isManager={isManager}
        showPins={showWater}
        showReach={showReach}
        addingTrough={addingTrough}
        onAddingChange={setAddingTrough}
        onTroughDropped={() => {
          setShowReach(true)
          localStorage.setItem('cattle_showReach', '1')
        }}
        onPinSelected={() => setSelectedId(null)}
        beforeId={LINE}
      />

      <WeedsLayer
        map={mapInstance}
        mapReady={ready}
        visible={showWeeds}
        isManager={hasManagerAccess(profile?.role)}
        drawing={drawingWeed}
        onDrawingChange={setDrawingWeed}
      />
    </div>
  )
}
