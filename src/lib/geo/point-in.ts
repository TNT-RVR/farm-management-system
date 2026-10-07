import type { MultiPolygon, Polygon, Position } from 'geojson'
import { haversineM } from './measure'

/**
 * Which field a point is standing in.
 *
 * The phone knows where it is, and every field knows its shape, so anything
 * entered from a phone can default to the field underfoot — a moisture test, a
 * task, a note — rather than a dropdown of twenty-three names scrolled through
 * with a wet thumb.
 */

/** Ray-cast point-in-ring. The ring may or may not repeat its first point. */
export function pointInRing(p: Position, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** Inside the outer ring and outside every hole. */
export function pointInPolygon(p: Position, poly: Polygon['coordinates']): boolean {
  if (!poly.length || !pointInRing(p, poly[0])) return false
  return !poly.slice(1).some((hole) => pointInRing(p, hole))
}

export function pointInMultiPolygon(p: Position, mp: MultiPolygon): boolean {
  return mp.coordinates.some((poly) => pointInPolygon(p, poly))
}

export type Located<T> = { item: T; inside: boolean; distanceM: number }

/**
 * The field a point is in, or failing that the nearest one within reach.
 *
 * "Nearest" exists for the approach and the yard: a truck parked on the
 * headland is a few metres outside the drawn boundary, and the reading it is
 * about to enter is still for that field. Beyond `withinM` nothing is offered,
 * because a guess from the shop is worse than a blank.
 */
export function locate<T>(
  p: Position,
  items: { item: T; shape: MultiPolygon; anchor: Position }[],
  withinM = 500,
): Located<T> | null {
  let best: Located<T> | null = null
  for (const { item, shape, anchor } of items) {
    if (pointInMultiPolygon(p, shape)) return { item, inside: true, distanceM: 0 }
    const d = haversineM(p, anchor)
    if (d <= withinM && (!best || d < best.distanceM)) best = { item, inside: false, distanceM: d }
  }
  return best
}
