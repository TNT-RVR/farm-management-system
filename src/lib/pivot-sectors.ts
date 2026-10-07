import type { MultiPolygon, Polygon, Position } from 'geojson'

/**
 * A pivot circle cut into pie wedges, and what each wedge got.
 *
 * Pure maths for the sector map under the AIMM graph: where the wedges are,
 * how FieldNET's degree-by-degree water adds up inside each one, and how a
 * crop-vigour raster is read back into numbers. Nothing here touches the
 * network or the DOM, so all of it is tested.
 *
 * Bearings throughout are degrees clockwise from north, measured from the
 * pivot's centre — the convention FieldNET's own angle uses and the one
 * fieldnet_applied_bins is indexed by (bins[i] is the wedge from i to i+1).
 */

/** Nominal wedge width. The arc is split into equal wedges as close to this as it allows. */
export const WEDGE_DEG = 10

const EARTH_R = 6_371_000
const RAD = Math.PI / 180

export type LngLat = [number, number]

/** The pivot's watered arc: `span` degrees clockwise from `start`. 360 is a full circle. */
export type PivotArc = { start: number; span: number }

export const norm360 = (d: number) => ((d % 360) + 360) % 360

/**
 * The arc from FieldNET's partial start/end angles.
 *
 * Both equal (FieldNET sends 0 and 0) means no partial window: a full circle.
 * Otherwise the machine sweeps clockwise from start to end — #10 Jen's 86→255
 * is 169°, which is what the FieldNET app draws and what its applied water
 * covers.
 */
export function pivotArc(start: number | null | undefined, end: number | null | undefined): PivotArc {
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) return { start: 0, span: 360 }
  const s = norm360(start)
  const e = norm360(end)
  if (Math.abs(s - e) < 1e-9) return { start: 0, span: 360 }
  return { start: s, span: norm360(e - s) }
}

/** Destination [lng, lat] from a point, a bearing and a distance in metres (great circle). */
export function destination(from: LngLat | Position, bearingDeg: number, distM: number): LngLat {
  const br = bearingDeg * RAD
  const d = distM / EARTH_R
  const φ1 = from[1] * RAD
  const λ1 = from[0] * RAD
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(br))
  const λ2 = λ1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2))
  return [λ2 / RAD, φ2 / RAD]
}

/**
 * Bearing and distance from the pivot to a point, on a flat local projection.
 *
 * Flat is deliberate: this runs once per satellite pixel, and over a pivot's
 * few hundred metres the difference from the great-circle answer is well under
 * a metre and a hundredth of a degree.
 */
export function localPolar(center: LngLat | Position, p: LngLat | Position): { bearing: number; dist: number } {
  const dx = (p[0] - center[0]) * RAD * EARTH_R * Math.cos(center[1] * RAD)
  const dy = (p[1] - center[1]) * RAD * EARTH_R
  return { bearing: norm360(Math.atan2(dx, dy) / RAD), dist: Math.hypot(dx, dy) }
}

/** One wedge: from bearing a0 (0-360) clockwise to a1 = a0 + width, which may pass 360. */
export type Wedge = { index: number; a0: number; a1: number }

/**
 * The arc cut into equal wedges as close to `width` as it allows.
 *
 * Equal rather than 10° plus a sliver: #10 Jen's 169° would otherwise end in a
 * 9° wedge, and #9's 175° in a 5° one that reads as its own thing on the map.
 * 169° becomes 17 wedges of 9.94°; a full circle is exactly 36 of 10°, starting
 * at north.
 */
export function wedgesForArc(arc: PivotArc, width = WEDGE_DEG): Wedge[] {
  const n = Math.max(1, Math.round(arc.span / width))
  const w = arc.span / n
  return Array.from({ length: n }, (_, i) => {
    const a0 = norm360(arc.start + i * w)
    return { index: i, a0, a1: a0 + w }
  })
}

