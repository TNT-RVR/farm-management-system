import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import { addPinImages, PIN_ICON_EXPR, withPins } from '@/lib/map-pins'
import type { FeatureCollection, MultiPolygon, Position } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ChevronRight, Crosshair, Layers, MapPin, Ruler, X } from 'lucide-react'
import { SoilLayer } from '@/pages/map/SoilLayer'
import { YieldZoneLayer } from '@/pages/map/YieldZoneLayer'
import { MeasureTool } from '@/pages/map/MeasureTool'
import {
  freshness,
  ageSentence,
  ndviColour,
  useFieldSatellite,
  useFieldImagery,
  useZoneReadiness,
  zoneWaitingMessage,
  NDVI_RAMP,
  NO_DATA_COLOUR,
} from '@/lib/pastures'
import {
  boundariesForYear,
  useAllBoundaries,
  useCropHistoryByYear,
  useCropPlans,
  useCrops,
  useFields,
  type BoundaryRow,
  type FieldRow,
} from '@/lib/queries'
import { useCropYear } from '@/lib/crop-year'
import { GRID_ERROR_M, SURVEY_ERROR_M, atsBox, toGeoJson } from '@/lib/geo/ats'
import { useTownshipTable } from '@/lib/geo/atsTownships'
import { quarterGridGeoJson, quartersInView, type Bounds, type GridParcel } from '@/lib/geo/atsGrid'
import { formatLld, lldMatches, parseLld } from '@/lib/geo/lld'
import { reverseLld } from '@/lib/geo/ats'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  extractMid,
  isCattleLayer,
  layerLegend,
  splitLayers,
  useMyMapGeo,
  useMyMapUrl,
  useSetMyMapUrl,
} from '@/lib/mymaps'
import { FarmLayersLegend, FarmLayersOverlay } from '@/pages/map/FarmLayers'
import { farmLayersBusy, hitsFarmFeature } from '@/lib/farm-layers-map'
import { myMapFolderOf, useFarmLayers } from '@/lib/farm-layers'
import { CropSplitEditor } from '@/pages/map/CropSplitEditor'
import { useFieldPivots, useLatestBalance } from '@/lib/irrigation'
import {
  fnStatus,
  useFieldnetSystems,
  FN_STATUS_COLOR,
  type FieldnetSystem,
} from '@/lib/fieldnet'
import { PivotStatusPanel } from '@/components/PivotStatusPanel'

// Great-circle metres between two [lon,lat] points.
function metersBetween(a: number[], b: number[]): number {
  const R = 6371000
  const t = (x: number) => (x * Math.PI) / 180
  const dLat = t(b[1] - a[1])
  const dLon = t(b[0] - a[0])
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(t(a[1])) * Math.cos(t(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(q))
}
// Pivot radius (m) implied by the irrigated acreage: r = sqrt(area / π).
const acresRadiusM = (acres: number) => Math.sqrt((acres * 4046.8564224) / Math.PI)

// Destination point [lon,lat] from a start point, bearing (deg from N), distance (m).
function destination(lon: number, lat: number, bearingDeg: number, distM: number): number[] {
  const R = 6371000
  const br = (bearingDeg * Math.PI) / 180
  const d = distM / R
  const φ1 = (lat * Math.PI) / 180
  const λ1 = (lon * Math.PI) / 180
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(br))
  const λ2 =
    λ1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2))
  return [(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]
}
// Bearing (deg from N) from point a to point b.
function bearingBetween(a: number[], b: number[]): number {
  const φ1 = (a[1] * Math.PI) / 180
  const φ2 = (b[1] * Math.PI) / 180
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
// A closed ring approximating the pivot's wetted circle.
function circleRing(center: number[], radiusM: number): number[][] {
  const pts: number[][] = []
  for (let a = 0; a <= 360; a += 6) pts.push(destination(center[0], center[1], a, radiusM))
  return pts
}
// A pie-wedge ring from bearing a0 to a1 (handles wraparound).
function wedgeRing(center: number[], radiusM: number, a0: number, a1: number): number[][] {
  let end = a1
  if (end < a0) end += 360
  const pts: number[][] = [center]
  for (let a = a0; a < end; a += 3) pts.push(destination(center[0], center[1], a, radiusM))
  pts.push(destination(center[0], center[1], end, radiusM))
  pts.push(center)
  return pts
}
// Absolute applied-water scale (mm). Band edges are per time window, since a
// week's water is far less than a season's. Colour runs dry → wet.
const HEATMAP_COLORS = ['#dc2626', '#f97316', '#facc15', '#84cc16', '#22c55e', '#3b82f6'] as const
const HEATMAP_BANDS: Record<AppliedWindow, number[]> = {
  season: [50, 100, 150, 200, 250],
  month: [20, 40, 60, 80, 100],
  week: [5, 10, 15, 20, 25],
}
type AppliedWindow = 'season' | 'month' | 'week'
const WINDOW_LABEL: Record<AppliedWindow, string> = {
  season: 'This year',
  month: 'Last 30 days',
  week: 'Last 7 days',
}
const MM_PER_IN = 25.4
const mmIn = (mm: number) => `${Math.round(mm)} mm (${(mm / MM_PER_IN).toFixed(2)}″)`

/** Colour for an absolute applied depth (mm) within the chosen window. */
function sectorColor(depthMm: number, window: AppliedWindow): string {
  const bands = HEATMAP_BANDS[window]
  for (let i = 0; i < bands.length; i++) if (depthMm < bands[i]) return HEATMAP_COLORS[i]
  return HEATMAP_COLORS[HEATMAP_COLORS.length - 1]
}

/** Legend rows: [label, colour] for the chosen window, in mm + inches. */
function heatmapLegend(window: AppliedWindow): [string, string][] {
  const b = HEATMAP_BANDS[window]
  const rows: [string, string][] = []
  for (let i = 0; i <= b.length; i++) {
    const lo = i === 0 ? 0 : b[i - 1]
    const hi = i < b.length ? b[i] : null
    const label =
      hi == null
        ? `${lo}+ mm (${(lo / MM_PER_IN).toFixed(1)}″+)`
        : `${lo}–${hi} mm (${(lo / MM_PER_IN).toFixed(1)}–${(hi / MM_PER_IN).toFixed(1)}″)`
    rows.push([label, HEATMAP_COLORS[i]])
  }
  return rows
}
import { downloadFieldFileData, useGeospatialFiles, type FieldFileRow } from '@/lib/files'
import { parseBoundaryData } from '@/lib/geo/parse-boundary-file'
import { SALT_CLASSES, SALT_NO_DATA, fieldSalinity, saltColour, useFieldSalinity, type FieldSalt } from '@/lib/salinity'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { labelPointOf } from '@/lib/geo/area'
import { cn } from '@/lib/utils'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { Fold } from '@/components/Fold'
import { InfoPopover } from '@/components/InfoPopover'
import { ndreColour, useFieldNdre } from '@/lib/ndre'
import { SOIL_NO_DATA_COLOUR, SOIL_WATER_BANDS, AGRASID_SOURCE } from '@/lib/soil-landscape'
import { useYieldZones, yieldBands } from '@/lib/yield-zones'
import { farmMapCenter } from '@/lib/farm-setup'

type Feature = {
  type: 'Feature'
  geometry: MultiPolygon
  properties: {
    field_id: string
    name: string
    acres: number
    irr_status: string
    fn_status: string
    /** The colour the satellite fill uses. Grey where there is no observation. */
    ndvi_colour: string
  }
}

// Live-pivot (FieldNET) field fill + arm colour: red fault, blue on, green off, grey no-comms.
const FIELDNET_FILL: unknown = [
  'match',
  ['get', 'fn_status'],
  'fault', FN_STATUS_COLOR.fault,
  'on', FN_STATUS_COLOR.on,
  'off', FN_STATUS_COLOR.off,
  'disconnected', FN_STATUS_COLOR.disconnected,
  '#94a3b8',
]
const FIELDNET_LEGEND = [
  ['Fault / alert', FN_STATUS_COLOR.fault],
  ['Pivot on', FN_STATUS_COLOR.on],
  ['Pivot off', FN_STATUS_COLOR.off],
  ['Disconnected', FN_STATUS_COLOR.disconnected],
] as const


// Field fill: flat blue normally, or colour-coded by irrigation status when the
// irrigation layer is on (spec §12.1). Fields with no balance data stay grey so
// "not scheduled" reads differently from "OK".
//
// Blue rather than green for the resting state: the basemap is satellite
// imagery, and in summer a green outline sits on top of green cropland and
// disappears. Nothing else in the natural scene is this blue, so the boundary
// reads at a glance. The status ramps below stay green/amber/red — those carry
// meaning, and the resting colour deliberately does not.
//
// The FILL is transparent with no layer active. A blue wash over real imagery
// shifts how the crop underneath reads, and the resting state has nothing to
// say that the outline does not already say.
const BOUNDARY_FILL_OFF = '#38bdf8'
const BOUNDARY_LINE_OFF = '#0ea5e9'
const IRRIGATION_FILL_ON: unknown = [
  'match',
  ['get', 'irr_status'],
  'ok', '#22c55e',
  'soon', '#f59e0b',
  'now', '#ef4444',
  'stress', '#b91c1c',
  '#94a3b8',
]
const IRRIGATION_LEGEND = [
  ['OK', '#22c55e'],
  ['Irrigate soon', '#f59e0b'],
  ['Irrigate now', '#ef4444'],
  ['Water stress', '#b91c1c'],
  ['Not scheduled', '#94a3b8'],
] as const

/**
 * Whether a map can still be asked about its layers.
 *
 * Effect cleanups capture the map in a closure, and React runs cleanups in the
 * order the effects were DEFINED — so the initialising effect's cleanup, which
 * calls map.remove(), runs before every other one. Each later cleanup then
 * reaches a destroyed map whose style is gone, and map.getLayer() throws
 * "Cannot read properties of undefined".
 *
 * That throw is why leaving the map blanked the whole app. It happens during
 * unmount, while the pathname-keyed error boundary is itself unmounting, so
 * nothing is left to catch it and React tears down the entire root — a white
 * screen that only a reload fixes, which is exactly what it looked like.
 *
 * `style` is internal, hence the cast; there is no public "is this map still
 * alive" predicate, and `loaded()` throws on a removed map rather than
 * answering.
 */
function mapAlive(m: maplibregl.Map | null | undefined): m is maplibregl.Map {
  return !!m && !!(m as unknown as { style?: unknown }).style
}

/**
 * Just the date the picture was taken.
 *
 * Everything else came off this layer deliberately: it carried an age in days,
 * a caveat about interpolation and a colour ramp, none of which apply to a
 * photograph. A photograph is one moment, and the only thing worth saying about
 * it is when. Fields usually share a satellite pass, so one date normally
 * covers them all; a range appears only when they genuinely differ.
 */
/**
 * The one NDVI range every raster is drawn on.
 *
 * Read off the images themselves rather than recomputed, so the legend can only
 * ever describe what was actually rendered. A legend derived separately would
 * drift from the pictures the moment the scale moved.
 */
function ndviScaleLabel(images: { stretch_min: number | null; stretch_max: number | null }[] | undefined): string {
  const withScale = (images ?? []).filter((i) => i.stretch_min != null && i.stretch_max != null)
  if (!withScale.length) return 'Shaded from low to high NDVI.'
  const lo = Math.min(...withScale.map((i) => i.stretch_min as number))
  const hi = Math.max(...withScale.map((i) => i.stretch_max as number))
  return `Shaded from ${lo.toFixed(2)} to ${hi.toFixed(2)} NDVI.`
}

function photoDateLabel(days: string[]): string {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  const sorted = [...new Set(days)].sort()
  const oldest = sorted[0]
  const newest = sorted[sorted.length - 1]
  return oldest === newest
    ? `Taken ${fmt(newest)}.`
    : `Taken ${fmt(oldest)} to ${fmt(newest)}.`
}


/**
 * A legend that stays folded up until asked for.
 *
 * Every layer that has one shows five or six swatches, and with three layers on
 * the panel becomes a wall of colour nobody is reading. The arrow sits on the
 * layer's own row, so the legend is one click away from the thing it explains
 * rather than always in the way. The choice sticks per layer.
 */
function useLegendOpen(key: string) {
  const [open, setOpen] = useState(() => localStorage.getItem(`map_legend_${key}`) === '1')
  useEffect(() => void localStorage.setItem(`map_legend_${key}`, open ? '1' : '0'), [key, open])
  return [open, () => setOpen((o) => !o)] as const
}

function LegendArrow({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? `Hide the ${label} legend` : `Show the ${label} legend`}
      className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
    >
      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
    </button>
  )
}

