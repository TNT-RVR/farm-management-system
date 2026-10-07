import type { MultiPolygon, Position } from 'geojson'

/**
 * The outer ring of the biggest part, which is the field.
 *
 * A boundary can be a MultiPolygon — a field split by a road, or a shapefile
 * that brought a sliver along. The draw tool edits one ring, so editing the
 * largest is the only honest choice; saving then replaces the whole boundary
 * with that ring, which is why the screen says so before you start.
 */
export function largestRing(mp: MultiPolygon | null): Position[] | null {
  if (!mp?.coordinates?.length) return null
  let best: Position[] | null = null
  let bestLen = 0
  for (const poly of mp.coordinates) {
    const ring = poly[0]
    if (ring && ring.length > bestLen) {
      best = ring
      bestLen = ring.length
    }
  }
  if (!best) return null
  // The tool holds open rings; a GeoJSON ring repeats its first point.
  const ring = [...best]
  if (ring.length > 1) {
    const a = ring[0]
    const b = ring[ring.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) ring.pop()
  }
  return ring
}