/** Which wedge a bearing falls in, or -1 outside a partial arc. */
export function wedgeIndexOf(bearing: number, arc: PivotArc, count: number): number {
  const off = norm360(bearing - arc.start)
  if (arc.span < 360 && off >= arc.span) return -1
  return Math.min(count - 1, Math.floor(off / (arc.span / count)))
}

/** A closed pie-wedge ring: centre, out along a0, round the arc, back to the centre. */
export function wedgeRing(center: LngLat, radiusM: number, a0: number, a1: number, stepDeg = 2): LngLat[] {
  const pts: LngLat[] = [center]
  for (let a = a0; a < a1; a += stepDeg) pts.push(destination(center, a, radiusM))
  pts.push(destination(center, a1, radiusM))
  pts.push(center)
  return pts
}

/** A closed ring round the whole circle. */
export function circleRing(center: LngLat, radiusM: number, stepDeg = 3): LngLat[] {
  const pts: LngLat[] = []
  for (let a = 0; a < 360; a += stepDeg) pts.push(destination(center, a, radiusM))
  pts.push(pts[0])
  return pts
}

/**
 * Add up days of 1° bins into one 360-long total.
 *
 * A missing or null bin is no water that day, which is what it means: the
 * sync writes a row only for a day the pivot ran, and a bin it did not reach
 * is zero rather than unknown.
 */
export function sumDailyBins(days: readonly (readonly (number | null)[] | null | undefined)[]): number[] {
  const out = new Array<number>(360).fill(0)
  for (const bins of days) {
    if (!bins) continue
    for (let i = 0; i < 360 && i < bins.length; i++) {
      const v = bins[i]
      if (v != null && Number.isFinite(v)) out[i] += v
    }
  }
  return out
}

/**
 * The average depth on each wedge from 1° bins.
 *
 * Weighted by how much of each degree the wedge covers, because equal-width
 * wedges on a partial arc do not start on whole degrees. Only degrees inside
 * the wedge count, so on a partial pivot the bins it cannot reach never enter
 * any wedge. Null only where no bin under the wedge has a number at all.
 */
export function binsToWedges(bins: readonly (number | null)[], wedges: readonly Wedge[]): (number | null)[] {
  return wedges.map((w) => {
    let sum = 0
    let weight = 0
    for (let d = Math.floor(w.a0); d < Math.ceil(w.a1); d++) {
      const overlap = Math.min(d + 1, w.a1) - Math.max(d, w.a0)
      if (overlap <= 0) continue
      const v = bins[norm360(d)]
      if (v == null || !Number.isFinite(v)) continue
      sum += v * overlap
      weight += overlap
    }
    return weight > 0 ? sum / weight : null
  })
}

/** Mean of the wedges that have a value, weighted by width — i.e. by area. */
export function wedgeMean(values: readonly (number | null)[], wedges: readonly Wedge[]): number | null {
  let sum = 0
  let weight = 0
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) return
    const w = wedges[i].a1 - wedges[i].a0
    sum += v * w
    weight += w
  })
  return weight > 0 ? sum / weight : null
}

export function median(values: readonly (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Fraction above (+) or below (−) a reference. Null when the reference is not a usable divisor. */
export function relativeTo(value: number | null, ref: number | null): number | null {
  if (value == null || ref == null || !Number.isFinite(value) || !(ref > 0)) return null
  return value / ref - 1
}

// ---------------------------------------------------------------------------
// The needs-water score
// ---------------------------------------------------------------------------

/** A wedge this far below the field's mean applied water counts as fully "dry" (1). */
export const DRY_AT = 0.2
/** A wedge this far below the field's median NDVI counts as fully "weak" (1). */
export const WEAK_AT = 0.1
/** How the two are blended when both are known. */
export const WATER_WEIGHT = 0.6
export const VIGOUR_WEIGHT = 0.4

export type NeedScore = {
  /** −1 (well watered) to +1 (likely short). */
  score: number
  /** −1..1: how far below the field's mean applied water, scaled by DRY_AT. */
  dryness: number
  /** −1..1: how far below the field's median NDVI, scaled by WEAK_AT. Null without NDVI. */
  weakness: number | null
  /** Weak crop that got MORE water than average: vigour was left out of the score. */
  vigourIgnored: boolean
}

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x))