/** Salinity legend, and the saltiest fields by name — the colour alone hides which. */
function SaltLegend({ salt, names }: { salt: Map<string, FieldSalt>; names: Map<string, { name: string }> }) {
  const worst = [...salt.entries()].filter(([id]) => names.has(id)).sort((a, b) => b[1].worst - a[1].worst).slice(0, 5)
  return (
    <>
      <LegendList items={[['No soil-test EC', SALT_NO_DATA] as const, ...SALT_CLASSES.map((c) => [`EC ${c.label}`, c.colour] as const)]} />
      <p className="ml-6 mb-1 text-[11px] text-gray-500">
        Topsoil EC (mS/cm) from each field&apos;s latest soil test, averaged over its samples. Saltiest patches:{' '}
        {worst.length
          ? worst.map(([id, v]) => `${names.get(id)!.name} ${v.worst.toFixed(2)}${v.naPct != null && v.naPct >= 5 ? ` (Na ${v.naPct.toFixed(0)}%)` : ''}`).join(', ')
          : 'none on record'}
        .
      </p>
    </>
  )
}

function LegendList({
  items,
  className = 'mb-1 ml-6 space-y-0.5',
}: {
  items: readonly (readonly [string, string])[]
  className?: string
}) {
  return (
    <ul className={className}>
      {items.map(([l, color]) => (
        <li key={l} className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <span className="inline-block h-2.5 w-2.5 flex-none rounded-sm" style={{ backgroundColor: color }} />
          {l}
        </li>
      ))}
    </ul>
  )
}

/**
 * One Google My Maps layer, with its own legend behind its own arrow.
 *
 * Two levels of folding, because My Maps is two levels deep: the map has layers
 * (Oil, Gas, Leases) and each layer has its own named, coloured features. Opening
 * everything at once would put a couple of hundred rows in a floating panel.
 */
function MyMapLayerRow({
  layer,
  fc,
  checked,
  onToggle,
}: {
  layer: string
  fc: FeatureCollection
  checked: boolean
  onToggle: (on: boolean) => void
}) {
  const [open, toggle] = useLegendOpen(`mymap_${layer}`)
  // Only built when actually shown — a map with thousands of placemarks should
  // not walk them all to render a panel row that is folded shut.
  const legend = useMemo(() => (open ? layerLegend(fc, layer) : []), [open, fc, layer])

  return (
    <li>
      <div className="flex items-center gap-1">
        <label className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-[13px]">
          <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
          <span className="truncate">{layer}</span>
        </label>
        <LegendArrow open={open} onToggle={toggle} label={layer} />
      </div>
      {open && (
        <>
          <LegendList items={legend.map((e) => [e.label, e.color] as const)} className="mb-1 ml-6 space-y-0.5" />
          {legend.length === 0 && (
            <p className="mb-1 ml-6 text-[11px] text-gray-400">Nothing in this layer.</p>
          )}
        </>
      )}
    </li>
  )
}

/** The field-colour choices, in the order the layer panel lists them. */
const FILL_MODES = [
  ['none', 'Off'],
  ['aimm', 'Irrigation (AIMM)'],
  ['fieldnet', 'Live pivots (FieldNET)'],
  ['satellite', 'Satellite (NDVI)'],
  ['photo', 'Latest satellite photo'],
  ['salinity', 'Salinity (soil tests)'],
] as const

