/**
 * Minimal ESRI shapefile (.shp) polygon reader — enough for boundary imports.
 * Spec: 100-byte big-endian header, then records of (8-byte BE record header,
 * little-endian shape). Type 5 = Polygon. Ring winding in the wild is
 * unreliable (John Deere exports violate it), so outer-vs-hole is classified
 * by containment, not winding.
 */
import type { MultiPolygon, Position } from 'geojson'
import { ringAreaM2 } from './area'

const SHAPE_NULL = 0
const SHAPE_POLYGON = 5

function pointInRing(pt: Position, ring: Position[]): boolean {
  const [x, y] = pt
  let inside = false
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside
  }
  return inside
}

/** Group rings into GeoJSON MultiPolygon coordinates with RFC 7946 winding. */
export function ringsToMultiPolygon(rings: Position[][]): MultiPolygon['coordinates'] {
  const ranked = [...rings].sort((a, b) => Math.abs(ringAreaM2(b)) - Math.abs(ringAreaM2(a)))
  const groups: Position[][][] = []
  for (const ring of ranked) {
    const parent = groups.find((g) => pointInRing(ring[0], g[0]))
    if (parent) parent.push(ring)
    else groups.push([ring])
  }
  return groups.map((group) =>
    group.map((ring, i) => {
      const ccw = ringAreaM2(ring) > 0
      const wantCcw = i === 0
      return ccw === wantCcw ? ring : [...ring].reverse()
    }),
  )
}

export function parseShp(buf: ArrayBuffer): MultiPolygon {
  const view = new DataView(buf)
  if (view.getInt32(0, false) !== 9994) throw new Error('Not a shapefile (bad magic)')

  const allRings: Position[][] = []
  let pos = 100
  while (pos + 8 <= buf.byteLength) {
    const contentWords = view.getInt32(pos + 4, false)
    pos += 8
    const recStart = pos
    const shapeType = view.getInt32(recStart, true)
    if (shapeType === SHAPE_POLYGON) {
      const numParts = view.getInt32(recStart + 36, true)
      const numPoints = view.getInt32(recStart + 40, true)
      const partsOff = recStart + 44
      const pointsOff = partsOff + 4 * numParts
      const parts: number[] = []
      for (let i = 0; i < numParts; i++) parts.push(view.getInt32(partsOff + 4 * i, true))
      for (let i = 0; i < numParts; i++) {
        const start = parts[i]
        const end = i + 1 < numParts ? parts[i + 1] : numPoints
        const ring: Position[] = []
        for (let j = start; j < end; j++) {
          ring.push([
            view.getFloat64(pointsOff + 16 * j, true),
            view.getFloat64(pointsOff + 16 * j + 8, true),
          ])
        }
        if (ring.length >= 4) allRings.push(ring)
      }
    } else if (shapeType !== SHAPE_NULL) {
      throw new Error(`Unsupported shapefile geometry type ${shapeType} (only polygons)`)
    }
    pos = recStart + contentWords * 2
  }
  if (allRings.length === 0) throw new Error('Shapefile contains no polygon rings')
  return { type: 'MultiPolygon', coordinates: ringsToMultiPolygon(allRings) }
}

/** Loud CRS check: boundaries must arrive as WGS84 lon/lat (EPSG:4326). */
export function assertWgs84Prj(prjText: string, sourceName: string): void {
  const t = prjText.toUpperCase()
  if (!t.includes('WGS_1984') && !t.includes('WGS 84') && !t.includes('4326')) {
    throw new Error(
      `${sourceName}: projection is not WGS84/EPSG:4326 — re-export in lat/long or convert first. .prj says: ${prjText.slice(0, 120)}…`,
    )
  }
}
