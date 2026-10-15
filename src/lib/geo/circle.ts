import type { Position } from 'geojson'

/**
 * A circle of `radiusM` around a point, as a closed ring of positions.
 *
 * Good to a metre or so at this size: the earth is treated as a sphere and
 * the ring is stepped in bearing, which is what a trough's 800 m looks like
 * on the map and all that a dashed guide line needs.
 */
export function circleRing([lon, lat]: Position, radiusM: number, steps = 64): Position[] {
  const R = 6_371_000
  const d = radiusM / R
  const lat1 = (lat * Math.PI) / 180
  const lon1 = (lon * Math.PI) / 180
  const ring: Position[] = []
  for (let i = 0; i <= steps; i++) {
    const b = (i / steps) * 2 * Math.PI
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b))
    const lon2 =
      lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }
  return ring
}
