import type { MultiPolygon, Polygon, Position } from 'geojson'

/**
 * Which field you are standing in.
 *
 * Used to warn somebody walking into a crop that is still inside its re-entry
 * interval. Deliberately plain arithmetic on the boundaries the app already
 * has — no map, no network, nothing that needs to load before it can answer.
 *
 * The limits are worth stating plainly, because this is a safety feature and
 * overselling it would be worse than not having it: it only runs while the app
 * is open, a phone in a pocket warns nobody, and GPS on a handset is good to
 * some tens of metres. It is a reminder at a gate, not a fence.
 */

/**
 * Is a point inside a ring? Ray casting, counting crossings to the east.
 *
 * Longitude/latitude are treated as plain x/y. Over a quarter section that
 * costs nothing, and the alternative — projecting every boundary — would be
 * arithmetic nobody could check against a map.
 */
function inRing(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    // Strictly one side of the edge, so a vertex is not counted twice.
    const straddles = yi > lat !== yj > lat
    if (straddles && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Inside the outer ring and outside every hole. */
function inPolygon(lng: number, lat: number, rings: Position[][]): boolean {
  if (!rings.length || !inRing(lng, lat, rings[0])) return false
  for (let i = 1; i < rings.length; i++) if (inRing(lng, lat, rings[i])) return false
  return true
}

export function pointInBoundary(
  lng: number,
  lat: number,
  boundary: Polygon | MultiPolygon | null | undefined,
): boolean {
  if (!boundary) return false
  if (boundary.type === 'Polygon') return inPolygon(lng, lat, boundary.coordinates)
  return boundary.coordinates.some((poly) => inPolygon(lng, lat, poly))
}

export type FieldShape = { fieldId: string; boundary: Polygon | MultiPolygon | null | undefined }

/**
 * The first field containing this point, if any.
 *
 * First rather than nearest: boundaries here do not overlap, and picking a
 * "best" match would invent a judgement the data cannot support.
 */
export function fieldAt(lng: number, lat: number, shapes: FieldShape[]): string | null {
  for (const s of shapes) if (pointInBoundary(lng, lat, s.boundary)) return s.fieldId
  return null
}

/** Metres between two points. Equirectangular — fine over a field, cheap to run. */
export function metresBetween(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6_371_000
  const toRad = Math.PI / 180
  const x = (bLng - aLng) * toRad * Math.cos(((aLat + bLat) / 2) * toRad)
  const y = (bLat - aLat) * toRad
  return Math.sqrt(x * x + y * y) * R
}

/**
 * Has the reading moved enough to be worth re-checking?
 *
 * A stationary phone reports a slightly different position every few seconds.
 * Without this the warning would recompute constantly, and on a boundary line
 * it would flicker in and out of the field.
 */
export function movedEnough(
  from: { lng: number; lat: number } | null,
  to: { lng: number; lat: number },
  metres = 25,
): boolean {
  if (!from) return true
  return metresBetween(from.lng, from.lat, to.lng, to.lat) >= metres
}