/**
 * Indicative, not a prescription.
 *
 *   dryness  = (field mean applied − wedge applied) ÷ (DRY_AT × field mean), clamped to ±1
 *   weakness = (field median NDVI − wedge NDVI)     ÷ (WEAK_AT × field median), clamped to ±1
 *   score    = WATER_WEIGHT × dryness + VIGOUR_WEIGHT × weakness
 *
 * With no NDVI the score is dryness alone. One exception: a wedge with a weak
 * crop that nonetheless got more water than average has its weakness counted
 * as zero. Water is not what that crop is short of — salinity, a wet spot,
 * disease or poor ground are likelier — and adding more would be the wrong
 * reading of the map. The tooltip says so rather than hiding it.
 *
 * Inputs are the relative figures from relativeTo: +0.1 is 10% above the
 * field's reference, −0.1 10% below.
 */
export function needScore(appliedRel: number | null, ndviRel: number | null): NeedScore | null {
  if (appliedRel == null) return null
  const dryness = clamp1(-appliedRel / DRY_AT)
  if (ndviRel == null) return { score: dryness, dryness, weakness: null, vigourIgnored: false }
  const weakness = clamp1(-ndviRel / WEAK_AT)
  const vigourIgnored = weakness > 0 && dryness < 0
  const score = WATER_WEIGHT * dryness + VIGOUR_WEIGHT * (vigourIgnored ? 0 : weakness)
  return { score, dryness, weakness, vigourIgnored }
}

// ---------------------------------------------------------------------------
// Colour bands
// ---------------------------------------------------------------------------

export type Band = { upTo: number; colour: string; label: string }

export function bandFor(value: number | null, bands: readonly Band[]): Band | null {
  if (value == null || !Number.isFinite(value)) return null
  for (const b of bands) if (value < b.upTo) return b
  return bands[bands.length - 1]
}

/** Applied water against the field mean. Warm is drier, cool is wetter. */
export const APPLIED_BANDS: Band[] = [
  { upTo: -0.3, colour: '#b2182b', label: '30%+ less' },
  { upTo: -0.15, colour: '#ef8a62', label: '15–30% less' },
  { upTo: -0.05, colour: '#fddbc7', label: '5–15% less' },
  { upTo: 0.05, colour: '#f7f7f7', label: 'within 5%' },
  { upTo: 0.15, colour: '#d1e5f0', label: '5–15% more' },
  { upTo: 0.3, colour: '#67a9cf', label: '15–30% more' },
  { upTo: Infinity, colour: '#2166ac', label: '30%+ more' },
]

/**
 * NDVI against the field median. Tighter than the water bands: within a
 * closed canopy a few per cent of NDVI is already a visible difference.
 */
export const VIGOUR_BANDS: Band[] = [
  { upTo: -0.1, colour: '#8c510a', label: '10%+ below' },
  { upTo: -0.05, colour: '#d8b365', label: '5–10% below' },
  { upTo: -0.02, colour: '#f6e8c3', label: '2–5% below' },
  { upTo: 0.02, colour: '#f5f5f5', label: 'within 2%' },
  { upTo: 0.05, colour: '#c7e9c0', label: '2–5% above' },
  { upTo: 0.1, colour: '#74c476', label: '5–10% above' },
  { upTo: Infinity, colour: '#238b45', label: '10%+ above' },
]

export const NEED_BANDS: Band[] = [
  { upTo: -0.5, colour: '#2166ac', label: 'Well watered' },
  { upTo: -0.2, colour: '#92c5de', label: 'Wetter side' },
  { upTo: 0.2, colour: '#f7f7f7', label: 'About average' },
  { upTo: 0.5, colour: '#fdae61', label: 'May want more' },
  { upTo: Infinity, colour: '#d7191c', label: 'Likely short' },
]

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function inRing(pt: LngLat | Position, ring: readonly Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Point in a Polygon or MultiPolygon, holes respected. */
export function pointInGeometry(pt: LngLat | Position, g: Polygon | MultiPolygon | null | undefined): boolean {
  if (!g) return false
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  for (const rings of polys) {
    if (!rings.length || !inRing(pt, rings[0])) continue
    let inHole = false
    for (let h = 1; h < rings.length; h++) if (inRing(pt, rings[h])) inHole = true
    if (!inHole) return true
  }
  return false
}

/** Twice the signed area of a ring in degrees; the sign is its winding. */
function ringArea2(ring: readonly Position[]): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  return a
}

