import type { Position } from 'geojson'

/**
 * Great-circle steps on a spherical earth: where a bearing and a distance land,
 * which way one point lies from another, and a circle drawn from them.
 *
 * Good to a metre or so at farm sizes — a pivot's few hundred metres, a
 * trough's 800 m reach — which is all a shape on the map needs.
 */

const EARTH_R = 6_371_000
const RAD = Math.PI / 180

/** Destination [lng, lat] from a point, a bearing (degrees from north) and a distance in metres. */
export function destination(from: Position, bearingDeg: number, distM: number): [number, number] {
  const br = bearingDeg * RAD
  const d = distM / EARTH_R
  const φ1 = from[1] * RAD
  const λ1 = from[0] * RAD
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(br))
  const λ2 = λ1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2))
  return [λ2 / RAD, φ2 / RAD]
}

/** Initial bearing (degrees from north, 0–360) from a to b, both [lng, lat]. */
export function bearingBetween(a: Position, b: Position): number {
  const φ1 = a[1] * RAD
  const φ2 = b[1] * RAD
  const Δλ = (b[0] - a[0]) * RAD
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) / RAD + 360) % 360
}

/**
 * A circle of `radiusM` around a point, as a closed ring: `steps` points
 * stepped evenly in bearing from north, then the first one again.
 */
export function circleRing(center: Position, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = []
  for (let i = 0; i < steps; i++) ring.push(destination(center, (i / steps) * 360, radiusM))
  ring.push(ring[0])
  return ring
}
