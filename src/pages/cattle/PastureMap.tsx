import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import { addPinImages, PIN_ICON_EXPR, withPins } from '@/lib/map-pins'
import type { Feature, FeatureCollection, Point } from 'geojson'
import {
  ChevronLeft,
  ExternalLink,
  ChevronRight,
  DoorOpen,
  Droplet,
  Grid3x3,
  Layers,
  Satellite,
  Sprout,
  X,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { AdminOnly } from '@/components/TechnicalDetails'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { useFarmMap } from '@/lib/geo/use-farm-map'
import { quartersInView, type Bounds, type GridParcel } from '@/lib/geo/atsGrid'
import { useTownshipTable } from '@/lib/geo/atsTownships'
import { drawQuarterGrid, removeQuarterGrid } from '@/lib/geo/quarter-grid-layer'
import { raiseToTop } from '@/lib/geo/layer-order'
import { pastureLabel } from '@/lib/pastureLabel'
import {
  freshness,
  ndviColour,
  useFieldImagery,
  useImageryDays,
  useRanchScopedPastures,
  usePastureRanchLinks,
  NDVI_RAMP,
  NO_DATA_COLOUR,
  type ImageryDay,
  type Pasture,
} from '@/lib/pastures'
import { asOfDay, photoDateLabel, stepDay } from '@/lib/map-as-of'
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
  type WaterReach,
  WATER_REACH_LAYERS,
  type RiverAccess,
} from '@/lib/cattle-water'
import { useGrazeableAcres, useUnderutilisation } from '@/lib/grazing-forage'
import { WaterLayer } from '@/pages/cattle/WaterLayer'
import { GatesPanel } from '@/pages/cattle/GatesPanel'
import { TroughSuggest } from '@/pages/cattle/TroughSuggest'
import { usePastureGates } from '@/lib/grazing-plan-data'
import {
  isDormant,
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

const SRC = 'pastures'
const FILL = 'pasture-fill'
const LINE = 'pasture-line'
const LABEL = 'pasture-label'
const OCCUPIED = 'pasture-occupied'
/**
 * Where the distance-from-water bands come from. Named here rather than
 * inline because the numbers they justify are farm settings now, and the next
 * person to change 250 or 800 should be able to find what they are arguing
 * with. docs/grazing-distance-evidence.md has the rest.
 */
const PINCHAK_PAPER = 'https://journals.uair.arizona.edu/index.php/jrm/article/viewFile/19203/18846'
const BCRC_WATER = 'https://www.beefresearch.ca/pasture-101/fencing-water-infrastructure-on-pasture/'

const HERD_SRC = 'herd'
const HERD_LABEL = 'herd-label'
/**
 * The layer rail, top to bottom: the shading first because it is the one most
 * visits change, then the overlays, then the My Map import last.
 */
type RailKey = 'shading' | 'water' | 'gates' | 'grid' | 'weeds' | 'mymap'
type RailItem = {
  key: RailKey
  label: string
  Icon: typeof Satellite
  on: boolean
  /** What the icon's state means, in words, for the hover title. */
  hint: string
}

// Storage can throw (private window, blocked site data); the map must open regardless.
const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* a preference, not data */
  }
}

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
export function PastureMap({
  ranchId = '',
  growingMonths = [4, 10],
}: {
  /** The Ranch filter; '' is All. */
  ranchId?: string
  /** The ranch's growing season, first and last month; outside it the grass is dormant. */
  growingMonths?: [number, number]
} = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Zoom buttons bottom-right (Sam, 11 Nov 2026): the layer rail floats over
  // the top-right corner, which is where MapLibre puts them by default, so +
  // and − sat underneath it and could not be reached.
  const { map, mapRef, ready } = useFarmMap(containerRef, {
    zoom: 10,
    controls: { scale: true, navAt: 'bottom-right' },
  })
  // The map itself, not read off the ref during render: a ref does not
  // re-render the child that needs it. Handed over once its style has loaded.
  const mapInstance = ready ? map : null
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // What a clicked paddock is worth: the Grazing tab's own acres, and the
  // ground that is too far from water to be grazed. Both used to be cards
  // below the map; they belong on the paddock you just pointed at
  // (Sam, 11 Nov 2026).
  // Under All there is no ranch to ask for, and the Grazing tab's acres are
  // kept per ranch — so take the ranch from the paddock that was clicked,
  // rather than leaving the figure blank on the tab the page opens on.
  const ranchLinks = usePastureRanchLinks()
  const grazeable = useGrazeableAcres(
    ranchId || (selectedId ? (ranchLinks.data?.get(selectedId) ?? null) : null),
  )
  // Which layer's flyout is open, if any. Nothing is open on arrival and the
  // choice is not remembered: a flyout covers part of the map, and the map is
  // what people came to see. The rail behind it shows what is drawn, so there
  // is no longer a reason to leave one open just to read a legend.
  const [openRail, setOpenRail] = useState<RailKey | null>(null)
  // Weeds live here rather than on the crop map: what gets marked on this farm
  // is rangeland — sagebrush and the like — and the person who finds a patch is
  // out looking at grass, not at a pivot.
  // Off unless it has been turned on. A weed patch is drawn once and then sits
  // there every time the map opens, over the shading the map is actually for;
  // the people who want it know where the toggle is.
  const [showWeeds, setShowWeeds] = useState(() => readStored('cattle_showWeeds') === '1')

  // The quarter-section grid, the same one the crop map draws. On by default
  // since 10 Nov 2026 (Sam): with the paddock shading off, the quarters are
  // what locates a paddock on the ground, and everyone here describes land by
  // its quarter. It only draws past GRID_MIN_ZOOM, so it is not clutter at
  // ranch scale.
  const [showGrid, setShowGrid] = useState(() => readStored('cattle_showGrid') !== '0')
  const [gridView, setGridView] = useState<{ zoom: number; bounds: Bounds } | null>(null)
  const gridMarkersRef = useRef<maplibregl.Marker[]>([])
  // Below this the quarters are smaller than their own labels. Same figure as
  // the crop map, so "zoom in to see it" means the same thing on both.
  const GRID_MIN_ZOOM = 13.5
  const gridOn = showGrid && (gridView?.zoom ?? 0) >= GRID_MIN_ZOOM
  // Only loads the township table once something actually wants it -- it is a
  // sizeable download and most visits to this map never turn the grid on.
  const townships = useTownshipTable(showGrid)
  const [drawingWeed, setDrawingWeed] = useState(false)
  const { profile } = useAuth()
  const { data: pastures, isLoading } = useRanchScopedPastures(ranchId)

  // Water is its own table now: pins dragged and named on this map. The My
  // Map's Water layer was brought over once and can be re-synced for new pins.
  const isManager = hasManagerAccess(profile?.role)
  const { data: waterSources } = useCattleWater()
  // Only so the rail can light the Gates icon and hide it on a ranch with no
  // gates; GatesPanel runs the same query, and react-query serves them one.
  const { data: gates } = usePastureGates()
  const water = useWaterMutations()
  const [showWater, setShowWater] = useState(() => readStored('cattle_showWater') !== '0')
  const [showReach, setShowReach] = useState(() => readStored('cattle_showReach') === '1')
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
  const marginTotal = (reachRows ?? [])
    .filter((r) => pastureLabel(r.name))
    .reduce((s, r) => s + r.margin_acres, 0)
  // The two radii are settings, not constants — they moved from 800 m to 700 m
  // on 11 Nov 2026 — so the legend reads them off the rows it is describing
  // rather than naming a distance the shading no longer uses.
  const reachNear = Math.round(reachRows?.[0]?.near_m ?? 250)
  const reachFar = Math.round(reachRows?.[0]?.far_m ?? 800)
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
  //
  // Off to start with (Sam, 10 Nov 2026): the map is opened to find a gate,
  // a water source or a paddock boundary far more often than to read grass,
  // and a full-colour NDVI wash over every paddock buries all three. The
  // picker is right there for the days the grass is the question.
  const [fillMode, setFillMode] = useState<PastureFill>(
    () => (readStored('cattle_fillMode') as PastureFill | null) ?? 'off',
  )
  // Same two jobs as the crop map: one ramp across every paddock so they can
  // be ranked against each other, or each paddock stretched to its own range so
  // the bare knoll inside it is visible. Cattle graze selectively, so the
  // second question is the one that decides where to put a fence.
  const [ndviScale, setNdviScale] = useState<'shared' | 'field'>(
    () => (readStored('pasture_ndviScale') as 'shared' | 'field') || 'shared',
  )
  // The day the imagery shows (Sam, 5 Nov 2026): the latest pass, or a past
  // one picked below. Kept in the address (?on=YYYY-MM-DD) like the crop map's
  // picker, so a link opens on the same day — which is how a screenshot of one
  // paddock before and after a graze gets found twice.
  const [dayParams, setDayParams] = useSearchParams()
  const today = new Date().toLocaleDateString('en-CA')
  const asOf = asOfDay(dayParams.get('on'), today)
  const ndviKind = ndviScale === 'field' ? ('ndvi_field' as const) : ('ndvi' as const)
  const { data: ndviRasters } = useFieldImagery(ndviKind, 'pasture', asOf)
  const { data: photoRasters } = useFieldImagery('truecolour', 'pasture', asOf)
  // The passes on file for whichever layer is showing, so the picker offers
  // days that actually hold a picture instead of a blank calendar.
  const { data: imageryDays } = useImageryDays(fillMode === 'photo' ? 'truecolour' : ndviKind, 'pasture')
  const shownRasters = fillMode === 'photo' ? photoRasters : ndviRasters
  const setAsOf = (v: string | null) =>
    setDayParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (v) next.set('on', v)
        else next.delete('on')
        return next
      },
      { replace: true },
    )

  // Gates, fences and water, from the Google My Map. They used to sit on the
  // crop map where they were only clutter; this is the map they describe.
  const { data: farmMap } = useMyMapUrl()
  const { data: myMapGeo } = useMyMapGeo(farmMap?.mymaps_url ?? null, true)
  // The My Map's own pasture layer is the paddocks this map already draws,
  // white line and letter, always. Listing it again was one more switch.
  //
  // Its Water layer goes the same way, and for a sharper reason: every pin on
  // it was copied into cattle_water when that table was made, so leaving it
  // here drew the farm's water TWICE -- once as the pins the Water switch
  // controls and drags and names, and once as a My Map overlay that switch
  // never touched. Turning water off left a full set of pins on the map, which
  // is exactly what it looked like. The copy that stays is the editable one;
  // "Sync new pins from My Map" still reads that layer straight from the
  // My Map, so nothing stops a new pin coming across.
  const cattleLayerNames = useMemo(
    () => (myMapGeo ? splitLayers(myMapGeo.layers).cattle.filter((n) => !/pasture|fence|water/i.test(n)) : []),
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

  useEffect(() => writeStored('pasture_ndviScale', ndviScale), [ndviScale])

  // The traffic light per paddock, from readiness, rest and this season's grazing.
  const { data: readiness } = useReadinessNow()
  const { data: grazed } = useGrazedThisSeason()
  const dormant = isDormant(new Date(), growingMonths[0], growingMonths[1])
  const lights = useMemo(() => {
    const m = new Map<string, { light: Light; why: string }>()
    for (const p of pastures ?? []) {
      const row = readiness?.find((r) => r.pasture_id === p.id)
      m.set(p.id, trafficLight(row, grazed?.has(p.id) ?? false, dormant))
    }
    return m
  }, [pastures, readiness, grazed, dormant])
  const features = useMemo(() => toFeatures(pastures ?? [], lights), [pastures, lights])
  const selected = (pastures ?? []).find((p) => p.id === selectedId) ?? null
  const withImagery = (pastures ?? []).filter((p) => p.ndvi != null).length

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
  }, [mapRef, ready, features])

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
  }, [mapRef, ready, cattleOverlay])

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
  }, [mapRef, ready])

  // ── The quarter-section grid ────────────────────────────────────────────

  // Where the map is looking, so the grid knows which quarters to build. Only
  // watched while the grid is on: a moveend listener that recomputes nothing
  // is still a re-render on every pan.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !showGrid) return
    const readView = () => {
      const b = map.getBounds()
      setGridView({
        zoom: map.getZoom(),
        bounds: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
      })
    }
    map.on('moveend', readView)
    readView()
    return () => {
      map.off('moveend', readView)
    }
  }, [mapRef, ready, showGrid])

  // Derived, not stored. The quarters in view are a pure function of the view
  // and the township table, so holding them in state only adds a render and a
  // chance for the two to disagree.
  const gridParcels = useMemo<GridParcel[]>(
    () => (gridOn && gridView ? quartersInView(gridView.bounds, townships) : []),
    [gridOn, gridView, townships],
  )

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    // Off means off: drawing an empty collection would leave the layer in
    // place, and a style reload would then bring an empty grid back with it.
    if (!gridOn) {
      removeQuarterGrid(map, gridMarkersRef.current)
      gridMarkersRef.current = []
      return
    }
    gridMarkersRef.current = drawQuarterGrid(map, gridParcels, gridMarkersRef.current)
    // The paddock letters sit above everything, including this.
    raiseLabels(map)
  }, [mapRef, ready, gridOn, gridParcels])

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
  }, [mapRef, ready])

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
  }, [mapRef, ready, features, herd])

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
        // The day is part of the id. A MapLibre image source keeps the URL it
        // was created with, so reusing one id across days would leave the first
        // day's picture on screen under a new date — silently, which is the
        // worst way for a date picker to be wrong.
        const id = `${set.prefix}${img.sensed_on}-${img.subject_id}`
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
  }, [mapRef, ready, ndviRasters, photoRasters, fillMode, ndviScale, asOf])

  // Frame the ranch's paddocks once we know where they are, and again when the
  // Ranch filter changes — but not on every data refresh, which would undo a
  // zoom somebody chose.
  const framedFor = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || framedFor.current === ranchId || features.features.length === 0) return
    const b = new maplibregl.LngLatBounds()
    for (const f of features.features) {
      const geom = f.geometry
      const polys =
        geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : []
      for (const poly of polys) for (const ring of poly) for (const c of ring) b.extend(c as [number, number])
    }
    if (!b.isEmpty()) map.fitBounds(b, { padding: 32, maxZoom: 15, duration: 0 })
    framedFor.current = ranchId
  }, [mapRef, ready, features, ranchId])

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

  // `on` is what the icon lights for: whether the map is drawing anything from
  // that layer right now, not whether its flyout is open. Each one says what
  // its own state means on hover, because "drawn" is not the same question for
  // every layer — a gate is drawn whether or not it is open.
  const shadingWord = { readiness: 'ready to graze', ndvi: 'NDVI', photo: 'photo', off: 'off' }[fillMode]
  const gatesOpen = gates?.filter((g) => g.is_open).length ?? 0
  const myMapOn = cattleLayerNames.filter((n) => layerSettings[n]?.visible !== false).length
  const rail: RailItem[] = [
    {
      key: 'shading',
      label: 'Paddock shading',
      Icon: Satellite,
      on: fillMode !== 'off',
      hint: `Paddock shading — ${shadingWord}`,
    },
    {
      key: 'water',
      label: 'Water',
      Icon: Droplet,
      on: showWater || showReach,
      hint: `Water — ${
        showWater && showReach
          ? 'drinks and distance'
          : showWater
            ? 'drinks'
            : showReach
              ? 'distance'
              : 'off'
      }`,
    },
    {
      key: 'grid',
      label: 'Survey grid',
      Icon: Grid3x3,
      on: showGrid,
      hint: `Survey grid — ${showGrid ? 'on' : 'off'}`,
    },
    // Gates are not a layer you draw, but an open one carries the next
    // paddock's water through it — so the icon lights when any gate is open,
    // which is exactly when the water shading is not what the fences suggest.
    ...(gates?.length
      ? [
          {
            key: 'gates' as const,
            label: 'Gates',
            Icon: DoorOpen,
            on: gatesOpen > 0,
            hint: `Gates — ${gatesOpen} of ${gates.length} open`,
          },
        ]
      : []),
    {
      key: 'weeds',
      label: 'Weeds',
      Icon: Sprout,
      on: showWeeds,
      hint: `Weeds — ${showWeeds ? 'on' : 'off'}`,
    },
  ]
  if (cattleLayerNames.length > 0)
    rail.push({
      key: 'mymap',
      label: 'Map layers',
      Icon: Layers,
      on: myMapOn > 0,
      hint: `Map layers — ${myMapOn} of ${cattleLayerNames.length} shown`,
    })

  return (
    <div className="space-y-3">
      {/* This row sits above the map, so the column beside the map is pushed
          down by its height to keep the two tops level. MAP_HEAD_H in
          MapSidebar.tsx is that height — change it with this row. */}
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
        {/* An icon rail, not one long panel. Every layer used to share a
            single scrolling column, so its switch, its legend and its own
            buttons sat a screen apart, and collapsed the panel said only
            "Layers" — you could not tell what the map was drawing without
            opening it. A lit icon says that at a glance, and opening one
            brings that layer's switch, legend and actions up together. One
            flyout at a time: two would cover the map this page is for. */}
        {/* No backdrop-blur on the flyout below, deliberately. backdrop-filter
            makes an element the containing block for its fixed-position
            children, so the ⓘ panels inside these flyouts were positioned
            against that 224 px box and clipped by its own overflow — you had
            to scroll a narrow column to read a paragraph. Opaque white
            instead, and the panels float over the map as they do elsewhere. */}
        <div className="absolute right-3 top-3 z-10 flex items-start justify-end gap-2">
          {openRail && (
            <div className="max-h-[60vh] w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                {/* GatesPanel heads itself, so it would be titled twice. */}
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {openRail === 'gates' ? '' : rail.find((r) => r.key === openRail)?.label}
                </p>
                <button
                  onClick={() => setOpenRail(null)}
                  aria-label="Close"
                  className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              {openRail === 'shading' && (
                <>
                  <div className="flex gap-1">
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
                        onClick={() => {
                          setFillMode(val)
                          // Sticks, like the other layer switches: a shading you
                          // have to re-pick every visit is one you stop picking.
                          writeStored('cattle_fillMode', val)
                        }}
                        title={
                          val === 'ndvi' ? 'NDVI — how green the satellite sees the paddock' : undefined
                        }
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
                  {(fillMode === 'ndvi' || fillMode === 'photo') && (
                    <ImageryDayPicker
                      days={imageryDays ?? []}
                      asOf={asOf}
                      onPick={setAsOf}
                      shown={shownRasters}
                    />
                  )}
                  {fillMode === 'readiness' && (
                    <ul className="mt-2 space-y-0.5">
                      {((dormant ? ['dormant', 'red', 'grey'] : ['green', 'yellow', 'red', 'grey']) as Light[]).map(
                        (l) => (
                          <li key={l} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-sm"
                              style={{ backgroundColor: LIGHT_COLOUR[l] }}
                            />
                            {LIGHT_LABEL[l]}
                          </li>
                        ),
                      )}
                      <li className="pt-1">
                        <HelpNote summary="Tap a paddock for the reason." title="How “Graze?” is decided">
                          <p>
                            Forage from the satellite, rest since the last move-out against the
                            paddock's minimum, cattle on it now, and whether it has been grazed this
                            season. Tap a paddock for the reason.
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
                      <li className="text-[11px] text-gray-400">
                        NDVI — bare ground through heavy canopy
                      </li>
                    </ul>
                  )}
                  {fillMode === 'off' && (
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      Paddocks drawn as outlines only.
                    </p>
                  )}
                </>
              )}

              {openRail === 'water' && (
                <>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={showWater}
                      onChange={(e) => {
                        setShowWater(e.target.checked)
                        writeStored('cattle_showWater', e.target.checked ? '1' : '0')
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
                        writeStored('cattle_showReach', e.target.checked ? '1' : '0')
                      }}
                      className="h-3.5 w-3.5"
                    />
                    Distance from water
                  </label>
                  {showReach && (
                    <ul className="mt-1.5 space-y-0.5">
                      {(
                        [
                          ['#38bdf8', `Within ${reachNear} m of a drink — grazes evenly`, null],
                          [
                            '#f59e0b',
                            `${reachNear}–${reachFar.toLocaleString('en-CA')} m, grazed less evenly`,
                            marginTotal,
                          ],
                          [
                            '#dc2626',
                            `Past ${reachFar.toLocaleString('en-CA')} m, past the recommendation`,
                            beyondTotal,
                          ],
                        ] as [string, string, number | null][]
                      ).map(([colour, label, acres]) => (
                        <li key={label} className="flex items-baseline gap-1.5 text-[11px] text-gray-600">
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: colour }}
                          />
                          <span>
                            {label}
                            {acres != null && (
                              <span className="text-gray-400">
                                {' · '}
                                {Math.round(acres).toLocaleString('en-CA')} ac
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                      <li className="text-[11px] text-gray-400">
                        Counted from drinks inside the paddock's own fence.
                      </li>
                      <li className="pt-1">
                        <HelpNote summary="A recommendation, not a limit." title="What the bands mean">
                          <p>
                            {reachNear} m is the recommended distance from water. The Beef Cattle
                            Research Council calls 800 ft the ideal; South Dakota State puts the
                            start of the rapid drop-off in grazing use at 800–1,000 ft; and a
                            three-season Wyoming study found three quarters of all grazing inside
                            366 m.
                          </p>
                          <p className="mt-1.5">
                            Red is past the recommendation, not out of reach. On flat ground cattle
                            will walk two miles for a drink — red is ground that gets grazed
                            lightly, not ground they cannot water on.
                          </p>
                          <p className="mt-2 border-t border-gray-100 pt-2">
                            <a
                              href={PINCHAK_PAPER}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                            >
                              Pinchak et al. 1991 <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>{' '}
                            is the measurement behind 366 m — three seasons of observed grazing on
                            Wyoming foothill range. The quarter-mile ideal is the{' '}
                            <a
                              href={BCRC_WATER}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                            >
                              Beef Cattle Research Council's <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                            . The full working, every source and why 800 m was wrong, is in
                            docs/grazing-distance-evidence.md.
                          </p>
                        </HelpNote>
                      </li>
                    </ul>
                  )}
                  {isManager && (
                    <div className="mt-2 flex flex-col gap-1">
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
                          {synced === 0
                            ? 'Nothing new on the My Map.'
                            : `${synced} new pin${synced === 1 ? '' : 's'} added.`}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {openRail === 'gates' && <GatesPanel ranchId={ranchId} canEdit={isManager} />}

              {openRail === 'grid' && (
                <>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={showGrid}
                      onChange={(e) => {
                        setShowGrid(e.target.checked)
                        writeStored('cattle_showGrid', e.target.checked ? '1' : '0')
                      }}
                      className="h-3.5 w-3.5"
                    />
                    Quarter sections
                  </label>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {showGrid && !gridOn
                      ? 'Zoom in to draw it.'
                      : 'The legal quarters, the same grid the crop map draws.'}
                  </p>
                </>
              )}

              {openRail === 'weeds' && (
                <>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={showWeeds}
                      onChange={(e) => {
                        setShowWeeds(e.target.checked)
                        writeStored('cattle_showWeeds', e.target.checked ? '1' : '0')
                      }}
                      className="h-3.5 w-3.5"
                    />
                    Show patches
                  </label>
                  {showWeeds && (
                    <>
                      <ul className="mt-1.5 space-y-0.5">
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
                          className="mt-2 w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Mark a patch
                        </button>
                      )}
                    </>
                  )}
                </>
              )}

              {openRail === 'mymap' && (
                <>
                  <ul className="space-y-1">
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
                          {/* A colour well rather than a palette: the layers come
                              from a map Sam controls, so the choice should be
                              his too. */}
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
                        Tick what this map should draw from “{editingLayer}”. Pipes, pumps, pivots and
                        the irrigated fields start hidden; the My Map itself is not changed.
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
                                .map((f) => ({
                                  f,
                                  key: featureKey(f),
                                  name: featureName(f) || '(unnamed)',
                                  kind: f.geometry?.type ?? '',
                                }))
                                .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
                                .map(({ f, key, name: fname, kind }) => (
                                  <li key={key} className="flex items-center gap-1.5 text-[11px] text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={!isHiddenFeature(f, hiddenOverrides)}
                                      onChange={(e) =>
                                        hiddenMut.set.mutate({ features: [f], hidden: !e.target.checked })
                                      }
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
                </>
              )}
            </div>
          )}

          <div className="flex shrink-0 flex-col gap-0.5 rounded-lg border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur">
            {rail.map(({ key, label, Icon, on, hint }) => (
              <button
                key={key}
                onClick={() => setOpenRail((o) => (o === key ? null : key))}
                title={hint}
                aria-label={label}
                aria-pressed={openRail === key}
                className={cn(
                  'relative rounded-md p-1.5 transition-colors',
                  openRail === key
                    ? 'bg-gray-900 text-white'
                    : on
                      ? 'bg-brand-100 text-brand-800 hover:bg-brand-200'
                      : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500',
                )}
              >
                <Icon className="h-4 w-4" />
                {/* The tint alone is easy to miss at this size, and the whole
                    point of the rail is reading what is drawn without opening
                    anything — so a lit layer also carries a dot. */}
                {on && (
                  <span
                    className={cn(
                      'absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full',
                      openRail === key ? 'bg-white' : 'bg-brand-600',
                    )}
                  />
                )}
              </button>
            ))}
          </div>
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
                <dt className="text-[11px] uppercase tracking-wide text-gray-500">Total acres</dt>
                <dd className="font-semibold tabular-nums text-gray-900">
                  {selected.area_acres != null ? ac0(selected.area_acres) : <span className="text-gray-300">—</span>}
                </dd>
              </div>
              <div>
                <dt
                  className="text-[11px] uppercase tracking-wide text-gray-500"
                  title="The acres that actually grow grass: the paddock less its waste ground, plus whatever of a crop field inside the fence the herd can take. The same figure the Grazing tab prints."
                >
                  Grazeable
                </dt>
                <dd className="font-semibold tabular-nums text-gray-900">
                  {grazeable.get(selected.id) ? (
                    ac0(grazeable.get(selected.id)!.grazeable)
                  ) : (
                    <span className="text-gray-300" title="This paddock has no row on the Grazing tab.">
                      —
                    </span>
                  )}
                </dd>
              </div>
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

            <UnusedGround reach={selectedReach} />
            <RingComparison pastureId={selected.id} reach={selectedReach} />

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
                <TroughSuggest
                  key={selected.id}
                  map={mapInstance}
                  mapReady={ready}
                  pastureId={selected.id}
                  canEdit={isManager}
                  beforeId={LINE}
                />
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

        {/* Inside the map's own box, not after it: the panel this draws when a
            pin is clicked is positioned `absolute`, and out here the nearest
            positioned ancestor was the page itself — so it pinned to the
            bottom-left corner of the window, over the nav and the cards under
            the map, instead of sitting on the map. */}
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
            writeStored('cattle_showReach', '1')
          }}
          onPinSelected={() => setSelectedId(null)}
          beforeId={LINE}
        />
      </div>

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

/**
 * Which satellite pass the paddocks are shaded from.
 *
 * A plain calendar would be the wrong control here: Sentinel-2 comes over every
 * few days, cloud throws most of those away, and a paddock only appears in the
 * pass that actually saw it — so the list is the passes on file, each with the
 * number of paddocks it covered. Picking a day with 3 of 17 is allowed; being
 * surprised by it afterwards is not.
 *
 * The newest pass is "Latest", not its own date, so the address does not pin a
 * day that goes stale on the next clear morning.
 */
function ImageryDayPicker({
  days,
  asOf,
  onPick,
  shown,
}: {
  days: ImageryDay[]
  asOf: string | null
  onPick: (day: string | null) => void
  shown: { sensed_on: string }[] | undefined
}) {
  const list = days.map((d) => d.day)
  const back = stepDay(list, asOf, -1)
  const fwd = stepDay(list, asOf, 1)
  const total = days.length ? Math.max(...days.map((d) => d.subjects)) : 0
  const picked = days.find((d) => d.day === asOf)
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-CA', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })

  if (!days.length) return null
  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Satellite day</p>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPick(back.day)}
          disabled={!back.moved}
          aria-label="Previous satellite pass"
          title="Previous satellite pass"
          className="rounded border border-gray-300 p-1 text-gray-600 enabled:hover:bg-gray-50 disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <select
          value={asOf ?? ''}
          onChange={(e) => onPick(e.target.value || null)}
          aria-label="Show the paddocks as the satellite saw them on"
          className={cn(
            'min-w-0 flex-1 rounded border px-1 py-1 text-[11px]',
            asOf ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-300 text-gray-700',
          )}
        >
          <option value="">Latest</option>
          {[...days].reverse().slice(1).map((d) => (
            <option key={d.day} value={d.day}>
              {fmt(d.day)} · {d.subjects} of {total}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onPick(fwd.day)}
          disabled={!fwd.moved}
          aria-label="Next satellite pass"
          title="Next satellite pass"
          className="rounded border border-gray-300 p-1 text-gray-600 enabled:hover:bg-gray-50 disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        {asOf && (
          <button
            type="button"
            onClick={() => onPick(null)}
            aria-label="Back to the latest pass"
            title="Back to the latest pass"
            className="rounded p-0.5 text-amber-800 hover:bg-amber-100"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        {shown?.length ? photoDateLabel(shown.map((i) => i.sensed_on)) : 'No picture on file for this day.'}
        {picked && picked.subjects < total ? ` ${total - picked.subjects} paddock(s) show an earlier pass.` : ''}
      </p>
      {asOf && (
        <p className="mt-1 text-[11px] text-amber-700">
          Imagery only. Graze?, the herd and water stay as they are today.
        </p>
      )}
    </div>
  )
}

/** Acres, to the nearest one, the way the rest of the cattle pages write them. */
const ac0 = (n: number) => `${Math.round(n).toLocaleString('en-CA')} ac`

/**
 * Ground in this paddock the herd effectively does not use, because it is too
 * far from water (spec §9.4).
 *
 * Distance from water is a range, not a line, and the radii are a
 * recommendation rather than a limit: cattle work the ground inside the near
 * radius evenly and keep going well past it, grazing it less evenly as they
 * go. None of this is ground they cannot reach -- on flat ground they will
 * walk two miles for a drink. So it reads as two figures rather than one — past the
 * outer radius, where the herd does not go, and the margin between, which it
 * grazes lightly. A paddock with no water pin is held out: its whole area
 * comes back as out of reach, which says nothing about the grazing.
 */
/**
 * Whether the far ground is actually being left — the satellite's own answer
 * to the acres above it (Sam, 12 Nov 2026: "put it back").
 *
 * The acres beyond the recommended distance are a prediction out of the
 * grazing-distance research. This is the check on it: the paddock is cut into
 * three rings by distance from water, and on a day the satellite gets a clear
 * look at the whole paddock, the greenness of the outer ring is compared with
 * the inner one. Same ground, same day, same weather, so most of what is left
 * between them is the cattle.
 *
 * It cuts both ways, and the second way is the one that saves money: a far
 * ring grazed as hard as the near one is a paddock that needs no trough,
 * whatever the distance rule says.
 *
 * Blank is the normal state for a while. A ring's readings are thrown away
 * whenever the ring is redrawn — a pin moved, a trough added, "cattle drink
 * here" unticked — because a reading describes the ground it was taken over.
 * So the history only builds while the water sits still, and only through the
 * growing season: greenness in November says nothing about grazing.
 */
function RingComparison({ pastureId, reach }: { pastureId: string; reach: WaterReach | null }) {
  const { data: rows } = useUnderutilisation()
  if (!reach?.is_paddock || !reach.has_water) return null
  const near = Math.round(reach.near_m).toLocaleString('en-CA')
  const far = Math.round(reach.far_m).toLocaleString('en-CA')
  const r = (rows ?? []).find((x) => x.pasture_id === pastureId)

  if (!r || !r.same_day) {
    return (
      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-500">
        The rings have not been compared yet
        <InfoPopover title="Comparing the rings">
          <p>
            The paddock is cut into three rings by distance from water — within {near} m, {near} to{' '}
            {far} m, and beyond {far} m — and the satellite&rsquo;s greenness reading for the outer
            ring is compared with the inner one, taken on the same day so the weather and the season
            cancel out. A far ring that is markedly greener is ground the herd is not eating.
          </p>
          <p className="mt-2">
            A ring&rsquo;s readings are thrown away whenever it is redrawn, because a reading
            describes the ground it was taken over: move a pin, add a trough or untick &ldquo;cattle
            drink here&rdquo; and that paddock starts again. So this fills in while the water sits
            still, through a growing season — greenness in November says nothing about grazing.
          </p>
        </InfoPopover>
      </p>
    )
  }

  return (
    <div
      className={cn(
        'mt-1.5 rounded-md px-2 py-1.5 text-xs',
        r.actionable ? 'bg-amber-50 text-amber-900' : 'text-gray-600',
      )}
    >
      <p>{r.finding}</p>
      <p className="mt-0.5 text-[11px] tabular-nums text-gray-500">
        NDVI {r.near_water_ndvi} within {near} m against {r.far_water_ndvi} beyond {far} m
        {r.ndvi_gap != null && ` — a gap of ${r.ndvi_gap}`}.
      </p>
    </div>
  )
}

function UnusedGround({ reach }: { reach: WaterReach | null }) {
  if (!reach || !reach.is_paddock) return null
  if (!reach.has_water) {
    return (
      <p className="mt-2 rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
        No water marked on this paddock, so how much of it the herd can reach is unknown.
      </p>
    )
  }
  const beyond = reach.beyond_acres
  const margin = reach.margin_acres
  if (beyond <= 0 && margin <= 0) {
    return (
      <p className="mt-2 text-xs text-green-800">
        Every acre is within the recommended {Math.round(reach.near_m).toLocaleString('en-CA')} m
        of water.
      </p>
    )
  }
  return (
    <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
      <p className="font-medium">Ground the herd is not using</p>
      <p className="mt-0.5">
        {beyond > 0 && (
          <>
            <span className="font-semibold tabular-nums">{ac0(beyond)}</span> sits past{' '}
            {Math.round(reach.far_m).toLocaleString('en-CA')} m from water, too far to graze
          </>
        )}
        {beyond > 0 && margin > 0 && ', and '}
        {margin > 0 && (
          <>
            <span className="font-semibold tabular-nums">{ac0(margin)}</span> between{' '}
            {Math.round(reach.near_m).toLocaleString('en-CA')} and {Math.round(reach.far_m).toLocaleString('en-CA')} m
            is grazed lightly
          </>
        )}
        .
      </p>
      <p className="mt-0.5 text-amber-800">
        Only <span className="font-semibold tabular-nums">{ac0(reach.reach_acres)}</span> is within{' '}
        {Math.round(reach.near_m).toLocaleString('en-CA')} m of water.
      </p>
    </div>
  )
}