export function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const overlayLoaded = useRef<Set<string>>(new Set())
  const [mapReady, setMapReady] = useState(false)
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [showBoundaries, setShowBoundaries] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showMyMap, setShowMyMap] = useState(() => localStorage.getItem('map_showMyMap') === '1')
  const [activeMyMapLayers, setActiveMyMapLayers] = useState<Set<string>>(new Set())
  const [aimmLegend, toggleAimmLegend] = useLegendOpen('aimm')
  const [fnLegend, toggleFnLegend] = useLegendOpen('fieldnet')
  const [heatLegend, toggleHeatLegend] = useLegendOpen('heatmap')
  const [soilLegend, toggleSoilLegend] = useLegendOpen('soil')
  const [yieldLegend, toggleYieldLegend] = useLegendOpen('yield')
  const { data: yieldZones } = useYieldZones()
  const [satLegend, toggleSatLegend] = useLegendOpen('satellite')
  const [myMapOpen, toggleMyMapOpen] = useLegendOpen('mymap')
  const [showSoil, setShowSoil] = useState(() => localStorage.getItem('map_showSoil') === '1')
  const [showYield, setShowYield] = useState(() => localStorage.getItem('map_showYield') === '1')
  const [showLocation, setShowLocation] = useState(() => localStorage.getItem('map_showLocation') === '1')
  const [locError, setLocError] = useState('')
  const layersSigRef = useRef('')
  const myMapPopup = useRef<maplibregl.Popup | null>(null)
  const [activeOverlays, setActiveOverlays] = useState<Set<string>>(new Set())
  const [overlayErrors, setOverlayErrors] = useState<Record<string, string>>({})
  // For the folded Overlays group's summary: how many are drawing right now.
  const [aimmMore, setAimmMore] = useState(false)
  const overlaysOn = (showMyMap ? 1 : 0) + (showSoil ? 1 : 0) + (showYield ? 1 : 0) + activeOverlays.size

  // Field-fill colouring: off, AIMM irrigation status, or FieldNET live pivots.
  // NDVI is what the map opens on. A saved choice still wins — this is the
  // default for a device that has never expressed one, not an override of
  // somebody who deliberately turned the colour off.
  const [fillMode, setFillMode] = useState<'none' | 'aimm' | 'fieldnet' | 'satellite' | 'photo' | 'salinity'>(
    () =>
      (localStorage.getItem('map_fillMode') as 'none' | 'aimm' | 'fieldnet' | 'satellite' | 'photo' | 'salinity') ||
      'satellite',
  )
  const showIrrigation = fillMode === 'aimm'
  const showFieldnet = fillMode === 'fieldnet'
  const showSatellite = fillMode === 'satellite'
  const showPhoto = fillMode === 'photo'
  const showSalt = fillMode === 'salinity'
  const { data: saltRows } = useFieldSalinity(showSalt)
  const saltByField = useMemo(() => fieldSalinity(saltRows ?? []), [saltRows])
  const { data: fieldSat } = useFieldSatellite()
  const { data: zoneReadiness } = useZoneReadiness()
  const { data: fieldImages, error: fieldImagesError } = useFieldImagery()
  // The NDVI raster: per-pixel, at the sensor's real 10 m. A field mean is one
  // number for eighty acres, and the whole reason to look from space is that a
  // field is not uniform.
  // Two NDVI rasters exist per scene and they answer different questions. The
  // shared scale makes fields comparable — same colour, same NDVI, anywhere on
  // the map. The per-field stretch shows what is happening INSIDE one field,
  // which a farm-wide ramp flattens away: a closed August canopy spanning 0.82
  // to 0.86 is one bucket of the shared ramp and renders as a single colour.
  const [ndviScale, setNdviScale] = useState<'shared' | 'field'>(
    () => (localStorage.getItem('map_ndviScale') as 'shared' | 'field') || 'shared',
  )
  // Which index shades the fields. NDVI saturates once the canopy closes, so
  // from about mid-July every acre of corn reads the same and the map goes
  // quiet exactly when the crop is deciding the yield. NDRE uses the red edge
  // and keeps separating. Remembered, because whoever switches to it in August
  // wants it every time they open the map that month.
  const [index, setIndex] = useState<'ndvi' | 'ndre'>(
    () => (localStorage.getItem('map_index') as 'ndvi' | 'ndre') || 'ndvi',
  )
  const { data: fieldNdre } = useFieldNdre()
  const ndreByField = useMemo(
    () => new Map((fieldNdre ?? []).map((f) => [f.field_id, f])),
    [fieldNdre],
  )
  // NDRE is its own raster, not a recolouring of the NDVI one. There is no
  // per-field stretch for it: it earns its keep by comparing fields late in the
  // season, which a per-field range would destroy.
  const { data: ndviRasters } = useFieldImagery(
    index === 'ndre' ? 'ndre' : ndviScale === 'field' ? 'ndvi_field' : 'ndvi',
  )
  const ndviByField = useMemo(
    () => new Map((fieldSat ?? []).map((f) => [f.field_id, f])),
    [fieldSat],
  )
  const satelliteCoverage = useMemo(() => {
    const imaged = (fieldSat ?? []).filter((f) => f.ndvi != null)
    const freshest = imaged
      .map((f) => f.days_since_observation)
      .filter((d): d is number => d != null)
      .sort((a, b) => a - b)[0]
    return {
      total: (fieldSat ?? []).length,
      withImagery: imaged.length,
      freshest: freshest != null ? freshness(freshest).label : '—',
    }
  }, [fieldSat])
  const [showHeatmap, setShowHeatmap] = useState(() => localStorage.getItem('map_fnHeatmap') === '1')
  const [heatWindow, setHeatWindow] = useState<AppliedWindow>(
    // The last seven days by default: the heatmap answers "where has the water
    // been going lately", and a season total flattens that out to nothing.
    () => (localStorage.getItem('map_fnHeatWindow') as AppliedWindow) || 'week',
  )
  const [lldQuery, setLldQuery] = useState('')

  // "Which quarter is this?" — the inverse of the search above, and the one you
  // want standing in a field rather than sitting at a desk.
  const [identifying, setIdentifying] = useState(false)
  const [identified, setIdentified] = useState<{
    lngLat: [number, number]
    result: ReturnType<typeof reverseLld>
  } | null>(null)
  // The map's click handler is registered once and would otherwise close over
  // the first value of `identifying` forever.
  const identifyingRef = useRef(false)
  identifyingRef.current = identifying

  // The tape measure. Same trick with the ref: while it is out, a click is a
  // corner rather than a request to open whatever field is underneath.
  const [measuring, setMeasuring] = useState(false)
  const measuringRef = useRef(false)
  measuringRef.current = measuring
  // Same trick for drawing a weed patch: every vertex click lands on a field,
  // and without this each one would also open that field's panel.

  // The quarter-section grid drawn once you are close enough for it to mean
  // something. Recomputed as the map moves.
  const [gridParcels, setGridParcels] = useState<GridParcel[]>([])
  const [view, setView] = useState<{ zoom: number; bounds: Bounds } | null>(null)
  const gridMarkersRef = useRef<maplibregl.Marker[]>([])
  const townshipsRef = useRef<ReturnType<typeof useTownshipTable>>(null)
  const [searchParams] = useSearchParams()

  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: allBoundaries } = useAllBoundaries()
  const { data: overlayFiles } = useGeospatialFiles()
  const { data: plans } = useCropPlans(cropYear)
  const { data: history } = useCropHistoryByYear(cropYear)
  const { data: crops } = useCrops()
  const { data: balance } = useLatestBalance()
  const { data: fnSystems } = useFieldnetSystems()
  const { data: pivotSpecs } = useFieldPivots()

  // field_id → pivot radius inputs (pipe length, else irrigated acres).
  const pivotByField = useMemo(() => {
    const m = new Map<string, { lengthM: number | null; acres: number | null }>()
    pivotSpecs?.forEach((p) => {
      if (p.field_id)
        m.set(p.field_id, {
          lengthM: p.length_m != null ? Number(p.length_m) : null,
          acres: p.acres_irrigated != null ? Number(p.acres_irrigated) : null,
        })
    })
    return m
  }, [pivotSpecs])

  // Field → current irrigation status, for the colour-coded layer (spec §12.1).
  const statusByField = useMemo(() => {
    const m = new Map<string, string>()
    balance?.forEach((b) => m.set(b.field_id, b.status ?? 'ok'))
    return m
  }, [balance])
  const balanceByField = useMemo(
    () => new Map((balance ?? []).map((b) => [b.field_id, b])),
    [balance],
  )

  // Field → its live FieldNET system, for pivot-status field colouring.
  const fnByField = useMemo(() => {
    const m = new Map<string, FieldnetSystem>()
    fnSystems?.forEach((s) => {
      if (s.field_id) m.set(s.field_id, s)
    })
    return m
  }, [fnSystems])

  // FieldNET-style pivot rendering: a wetted circle (radius = pivot pipe length,
  // else radius from irrigated acres), the arm at its current angle, a direction
  // arrow, and a dashed line at the auto/service-stop angle. Matches the FieldNET
  // app look. Colour = status (blue watering, green dry, red fault, grey offline).
  const fnLayers = useMemo(() => {
    const circles: GeoJSON.Feature[] = []
    const arms: GeoJSON.Feature[] = []
    const stops: GeoJSON.Feature[] = []
    const arrows: GeoJSON.Feature[] = []
    const sectors: GeoJSON.Feature[] = []
    for (const s of fnSystems ?? []) {
      const g = s.geometry as { type?: string; coordinates?: number[][] } | null
      let center: number[] | null = null
      let geomBearing: number | null = null
      if (g?.type === 'LineString' && g.coordinates && g.coordinates.length >= 2) {
        center = g.coordinates[0]
        geomBearing = bearingBetween(g.coordinates[0], g.coordinates[g.coordinates.length - 1])
      } else if (s.latitude != null && s.longitude != null) {
        center = [Number(s.longitude), Number(s.latitude)]
      }
      if (!center) continue
      const spec = s.field_id ? pivotByField.get(s.field_id) : undefined
      const geomLen =
        g?.type === 'LineString' && g.coordinates
          ? metersBetween(g.coordinates[0], g.coordinates[g.coordinates.length - 1])
          : 0
      const raw = (s.raw && typeof s.raw === 'object' ? s.raw : {}) as Record<string, unknown>
      // Radius: prefer FieldNET's reported pipe length, then our spec, then acres.
      const sysLen = typeof raw.system_length === 'number' ? raw.system_length : null
      const radius =
        (sysLen ?? spec?.lengthM ?? (spec?.acres ? acresRadiusM(spec.acres) : null) ?? geomLen) || 400
      const angle = typeof raw.pivot_angle === 'number' ? raw.pivot_angle : (geomBearing ?? 0)
      const props = { fn_status: fnStatus(s), name: s.name ?? '' }

      // Window-wiping pivots (river-limited) report partial_start/end_angle — the
      // stop angles they sweep between. Draw a wedge for those, a full circle when
      // no partial window is set (start == end). Matches the FieldNET app.
      const ps = typeof raw.partial_start_angle === 'number' ? raw.partial_start_angle : null
      const pe = typeof raw.partial_end_angle === 'number' ? raw.partial_end_angle : null
      const partial = ps != null && pe != null && ps !== pe
      circles.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [partial ? wedgeRing(center, radius, ps, pe) : circleRing(center, radius)],
        },
        properties: props,
      })
      const tip = destination(center[0], center[1], angle, radius)
      arms.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [center, tip] }, properties: props })

      // Direction-of-travel arrowhead sitting just INSIDE the circle at the arm
      // tip: back edge runs down the arm (flush with the line), apex advances
      // along the circle edge the way the pivot turns (forward = clockwise). A
      // metres-based triangle, so it scales with the circle at every zoom.
      // Only while actually turning: `direction` is the LAST reported direction
      // and persists when parked, so gate on the live operational status.
      const op = (s.operational_status ?? '').toLowerCase()
      const dir = (s.direction ?? '').toLowerCase()
      const moving = /^(forward|reverse|running)/.test(op)
      if (moving) {
        const sign = op.startsWith('reverse') || (op.startsWith('running') && dir === 'reverse') ? -1 : 1
        const len = Math.max(24, Math.min(70, radius * 0.14))
        const arcStep = ((len / radius) * 180) / Math.PI // degrees along the arc
        const thick = len * 0.85
        const apex = destination(center[0], center[1], angle + sign * arcStep, radius)
        const backInner = destination(center[0], center[1], angle, radius - thick)
        arrows.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[apex, tip, backInner, apex]] },
          properties: props,
        })
      }
      if (typeof raw.service_stop === 'number') {
        const stopTip = destination(center[0], center[1], raw.service_stop as number, radius)
        stops.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [center, stopTip] }, properties: props })
      }

      // Applied-depth heatmap: one wedge per FieldNET sector, shaded by depth
      // relative to the field mean (red = under-watered / behind).
      const win = (s.applied_windows ?? null) as Record<
        string,
        { sectors?: { depth: number; a0: number; a1: number }[] }
      > | null
      const fromWindow = win?.[heatWindow]?.sectors
      const secArr = Array.isArray(fromWindow)
        ? fromWindow
        : heatWindow === 'season' && Array.isArray(s.applied_sectors)
          ? (s.applied_sectors as unknown as { depth: number; a0: number; a1: number }[])
          : []
      // On window-wiping pivots the machine physically can't water outside
      // partial_start→partial_end, so clip every sector to that arc (a sector
      // reconstructed slightly wide would otherwise spill outside the field).
      const winW = partial ? (((pe as number) - (ps as number) + 360) % 360 || 360) : 360
      for (const sec of secArr) {
        if (typeof sec?.a0 !== 'number' || typeof sec?.a1 !== 'number') continue
        let a0 = sec.a0
        let a1 = sec.a1
        if (partial) {
          const start = ps as number
          let o0 = (((a0 - start) % 360) + 360) % 360
          let o1 = (((a1 - start) % 360) + 360) % 360
          if (o1 <= o0) o1 += 360
          o0 = Math.min(Math.max(o0, 0), winW)
          o1 = Math.min(Math.max(o1, 0), winW)
          if (o1 - o0 < 0.5) continue // nothing left inside the window
          a0 = (start + o0) % 360
          a1 = (start + o1) % 360
        }
        sectors.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [wedgeRing(center, radius, a0, a1)] },
          properties: {
            color: sectorColor(sec.depth, heatWindow),
            depth: sec.depth,
            label: `${s.name ?? 'Pivot'} — ${mmIn(sec.depth)} applied (${WINDOW_LABEL[heatWindow].toLowerCase()})`,
          },
        })
      }
    }
    const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
    return {
      circles: fc(circles),
      arms: fc(arms),
      stops: fc(stops),
      arrows: fc(arrows),
      sectors: fc(sectors),
    }
  }, [fnSystems, pivotByField, heatWindow])

  const boundaries = useMemo(
    () => (allBoundaries ? boundariesForYear(allBoundaries, cropYear) : undefined),
    [allBoundaries, cropYear],
  )

  const cropForField = useMemo(() => {
    const cropById = new Map(crops?.map((c) => [c.id, c.name]) ?? [])
    const m = new Map<string, string>()
    history?.forEach((h) => m.set(h.field_id, cropById.get(h.crop_id) ?? ''))
    plans?.forEach((p) => m.set(p.field_id, cropById.get(p.crop_id) ?? ''))
    return m
  }, [plans, history, crops])

  const fieldById = useMemo(() => {
    const m = new Map<string, FieldRow>()
    fields?.forEach((f) => m.set(f.id, f))
    return m
  }, [fields])

  const boundaryByField = useMemo(() => {
    const m = new Map<string, BoundaryRow>()
    boundaries?.forEach((b) => m.set(b.field_id, b))
    return m
  }, [boundaries])

  const featureCollection = useMemo(() => {
    if (!fields || !boundaries) return null
    // fieldById holds only active fields, so this drops archived-field boundaries.
    const features: Feature[] = boundaries
      .filter((b) => fieldById.has(b.field_id))
      .map((b) => ({
      type: 'Feature',
      geometry: b.geometry as unknown as MultiPolygon,
      properties: {
        field_id: b.field_id,
        name: fieldById.get(b.field_id)?.name ?? '',
        acres: b.acres,
        irr_status: statusByField.get(b.field_id) ?? 'none',
        fn_status: fnByField.has(b.field_id) ? fnStatus(fnByField.get(b.field_id)!) : 'none',
        // Grey ONLY where nothing has ever been observed — an unimaged field is
        // not a bare one, and shading it green would invent a look we never had.
        // Age no longer changes the colour: the reading is shown whatever its
        // age, and how old it is appears in the legend and on the field tile.
        // The property keeps its name so the paint expression does not have to
        // know which index produced it.
        ndvi_colour:
          index === 'ndre'
            ? ndreColour(ndreByField.get(b.field_id)?.ndre ?? null)
            : ndviColour(ndviByField.get(b.field_id)?.ndvi ?? null),
        salt_colour: saltColour(saltByField.get(b.field_id)?.ec),
      },
    }))
    return { type: 'FeatureCollection' as const, features }
  }, [fields, boundaries, fieldById, statusByField, fnByField, ndviByField, ndreByField, index, saltByField])

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
    map.on('load', () => setMapReady(true))

    // MapLibre's compact attribution renders the "i" button but starts opened,
    // so the Esri credit sits across the bottom corner of the map until it is
    // clicked away. The credit still has to be REACHABLE — it is a licence
    // condition, not decoration — so it is collapsed, never removed.
    //
    // Collapsing once is not enough: _updateCompact re-adds the open state
    // every time it runs, which includes each window resize. So it is held
    // shut until the reader opens it themselves, and after that left alone.
    map.on('load', () => {
      const attrib = containerRef.current?.querySelector<HTMLElement>('.maplibregl-ctrl-attrib')
      if (!attrib) return
      let openedByReader = false
      const collapse = () => {
        if (openedByReader) return
        attrib.classList.remove('maplibregl-compact-show')
        attrib.removeAttribute('open')
      }
      attrib.querySelector('summary')?.addEventListener('click', () => {
        openedByReader = true
      })
      collapse()
      const obs = new MutationObserver(collapse)
      obs.observe(attrib, { attributes: true, attributeFilter: ['class', 'open'] })
      map.once('remove', () => obs.disconnect())
    })

    const readView = () => {
      const b = map.getBounds()
      setView({
        zoom: map.getZoom(),
        bounds: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
      })
    }
    map.on('moveend', readView)
    map.on('load', readView)

    // Anywhere on the map, not just on a field: the point of the tool is to
    // answer for ground we do not farm.
    map.on('click', (e) => {
      if (!identifyingRef.current) return
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      setIdentified({ lngLat, result: reverseLld({ lat: e.lngLat.lat, lng: e.lngLat.lng }, townshipsRef.current) })
    })
    mapRef.current = map
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__map = map
    }
    const loadedSet = overlayLoaded.current
    return () => {
      map.remove()
      mapRef.current = null
      loadedSet.clear()
      setMapReady(false)
    }
  }, [])

  // Swap the field fill between flat blue, the irrigation-status ramp, and the
  // live-pivot (FieldNET) colours. FieldNET takes precedence when both are on.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer('boundaries-fill')) return
    const color = showSatellite
      ? (['get', 'ndvi_colour'] as unknown)
      : showSalt
        ? (['get', 'salt_colour'] as unknown)
      : showFieldnet
        ? FIELDNET_FILL
        : showIrrigation
          ? IRRIGATION_FILL_ON
          : BOUNDARY_FILL_OFF
    map.setPaintProperty('boundaries-fill', 'fill-color', color as never)
    // In FieldNET mode the pivot circles carry the signal, so keep the field
    // fill light; AIMM mode fills the whole polygon more strongly.
    map.setPaintProperty(
      'boundaries-fill',
      'fill-opacity',
      // Zero whenever the fill carries no meaning of its own — over a
      // photograph it would tint the picture, and with no layer active it tinted
      // the basemap blue and shifted how the crop underneath read. The outline
      // marks the field; a wash of colour over real ground only misleads.
      // A fill-opacity of 0 still hit-tests, so clicking a field keeps working.
      showPhoto || (!showSatellite && !showFieldnet && !showIrrigation && !showSalt)
        ? 0
        : showSalt
          ? 0.6
          : showSatellite
          // Faint under the raster: it is the field-mean fallback for fields
          // with no NDVI raster yet, and must not compete with the real one.
          ? 0.3
          : showFieldnet
            ? 0.12
            : 0.55,
    )
  }, [showFieldnet, showIrrigation, showSatellite, showPhoto, showSalt, mapReady, featureCollection])

  useEffect(() => void localStorage.setItem('map_fillMode', fillMode), [fillMode])
  useEffect(() => void localStorage.setItem('map_ndviScale', ndviScale), [ndviScale])

  /**
   * A tap on the map puts the layer panel away.
   *
   * Open, with every section expanded, the panel is taller than a phone screen
   * and covers the thing it exists to explain. The natural gesture at that
   * point is to touch the map, so that is what closes it; Escape does the same
   * with a keyboard. Panning counts too — you are already looking past it.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const close = () => setPanelOpen(false)
    map.on('click', close)
    map.on('dragstart', close)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      map.off('click', close)
      map.off('dragstart', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [mapReady])

  /**
   * The most recent real photograph of each field.
   *
   * One MapLibre `image` source per field rather than one combined raster:
   * the fields are miles apart, and a single image spanning all of them would
   * be almost entirely empty and enormous. Each source is placed by the four
   * corners the capture recorded, so the picture sits exactly where the
   * boundary that cut it sits.
   *
   * Sources are added once and reused. Removing and re-adding them on every
   * toggle makes the map flash white and re-download every image.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!mapAlive(map) || !mapReady) return
    const live = new Set<string>()

    // Two raster sets on the same machinery: the photograph, and NDVI. They are
    // never both on, so one loop with a prefix keeps the add/remove bookkeeping
    // in one place.
    const sets: { rows: typeof fieldImages; prefix: string; on: boolean; smooth: boolean }[] = [
      { rows: fieldImages, prefix: 'sat-photo-', on: showPhoto, smooth: true },
      // The mode is in the layer id so switching genuinely swaps the rasters.
      // Sources are added once and never re-pointed, so a shared prefix would
      // leave the first mode's images on screen forever.
      { rows: ndviRasters, prefix: `sat-${index}-${ndviScale}-`, on: showSatellite, smooth: false },
    ]

    for (const set of sets)
    for (const img of set.rows ?? []) {
      const id = `${set.prefix}${img.subject_id}`
      live.add(id)
      // One image failing to add must not stop the rest — before this, a
      // throw here skipped every visibility change below it, and the NDVI
      // rasters stayed painted on whatever mode was picked (seen on a phone).
      try {
      if (!map.getSource(id)) {
        map.addSource(id, {
          type: 'image',
          url: img.url,
          // Clockwise from the top left, which is the order MapLibre expects.
          coordinates: [
            [img.west, img.north],
            [img.east, img.north],
            [img.east, img.south],
            [img.west, img.south],
          ],
        })
        map.addLayer({
          id,
          type: 'raster',
          source: id,
          layout: { visibility: 'none' },
          paint: {
            'raster-opacity': 1,
            'raster-fade-duration': 0,
            // Nearest for NDVI so the 10 m pixels stay visible. Blending them
            // would show intermediate values nobody measured, and the hard
            // edges are an honest statement of how fine the reading is.
            'raster-resampling': set.smooth ? 'linear' : 'nearest',
          },
        })
      }
      } catch (e) {
        console.warn(`[map] satellite image ${id} could not be added:`, (e as Error).message)
      }
    }

    // Visibility in its own pass, over every satellite layer on the map, so
    // what shows is always exactly the chosen mode — whatever happened above.
    for (const layer of map.getStyle().layers ?? []) {
      if (!/^sat-(photo|ndvi|ndre)-/.test(layer.id)) continue
      const on = sets.some((set) => set.on && layer.id.startsWith(set.prefix))
      try {
        map.setLayoutProperty(layer.id, 'visibility', on ? 'visible' : 'none')
      } catch {
        /* removed below if it is stale */
      }
    }

    // A field whose imagery disappeared (a scene withdrawn, a failed signature)
    // must not keep showing yesterday's picture — and neither may the rasters
    // of a mode no longer chosen. This matched 'sat-photo-' and 'sat-ndvi-'
    // only, so NDRE rasters ('sat-ndre-…') outlived a switch back to NDVI or
    // the layer being turned off, and sat on the map until a refresh.
    for (const layer of map.getStyle().layers ?? []) {
      if (/^sat-(photo|ndvi|ndre)-/.test(layer.id) && !live.has(layer.id)) {
        try {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id)
          if (map.getSource(layer.id)) map.removeSource(layer.id)
        } catch (e) {
          console.warn(`[map] could not remove ${layer.id}:`, (e as Error).message)
        }
      }
    }
  }, [fieldImages, ndviRasters, showPhoto, showSatellite, mapReady, ndviScale, index])

  // FieldNET pivot circles + arm + direction arrow + stop line.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const setSrc = (id: string, data: GeoJSON.FeatureCollection) => {
      const s = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (s) s.setData(data)
      else map.addSource(id, { type: 'geojson', data })
    }
    setSrc('fieldnet-circles', fnLayers.circles)
    setSrc('fieldnet-sectors', fnLayers.sectors)
    setSrc('fieldnet-stops', fnLayers.stops)
    setSrc('fieldnet-arms', fnLayers.arms)
    setSrc('fieldnet-arrows', fnLayers.arrows)

    if (!map.getLayer('fieldnet-circle-fill')) {
      map.addLayer({ id: 'fieldnet-circle-fill', type: 'fill', source: 'fieldnet-circles', paint: { 'fill-color': FIELDNET_FILL as never, 'fill-opacity': 0.18 } })
      map.addLayer({ id: 'fieldnet-sectors-fill', type: 'fill', source: 'fieldnet-sectors', paint: { 'fill-color': ['get', 'color'] as never, 'fill-opacity': 0.55 } })
      map.addLayer({ id: 'fieldnet-circle-ring', type: 'line', source: 'fieldnet-circles', paint: { 'line-color': FIELDNET_FILL as never, 'line-width': 3 } })
      map.addLayer({ id: 'fieldnet-circle-dash', type: 'line', source: 'fieldnet-circles', paint: { 'line-color': '#ffffff', 'line-width': 1.4, 'line-dasharray': [3, 3] } })
      map.addLayer({ id: 'fieldnet-stop-line', type: 'line', source: 'fieldnet-stops', paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } })
      map.addLayer({ id: 'fieldnet-arm-casing', type: 'line', source: 'fieldnet-arms', layout: { 'line-cap': 'round' }, paint: { 'line-color': 'rgba(0,0,0,0.45)', 'line-width': 5 } })
      map.addLayer({ id: 'fieldnet-arm-line', type: 'line', source: 'fieldnet-arms', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 3 } })
      map.addLayer({ id: 'fieldnet-arrow', type: 'fill', source: 'fieldnet-arrows', paint: { 'fill-color': '#ffffff' } })
      map.addLayer({ id: 'fieldnet-arrow-line', type: 'line', source: 'fieldnet-arrows', paint: { 'line-color': 'rgba(0,0,0,0.45)', 'line-width': 1 } })
    }
    const vis = showFieldnet ? 'visible' : 'none'
    for (const id of [
      'fieldnet-circle-fill',
      'fieldnet-circle-ring',
      'fieldnet-circle-dash',
      'fieldnet-stop-line',
      'fieldnet-arm-casing',
      'fieldnet-arm-line',
      'fieldnet-arrow',
      'fieldnet-arrow-line',
    ])
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    if (map.getLayer('fieldnet-sectors-fill'))
      map.setLayoutProperty('fieldnet-sectors-fill', 'visibility', showFieldnet && showHeatmap ? 'visible' : 'none')
  }, [fnLayers, showFieldnet, showHeatmap, mapReady])

  useEffect(() => void localStorage.setItem('map_fnHeatmap', showHeatmap ? '1' : '0'), [showHeatmap])
  useEffect(() => void localStorage.setItem('map_showSoil', showSoil ? '1' : '0'), [showSoil])
  useEffect(() => void localStorage.setItem('map_showYield', showYield ? '1' : '0'), [showYield])
  useEffect(() => void localStorage.setItem('map_fnHeatWindow', heatWindow), [heatWindow])

  /**
   * A legal land description typed into the search box, resolved to a parcel
   * on the map — whether or not it is one of our fields.
   *
   * This is the scouting case: someone names a quarter we have never farmed
   * and you want to see where it is before driving out. It is deliberately
   * independent of the field list, which only knows about fields we already
   * have.
   */
  const lldParts = useMemo(() => parseLld(lldQuery), [lldQuery])
  // Fetch the ~141 KiB survey table only once someone types a description.
  // Also needed for identify — without the survey table reverseLld falls back
  // to a grid estimate, and a grid answer near a section line can name the wrong
  // quarter.
  // Below this the quarters are smaller than the labels on them, and a screen
  // of dotted boxes hides the fields underneath rather than informing anyone.
  const GRID_MIN_ZOOM = 13.5
  const showGrid = (view?.zoom ?? 0) >= GRID_MIN_ZOOM

  const townships = useTownshipTable(lldParts != null || identifying || showGrid)
  townshipsRef.current = townships

  const lldLookup = useMemo(() => {
    if (!lldParts) return null
    // No meridian given: assume W4, which covers southern Alberta. Said out
    // loud in the UI rather than assumed silently.
    const meridian = lldParts.meridian ?? 4
    // Always draw the SECTION — the mile-square landmark you navigate by — and
    // the quarter inside it when one was given.
    const section = atsBox({ ...lldParts, quarter: null, meridian }, townships)
    if (!section) return null
    const quarter = lldParts.quarter ? atsBox({ ...lldParts, meridian }, townships) : null
    return {
      section,
      quarter,
      label: formatLld(lldQuery) ?? lldQuery,
      assumedMeridian: lldParts.meridian == null,
    }
  }, [lldParts, lldQuery, townships])

  /** One of our own fields at that description, if there is one. */
  const lldField = useMemo(() => {
    if (!lldParts || !fields) return null
    return fields.find((f) => lldMatches(f.legal_land_description, lldQuery)) ?? null
  }, [lldParts, lldQuery, fields])

  /**
   * Draw the looked-up parcel and frame it.
   *
   * Layers are added lazily on first use rather than at map init: most map
   * sessions never touch the lookup, and this way they cost nothing until
   * they do. Re-added after a style reload, since `mapReady` recycles.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const src = map.getSource('lld-lookup') as maplibregl.GeoJSONSource | undefined
    const empty = { type: 'FeatureCollection' as const, features: [] }
    if (!lldLookup) {
      src?.setData(empty)
      return
    }

    // `kind` lets one source carry both rings: the section is outline-only,
    // the quarter is shaded.
    const section = toGeoJson(lldLookup.section, lldLookup.label)
    section.properties = { ...section.properties, kind: 'section' }
    const features = [section]
    if (lldLookup.quarter) {
      const q = toGeoJson(lldLookup.quarter, lldLookup.label)
      q.properties = { ...q.properties, kind: 'quarter' }
      features.push(q)
    }
    const data = { type: 'FeatureCollection' as const, features }

    if (src) src.setData(data)
    else map.addSource('lld-lookup', { type: 'geojson', data })

    if (!map.getLayer('lld-lookup-fill')) {
      map.addLayer({
        id: 'lld-lookup-fill',
        type: 'fill',
        source: 'lld-lookup',
        filter: ['==', ['get', 'kind'], 'quarter'],
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.16 },
      })
      map.addLayer({
        id: 'lld-lookup-line',
        type: 'line',
        source: 'lld-lookup',
        paint: {
          'line-color': '#f59e0b',
          // The section reads as the frame, the quarter as detail inside it.
          'line-width': ['case', ['==', ['get', 'kind'], 'section'], 2.5, 1.5],
          'line-dasharray': [2, 1.5],
        },
      })
    }

    const b = lldLookup.section.bounds
    map.fitBounds(
      [
        [b.west, b.south],
        [b.east, b.north],
      ],
      { padding: 120, duration: 600, maxZoom: 14 },
    )
  }, [mapReady, lldLookup])

  // Deep link: /map?field=<id> selects the field and zooms to it. The live
  // pivot colouring comes only with &layer=fieldnet, which the pivot list asks
  // for — arriving from a field page and finding the map recoloured is a
  // surprise nobody asked for.
  useEffect(() => {
    const fid = searchParams.get('field')
    if (!fid) return
    setSelectedId(fid)
    if (searchParams.get('layer') === 'fieldnet') setFillMode('fieldnet')
  }, [searchParams])

  useEffect(() => {
    const map = mapRef.current
    const fid = searchParams.get('field')
    if (!map || !mapReady || !fid) return
    const b = boundaryByField.get(fid)
    if (!b?.geometry) return
    const bounds = new maplibregl.LngLatBounds()
    ;(b.geometry as unknown as MultiPolygon).coordinates.forEach((poly: Position[][]) =>
      poly[0].forEach((p: Position) => bounds.extend([p[0], p[1]])),
    )
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 120, maxZoom: 14, animate: true })
  }, [searchParams, mapReady, boundaryByField])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !featureCollection) return

    const existing = map.getSource('boundaries') as maplibregl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(featureCollection)
    } else {
      map.addSource('boundaries', { type: 'geojson', data: featureCollection })
      map.addLayer({
        id: 'boundaries-fill',
        type: 'fill',
        source: 'boundaries',
        paint: { 'fill-color': BOUNDARY_FILL_OFF, 'fill-opacity': 0 },
      })
      map.addLayer({
        id: 'boundaries-line',
        type: 'line',
        source: 'boundaries',
        paint: { 'line-color': BOUNDARY_LINE_OFF, 'line-width': 2 },
      })
      map.addLayer({
        id: 'boundaries-selected',
        type: 'line',
        source: 'boundaries',
        paint: { 'line-color': '#facc15', 'line-width': 3.5 },
        filter: ['==', ['get', 'field_id'], ''],
      })
      map.on('click', 'boundaries-fill', (e) => {
        // While identifying or drawing, a click is a question about the ground
        // or a polygon corner — not a request to open whatever field happens to
        // be under it.
        if (identifyingRef.current || measuringRef.current) return
        // A tap on one of the farm's own pins or lines is about that, not the field under it.
        if (farmLayersBusy() || hitsFarmFeature(map, e.point)) return
        const f = e.features?.[0]
        if (f) setSelectedId(f.properties.field_id as string)
      })
      map.on('mouseenter', 'boundaries-fill', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'boundaries-fill', () => (map.getCanvas().style.cursor = ''))
    }

    // Field-name labels as HTML markers (no glyph server needed)
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = featureCollection.features.map((f) => {
      const el = document.createElement('div')
      el.className =
        'pointer-events-none select-none text-xs font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]'
      el.textContent = f.properties.name
      return new maplibregl.Marker({ element: el }).setLngLat(labelPointOf(f.geometry)).addTo(map)
    })

    const bounds = new maplibregl.LngLatBounds()
    featureCollection.features.forEach((f) =>
      f.geometry.coordinates.forEach((poly: Position[][]) =>
        poly[0].forEach((p: Position) => bounds.extend([p[0], p[1]])),
      ),
    )
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, animate: false })
  }, [featureCollection, mapReady])

  // Layer visibility toggles
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer('boundaries-fill')) return
    const vis = showBoundaries ? 'visible' : 'none'
    map.setLayoutProperty('boundaries-fill', 'visibility', vis)
    map.setLayoutProperty('boundaries-line', 'visibility', vis)
    map.setLayoutProperty('boundaries-selected', 'visibility', vis)
  }, [showBoundaries, mapReady, featureCollection])

  useEffect(() => {
    markersRef.current.forEach((m) => {
      m.getElement().style.display = showLabels ? '' : 'none'
    })
  }, [showLabels, featureCollection, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer('boundaries-selected')) return
    map.setFilter('boundaries-selected', ['==', ['get', 'field_id'], selectedId ?? ''])
  }, [selectedId, mapReady])

  // Geospatial file overlays (rx / fertility maps)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !overlayFiles) return

    for (const file of overlayFiles) {
      const srcId = `overlay-${file.id}`
      const enabled = activeOverlays.has(file.id)
      const added = overlayLoaded.current.has(file.id)

      if (enabled && !added) {
        overlayLoaded.current.add(file.id)
        void (async () => {
          try {
            const buf = await downloadFieldFileData(file)
            const { boundaries: parsed, errors } = await parseBoundaryData(file.filename, buf)
            if (parsed.length === 0) {
              throw new Error(errors[0] ?? 'no polygon features in file')
            }
            if (!mapRef.current || !overlayLoaded.current.has(file.id)) return
            mapRef.current.addSource(srcId, {
              type: 'geojson',
              data: {
                type: 'FeatureCollection',
                features: parsed.map((p) => ({
                  type: 'Feature' as const,
                  geometry: p.geometry,
                  properties: { name: p.name ?? '' },
                })),
              },
            })
            mapRef.current.addLayer({
              id: `${srcId}-fill`,
              type: 'fill',
              source: srcId,
              // Polygons only — an imported line would otherwise be filled shut.
              filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
              paint: { 'fill-color': '#fb923c', 'fill-opacity': 0.35 },
            })
            mapRef.current.addLayer({
              id: `${srcId}-line`,
              type: 'line',
              source: srcId,
              paint: { 'line-color': '#fb923c', 'line-width': 1.5 },
            })
          } catch (e) {
            overlayLoaded.current.delete(file.id)
            setOverlayErrors((prev) => ({ ...prev, [file.id]: (e as Error).message }))
            setActiveOverlays((prev) => {
              const next = new Set(prev)
              next.delete(file.id)
              return next
            })
          }
        })()
      } else if (!enabled && added) {
        overlayLoaded.current.delete(file.id)
        if (map.getLayer(`${srcId}-fill`)) map.removeLayer(`${srcId}-fill`)
        if (map.getLayer(`${srcId}-line`)) map.removeLayer(`${srcId}-line`)
        if (map.getSource(srcId)) map.removeSource(srcId)
      }
    }
  }, [activeOverlays, overlayFiles, mapReady])

  // Google My Maps overlay (live KML). Additive layer — existing layers, icons
  // and colours are untouched.
  const { data: farmMap } = useMyMapUrl()
  const myMapUrl = farmMap?.mymaps_url ?? null
  const myMapMid = extractMid(myMapUrl)
  const setMyMapUrl = useSetMyMapUrl()
  const { data: myMapGeo, error: myMapError, isLoading: myMapLoading } = useMyMapGeo(myMapUrl, showMyMap)

  /**
   * The crop map shows crop layers. Pastures, gates and water belong with the
   * herd, and they are drawn on the Cattle map instead — this is the one place
   * that decision is made, so a layer cannot end up on both.
   */
  // The farm's own layers (copied out of the My Map, edited in the app). A
  // copied folder is no longer read from Google, or it would show twice.
  const { data: farmLayers } = useFarmLayers()
  const copiedFolders = useMemo(() => new Set((farmLayers ?? []).map(myMapFolderOf).filter((x): x is string => !!x)), [farmLayers])
  const [farmOff, setFarmOff] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('map_farmLayersOff') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const farmActive = useMemo(() => new Set((farmLayers ?? []).filter((l) => !farmOff.has(l.id)).map((l) => l.id)), [farmLayers, farmOff])
  const toggleFarmLayer = (id: string, on: boolean) =>
    setFarmOff((prev) => {
      const next = new Set(prev)
      if (on) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem('map_farmLayersOff', JSON.stringify([...next]))
      } catch {
        /* private window */
      }
      return next
    })
  const cropMyMapLayers = useMemo(
    () => splitLayers(myMapGeo?.layers ?? []).crop.filter((l) => !copiedFolders.has(l)),
    [myMapGeo, copiedFolders],
  )

  // Remember the map/location toggles across visits.
  useEffect(() => void localStorage.setItem('map_showMyMap', showMyMap ? '1' : '0'), [showMyMap])
  useEffect(() => void localStorage.setItem('map_showLocation', showLocation ? '1' : '0'), [showLocation])

  // On a NEW layer set (not a refetch), restore the last-visible layers for this
  // map from localStorage, else show all.
  useEffect(() => {
    if (!myMapGeo) return
    const sig = `${myMapMid}|${myMapGeo.layers.slice().sort().join('~')}`
    if (sig === layersSigRef.current) return
    layersSigRef.current = sig
    let saved: string[] | null = null
    try {
      const raw = localStorage.getItem(`map_myMapLayers_${myMapMid}`)
      saved = raw ? (JSON.parse(raw) as string[]) : null
    } catch {
      saved = null
    }
    const restored = saved ? myMapGeo.layers.filter((l) => saved!.includes(l)) : myMapGeo.layers
    setActiveMyMapLayers(new Set(restored))
  }, [myMapGeo, myMapMid])

  // Persist the visible-layer selection per map.
  useEffect(() => {
    if (myMapMid && myMapGeo) localStorage.setItem(`map_myMapLayers_${myMapMid}`, JSON.stringify([...activeMyMapLayers]))
  }, [activeMyMapLayers, myMapMid, myMapGeo])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !showMyMap || !myMapGeo) return
    const layerIds = ['mymap-label', 'mymap-pin', 'mymap-icon', 'mymap-point', 'mymap-line', 'mymap-fill']
    // Intersected with the crop set, so a cattle layer left over in saved
    // state cannot reappear on this map.
    const drawable = [...activeMyMapLayers].filter((l) => !isCattleLayer(l) && !copiedFolders.has(l))
    const inLayer = ['in', ['get', '_layer'], ['literal', drawable]] as unknown as maplibregl.FilterSpecification
    const pointIn = ['all', ['==', ['geometry-type'], 'Point'], inLayer] as unknown as maplibregl.FilterSpecification
    // Points with a chosen pin icon get the icon; the rest keep the dot.
    const pinIn = ['all', ['==', ['geometry-type'], 'Point'], ['has', '_pin'], inLayer] as unknown as maplibregl.FilterSpecification
    const dotIn = ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', '_pin']], inLayer] as unknown as maplibregl.FilterSpecification
    // Polygons only. MapLibre fills a LineString handed to a fill layer as if it
    // were a closed ring — which drew a blue wedge joining the two ends of every
    // power line and fence in My Maps. The cattle map already filtered this way.
    const polygonIn = ['all', ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false], inLayer] as unknown as maplibregl.FilterSpecification
    map.addSource('mymap', { type: 'geojson', data: withPins(myMapGeo.fc) })
    // Colours/icons come straight from the KML (togeojson decodes them), Google-blue fallback.
    map.addLayer({ id: 'mymap-fill', type: 'fill', source: 'mymap', filter: polygonIn, paint: { 'fill-color': ['coalesce', ['get', 'fill'], '#1a73e8'], 'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.3] } })
    map.addLayer({ id: 'mymap-line', type: 'line', source: 'mymap', filter: inLayer, paint: { 'line-color': ['coalesce', ['get', 'stroke'], '#1a73e8'], 'line-width': ['coalesce', ['get', 'stroke-width'], 2] } })
    map.addLayer({ id: 'mymap-point', type: 'circle', source: 'mymap', filter: dotIn, paint: { 'circle-radius': 6, 'circle-color': ['coalesce', ['get', 'icon-color'], ['get', 'stroke'], '#1a73e8'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
    map.addLayer({ id: 'mymap-icon', type: 'symbol', source: 'mymap', filter: dotIn, layout: { 'icon-image': ['image', ['get', 'icon']], 'icon-size': 0.5, 'icon-allow-overlap': true } })
    map.addLayer({ id: 'mymap-pin', type: 'symbol', source: 'mymap', filter: pinIn, layout: { 'icon-image': PIN_ICON_EXPR as unknown as maplibregl.ExpressionSpecification, 'icon-allow-overlap': true, 'icon-ignore-placement': true } })
    void addPinImages(map)
    map.addLayer({ id: 'mymap-label', type: 'symbol', source: 'mymap', filter: pointIn, layout: { 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top' }, paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1 } })
    const hrefs = new Set(
      myMapGeo.fc.features
        .filter((f) => f.geometry.type === 'Point' && typeof f.properties?.icon === 'string')
        .map((f) => f.properties!.icon as string),
    )
    for (const href of hrefs) {
      if (map.hasImage(href)) continue
      map.loadImage(href).then(({ data }) => { if (!map.hasImage(href)) map.addImage(href, data) }).catch(() => {})
    }

    // Click a feature → popup with its name/description + an edit link to My Maps.
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
    const editUrl = `https://www.google.com/maps/d/edit?mid=${myMapMid}`
    const clickable = ['mymap-fill', 'mymap-line', 'mymap-point', 'mymap-pin'] as const
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const p = (f.properties ?? {}) as Record<string, string>
      const name = p.name || p._layer || 'Feature'
      const desc = p.description || ''
      const html =
        `<div style="max-width:230px;font-family:inherit">` +
        `<div style="font-weight:600;margin-bottom:2px">${esc(name)}</div>` +
        (p._layer ? `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px">${esc(p._layer)}</div>` : '') +
        (desc ? `<div style="font-size:12px;color:#374151;margin-bottom:6px;max-height:180px;overflow:auto">${desc}</div>` : '') +
        `<a href="${editUrl}" target="_blank" rel="noreferrer" style="font-size:12px;color:#1d4ed8;font-weight:600;text-decoration:none">Edit in Google My Maps ↗</a></div>`
      if (!myMapPopup.current) myMapPopup.current = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      myMapPopup.current.setLngLat(e.lngLat).setHTML(html).addTo(map)
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    for (const id of clickable) {
      map.on('click', id, onClick)
      map.on('mouseenter', id, enter)
      map.on('mouseleave', id, leave)
    }

    return () => {
      for (const id of clickable) {
        map.off('click', id, onClick)
        map.off('mouseenter', id, enter)
        map.off('mouseleave', id, leave)
      }
      myMapPopup.current?.remove()
      if (!mapAlive(map)) return
      for (const id of layerIds) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource('mymap')) map.removeSource('mymap')
    }
  }, [showMyMap, myMapGeo, activeMyMapLayers, mapReady, myMapMid, copiedFolders])

  // Live user location (toggleable) via the Geolocation API.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const clear = () => {
      if (!mapAlive(map)) return
      for (const id of ['user-loc-dot', 'user-loc-halo']) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource('user-loc')) map.removeSource('user-loc')
    }
    if (!showLocation || !navigator.geolocation) {
      clear()
      return
    }
    setLocError('')
    let centered = false
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const data = { type: 'Point' as const, coordinates: [pos.coords.longitude, pos.coords.latitude] }
        const src = map.getSource('user-loc') as maplibregl.GeoJSONSource | undefined
        if (src) src.setData({ type: 'Feature', geometry: data, properties: {} })
        else {
          map.addSource('user-loc', { type: 'geojson', data: { type: 'Feature', geometry: data, properties: {} } })
          map.addLayer({ id: 'user-loc-halo', type: 'circle', source: 'user-loc', paint: { 'circle-radius': 14, 'circle-color': '#3b82f6', 'circle-opacity': 0.2 } })
          map.addLayer({ id: 'user-loc-dot', type: 'circle', source: 'user-loc', paint: { 'circle-radius': 6, 'circle-color': '#3b82f6', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
        }
        if (!centered) {
          centered = true
          map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(map.getZoom(), 13) })
        }
      },
      (err) => setLocError(err.code === err.PERMISSION_DENIED ? 'Location permission denied.' : 'Could not get location.'),
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
    return () => {
      navigator.geolocation.clearWatch(watch)
      clear()
    }
  }, [showLocation, mapReady])

  const selected = selectedId ? fieldById.get(selectedId) : null
  const summaryRef = useRef<HTMLDivElement>(null)

  /**
   * Keep the zoom buttons out from under the field summary.
   *
   * Both live in the map's top-right corner, so opening a field buries the
   * zoom controls behind the panel. Rather than move either one permanently —
   * the corner is where people look for zoom, and the summary wants the same
   * corner on a wide screen — the controls step down by exactly the panel's
   * height while it is open, and step back when it closes.
   *
   * Measured rather than assumed: the panel grows and shrinks with what the
   * field has (a pivot, a water balance, neither), so a fixed offset would be
   * wrong for most fields. Below md the panel is docked to the bottom of the
   * screen instead and nothing needs to move.
   */
  useEffect(() => {
    const container = containerRef.current
    const ctrl = container?.querySelector<HTMLElement>('.maplibregl-ctrl-top-right')
    if (!ctrl) return
    ctrl.style.transition = 'transform 160ms ease'

    const wide = window.matchMedia('(min-width: 768px)')
    const apply = () => {
      const panel = summaryRef.current
      const shift = panel && wide.matches ? panel.offsetHeight + 8 : 0
      ctrl.style.transform = shift ? `translateY(${shift}px)` : ''
    }
    apply()

    // The panel resizes as its contents load, so a single measurement goes
    // stale a moment after it is taken.
    const ro = new ResizeObserver(apply)
    if (summaryRef.current) ro.observe(summaryRef.current)
    wide.addEventListener('change', apply)
    return () => {
      ro.disconnect()
      wide.removeEventListener('change', apply)
      ctrl.style.transform = ''
    }
  }, [selected, mapReady])
  useEffect(() => {
    if (!showGrid || !view) {
      setGridParcels([])
      return
    }
    setGridParcels(quartersInView(view.bounds, townships))
  }, [showGrid, view, townships])

  // Dotted quarter outlines, plus a label in each. The labels are HTML markers
  // rather than a symbol layer because this style ships no glyph server — the
  // same reason the field names are markers.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    // The shared builder rather than an inline copy, so the properties the
    // paint expressions read cannot drift away from what the module emits.
    const fc = quarterGridGeoJson(gridParcels)

    const src = map.getSource('quarter-grid') as maplibregl.GeoJSONSource | undefined
    if (src) {
      src.setData(fc)
    } else {
      map.addSource('quarter-grid', { type: 'geojson', data: fc })
      map.addLayer({
        id: 'quarter-grid-line',
        type: 'line',
        source: 'quarter-grid',
        paint: {
          'line-color': '#ffffff',
          'line-width': 1,
          // An estimated parcel is drawn fainter than a surveyed one, so the
          // grid never claims a precision it does not have outside Alberta.
          // MapLibre cannot vary line-dasharray per feature, so opacity does
          // the work and the label carries the word.
          'line-opacity': ['case', ['get', 'estimated'], 0.35, 0.75],
          'line-dasharray': [2, 2],
        },
      })
    }

    gridMarkersRef.current.forEach((m) => m.remove())
    gridMarkersRef.current = gridParcels.map((p) => {
      const el = document.createElement('div')
      el.className =
        'pointer-events-none select-none whitespace-nowrap text-[10px] font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.95)]' +
        (p.estimated ? ' italic opacity-70' : '')
      // Always the full description. "NW" on its own named the corner without
      // naming the parcel — every section has one, so it answered nothing.
      // A leading "≈" marks a parcel placed by estimate rather than survey —
      // click it with the identify tool for the reason in words.
      el.textContent = p.estimated ? `≈ ${p.label}` : p.label
      return new maplibregl.Marker({ element: el })
        .setLngLat([p.box.center.lng, p.box.center.lat])
        .addTo(map)
    })
  }, [gridParcels, mapReady])

  // Crosshair while armed, so it is obvious the next click is a question.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = identifying ? 'crosshair' : ''
    return () => {
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = ''
    }
  }, [identifying])

  // A pin on the point that was asked about — without it the answer floats free
  // of the place it describes.
  const identifyMarker = useRef<maplibregl.Marker | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    identifyMarker.current?.remove()
    identifyMarker.current = null
    if (!identified) return
    const el = document.createElement('div')
    el.className = 'h-3 w-3 rounded-full border-2 border-white bg-brand-700 shadow'
    identifyMarker.current = new maplibregl.Marker({ element: el })
      .setLngLat(identified.lngLat)
      .addTo(map)
    return () => {
      identifyMarker.current?.remove()
      identifyMarker.current = null
    }
  }, [identified])

  const selectedBoundary = selectedId ? boundaryByField.get(selectedId) : null

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Mounted whether or not the layer is ticked on — it owns the MapLibre
          layers, so unmounting it would strand them visible. */}
      <SoilLayer map={mapRef.current} mapReady={mapReady} visible={showSoil} />
      <YieldZoneLayer map={mapRef.current} mapReady={mapReady} visible={showYield} />
      <FarmLayersOverlay map={mapRef.current} ready={mapReady} layers={farmLayers ?? []} activeIds={[...farmActive]} isManager={isManager} />

      {/* Mounted only while it is out: its layers and its corners go with it,
          so putting the tape away is the same thing as clearing it. */}
      {measuring && (
        <MeasureTool
          map={mapRef.current}
          mapReady={mapReady}
          onClose={() => setMeasuring(false)}
        />
      )}

      {/* Layer panel + legal-land search */}
      {/* Wraps on a phone: three buttons and the search box are wider than a
          390 px screen, and without the wrap the search box hung off the right
          edge with the Measure button half under the zoom control. */}
      {/* Above the field card: on a phone the card rises from the bottom and
          must never cover the layer switch. */}
      <div className="absolute left-2 right-12 top-2 z-10 md:right-auto">
        <div className="flex flex-wrap items-start gap-1.5">
          <button
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
            title={panelOpen ? 'Hide the layers' : 'Show the layers'}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow',
              panelOpen
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
            )}
          >
            <Layers className="h-3.5 w-3.5" /> Layers
          </button>
          <button
            onClick={() => {
              setIdentifying((v) => !v)
              setIdentified(null)
            }}
            aria-pressed={identifying}
            title="Click the map to find out which quarter section a point is in"
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow',
              identifying
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
            )}
          >
            <Crosshair className="h-3.5 w-3.5" /> {identifying ? 'Click the map' : 'Point'}
          </button>
          <button
            onClick={() => {
              setMeasuring((v) => !v)
              // The two tools both want the clicks, so only one is out at a
              // time. Picking up the tape puts the point tool away.
              setIdentifying(false)
              setIdentified(null)
            }}
            aria-pressed={measuring}
            title="Measure a distance or an area off the map"
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow',
              measuring
                ? 'border-amber-500 bg-amber-500 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
            )}
          >
            <Ruler className="h-3.5 w-3.5" /> Measure
          </button>
          <div className="w-48 sm:w-60">
            <input
              value={lldQuery}
              onChange={(e) => setLldQuery(e.target.value)}
              placeholder="Find by legal land…"
              aria-label="Find by legal land description"
              className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 shadow placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            />
            {identified && (
              <div className="mt-1 rounded-md border border-brand-300 bg-white p-2 shadow">
                <div className="flex items-start gap-1.5">
                  <Crosshair className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700" />
                  <div className="min-w-0 flex-1">
                    {identified.result ? (
                      <>
                        <p className="text-sm font-semibold text-gray-900">
                          {identified.result.text}
                        </p>
                        <p className="mt-0.5 text-[11px] text-gray-500">
                          {identified.result.source === 'survey'
                            ? 'From the survey grid'
                            : // The fallback tier is roughly 300 m — a third of a
                              // quarter — so near a section line it can name the
                              // neighbouring parcel.
                              'Estimated — no survey data here, so a point near a section line may be out by one'}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-700">
                        That point is outside the Alberta township system.
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] tabular-nums text-gray-400">
                      {identified.lngLat[1].toFixed(4)}, {identified.lngLat[0].toFixed(4)}
                    </p>
                  </div>
                  <button
                    onClick={() => setIdentified(null)}
                    aria-label="Clear"
                    className="text-gray-300 hover:text-gray-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
            {lldLookup && (
              <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-2 shadow">
                <p className="flex items-center gap-1 text-xs font-semibold text-amber-900">
                  <MapPin className="h-3 w-3 shrink-0" /> {lldLookup.label}
                </p>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] leading-snug text-amber-800">
                  <span>
                    {lldLookup.quarter ? 'Section outlined, quarter shaded' : 'Section outlined'}
                    {lldLookup.assumedMeridian ? ', assuming W4' : ''}.
                  </span>
                  <InfoPopover title="How close is this?" width={260}>
                    <p>
                      {lldLookup.section.source === 'survey'
                        ? `From the Alberta survey, to within about ${SURVEY_ERROR_M} m.`
                        : `Estimated from the township grid, to within about ${GRID_ERROR_M} m — outside the Alberta survey data.`}
                    </p>
                  </InfoPopover>
                </div>
                {lldField ? (
                  <button
                    onClick={() => setSelectedId(lldField.id)}
                    className="mt-1 text-[11px] font-medium text-amber-900 underline underline-offset-2"
                  >
                    Our field: {lldField.name}
                  </button>
                ) : (
                  <p className="mt-1 text-[11px] text-amber-700">Not one of our fields.</p>
                )}
              </div>
            )}
          </div>
        </div>
        {panelOpen && (
          <div className="mt-1 max-h-[38vh] w-56 overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg sm:max-h-[60vh]">
            {/* Pinned to the top of the scroll, so the way out is on screen
                wherever the reader has scrolled to. Everything below it is a
                list that grows as layers are turned on, and it used to run off
                the bottom of a phone. */}
            <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-2 flex items-center justify-between border-b border-gray-100 bg-white px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Layers
              </span>
              <button
                onClick={() => setPanelOpen(false)}
                aria-label="Hide the layers"
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Three groups, so the panel opens on the choice most people came
                for — what colour the fields are — and the extras wait a tap
                away. Each fold remembers itself on this device. */}
            <Fold
              title="Field colour"
              defaultOpen
              storageKey="map-layers-colour"
              summary={FILL_MODES.find(([v]) => v === fillMode)?.[1]}
              className="border-gray-100"
              bodyClassName="px-2 py-1.5"
            >
            <label className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={showBoundaries}
                onChange={(e) => setShowBoundaries(e.target.checked)}
              />
              Field boundaries
            </label>
            {FILL_MODES.map(([val, label]) => (
              <div key={val}>
                {/* The arrow is a sibling of the label, not inside it — inside,
                    clicking it would also pick the radio. */}
                <div className="flex items-center gap-1">
                  <label className="flex flex-1 items-center gap-2 py-0.5">
                    <input
                      type="radio"
                      name="fillmode"
                      checked={fillMode === val}
                      onChange={() => setFillMode(val)}
                      // Closes the panel on a narrow screen — in the BUBBLE
                      // phase, after the change. It used to be onClickCapture:
                      // the capture-phase close re-rendered before the click
                      // bubbled, the radio was gone by the time React looked
                      // for its onChange, and on a phone the field colour
                      // could never be changed at all (stuck on NDVI). On a
                      // desktop the panel is beside the map, and stays open
                      // for anyone comparing two layers.
                      onClick={() => {
                        if (window.matchMedia('(max-width: 767px)').matches) setPanelOpen(false)
                      }}
                    />
                    {label}
                  </label>
                  {val === 'aimm' && showIrrigation && (
                    <LegendArrow open={aimmLegend} onToggle={toggleAimmLegend} label="irrigation" />
                  )}
                  {val === 'fieldnet' && showFieldnet && (
                    <LegendArrow open={fnLegend} onToggle={toggleFnLegend} label="pivot" />
                  )}
                  {val === 'satellite' && showSatellite && (
                    <LegendArrow open={satLegend} onToggle={toggleSatLegend} label="NDVI" />
                  )}
                </div>
                {/* Each legend sits directly under the option it belongs to. */}
                {val === 'salinity' && showSalt && <SaltLegend salt={saltByField} names={fieldById} />}
                {val === 'aimm' && showIrrigation && aimmLegend && (
                  <LegendList items={IRRIGATION_LEGEND} />
                )}
                {val === 'satellite' && showSatellite && (
                  <>
                    {satLegend && (
                      <LegendList
                        items={[
                          ['Never imaged', NO_DATA_COLOUR] as const,
                          ...NDVI_RAMP.map(([l, c]) => [`NDVI ≤ ${l}`, c] as const),
                        ]}
                      />
                    )}
                    {satLegend && (
                      <div className="ml-6 mb-1">
                        <InfoPopover title="About these colours" label="About these colours" width={300}>
                          <p>
                            {ndviScaleLabel(ndviRasters)} Every field is shaded on that one scale, so a
                            colour means the same thing wherever it appears. Click a field for the date
                            of the last clear look behind it.
                          </p>
                        </InfoPopover>
                      </div>
                    )}
                    {/* Spec §7.1: say plainly that zones are waiting on history,
                        rather than leaving their absence to be interpreted. */}
                    {satLegend && zoneWaitingMessage(zoneReadiness) && (
                      <p className="ml-6 mb-1 text-[11px] text-gray-500">
                        {zoneWaitingMessage(zoneReadiness)}
                      </p>
                    )}
                    {/* NDVI runs out of range once the canopy closes: from
                        about mid-July every acre of corn reads the same, right
                        through the weeks that set the yield. NDRE uses the red
                        edge and keeps separating heavy growth. The two are not
                        on the same numeric scale and never share a legend. */}
                    <div className="ml-6 mb-1">
                      <div className="flex gap-1">
                        {(
                          [
                            ['ndvi', 'NDVI'],
                            ['ndre', 'NDRE'],
                          ] as const
                        ).map(([val, label]) => (
                          <button
                            key={val}
                            onClick={() => {
                              setIndex(val)
                              localStorage.setItem('map_index', val)
                            }}
                            className={cn(
                              'rounded px-2 py-0.5 text-[11px] font-medium',
                              index === val
                                ? 'bg-brand-700 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                        <InfoPopover title="NDVI or NDRE" width={280} className="ml-1">
                          <p>
                            <b>NDVI</b> — the standard index. Sharper early, flattens once the canopy closes.
                          </p>
                          <p>
                            <b>NDRE</b> — red edge. Separates a closed canopy that NDVI reads as uniform.
                          </p>
                        </InfoPopover>
                      </div>
                    </div>
                    {/* Two jobs, two scales. Comparing fields needs one ramp
                        across the farm; looking inside a field needs that
                        field's own range, or a closed canopy is one flat
                        colour. A single scale cannot do both.

                        Hidden on NDRE, which renders on one fixed range: it
                        earns its keep comparing fields late in the season, and
                        a per-field stretch would remove exactly that. */}
                    <div className={cn('ml-6 mb-1', index === 'ndre' && 'hidden')}>
                      <div className="flex gap-1">
                        {(
                          [
                            ['shared', 'Compare fields'],
                            ['field', 'Inspect field'],
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
                        <InfoPopover title="Compare or inspect" width={280} className="ml-1">
                          <p>
                            <b>Compare fields</b> — one ramp across every field, so colours can be compared between them.
                          </p>
                          <p>
                            <b>Inspect field</b> — each field stretched to its own range. Shows variation inside a field —
                            colours mean nothing between fields.
                          </p>
                        </InfoPopover>
                      </div>
                    </div>
                    <p className="ml-6 mb-1 text-[11px] text-gray-500">
                      {satelliteCoverage.withImagery > 0
                        ? `${satelliteCoverage.withImagery} of ${satelliteCoverage.total} fields imaged · newest ${satelliteCoverage.freshest}`
                        : 'No satellite imagery yet — fields stay grey until the first pictures arrive.'}
                    </p>
                  </>
                )}
                {val === 'photo' && showPhoto && (
                  <p
                    className={`ml-6 mb-1 text-[11px] ${fieldImagesError ? 'text-red-600' : 'text-gray-500'}`}
                    // The raw error is for whoever is fixing it; hover shows it.
                    title={fieldImagesError ? (fieldImagesError as Error).message : undefined}
                  >
                    {fieldImagesError
                      ? 'Couldn’t load the satellite photos. Try again later.'
                      : fieldImages?.length
                        ? photoDateLabel(fieldImages.map((i) => i.sensed_on))
                        : 'No photo captured yet.'}
                  </p>
                )}
                {val === 'fieldnet' && showFieldnet && (
                  <>
                    {fnLegend && <LegendList items={FIELDNET_LEGEND} />}
                    <label
                      className="ml-6 flex items-center gap-2 py-0.5 text-[13px]"
                      title="Shade each pivot sector by applied water depth vs the pivot's own average"
                    >
                      <input
                        type="checkbox"
                        checked={showHeatmap}
                        onChange={(e) => setShowHeatmap(e.target.checked)}
                      />
                      Applied heatmap
                    </label>
                    {showHeatmap && (
                      <>
                        <div className="ml-10 mt-1 flex gap-1">
                          {(['week', 'month', 'season'] as const).map((w) => (
                            <button
                              key={w}
                              onClick={() => setHeatWindow(w)}
                              className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                heatWindow === w
                                  ? 'bg-brand-700 text-white'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                              )}
                            >
                              {w === 'season' ? 'Year' : w === 'month' ? '30 d' : '7 d'}
                            </button>
                          ))}
                        </div>
                        <div className="ml-10 mt-1 flex items-center gap-1">
                          <p className="flex-1 text-[10px] text-gray-400">
                            Water applied · {WINDOW_LABEL[heatWindow].toLowerCase()}
                          </p>
                          <LegendArrow open={heatLegend} onToggle={toggleHeatLegend} label="heatmap" />
                        </div>
                        {heatLegend && (
                          <LegendList items={heatmapLegend(heatWindow)} className="mb-1 ml-10 space-y-0.5" />
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
            <label className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
              />
              Field labels
            </label>
            </Fold>

            <Fold
              title="Overlays"
              storageKey="map-layers-overlays"
              summary={overlaysOn > 0 ? `${overlaysOn} on` : undefined}
              className="mt-2 border-gray-100"
              bodyClassName="px-2 py-1.5"
            >
            <div>
              <div className="flex items-center gap-1">
                <label
                  className="flex flex-1 items-center gap-2 py-0.5"
                  title={myMapUrl ? undefined : 'Add a Google My Maps URL below'}
                >
                  <input
                    type="checkbox"
                    checked={showMyMap}
                    disabled={!myMapUrl}
                    onChange={(e) => setShowMyMap(e.target.checked)}
                  />
                  Google My Map
                </label>
                {showMyMap && myMapGeo && myMapGeo.layers.length > 0 && (
                  <LegendArrow open={myMapOpen} onToggle={toggleMyMapOpen} label="My Map layer" />
                )}
              </div>
              {showMyMap && myMapLoading && <p className="ml-6 text-[11px] text-gray-400">Loading…</p>}
              {showMyMap && myMapError && (
                <p className="ml-6 text-[11px] text-red-600">
                  {(myMapError as Error).message === 'not_shared'
                    ? 'Map isn’t shared — set it to “Anyone with the link: Viewer” in My Maps.'
                    : 'Couldn’t load the map.'}
                </p>
              )}
              {showMyMap && myMapOpen && myMapGeo && cropMyMapLayers.length > 0 && (
                <ul className="ml-6 space-y-0.5">
                  {cropMyMapLayers.map((layer) => (
                    <MyMapLayerRow
                      key={layer}
                      layer={layer}
                      fc={myMapGeo.fc}
                      checked={activeMyMapLayers.has(layer)}
                      onToggle={(on) =>
                        setActiveMyMapLayers((prev) => {
                          const next = new Set(prev)
                          if (on) next.add(layer)
                          else next.delete(layer)
                          return next
                        })
                      }
                    />
                  ))}
                </ul>
              )}
              {isManager && (
                <input
                  key={myMapUrl ?? 'none'}
                  defaultValue={myMapUrl ?? ''}
                  placeholder="Paste Google My Maps URL"
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null
                    if (farmMap !== undefined && v !== (myMapUrl ?? null)) setMyMapUrl.mutate({ id: farmMap?.id, mymaps_url: v })
                  }}
                  className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-[11px]"
                />
              )}
            </div>

            <FarmLayersLegend layers={farmLayers ?? []} active={farmActive} onToggle={toggleFarmLayer} isManager={isManager} />

            <div className="mt-2 border-t border-gray-100 pt-2">
              <div className="flex items-center gap-1">
                <label className="flex flex-1 items-center gap-2 py-0.5">
                  <input type="checkbox" checked={showSoil} onChange={(e) => setShowSoil(e.target.checked)} />
                  Soil survey
                </label>
                {showSoil && (
                  <LegendArrow open={soilLegend} onToggle={toggleSoilLegend} label="soil" />
                )}
              </div>
              {showSoil && soilLegend && (
                <div className="ml-6 mt-0.5">
                  <LegendList
                    items={[
                      ...SOIL_WATER_BANDS.map((b) => [b.label, b.colour] as const),
                      ['no rating', SOIL_NO_DATA_COLOUR] as const,
                    ]}
                    className="space-y-0.5"
                  />
                  <div className="mt-1">
                    <InfoPopover title="Soil survey" label="About this layer" width={280}>
                      <p>
                        Water a crop can reach in the top metre. Tap an area for the soil, what it
                        holds and what that means.{' '}
                        <a
                          href={AGRASID_SOURCE.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-700 hover:underline"
                        >
                          AGRASID 4.1
                        </a>
                      </p>
                    </InfoPopover>
                  </div>
                </div>
              )}

              <div className="mt-1.5 flex items-center gap-1 border-t border-gray-100 pt-1.5">
                <label className="flex flex-1 items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={showYield}
                    onChange={(e) => setShowYield(e.target.checked)}
                  />
                  Productivity zones
                </label>
                {showYield && (
                  <LegendArrow open={yieldLegend} onToggle={toggleYieldLegend} label="productivity" />
                )}
              </div>
              {showYield && yieldLegend && (
                <div className="ml-6 mt-0.5">
                  <LegendList
                    items={yieldBands(yieldZones ?? []).map(
                      (b) => [`${b.from}–${b.to}`, b.colour] as const,
                    )}
                    className="space-y-0.5"
                  />
                  {/* The caveat belongs on the legend, not in a doc nobody
                      opens. These are an index normalised to each field's own
                      average, which is not obvious from a map of coloured
                      ground and changes what the colours mean. */}
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
                    % of the field&rsquo;s own average
                    <InfoPopover title="Productivity zones" width={280}>
                      <p>
                        Each zone as a percentage of its own field&rsquo;s average, from the
                        agronomist&rsquo;s maps — so 110 is good ground for that field, not a bushel
                        figure, and fields cannot be ranked against each other. Tap a zone.
                      </p>
                    </InfoPopover>
                  </div>
                </div>
              )}
            </div>

            {overlayFiles && overlayFiles.length > 0 && (
              <div className="mt-2 border-t border-gray-100 pt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Files
                </p>
                {overlayFiles.map((f: FieldFileRow) => (
                  <label key={f.id} className="flex items-center gap-2 py-0.5" title={f.filename}>
                    <input
                      type="checkbox"
                      checked={activeOverlays.has(f.id)}
                      onChange={(e) => {
                        setOverlayErrors((prev) => {
                          const next = { ...prev }
                          delete next[f.id]
                          return next
                        })
                        setActiveOverlays((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(f.id)
                          else next.delete(f.id)
                          return next
                        })
                      }}
                    />
                    <span className="truncate">{f.filename}</span>
                  </label>
                ))}
                {Object.entries(overlayErrors).map(([id, msg]) => (
                  <p key={id} className="mt-1 text-xs text-red-600">
                    {overlayFiles.find((f) => f.id === id)?.filename}: {msg}
                  </p>
                ))}
              </div>
            )}
            </Fold>

            <Fold
              title="Tools"
              storageKey="map-layers-tools"
              summary={showLocation ? 'location on' : undefined}
              className="mt-2 border-gray-100"
              bodyClassName="px-2 py-1.5"
            >
              <label className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={showLocation} onChange={(e) => setShowLocation(e.target.checked)} />
                My location
              </label>
              {showLocation && locError && <p className="ml-6 text-[11px] text-red-600">{locError}</p>}
            </Fold>
          </div>
        )}
      </div>

      {selected && (
        <div
          ref={summaryRef}
          className="absolute inset-x-2 bottom-2 max-h-[45vh] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-4 shadow-lg md:max-h-none md:overflow-visible md:inset-x-auto md:right-3 md:top-3 md:bottom-auto md:w-80"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold text-gray-900">{selected.name}</h2>
              <p className="text-xs text-gray-500">{selected.legal_land_description ?? '—'}</p>
            </div>
            <button
              onClick={() => setSelectedId(null)}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Map acres</dt>
              <dd className="font-medium">
                {selectedBoundary?.acres != null ? Number(selectedBoundary.acres).toFixed(1) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Crop {cropYear}</dt>
              <dd className="font-medium">{cropForField.get(selected.id) || '—'}</dd>
            </div>
            {/* The age of the real look behind the satellite reading. It used to
                be carried by the fill colour; it is stated here instead, so the
                colour can show the reading at any age (spec §14.2 still
                requires the age be visible, not that it tint anything). */}
            {(() => {
              const sat = ndviByField.get(selected.id)
              if (!sat) return null
              return (
                <div className="col-span-2">
                  <dt className="text-xs text-gray-500">Satellite</dt>
                  <dd className="font-medium">
                    {sat.ndvi != null ? `NDVI ${sat.ndvi.toFixed(2)}` : 'No reading'}
                  </dd>
                  <p className="mt-0.5 text-xs font-normal text-gray-500">
                    {ageSentence(sat.days_since_observation, sat.last_observed_on)}
                  </p>

                </div>
              )
            })()}
          </dl>

          {/* FieldNET live telemetry when the FieldNET layer is active. */}
          {showFieldnet &&
            (() => {
              const s = fnByField.get(selected.id)
              if (!s)
                return (
                  <p className="mt-3 text-xs text-gray-400">
                    No FieldNET pivot linked.{' '}
                    <SetupLink managerOnly to={SETUP_LINKS.fieldnetPivot(selected.id)}>
                      Link one
                    </SetupLink>
                  </p>
                )
              return (
                <div className="mt-3">
                  <PivotStatusPanel system={s} compact />
                  {s.applied_behind_deg != null && s.applied_behind_deg > 10 && (
                    <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
                      {Math.round(s.applied_behind_deg)}° of the circle under-watered
                      {s.applied_min_mm != null && s.applied_mean_mm != null
                        ? ` — driest ${Math.round(s.applied_min_mm)} vs mean ${Math.round(s.applied_mean_mm)} mm`
                        : ''}
                    </p>
                  )}
                </div>
              )
            })()}

          {/* AIMM soil-moisture balance when the AIMM layer is active. */}
          {showIrrigation &&
            (() => {
              const b = balanceByField.get(selected.id)
              if (!b) return <p className="mt-3 text-xs text-gray-400">No AIMM balance yet.</p>
              const label =
                ({ ok: 'OK', soon: 'Irrigate soon', now: 'Irrigate now', stress: 'Water stress' } as Record<string, string>)[
                  b.status ?? ''
                ] ?? '—'
              const color =
                ({ ok: '#22c55e', soon: '#f59e0b', now: '#ef4444', stress: '#b91c1c' } as Record<string, string>)[
                  b.status ?? ''
                ] ?? '#94a3b8'
              // Status (the badge) and days to irrigate answer "do I water
              // this?"; the balance behind them waits behind More.
              const facts: [string, string][] = [
                ['Days to irrigate', b.days_to_irrigate != null ? `${b.days_to_irrigate}` : '—'],
                ...(aimmMore
                  ? ([
                      ['Depletion', b.dr_mm != null ? `${Math.round(b.dr_mm)} mm` : '—'],
                      ['Refill point', b.raw_mm != null ? `${Math.round(b.raw_mm)} mm` : '—'],
                      ['ETc', b.etc_mm != null ? `${b.etc_mm.toFixed(1)} mm` : '—'],
                      ['Rec. gross', b.rec_gross_mm != null ? `${Math.round(b.rec_gross_mm)} mm` : '—'],
                      ['As of', b.date],
                    ] as [string, string][])
                  : []),
              ]
              return (
                <div className="mt-3 rounded-md border border-gray-100 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-600">AIMM soil moisture</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: color }}
                    >
                      {label}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {facts.map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-gray-400">{k}</dt>
                        <dd className="font-medium text-gray-800">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <button
                    type="button"
                    onClick={() => setAimmMore((m) => !m)}
                    className="mt-1.5 text-[11px] font-medium text-brand-700 hover:underline"
                  >
                    {aimmMore ? 'Less' : 'More'}
                  </button>
                </div>
              )
            })()}

          <div className="mt-3 flex gap-2">
            <Link
              to={`/fields/${selected.id}`}
              className="flex-1 rounded-md bg-brand-700 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-brand-800"
            >
              Open field
            </Link>
            {isManager && selectedBoundary?.geometry && (
              <button
                onClick={() => setSplitOpen(true)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                title="Split this field into multiple crops"
              >
                Split crops
              </button>
            )}
          </div>
        </div>
      )}

      {splitOpen && selected && selectedBoundary?.geometry && (
        <CropSplitEditor
          field={{ id: selected.id, name: selected.name }}
          boundary={selectedBoundary.geometry as unknown as MultiPolygon}
          cropYear={cropYear}
          onClose={() => setSplitOpen(false)}
        />
      )}
    </div>
  )
}