/**
 * A polygon covering a box with the field cut out of it: the dimmer that makes
 * wedges read as clipped to the fence.
 *
 * The holes must wind the opposite way to the outer ring. MapLibre splits
 * GeoJSON rings into polygons by winding, and a hole wound like its outer ring
 * is drawn as a second filled polygon — the field would be dimmed, not the
 * ground around it.
 */
export function outsideMask(
  g: Polygon | MultiPolygon,
  box: { west: number; south: number; east: number; north: number },
): Polygon {
  const outer: Position[] = [
    [box.west, box.south],
    [box.east, box.south],
    [box.east, box.north],
    [box.west, box.north],
    [box.west, box.south],
  ]
  const outerSign = Math.sign(ringArea2(outer))
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  const holes = polys
    .filter((p) => p[0]?.length >= 4)
    .map((p) => (Math.sign(ringArea2(p[0])) === outerSign ? [...p[0]].reverse() : p[0]))
  return { type: 'Polygon', coordinates: [outer, ...holes] }
}

/**
 * Points spread evenly by AREA over a wedge, for "how much of this wedge is in
 * that zone". Radii go as the square root so the outer rings, which hold most
 * of a wedge's ground, get most of the samples.
 */
export function wedgeSamples(center: LngLat, radiusM: number, w: Wedge, rings = 5, spokes = 4): LngLat[] {
  const out: LngLat[] = []
  for (let r = 0; r < rings; r++) {
    const dist = radiusM * Math.sqrt((r + 0.5) / rings)
    for (let s = 0; s < spokes; s++) out.push(destination(center, w.a0 + ((s + 0.5) / spokes) * (w.a1 - w.a0), dist))
  }
  return out
}

/**
 * Season applied water as 1° bins, read off FieldNET's applied_geom wedges.
 *
 * The fallback for a pivot the daily bins have not reached yet. Each degree is
 * sampled by POINT — the middle of the degree at half the radius, then further
 * out and further in — against the polygons, rather than by reading angles off
 * the polygon rings. The rings do not reliably start at the centre, and the
 * old applied_sectors got its angles wrong by assuming they did.
 *
 * Returns null when there is nothing to read. A degree inside no polygon is 0.
 */
