import type { Geometry, MultiPolygon, Position } from 'geojson'

/**
 * How close to water Alberta lets manure go.
 *
 * From the Agricultural Operation Practices Act, which applies to every farm in
 * the province and not only to confined feeding operations. The distances are
 * the province's, not this app's:
 *
 *   - 30 m from a common body of water, surface applied and incorporated
 *     within 48 hours. This is what a solid spreader does here.
 *   - 10 m if the manure is injected below the surface.
 *   - 30 m from a water well.
 *
 * AOPA also sets slope-based setbacks for forage, direct-seeded crops and
 * frozen or snow-covered ground, where the required distance grows with the
 * slope toward the water. Those are published as diagrams rather than a table
 * and are NOT encoded here — the screen says so instead of quietly applying the
 * flat-ground number to a case the regulation treats differently.
 *
 * This is a guide for planning. The operator is responsible for the rule.
 */
export type ApplicationMethod = 'surface' | 'injected'

export const AOPA_SETBACK_M: Record<ApplicationMethod, number> = {
  surface: 30,
  injected: 10,
}

/** From a water well, whichever way the manure goes on. */
export const AOPA_WELL_SETBACK_M = 30

export const setbackFor = (method: ApplicationMethod): number => AOPA_SETBACK_M[method]

/**
 * Degrees to metres, locally.
 *
 * A degree of longitude is two thirds of a degree of latitude at 50°N, so
 * measuring in degrees and multiplying by one constant reports an east-west
 * distance a third too large. Everything below works in metres on a plane
 * centred on the shape being measured, which over the few hundred metres a
 * setback covers is exact enough that the error is far below a GPS fix.
 */
function projector(lat: number) {
  const mPerDegLat = 111_132
  const mPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180)
  return (p: Position): [number, number] => [p[0] * mPerDegLon, p[1] * mPerDegLat]
}

/** Distance from a point to a line segment, in whatever units came in. */
function pointToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function segmentToSegment(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number],
): number {
  // Crossing segments are zero apart. Without this, two shapes that overlap
  // report the distance between their nearest corners instead of nothing.
  const d = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = d(b1, b2, a1)
  const d2 = d(b1, b2, a2)
  const d3 = d(a1, a2, b1)
  const d4 = d(a1, a2, b2)
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0
  return Math.min(
    pointToSegment(a1, b1, b2),
    pointToSegment(a2, b1, b2),
    pointToSegment(b1, a1, a2),
    pointToSegment(b2, a1, a2),
  )
}

/** Ray casting, on projected coordinates. */
function inRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const hit =
      ring[i][1] > p[1] !== ring[j][1] > p[1] &&
      p[0] <
        ((ring[j][0] - ring[i][0]) * (p[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]
    if (hit) inside = !inside
  }
  return inside
}

/**
 * Every ring of a geometry, as lists of positions. Lines count as one ring.
 *
 * Points and geometry collections come back empty rather than throwing: the
 * water layers are lines and polygons today, and a stray point feature should
 * be ignored, not crash the map somebody is drawing on.
 */
export function ringsOf(geom: Geometry): Position[][] {
  switch (geom.type) {
    case 'Polygon':
      return geom.coordinates
    case 'MultiPolygon':
      return geom.coordinates.flat()
    case 'LineString':
      return [geom.coordinates]
    case 'MultiLineString':
      return geom.coordinates
    default:
      return []
  }
}

const isArea = (type: string) => type === 'Polygon' || type === 'MultiPolygon'

/**
 * How far a drawn spread is from a water feature, in metres. Zero if it touches.
 *
 * Measured edge to edge rather than centre to centre: the question AOPA asks is
 * about the nearest part of the spread, and a centre-to-centre figure would
 * pass a quarter-section spread whose corner runs into the creek.
 */
export function distanceToFeature(spread: MultiPolygon, feature: Geometry): number {
  const spreadRings = ringsOf(spread)
  const featureRings = ringsOf(feature)
  if (spreadRings.length === 0 || featureRings.length === 0) return Number.POSITIVE_INFINITY

  const lat = spreadRings[0][0]?.[1] ?? 50
  const project = projector(lat)
  const a = spreadRings.map((r) => r.map(project))
  const b = featureRings.map((r) => r.map(project))

  // Containment either way is an overlap, and a shape entirely inside another
  // never crosses an edge — so the segment test alone would miss it.
  if (isArea(feature.type) && b.some((ring) => a.some((r) => r.some((p) => inRing(p, ring))))) return 0
  if (a.some((ring) => b.some((r) => r.some((p) => inRing(p, ring))))) return 0

  let best = Number.POSITIVE_INFINITY
  for (const ra of a) {
    for (let i = 0; i < ra.length - 1; i++) {
      for (const rb of b) {
        for (let j = 0; j < rb.length - 1; j++) {
          const d = segmentToSegment(ra[i], ra[i + 1], rb[j], rb[j + 1])
          if (d < best) best = d
          if (best === 0) return 0
        }
      }
    }
  }
  return best
}

export type SetbackCheck = {
  /** Metres to the nearest water feature, or null when none are on file. */
  distanceM: number | null
  requiredM: number
  /** False only when a feature is genuinely too close — never merely unknown. */
  breach: boolean
  nearest: { name: string | null; kind: string } | null
}

/**
 * Whether a drawn spread clears the setback.
 *
 * With no water features loaded this returns `breach: false` and a null
 * distance, and the screen must say "not checked" rather than "clear". An app
 * that reports compliance it has not established is worse than one that says
 * nothing.
 */
export function checkSetback(
  spread: MultiPolygon,
  water: { name: string | null; kind: string; geometry: Geometry }[],
  method: ApplicationMethod = 'surface',
): SetbackCheck {
  const requiredM = setbackFor(method)
  if (water.length === 0) return { distanceM: null, requiredM, breach: false, nearest: null }

  let best = Number.POSITIVE_INFINITY
  let nearest: { name: string | null; kind: string } | null = null
  for (const w of water) {
    const d = distanceToFeature(spread, w.geometry)
    if (d < best) {
      best = d
      nearest = { name: w.name, kind: w.kind }
    }
  }
  if (!Number.isFinite(best)) return { distanceM: null, requiredM, breach: false, nearest: null }
  return { distanceM: best, requiredM, breach: best < requiredM, nearest }
}
