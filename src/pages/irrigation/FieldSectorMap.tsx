import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info, X } from 'lucide-react'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { supabase } from '@/lib/supabase'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { boundariesForYear } from '@/lib/queries'
import { NDVI_RAMP } from '@/lib/pastures'
import { rangeLabel, useYieldZones } from '@/lib/yield-zones'
import { useRxMap } from '@/lib/fertility-rx'
import { sitesForYear, useSampleSites } from '@/lib/soil-sites'
import { conv, useUnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import {
  APPLIED_BANDS,
  DRY_AT,
  NEED_BANDS,
  VIGOUR_BANDS,
  VIGOUR_WEIGHT,
  WATER_WEIGHT,
  WEAK_AT,
  WEDGE_DEG,
  bandFor,
  binsFromAppliedGeom,
  binsToWedges,
  circleRing,
  clearFraction,
  hexToRgb,
  median,
  ndviByWedge,
  needScore,
  norm360,
  outsideMask,
  pivotArc,
  pointInGeometry,
  relativeTo,
  sumDailyBins,
  wedgeMean,
  wedgeRing,
  wedgeSamples,
  wedgesForArc,
  type Band,
  type LngLat,
  type NeedScore,
  type PivotArc,
  type Raster,
  type Wedge,
} from '@/lib/pivot-sectors'

/**
 * The pivot circle as pie wedges on the satellite, under the AIMM graph.
 *
 * The graph says how wet the field is on average; this says WHERE. Each wedge
 * is coloured by what FieldNET put on it, by how the crop looks from space, or
 * by a blend of the two that points at the parts of the circle that might want
 * more water. Yield zones and the fertility Rx go over the top, because a
 * weak wedge sitting on a zone-1 knoll is a different conversation from a weak
 * wedge on the best ground in the field.
 *
 * maplibre-gl is loaded inside an effect so that mounting this lazily keeps the
 * map library out of whatever chunk imports it.
 */

type Mode = 'moisture' | 'water' | 'vigour' | 'need'
type AppliedWindow = 'season' | 'month' | 'week'

const MODES: { id: Mode; label: string }[] = [
  { id: 'moisture', label: 'Soil moisture now' },
  { id: 'water', label: 'Water applied' },
  { id: 'vigour', label: 'Crop vigour' },
  { id: 'need', label: 'Needs water' },
]
const WINDOWS: { id: AppliedWindow; label: string; days: number | null }[] = [
  { id: 'season', label: 'Season', days: null },
  { id: 'month', label: 'Last 30 days', days: 30 },
  { id: 'week', label: 'Last 7 days', days: 7 },
]

/** An image that saw less than this much of the field is passed over for an older, clearer one. */
const CLEAR_ENOUGH = 0.8
/** How many recent images the automatic pick will open looking for a clear one. */
const MAX_TRIES = 6
const NO_DATA = '#9ca3af'
/** The NDVI rasters' seven colours, in order — the ramp sat-imagery.ts paints with. */
const RAMP = NDVI_RAMP.map(([, hex]) => hexToRgb(hex))

/**
 * Soil moisture per wedge as a share of that wedge's own capacity, from the
 * morning model run's balance per wedge (water_balance_wedges): where the
 * pivot's water landed, the same rain and crop demand everywhere, and the
 * soil's holding capacity varying around the circle. 50% is the irrigation
 * threshold.
 */
const MOISTURE_BANDS: Band[] = [
  { upTo: 0.5, colour: '#b2182b', label: 'below threshold' },
  { upTo: 0.6, colour: '#ef8a62', label: '50–60% full' },
  { upTo: 0.75, colour: '#fddbc7', label: '60–75%' },
  { upTo: 0.9, colour: '#d1e5f0', label: '75–90%' },
  { upTo: 1.0, colour: '#67a9cf', label: '90–100%' },
  { upTo: Infinity, colour: '#2166ac', label: 'over capacity' },
]
const bandsFor = (m: Mode): Band[] =>
  m === 'moisture' ? MOISTURE_BANDS : m === 'water' ? APPLIED_BANDS : m === 'vigour' ? VIGOUR_BANDS : NEED_BANDS

/** The latest actual balance per 10-degree wedge from north, for this field. */
function useWedgeMoisture(fieldId: string) {
  return useQuery({
    queryKey: ['sector-map', 'moisture', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('water_balance_wedges')
        .select('date, avail_mm, fc_mm')
        .eq('field_id', fieldId)
        .eq('is_forecast', false)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** The model's 36 ten-degree wedges averaged onto this map's wedges. */
function moistureOnWedges(avail: number[], cap: number[], wedges: Wedge[]): { mm: number | null; frac: number | null }[] {
  return wedges.map((w) => {
    const span = norm360(w.a1 - w.a0) || 360
    let a = 0
    let c = 0
    let n = 0
    for (let i = 0; i < 36; i++) {
      const mid = i * 10 + 5
      if (norm360(mid - w.a0) < span) {
        a += Number(avail[i]) || 0
        c += Number(cap[i]) || 0
        n++
      }
    }
    if (n === 0) {
      const i = Math.floor(norm360((w.a0 + w.a1) / 2) / 10) % 36
      a = Number(avail[i]) || 0
      c = Number(cap[i]) || 0
      n = 1
    }
    return c > 0 ? { mm: a / n, frac: a / c } : { mm: null, frac: null }
  })
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

type Pivot = {
  id: string
  name: string
  center: LngLat | null
  radiusM: number | null
  arc: PivotArc
  appliedGeom: unknown
}

/** The FieldNET pivots linked to this field, with their circle worked out. */
function usePivots(fieldId: string) {
  return useQuery({
    queryKey: ['sector-map', 'pivots', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async (): Promise<Pivot[]> => {
      const { data, error } = await supabase
        .from('fieldnet_systems')
        .select('fieldnet_id, name, latitude, longitude, raw, radius_m, arc_start_deg, arc_end_deg, applied_geom')
        .eq('field_id', fieldId)
        .order('name')
      if (error) throw error
      return (data ?? []).map((r) => {
        const raw = (r.raw ?? {}) as Record<string, unknown>
        const lat = num(r.latitude)
        const lng = num(r.longitude)
        // The wet length is what reaches the ground: the end gun throws past
        // the last tower, and the applied-water wedges run out to it.
        const radius = num(r.radius_m) ?? num(raw.system_length_wet) ?? num(raw.system_length)
        const haveArc = num(r.arc_start_deg) != null && num(r.arc_end_deg) != null
        return {
          id: r.fieldnet_id,
          name: r.name ?? 'Pivot',
          center: lat != null && lng != null ? ([lng, lat] as LngLat) : null,
          radiusM: radius != null && radius > 0 ? radius : null,
          arc: haveArc
            ? pivotArc(num(r.arc_start_deg), num(r.arc_end_deg))
            : pivotArc(num(raw.partial_start_angle), num(raw.partial_end_angle)),
          appliedGeom: r.applied_geom,
        }
      })
    },
  })
}

type AppliedWindows = {
  sums: Record<AppliedWindow, number[]>
  days: number
  first: string
  last: string
  /** The day the 7- and 30-day windows count back from. */
  anchor: string
}

const shiftDay = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * FieldNET's degree-by-degree water for the year, summed into the three windows.
 *
 * Summed here rather than kept as rows: a season is a few hundred rows of 360
 * numbers, and the cache that keeps this readable offline has no use for them
 * once they are added up. The key carries today so the short windows move on
 * each day. In a past year there is no "last 7 days", so the windows count
 * back from the last day the pivot ran instead.
 */
function useAppliedWindows(fieldnetId: string | null, year: number, today: string) {
  return useQuery({
    queryKey: ['sector-map', 'bins', fieldnetId, year, today],
    enabled: Boolean(fieldnetId),
    queryFn: async (): Promise<AppliedWindows | null> => {
      const { data, error } = await supabase
        .from('fieldnet_applied_bins')
        .select('date, bins')
        .eq('fieldnet_id', fieldnetId!)
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)
        .order('date')
      if (error) throw error
      const rows = data ?? []
      if (!rows.length) return null
      const last = rows[rows.length - 1].date
      const anchor = String(year) === today.slice(0, 4) ? today : last
      const within = (days: number) => {
        const from = shiftDay(anchor, 1 - days)
        return rows.filter((r) => r.date >= from && r.date <= anchor).map((r) => r.bins)
      }
      const tidy = (a: number[]) => a.map((v) => Math.round(v * 100) / 100)
      return {
        sums: {
          season: tidy(sumDailyBins(rows.map((r) => r.bins))),
          month: tidy(sumDailyBins(within(30))),
          week: tidy(sumDailyBins(within(7))),
        },
        days: rows.length,
        first: rows[0].date,
        last,
        anchor,
      }
    },
  })
}

/** This field's boundary for the year, as GeoJSON. */
function useBoundary(fieldId: string, year: number) {
  const q = useQuery({
    queryKey: ['sector-map', 'boundary', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase.from('field_boundaries_geojson').select('*').eq('field_id', fieldId)
      if (error) throw error
      return data ?? []
    },
  })
  return useMemo(
    () => (q.data ? ((boundariesForYear(q.data, year)[0]?.geometry ?? null) as Polygon | MultiPolygon | null) : null),
    [q.data, year],
  )
}

type NdviImage = {
  sensed_on: string
  kind: string
  storage_path: string
  west: number
  south: number
  east: number
  north: number
  lo: number
  hi: number
}

/**
 * Every NDVI raster of this field in the year, newest first, one per date.
 *
 * 'ndvi_field' is preferred: it is stretched across the field's own p10-p90,
 * so its seven colours are spread over the range the field actually spans and
 * the wedges can be told apart. The farm-scale 'ndvi' spreads the same seven
 * over 0.1-1.0, and inside one closed canopy that is two or three colours.
 */
function useNdviImages(fieldId: string, year: number) {
  return useQuery({
    queryKey: ['sector-map', 'ndvi-images', fieldId, year],
    enabled: Boolean(fieldId),
    queryFn: async (): Promise<NdviImage[]> => {
      const { data, error } = await supabase
        .from('sat_images')
        .select('sensed_on, kind, storage_path, west, south, east, north, stretch_min, stretch_max')
        .eq('subject_type', 'field')
        .eq('subject_id', fieldId)
        .in('kind', ['ndvi_field', 'ndvi'])
        .gte('sensed_on', `${year}-01-01`)
        .lte('sensed_on', `${year}-12-31`)
        .order('sensed_on', { ascending: false })
      if (error) throw error
      const byDate = new Map<string, NdviImage>()
      for (const r of data ?? []) {
        const lo = num(r.stretch_min)
        const hi = num(r.stretch_max)
        if (lo == null || hi == null || !(hi > lo)) continue
        const have = byDate.get(r.sensed_on)
        if (have && have.kind === 'ndvi_field') continue
        byDate.set(r.sensed_on, {
          sensed_on: r.sensed_on,
          kind: r.kind,
          storage_path: r.storage_path,
          west: Number(r.west),
          south: Number(r.south),
          east: Number(r.east),
          north: Number(r.north),
          lo,
          hi,
        })
      }
      return [...byDate.values()]
    },
    staleTime: 30 * 60_000,
  })
}

/** A stored PNG as raw RGBA. Straight from storage, with no colour management. */
async function decodePng(path: string): Promise<Raster> {
  const { data, error } = await supabase.storage.from('satellite-images').download(path)
  if (error || !data) throw new Error(`reading ${path}: ${error?.message ?? 'no data'}`)
  const bmp = await createImageBitmap(data, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d canvas')
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width: img.width, height: img.height, data: img.data }
}

type WedgeNdviResult = {
  sensedOn: string
  kind: string
  /** Share of the field the image saw clearly. */
  clear: number
  means: (number | null)[]
  pixels: number[]
}

/**
 * NDVI per wedge, read back out of the stored raster in the browser.
 *
 * The rasters are painted with exactly seven colours on a known stretch, so
 * each pixel's colour says which seventh of the stretch its NDVI fell in (see
 * rampIndex / rampValue). Averaged over the hundred-odd 10 m pixels in a
 * wedge, that is a mean fine enough to compare wedges by — with no new
 * backend pipeline. Only the per-wedge numbers are kept, not the pixels.
 *
 * With no date picked, the newest image that saw at least CLEAR_ENOUGH of the
 * field wins; failing that, the clearest of the last MAX_TRIES.
 */
function useWedgeNdvi(
  images: NdviImage[] | undefined,
  pick: string | null,
  pivot: Pivot | null,
  wedgeCount: number,
  boundary: Polygon | MultiPolygon | null,
) {
  const tries = useMemo(
    () => (images ? (pick ? images.filter((i) => i.sensed_on === pick) : images.slice(0, MAX_TRIES)) : []),
    [images, pick],
  )
  return useQuery({
    queryKey: [
      'sector-map',
      'ndvi-wedges',
      pivot?.id,
      pivot?.radiusM,
      pivot?.arc.start,
      pivot?.arc.span,
      wedgeCount,
      pick ?? 'auto',
      tries.map((t) => t.storage_path).join('|'),
      boundary ? 'b' : 'nb',
    ],
    enabled: Boolean(pivot?.center && pivot.radiusM && tries.length),
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<WedgeNdviResult | null> => {
      let best: WedgeNdviResult | null = null
      for (const img of tries) {
        const raster = await decodePng(img.storage_path)
        const clear = boundary ? clearFraction(raster, img, boundary) : 1
        const res = ndviByWedge(raster, img, pivot!.center!, pivot!.radiusM!, pivot!.arc, wedgeCount, RAMP, img.lo, img.hi)
        const cand = { sensedOn: img.sensed_on, kind: img.kind, clear, means: res.means, pixels: res.pixels }
        if (!best || clear > best.clear) best = cand
        if (clear >= CLEAR_ENOUGH) return cand
      }
      return best
    },
  })
}

type Share = { label: string; share: number }

/** How much of each wedge lies in each polygon, by area-spread sample points. */
function sharesByWedge(
  center: LngLat,
  radiusM: number,
  wedges: Wedge[],
  polys: { label: string; geometry: Polygon | MultiPolygon }[],
): Share[][] {
  if (!polys.length) return wedges.map(() => [])
  return wedges.map((w) => {
    const pts = wedgeSamples(center, radiusM, w)
    const counts = new Map<string, number>()
    for (const pt of pts) {
      const hit = polys.find((p) => pointInGeometry(pt, p.geometry))
      if (hit) counts.set(hit.label, (counts.get(hit.label) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, n]) => ({ label, share: n / pts.length }))
      .sort((a, b) => b.share - a.share)
  })
}

type WedgeRow = {
  wedge: Wedge
  moistureFrac: number | null
  applied: number | null
  appliedRel: number | null
  ndvi: number | null
  ndviRel: number | null
  pixels: number
  need: NeedScore | null
  zones: Share[]
  rx: Share[]
}

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const compass = (b: number) => DIRS[Math.round(norm360(b) / 22.5) % 16]
const deg = (b: number) => `${Math.round(norm360(b))}°`
const pct = (rel: number) => `${rel >= 0 ? '+' : '−'}${Math.abs(Math.round(rel * 100))}%`
const md = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

function bboxOf(rings: Position[][]) {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const ring of rings)
    for (const [x, y] of ring) {
      west = Math.min(west, x)
      east = Math.max(east, x)
      south = Math.min(south, y)
      north = Math.max(north, y)
    }
  return { west, south, east, north }
}
const ringsOf = (g: Polygon | MultiPolygon) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat())
const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })
const EMPTY = fc([])

export function FieldSectorMap({ fieldId, year }: { fieldId: string; year: number }) {
  const u = useUnitSystem()
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [mode, setMode] = useState<Mode>('moisture')
  const [win, setWin] = useState<AppliedWindow>('season')
  const [ndviPick, setNdviPick] = useState<string | null>(null)
  const [pivotPick, setPivotPick] = useState<string | null>(null)
  const [showZones, setShowZones] = useState(true)
  const [showRx, setShowRx] = useState(false)
  const [rxProductPick, setRxProductPick] = useState<string | null>(null)
  const [showSites, setShowSites] = useState(true)
  const [showInfo, setShowInfo] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  const pivotsQ = usePivots(fieldId)
  const pivots = useMemo(() => pivotsQ.data ?? [], [pivotsQ.data])
  const pivot = pivots.find((p) => p.id === pivotPick) ?? pivots[0] ?? null
  const drawable = Boolean(pivot?.center && pivot.radiusM)
  const boundary = useBoundary(fieldId, year)

  const wedges = useMemo(() => (pivot ? wedgesForArc(pivot.arc) : []), [pivot])

  // --- Applied water ---------------------------------------------------------
  const appliedQ = useAppliedWindows(pivot?.id ?? null, year, today)
  const isThisYear = String(year) === today.slice(0, 4)
  // applied_geom is FieldNET's current season only, so it stands in for a
  // missing season of bins this year and never for another year.
  const geomBins = useMemo(
    () =>
      appliedQ.data === null && isThisYear && pivot?.center && pivot.radiusM
        ? binsFromAppliedGeom(pivot.appliedGeom, pivot.center, pivot.radiusM)
        : null,
    [appliedQ.data, isThisYear, pivot],
  )
  const appliedSource: 'bins' | 'geom' | null = appliedQ.data ? 'bins' : geomBins ? 'geom' : null
  const effectiveWin: AppliedWindow = appliedSource === 'geom' ? 'season' : win
  const appliedBins = appliedQ.data ? appliedQ.data.sums[effectiveWin] : geomBins
  const appliedWedges = useMemo(() => (appliedBins ? binsToWedges(appliedBins, wedges) : null), [appliedBins, wedges])
  const appliedMean = useMemo(() => (appliedWedges ? wedgeMean(appliedWedges, wedges) : null), [appliedWedges, wedges])

  // --- NDVI ------------------------------------------------------------------
  const imagesQ = useNdviImages(fieldId, year)
  const ndviQ = useWedgeNdvi(imagesQ.data, ndviPick, drawable ? pivot : null, wedges.length, boundary)
  const ndvi = ndviQ.data ?? null
  const ndviMedian = useMemo(() => (ndvi ? median(ndvi.means) : null), [ndvi])

  // --- Overlays --------------------------------------------------------------
  const { data: allZones } = useYieldZones()
  const zones = useMemo(() => (allZones ?? []).filter((z) => z.field_id === fieldId && z.geometry), [allZones, fieldId])
  const { data: rxPolys } = useRxMap(fieldId, year)
  const rxProducts = useMemo(() => [...new Set((rxPolys ?? []).map((p) => p.product ?? 'Rx'))], [rxPolys])
  const rxProduct = rxProductPick && rxProducts.includes(rxProductPick) ? rxProductPick : (rxProducts[0] ?? null)
  const rxShown = useMemo(
    () => (rxPolys ?? []).filter((p) => (p.product ?? 'Rx') === rxProduct && p.geometry),
    [rxPolys, rxProduct],
  )
  const { data: allSites } = useSampleSites()
  const sites = useMemo(
    () => sitesForYear(allSites ?? [], year).filter((s) => s.field_id === fieldId),
    [allSites, year, fieldId],
  )

  const zoneShares = useMemo(
    () =>
      pivot?.center && pivot.radiusM
        ? sharesByWedge(
            pivot.center,
            pivot.radiusM,
            wedges,
            zones.map((z) => ({ label: `Zone ${z.zone} (${rangeLabel(z)})`, geometry: z.geometry })),
          )
        : wedges.map(() => []),
    [pivot, wedges, zones],
  )
  const rxShares = useMemo(
    () =>
      pivot?.center && pivot.radiusM
        ? sharesByWedge(
            pivot.center,
            pivot.radiusM,
            wedges,
            rxShown.map((p) => ({ label: p.target_rate != null ? `${p.target_rate}` : '—', geometry: p.geometry })),
          )
        : wedges.map(() => []),
    [pivot, wedges, rxShown],
  )

  // --- Soil moisture now (balance per wedge) ------------------------------------
  const moistQ = useWedgeMoisture(fieldId)
  const moisture = useMemo(
    () => (moistQ.data ? moistureOnWedges(moistQ.data.avail_mm as number[], moistQ.data.fc_mm as number[], wedges) : null),
    [moistQ.data, wedges],
  )

  // --- One row per wedge -----------------------------------------------------
  const rows = useMemo<WedgeRow[]>(
    () =>
      wedges.map((w, i) => {
        const applied = appliedWedges?.[i] ?? null
        const appliedRel = relativeTo(applied, appliedMean)
        const n = ndvi?.means[i] ?? null
        const ndviRel = relativeTo(n, ndviMedian)
        return {
          wedge: w,
          moistureFrac: moisture?.[i]?.frac ?? null,
          applied,
          appliedRel,
          ndvi: n,
          ndviRel,
          pixels: ndvi?.pixels[i] ?? 0,
          need: needScore(appliedRel, ndviRel),
          zones: zoneShares[i] ?? [],
          rx: rxShares[i] ?? [],
        }
      }),
    [wedges, moisture, appliedWedges, appliedMean, ndvi, ndviMedian, zoneShares, rxShares],
  )

  const bands: Band[] = bandsFor(mode)
  const valueOf = (r: WedgeRow) =>
    mode === 'moisture' ? r.moistureFrac : mode === 'water' ? r.appliedRel : mode === 'vigour' ? r.ndviRel : (r.need?.score ?? null)

  // --- GeoJSON for the map ---------------------------------------------------
  const wedgeFc = useMemo(() => {
    if (!pivot?.center || !pivot.radiusM) return EMPTY
    const center = pivot.center
    const radius = pivot.radiusM
    return fc(
      rows.map((r, i) => {
        const v = valueOf(r)
        const band = bandFor(v, bands)
        return {
          type: 'Feature',
          properties: { i, colour: band?.colour ?? NO_DATA, has: band ? 1 : 0 },
          geometry: { type: 'Polygon', coordinates: [wedgeRing(center, radius, r.wedge.a0, r.wedge.a1)] },
        }
      }),
    )
  }, [pivot, rows, mode, bands]) // eslint-disable-line react-hooks/exhaustive-deps

  const frame = useMemo(() => {
    if (!pivot?.center || !pivot.radiusM) return null
    const rings: Position[][] = [circleRing(pivot.center, pivot.radiusM)]
    if (boundary) rings.push(...ringsOf(boundary))
    return bboxOf(rings)
  }, [pivot, boundary])

  const maskFc = useMemo(() => {
    if (!boundary || !frame) return EMPTY
    const pad = 0.02
    const box = { west: frame.west - pad, south: frame.south - pad, east: frame.east + pad, north: frame.north + pad }
    return fc([{ type: 'Feature', properties: {}, geometry: outsideMask(boundary, box) }])
  }, [boundary, frame])

  const boundaryFc = useMemo(
    () => (boundary ? fc([{ type: 'Feature', properties: {}, geometry: boundary }]) : EMPTY),
    [boundary],
  )
  const centreFc = useMemo(
    () =>
      pivot?.center ? fc([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pivot.center } }]) : EMPTY,
    [pivot],
  )
  const zonesFc = useMemo(
    () =>
      fc(zones.map((z) => ({ type: 'Feature', properties: { label: `Z${z.zone}` }, geometry: z.geometry }))),
    [zones],
  )
  const rxFc = useMemo(
    () =>
      fc(
        rxShown.map((p) => ({
          type: 'Feature',
          properties: { label: p.target_rate != null ? `${p.target_rate}` : '' },
          geometry: p.geometry,
        })),
      ),
    [rxShown],
  )
  const sitesFc = useMemo(
    () =>
      fc(
        sites.map((s) => ({
          type: 'Feature',
          properties: { label: s.code },
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        })),
      ),
    [sites],
  )

  // --- The map ---------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const mapKey = drawable && pivot ? `${pivot.id}:${pivot.radiusM}:${pivot.arc.start}:${pivot.arc.span}` : null
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const mapReady = mapKey != null && readyKey === mapKey
  // Read once, at creation: later framing changes (the boundary arriving) do
  // not rebuild the map — the pivot circle is what it is framed on.
  const frameRef = useRef(frame)
  useEffect(() => {
    frameRef.current = frame
  }, [frame])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !mapKey) return
    let cancelled = false
    let map: MlMap | null = null
    import('maplibre-gl')
      .then(({ default: maplibregl }) => {
        if (cancelled) return
        const f = frameRef.current
        map = new maplibregl.Map({
          container: el,
          style: SATELLITE_STYLE,
          bounds: f ? [f.west, f.south, f.east, f.north] : undefined,
          fitBoundsOptions: { padding: 16 },
          attributionControl: { compact: true },
          // Two fingers to pan on a phone, ctrl + wheel on a desktop: this sits
          // in a scrolling page and must not swallow the scroll.
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
        })
        map.touchZoomRotate.disableRotation()
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
        const m = map
        m.on('load', () => {
          for (const id of ['wedges', 'mask', 'boundary', 'centre', 'zones', 'rx', 'sites'])
            m.addSource(id, { type: 'geojson', data: EMPTY })
          m.addLayer({
            id: 'wedges-fill',
            type: 'fill',
            source: 'wedges',
            paint: {
              'fill-color': ['get', 'colour'],
              'fill-opacity': ['case', ['==', ['get', 'has'], 1], 0.6, 0.25],
            },
          })
          m.addLayer({
            id: 'wedges-line',
            type: 'line',
            source: 'wedges',
            paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.7 },
          })
          m.addLayer({ id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': '#000000', 'fill-opacity': 0.5 } })
          m.addLayer({
            id: 'zones-line',
            type: 'line',
            source: 'zones',
            paint: { 'line-color': '#fde68a', 'line-width': 1.5, 'line-dasharray': [3, 2] },
          })
          m.addLayer({
            id: 'zones-label',
            type: 'symbol',
            source: 'zones',
            layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
            paint: { 'text-color': '#fef3c7', 'text-halo-color': '#000000', 'text-halo-width': 1.2 },
          })
          m.addLayer({
            id: 'rx-line',
            type: 'line',
            source: 'rx',
            paint: { 'line-color': '#f0abfc', 'line-width': 1.5 },
          })
          m.addLayer({
            id: 'rx-label',
            type: 'symbol',
            source: 'rx',
            layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
            paint: { 'text-color': '#fae8ff', 'text-halo-color': '#000000', 'text-halo-width': 1.2 },
          })
          m.addLayer({
            id: 'boundary-line',
            type: 'line',
            source: 'boundary',
            paint: { 'line-color': '#facc15', 'line-width': 2 },
          })
          m.addLayer({
            id: 'wedge-active',
            type: 'line',
            source: 'wedges',
            filter: ['==', ['get', 'i'], -1],
            paint: { 'line-color': '#111827', 'line-width': 3 },
          })
          m.addLayer({
            id: 'sites-dot',
            type: 'circle',
            source: 'sites',
            paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': '#7c2d12', 'circle-stroke-width': 2 },
          })
          m.addLayer({
            id: 'centre-dot',
            type: 'circle',
            source: 'centre',
            paint: { 'circle-radius': 4, 'circle-color': '#111827', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
          })

          const indexAt = (e: { features?: { properties?: Record<string, unknown> }[] }) => {
            const i = e.features?.[0]?.properties?.i
            return typeof i === 'number' ? i : null
          }
          m.on('mousemove', 'wedges-fill', (e) => {
            m.getCanvas().style.cursor = 'pointer'
            setHover(indexAt(e))
          })
          m.on('mouseleave', 'wedges-fill', () => {
            m.getCanvas().style.cursor = ''
            setHover(null)
          })
          m.on('click', 'wedges-fill', (e) => {
            const i = indexAt(e)
            setSelected((s) => (s === i ? null : i))
          })
          setReadyKey(mapKey)
        })
        mapRef.current = map
      })
      .catch((e: Error) => {
        if (!cancelled) setMapError(e.message)
      })
    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
    }
  }, [mapKey])

  // Push data into the map as it arrives.
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady) return
    const set = (id: string, data: FeatureCollection) => (m.getSource(id) as GeoJSONSource | undefined)?.setData(data)
    set('wedges', wedgeFc)
    set('mask', maskFc)
    set('boundary', boundaryFc)
    set('centre', centreFc)
    set('zones', zonesFc)
    set('rx', rxFc)
    set('sites', sitesFc)
  }, [mapReady, wedgeFc, maskFc, boundaryFc, centreFc, zonesFc, rxFc, sitesFc])

  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady) return
    const vis = (id: string, on: boolean) => m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    vis('zones-line', showZones)
    vis('zones-label', showZones)
    vis('rx-line', showRx)
    vis('rx-label', showRx)
    vis('sites-dot', showSites)
  }, [mapReady, showZones, showRx, showSites])

  const active = hover ?? selected
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady) return
    m.setFilter('wedge-active', ['==', ['get', 'i'], active ?? -1])
  }, [mapReady, active])

  // --- Render ----------------------------------------------------------------
  const unit = conv.depthUnit(u)
  const dp = u === 'metric' ? 0 : 2
  const depth = (mm: number | null) => (mm == null ? '—' : `${conv.depth(mm, u, dp)} ${unit}`)
  const winLabel = WINDOWS.find((w) => w.id === effectiveWin)!.label.toLowerCase()

  if (pivotsQ.isLoading)
    return (
      <Shell>
        <p className="py-10 text-center text-xs text-gray-400">Finding the pivot…</p>
      </Shell>
    )
  if (pivotsQ.isError)
    return (
      <Shell>
        <p className="py-6 text-center text-xs text-red-700">Could not read FieldNET pivots: {(pivotsQ.error as Error).message}</p>
      </Shell>
    )
  if (!pivot)
    return (
      <Shell>
        <p className="py-8 text-center text-sm text-gray-500">No FieldNET pivot linked to this field.</p>
        <p className="-mt-6 pb-4 text-center text-xs text-gray-400">Link its pivot to see the circle in wedges.</p>
        <p className="pb-6 text-center text-sm">
          <SetupLink managerOnly to={SETUP_LINKS.fieldnetPivot(fieldId)}>Link a FieldNET pivot</SetupLink>
        </p>
      </Shell>
    )
  if (!drawable)
    return (
      <Shell>
        <p className="py-8 text-center text-sm text-gray-500">
          {pivot.name} has no {pivot.center ? 'system length' : 'position'} on file from FieldNET, so its circle cannot be drawn.
        </p>
      </Shell>
    )

  const activeRow = active != null ? (rows[active] ?? null) : null
  const noWaterInWindow = appliedMean === 0
  const images = imagesQ.data ?? []

  return (
    <Shell
      title={`${pivot.name} · ${wedges.length} wedges of ${Math.round((pivot.arc.span / wedges.length) * 10) / 10}°`}
      onInfo={() => setShowInfo((s) => !s)}
    >
      {showInfo && <InfoPanel onClose={() => setShowInfo(false)} />}

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {pivots.length > 1 &&
          pivots.map((p) => (
            <Pill key={p.id} on={p.id === pivot.id} onClick={() => setPivotPick(p.id)}>
              {p.name}
            </Pill>
          ))}
        {MODES.map((m) => (
          <Pill key={m.id} on={mode === m.id} onClick={() => setMode(m.id)}>
            {m.label}
          </Pill>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        {mode !== 'vigour' && (
          <div className="flex flex-wrap items-center gap-1">
            {WINDOWS.map((w) => (
              <Pill
                key={w.id}
                small
                on={effectiveWin === w.id}
                disabled={appliedSource === 'geom' && w.id !== 'season'}
                title={appliedSource === 'geom' && w.id !== 'season' ? 'Daily FieldNET water is not loaded for this pivot yet — season only' : undefined}
                onClick={() => setWin(w.id)}
              >
                {w.label}
              </Pill>
            ))}
          </div>
        )}
        {mode !== 'water' && images.length > 0 && (
          <label className="flex items-center gap-1 text-gray-600">
            Image
            <select
              value={ndviPick ?? ''}
              onChange={(e) => setNdviPick(e.target.value || null)}
              className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs"
            >
              <option value="">Latest clear</option>
              {images.map((i) => (
                <option key={i.sensed_on} value={i.sensed_on}>
                  {md(i.sensed_on)}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-gray-600">
          {zones.length > 0 && <Toggle on={showZones} onChange={setShowZones} label="Yield zones" />}
          {rxProducts.length > 0 && <Toggle on={showRx} onChange={setShowRx} label="Fertility Rx" />}
          {showRx && rxProducts.length > 1 && (
            <select
              value={rxProduct ?? ''}
              onChange={(e) => setRxProductPick(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs"
              aria-label="Rx product"
            >
              {rxProducts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          {sites.length > 0 && <Toggle on={showSites} onChange={setShowSites} label="Soil sites" />}
        </span>
      </div>

      {mode === 'moisture' && (
        <p className="mb-2 text-xs text-gray-600">
          {moistQ.isLoading ? (
            'Reading the balance per wedge…'
          ) : !moistQ.data ? (
            <span className="text-amber-800">No balance per wedge yet — it needs FieldNET water by degree for this pivot; the morning run fills it.</span>
          ) : (
            <>
              Soil moisture {md(moistQ.data.date)}: driest wedge{' '}
              <b>{Math.round(Math.min(...rows.map((r) => r.moistureFrac ?? 9)) * 100)}%</b> of its capacity, wettest{' '}
              <b>{Math.round(Math.max(...rows.map((r) => r.moistureFrac ?? 0)) * 100)}%</b>. From where FieldNET put the water, the same rain and crop demand
              everywhere, and the soil's holding capacity around the circle.
            </>
          )}
        </p>
      )}
      <StatusLine
        mode={mode}
        appliedSource={appliedSource}
        appliedLoading={appliedQ.isLoading}
        applied={appliedQ.data ?? null}
        appliedMean={appliedMean}
        noWaterInWindow={noWaterInWindow}
        winLabel={winLabel}
        depth={depth}
        imagesLoading={imagesQ.isLoading}
        imageCount={images.length}
        ndvi={ndvi}
        ndviLoading={ndviQ.isFetching && !ndvi}
        ndviError={ndviQ.isError ? (ndviQ.error as Error).message : null}
        ndviMedian={ndviMedian}
        year={year}
      />

      <div className="relative">
        <div ref={containerRef} className="h-72 w-full overflow-hidden rounded-md border border-gray-200 bg-gray-100 sm:h-96" />
        {mapError && (
          <p className="absolute inset-x-0 top-1/2 text-center text-xs text-red-700">The map could not load: {mapError}</p>
        )}
      </div>

      <Legend bands={bands} mode={mode} />
      <WedgeDetail
        row={activeRow}
        mode={mode}
        depth={depth}
        winLabel={winLabel}
        ndviDate={ndvi?.sensedOn ?? null}
        rxProduct={showRx ? rxProduct : null}
        pinned={selected != null && hover == null}
        value={activeRow ? valueOf(activeRow) : null}
      />
    </Shell>
  )
}

function Shell({ children, title, onInfo }: { children: ReactNode; title?: string; onInfo?: () => void }) {
  return (
    <section className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-800">Where the water went</h3>
          {title && <p className="truncate text-xs text-gray-500">{title}</p>}
        </div>
        {onInfo && (
          <button
            type="button"
            onClick={onInfo}
            aria-label="About this map"
            className="rounded-full p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            <Info className="h-4 w-4" />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Pill({
  on,
  onClick,
  children,
  small,
  disabled,
  title,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
  small?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-40',
        small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        on ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
      )}
    >
      {children}
    </button>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-brand-700" />
      {label}
    </label>
  )
}

function StatusLine(p: {
  mode: Mode
  appliedSource: 'bins' | 'geom' | null
  appliedLoading: boolean
  applied: AppliedWindows | null
  appliedMean: number | null
  noWaterInWindow: boolean
  winLabel: string
  depth: (mm: number | null) => string
  imagesLoading: boolean
  imageCount: number
  ndvi: WedgeNdviResult | null
  ndviLoading: boolean
  ndviError: string | null
  ndviMedian: number | null
  year: number
}) {
  const water =
    p.appliedLoading ? (
      'Reading FieldNET water…'
    ) : p.appliedSource == null ? (
      <span className="text-amber-800">No FieldNET applied water for this pivot in {p.year}.</span>
    ) : p.noWaterInWindow ? (
      <span className="text-amber-800">No water applied in the {p.winLabel}.</span>
    ) : (
      <>
        Field average <b>{p.depth(p.appliedMean)}</b> applied, {p.winLabel}
        {p.appliedSource === 'bins' && p.applied
          ? ` · ${p.applied.days} days of FieldNET water, ${md(p.applied.first)}–${md(p.applied.last)}`
          : ' · from FieldNET’s season map (daily water not loaded yet)'}
      </>
    )
  const sat = p.imagesLoading ? (
    'Looking for satellite images…'
  ) : p.imageCount === 0 ? (
    <span className="text-amber-800">No satellite image yet for {p.year}.</span>
  ) : p.ndviError ? (
    <span className="text-red-700">Could not read the NDVI image: {p.ndviError}</span>
  ) : p.ndviLoading || !p.ndvi ? (
    'Reading the NDVI image…'
  ) : (
    <>
      NDVI {md(p.ndvi.sensedOn)}, field median <b>{p.ndviMedian?.toFixed(2) ?? '—'}</b>
      {' · '}
      {p.ndvi.kind === 'ndvi_field' ? 'stretched to this field' : 'farm scale'}
      {p.ndvi.clear < CLEAR_ENOUGH && (
        <span className="text-amber-800"> · only {Math.round(p.ndvi.clear * 100)}% of the field clear of cloud</span>
      )}
    </>
  )
  return (
    <div className="mb-2 space-y-0.5 text-xs text-gray-600">
      {p.mode !== 'vigour' && <p>{water}</p>}
      {p.mode !== 'water' && <p>{sat}</p>}
      {p.mode === 'need' && (
        <p className="text-gray-500">
          Indicative only, not a prescription.
          {!p.ndvi && p.appliedSource ? ' Based on applied water only — no usable NDVI image.' : ''}
        </p>
      )}
      {p.mode !== 'vigour' && p.appliedSource === 'bins' && p.winLabel !== 'season' && (
        <p className="text-gray-400">Short windows show where the pivot has been lately, not a problem on their own.</p>
      )}
    </div>
  )
}

function Legend({ bands, mode }: { bands: Band[]; mode: Mode }) {
  const caption =
    mode === 'moisture'
      ? 'Soil moisture, share of capacity'
      : mode === 'water'
        ? 'Applied vs field average'
        : mode === 'vigour'
          ? 'NDVI vs field median'
          : 'Needs water (indicative)'
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-gray-600">
      <span className="font-medium text-gray-700">{caption}</span>
      {bands.map((b) => (
        <span key={b.label} className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm border border-gray-300" style={{ background: b.colour }} />
          {b.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="h-3 w-3 rounded-sm border border-gray-300 opacity-50" style={{ background: NO_DATA }} />
        no data
      </span>
    </div>
  )
}

function WedgeDetail({
  row,
  mode,
  depth,
  winLabel,
  ndviDate,
  rxProduct,
  pinned,
  value,
}: {
  row: WedgeRow | null
  mode: Mode
  depth: (mm: number | null) => string
  winLabel: string
  ndviDate: string | null
  rxProduct: string | null
  pinned: boolean
  value: number | null
}) {
  if (!row) return <p className="mt-2 text-xs text-gray-400">Tap a wedge for its numbers.</p>
  const w = row.wedge
  const band = bandFor(value, bandsFor(mode))
  const shares = (s: Share[]) => s.map((x) => `${x.label} ${Math.round(x.share * 100)}%`).join(' · ')
  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold text-gray-900">
          {deg(w.a0)}–{deg(w.a1)} <span className="font-normal text-gray-500">({compass((w.a0 + w.a1) / 2)})</span>
        </span>
        {band && (
          <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-[11px]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: band.colour }} />
            {band.label}
          </span>
        )}
        {pinned && <span className="ml-auto text-[11px] text-gray-400">tap again to clear</span>}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {row.moistureFrac != null && (
          <div className="flex gap-1 sm:col-span-2">
            <dt className="text-gray-500">Soil moisture now:</dt>
            <dd className="tabular-nums">{Math.round(row.moistureFrac * 100)}% of capacity</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt className="text-gray-500">Applied ({winLabel}):</dt>
          <dd className="tabular-nums">
            {depth(row.applied)}
            {row.appliedRel != null && <span className="text-gray-500"> ({pct(row.appliedRel)} vs average)</span>}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-gray-500">NDVI{ndviDate ? ` ${md(ndviDate)}` : ''}:</dt>
          <dd className="tabular-nums">
            {row.ndvi != null ? row.ndvi.toFixed(2) : row.pixels ? 'too few clear pixels' : '—'}
            {row.ndviRel != null && <span className="text-gray-500"> ({pct(row.ndviRel)} vs median)</span>}
          </dd>
        </div>
        {row.need && (
          <div className="flex gap-1 sm:col-span-2">
            <dt className="text-gray-500">Needs-water score:</dt>
            <dd className="tabular-nums">
              {row.need.score.toFixed(2)}
              <span className="text-gray-500">
                {' '}
                (dryness {row.need.dryness.toFixed(2)}
                {row.need.weakness != null ? `, weakness ${row.need.weakness.toFixed(2)}` : ''})
              </span>
            </dd>
          </div>
        )}
        {row.need?.vigourIgnored && (
          <p className="text-amber-800 sm:col-span-2">
            Crop is weaker here despite more water than average — likely not a water problem (salinity, a wet spot, disease).
          </p>
        )}
        {row.zones.length > 0 && (
          <div className="flex gap-1 sm:col-span-2">
            <dt className="text-gray-500">Yield zones:</dt>
            <dd>{shares(row.zones)}</dd>
          </div>
        )}
        {rxProduct && row.rx.length > 0 && (
          <div className="flex gap-1 sm:col-span-2">
            <dt className="text-gray-500">Rx {rxProduct}:</dt>
            <dd>{shares(row.rx)}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function InfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="relative mb-3 rounded-md border border-sky-200 bg-sky-50 p-3 pr-8 text-xs leading-relaxed text-sky-950">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-2 top-2 text-sky-700 hover:text-sky-950">
        <X className="h-4 w-4" />
      </button>
      <p className="mb-1.5">
        <b>Wedges.</b> The pivot&apos;s watered arc cut into equal wedges of about {WEDGE_DEG}°, out to the wetted
        radius (the end gun&apos;s reach). The dimmed ground is outside the field boundary.
      </p>
      <p className="mb-1.5">
        <b>Water applied</b> comes from FieldNET: the water it recorded on each degree of the circle each day, added up
        over the window and averaged across the wedge. Colours compare each wedge with the field&apos;s average for the
        same window. Before the daily figures are loaded, FieldNET&apos;s season map is used and only the season window
        is available.
      </p>
      <p className="mb-1.5">
        <b>Crop vigour</b> is NDVI from the farm&apos;s Sentinel-2 images (10 m pixels). The stored NDVI picture is read
        back pixel by pixel into NDVI values and averaged per wedge; cloud is left out. Wedges are compared with the
        median wedge. The newest image that saw at least {CLEAR_ENOUGH * 100}% of the field is used unless you pick a
        date. Late in the season NDVI tracks ripening and harvest as much as water.
      </p>
      <p className="mb-1.5">
        <b>Needs water</b> is indicative, not a prescription. Per wedge:
        <br />
        dryness = how far below the field&apos;s average water it got, where {DRY_AT * 100}% below = 1;
        <br />
        weakness = how far below the median NDVI it is, where {WEAK_AT * 100}% below = 1 (both capped at ±1);
        <br />
        score = {WATER_WEIGHT} × dryness + {VIGOUR_WEIGHT} × weakness.
        <br />A weak wedge that got <i>more</i> water than average has its weakness counted as zero — water is not what
        it is short of. With no usable NDVI the score is dryness alone.
      </p>
      <p>
        <b>Overlays.</b> Yield zones are the agronomist&apos;s productivity zones (an index, 100 = the field&apos;s own
        average); a low-zone wedge is expected to look weaker. Fertility Rx shows the applicator prescription rates
        where a map was imported. Soil tests carry no location, so only marked sample sites can be shown.
      </p>
    </div>
  )
}