export function binsFromAppliedGeom(fc: unknown, center: LngLat, radiusM: number): number[] | null {
  const feats = (fc as { features?: unknown } | null)?.features
  if (!Array.isArray(feats)) return null
  const shapes: { g: Polygon | MultiPolygon; depth: number }[] = []
  for (const f of feats as { geometry?: { type?: string }; properties?: Record<string, unknown> }[]) {
    const depth = Number(f?.properties?.depth)
    const t = f?.geometry?.type
    if (!Number.isFinite(depth) || (t !== 'Polygon' && t !== 'MultiPolygon')) continue
    shapes.push({ g: f.geometry as Polygon | MultiPolygon, depth })
  }
  if (!shapes.length) return null
  const out = new Array<number>(360).fill(0)
  for (let d = 0; d < 360; d++) {
    for (const frac of [0.5, 0.75, 0.3, 0.9]) {
      const pt = destination(center, d + 0.5, radiusM * frac)
      const hit = shapes.find((s) => pointInGeometry(pt, s.g))
      if (hit) {
        out[d] = hit.depth
        break
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Reading NDVI back out of the stored rasters
// ---------------------------------------------------------------------------

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/**
 * The ramp step a pixel colour came from, or -1 if it is none of them.
 *
 * The NDVI rasters (netlify/shared/sat-imagery.ts) are painted with exactly the
 * seven NDVI_RAMP colours and nothing in between — the evalscript picks
 * COLOURS[round(t × 6)] and PNG is lossless — so an exact match is expected.
 * The tolerance only absorbs a browser's colour management nudging a channel.
 */
export function rampIndex(r: number, g: number, b: number, ramp: readonly Rgb[], tolerance = 24): number {
  let best = -1
  let bestD = tolerance * tolerance * 3
  for (let i = 0; i < ramp.length; i++) {
    const d = (r - ramp[i][0]) ** 2 + (g - ramp[i][1]) ** 2 + (b - ramp[i][2]) ** 2
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * The NDVI a ramp step stands for: the value its bucket is centred on.
 *
 * The evalscript maps t = (ndvi − lo) ÷ (hi − lo), clamped to 0..1, to step
 * round(t × (n − 1)), so step i covers t within half a step of i ÷ (n − 1).
 * The end steps also hold everything clamped beyond lo and hi, so a wedge of
 * bare ground reads no lower than lo — a floor that only matters on ground far
 * below the rest of the field, which the map flags regardless.
 */
export function rampValue(i: number, steps: number, lo: number, hi: number): number {
  return lo + (i / (steps - 1)) * (hi - lo)
}

export type RasterBox = { west: number; south: number; east: number; north: number }
export type Raster = { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

/** Pixel (x, y) centre in lng/lat. The rasters are requested in EPSG:4326, so this is linear. */
export function pixelLngLat(x: number, y: number, r: Raster, box: RasterBox): LngLat {
  return [
    box.west + ((x + 0.5) / r.width) * (box.east - box.west),
    box.north - ((y + 0.5) / r.height) * (box.north - box.south),
  ]
}

/**
 * How much of the field an image actually saw: clear pixels over pixels inside
 * the boundary. Cloud and smoke are transparent holes in these rasters, so a
 * half-clouded look shows up here as 0.5.
 */
export function clearFraction(r: Raster, box: RasterBox, boundary: Polygon | MultiPolygon): number {
  let inside = 0
  let clear = 0
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (!pointInGeometry(pixelLngLat(x, y, r, box), boundary)) continue
      inside++
      if (r.data[(y * r.width + x) * 4 + 3] >= 128) clear++
    }
  }
  return inside ? clear / inside : 0
}

export type WedgeNdvi = {
  /** Mean NDVI per wedge; null where fewer than minPixels clear pixels fell. */
  means: (number | null)[]
  /** Clear pixels per wedge — 10 m each, so ~100 per hectare. */
  pixels: number[]
}

/**
 * Mean NDVI on each wedge from an NDVI raster.
 *
 * Each opaque pixel is turned back into NDVI by its ramp step, placed by its
 * centre, and averaged into the wedge it falls in. Averaging a hundred-odd
 * seven-step values per wedge gives a mean far finer than one step, which is
 * what a comparison between wedges needs.
 */
export function ndviByWedge(
  r: Raster,
  box: RasterBox,
  center: LngLat,
  radiusM: number,
  arc: PivotArc,
  wedgeCount: number,
  ramp: readonly Rgb[],
  lo: number,
  hi: number,
  minPixels = 4,
): WedgeNdvi {
  const sum = new Array<number>(wedgeCount).fill(0)
  const pixels = new Array<number>(wedgeCount).fill(0)
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const o = (y * r.width + x) * 4
      if (r.data[o + 3] < 128) continue
      const { bearing, dist } = localPolar(center, pixelLngLat(x, y, r, box))
      if (dist > radiusM) continue
      const wi = wedgeIndexOf(bearing, arc, wedgeCount)
      if (wi < 0) continue
      const step = rampIndex(r.data[o], r.data[o + 1], r.data[o + 2], ramp)
      if (step < 0) continue
      sum[wi] += rampValue(step, ramp.length, lo, hi)
      pixels[wi]++
    }
  }
  return { means: sum.map((s, i) => (pixels[i] >= minPixels ? s / pixels[i] : null)), pixels }
}
