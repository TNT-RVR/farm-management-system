import type { MultiPolygon, Polygon } from 'geojson'
import { haversineM } from './geo/measure'
import { pointInGeometry } from './geo/point-in'

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
 * Is a point inside a field's boundary, holes respected?
 *
 * Longitude/latitude are treated as plain x/y (lib/geo/point-in). Over a
 * quarter section that costs nothing, and the alternative — projecting every
 * boundary — would be arithmetic nobody could check against a map.
 */
export function pointInBoundary(
  lng: number,
  lat: number,
  boundary: Polygon | MultiPolygon | null | undefined,
): boolean {
  return pointInGeometry([lng, lat], boundary)
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

/** Metres between two points (great circle, lib/geo/measure). */
export function metresBetween(aLng: number, aLat: number, bLng: number, bLat: number): number {
  return haversineM([aLng, aLat], [bLng, bLat])
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
